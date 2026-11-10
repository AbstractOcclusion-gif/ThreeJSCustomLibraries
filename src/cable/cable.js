import * as C from 'cannon-es';

const UTILITY_CABLE=Object.freeze({massPerMetre:1.5,radius:.025,damping:.1,color:0x303b47});
export const CABLE_PRESETS=Object.freeze({
 rope:Object.freeze({massPerMetre:1,radius:.035,damping:.14,color:0xb79869}),
 utility:UTILITY_CABLE,
 transmission:Object.freeze({...UTILITY_CABLE,color:0xaab6bf,metalness:.45,roughness:.45}),
 suspension:Object.freeze({massPerMetre:35,radius:.105,damping:.14,color:0x617689,metalness:.45,roughness:.45}),
 support:Object.freeze({massPerMetre:3,radius:.045,damping:.08,color:0x8e9ca8}),
});
export const CABLE_BUDGET=Object.freeze({segments:24,subdivisions:96,radialSides:6,cullDistance:60,disposeDistance:120});
// Wind drag on a link: 0.5 * air density * drag coefficient * (diameter * length) * |v| * v, v = wind - link velocity.
const AIR_DENSITY=1.225,DRAG_COEFFICIENT=1.2,GUST_HZ=.35,GUST_SWING=.5,GUST_PHASE_PER_LINK=.7;
const WIND_WAKE_DELTA=.5;   // m/s of wind change that wakes a sleeping cable
const finite=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);

// No clock, renderer, structural damage graph or electrical dependency. Body
// attachments are borrowed. Only world-point attachments allocate owned anchors.
// Articulated rigid links approximate a rope: local compression can exist before
// folding. Projected tensile force, not total joint force, drives cable rupture.
export function createCable({world,endpoints,length,segments=16,preset='rope',breakStrength=5000,moveFixedBody,solverSteps=[32,8],retentionDistance=120}={}){
 const profile=CABLE_PRESETS[preset];if(!Number.isFinite(retentionDistance)||retentionDistance<1)throw Error('Invalid cable retention distance');
 if(!world?.addBody||!profile||!Number.isInteger(segments)||segments<4||segments>CABLE_BUDGET.segments||!(Number.isFinite(breakStrength)&&breakStrength>0))throw Error('Invalid cable options');
 if(!Array.isArray(endpoints)||endpoints.length!==2)throw Error('Cable needs two explicit attachments');
 if(!Array.isArray(solverSteps)||solverSteps.length!==2||solverSteps.some((n,i)=>!Number.isInteger(n)||n<1||n>(i?32:128)))throw Error('Invalid cable solver steps');
 const position=a=>{if(a?.kind==='body'&&a.body?.world===world&&finite(a.localPoint))return a.body.pointToWorldFrame(new C.Vec3(...a.localPoint));if(a?.kind==='driven'&&world.nativeSleep&&typeof moveFixedBody!=='function')throw Error('Driven Jolt attachment requires moveFixedBody');if(['fixed','driven'].includes(a?.kind)&&finite(a.position))return new C.Vec3(...a.position);throw Error('Invalid cable attachment');};
 const start=position(endpoints[0]),end=position(endpoints[1]),span=start.distanceTo(end);
 if(!(span>=2&&Number.isFinite(length)&&length>=span*1.01&&length<=span*1.3))throw Error('Cable length must be 1–30% longer than a span of at least 2 m');
 // Fit the actual polygon length, rather than treating sag as extra stretch.
 const direction=end.vsub(start).scale(1/span),sagAxis=new C.Vec3(0,-1,0);sagAxis.vsub(direction.scale(sagAxis.dot(direction)),sagAxis);
 // Vertical hanging ropes need a sideways slack bow; subtracting only world Y
 // would fold the initial chain back along itself rather than give it slack.
 if(sagAxis.lengthSquared()<1e-8)sagAxis.set(1,0,0);else sagAxis.normalize();
 const pointsAt=sag=>Array.from({length:segments+1},(_,i)=>{const t=i/segments,p=new C.Vec3();start.lerp(end,t,p);p.vadd(sagAxis.scale(4*sag*t*(1-t)),p);return p;});
 let low=0,high=length,points;for(let i=0;i<45;i++){const sag=(low+high)/2;points=pointsAt(sag);const sum=points.slice(1).reduce((n,p,j)=>n+p.distanceTo(points[j]),0);if(sum>length)high=sag;else low=sag;}
 const links=[],joints=[],attachments=[null,null],listeners=new Set();let disposed=false,revision=0,time=0,fractureEnabled=true,maxGap=0,peakTension=0;
 const emit=event=>{revision++;for(const fn of listeners)fn({...event,time,revision});};
 for(let i=0;i<segments;i++){
  const delta=points[i+1].vsub(points[i]),size=delta.length(),body=new C.Body({mass:size*profile.massPerMetre,shape:new C.Box(new C.Vec3(Math.max(.01,size/2-.006),profile.radius,profile.radius)),position:points[i].vadd(points[i+1]).scale(.5),quaternion:new C.Quaternion().setFromVectors(new C.Vec3(1,0,0),delta.unit()),linearDamping:profile.damping,angularDamping:profile.damping,collisionFilterGroup:2,collisionFilterMask:3});
  body._noSettleFreeze=true;body.cableLink=true;world.addBody(body);links.push({body,length:size});
 }
 function joint(a,b,point,index,tip=point){const pivotA=a.pointToLocalFrame(point),pivotB=b.pointToLocalFrame(tip),constraint=new C.PointToPointConstraint(a,pivotA,b,pivotB,1e8);constraint.collideConnected=false;constraint._nativeSteps=solverSteps.slice();world.addConstraint(constraint);return{a,b,pivotA,pivotB,constraint,index,broken:false,tension:0,compression:0,force:0,gap:0};}
 for(let i=1;i<segments;i++)joints.push(joint(links[i-1].body,links[i].body,points[i],i-1));
 const wake=()=>{for(const {body}of links)body.wakeUp();for(const a of attachments)if(a?.body.mass>0)a.body.wakeUp();};
 function release(end,reason='released'){
  if(disposed||![0,1].includes(end))return false;const a=attachments[end];if(!a)return false;
  world.removeConstraint(a.joint.constraint);if(a.owned)world.removeBody(a.body);attachments[end]=null;wake();emit({type:'cable:released',end,reason});return true;
 }
 function attach(end,spec){
  if(disposed||![0,1].includes(end))throw Error('Invalid cable end');const p=position(spec);release(end,'reattached');
  const owned=spec.kind!=='body',body=owned?new C.Body({mass:0,position:p,collisionFilterMask:0}):spec.body;if(owned)world.addBody(body);
  const link=links[end===0?0:links.length-1],tip=link.body.pointToWorldFrame(new C.Vec3((end===0?-1:1)*link.length/2,0,0));
  // Preserve the cable tip's own pivot when attaching to a different world point.
  const record=joint(body,link.body,p,-1,tip);
  attachments[end]={kind:spec.kind,body,owned,localPoint:body.pointToLocalFrame(p),joint:record};wake();emit({type:'cable:attached',end,kind:spec.kind});
 }
 function breakAt(index,reason='cut'){
  const j=joints[index];if(disposed||!j||j.broken)return false;j.broken=true;world.removeConstraint(j.constraint);wake();emit({type:'cable:broken',joint:index,reason,tension:j.tension});return true;
 }
 function sections(){const out=[];let first=0;for(let i=0;i<joints.length;i++)if(joints[i].broken){if(!links[first].retired)out.push({first,last:i});first=i+1;}if(!links[first].retired)out.push({first,last:links.length-1});return out;}
 const reaction=new C.Vec3(),axis=new C.Vec3(),pivotAWorld=new C.Vec3(),pivotBWorld=new C.Vec3();
 function measure(j,dt){
  if(j.broken)return;
  if((j.a.mass===0||j.a.sleepState===C.Body.SLEEPING)&&(j.b.mass===0||j.b.sleepState===C.Body.SLEEPING))return;
  const e=j.constraint.equations;reaction.set(e[0].multiplier,e[1].multiplier,e[2].multiplier);j.b.pointToWorldFrame(j.pivotB,pivotBWorld);j.b.position.vsub(j.index<0?pivotBWorld:j.a.position,axis);if(axis.lengthSquared()>1e-12)axis.normalize();
  // Adapter lambda points opposite tensile pull along a -> b. At a fixing use
  // the cable's own axis, not the support COM (which can be far below the tip).
  const axial=-reaction.dot(axis);j.force=reaction.length();j.tension=Math.max(0,axial);j.compression=Math.max(0,-axial);j.a.pointToWorldFrame(j.pivotA,pivotAWorld);j.gap=pivotAWorld.distanceTo(pivotBWorld);maxGap=Math.max(maxGap,j.gap);peakTension=Math.max(peakTension,j.tension);
  j.filtered=(j.filtered??0)+(j.tension-(j.filtered??0))*(1-Math.exp(-dt/.025));
 }
 // Optional core/environment.js contract. Sleeping links are left asleep until the wind changes noticeably.
 let environment=null,wokenWindX=0,wokenWindZ=0;
 function applyWind(){
  const w=environment.wind;
  if(Math.hypot(w.x-wokenWindX,w.z-wokenWindZ)>WIND_WAKE_DELTA){wokenWindX=w.x;wokenWindZ=w.z;wake();}
  if(w.speed<=0)return;
  for(let i=0;i<links.length;i++){
   const link=links[i],body=link.body;if(link.retired||body.sleepState===C.Body.SLEEPING)continue;
   const gust=1+w.gust*GUST_SWING*Math.sin(time*GUST_HZ*2*Math.PI+i*GUST_PHASE_PER_LINK);
   const x=w.x*gust-body.velocity.x,y=-body.velocity.y,z=w.z*gust-body.velocity.z;
   const drag=.5*AIR_DENSITY*DRAG_COEFFICIENT*2*profile.radius*link.length*Math.hypot(x,y,z);
   body.force.x+=drag*x;body.force.y+=drag*y;body.force.z+=drag*z;
  }
 }
 endpoints.forEach((a,i)=>attach(i,a));
 return{links,joints,profile,length,attachments,get revision(){return revision;},get disposed(){return disposed;},get sleeping(){return links.every(l=>l.body.sleepState===C.Body.SLEEPING);},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},attach,release,breakAt,wake,
  retireDistant(reference){if(disposed)return 0;if(!finite(reference))throw Error('Invalid cable retention reference');const p=new C.Vec3(...reference);let removed=0;for(const section of sections()){if(section.first===0&&attachments[0]||section.last===links.length-1&&attachments[1])continue;const group=links.slice(section.first,section.last+1);if(!group.every(l=>l.body.sleepState===C.Body.SLEEPING&&l.body.position.distanceTo(p)>retentionDistance))continue;for(let i=section.first;i<section.last;i++){const j=joints[i];j.broken=true;world.removeConstraint(j.constraint);}for(const l of group){l.retired=true;world.removeBody(l.body);removed++;}emit({type:'cable:retired',...section});}return removed;},
  moveEndpoint(end,p){const a=attachments[end];if(!a?.owned||a.kind!=='driven'||!finite(p))throw Error('Endpoint is not a driven world attachment');a.body.position.set(...p);a.body.aabbNeedsUpdate=true;moveFixedBody?.(a.body);wake();},
  setFracture(enabled){fractureEnabled=!!enabled;},
  setEnvironment(next){environment=next??null;},
  beforeStep(dt){if(disposed)return;if(!(dt>0&&dt<=1/120))throw Error('Cable requires fixed steps <= 1/120 s');time+=dt;for(let i=0;i<2;i++)if(attachments[i]&&attachments[i].body.world!==world)release(i,'body-removed');if(environment)applyWind();},
  afterStep(dt){if(disposed)return;for(const j of joints){measure(j,dt);if(fractureEnabled&&!j.broken&&j.filtered>breakStrength)breakAt(j.index,'tension');}for(let i=0;i<2;i++){const a=attachments[i];if(a){measure(a.joint,dt);if(fractureEnabled&&a.joint.filtered>breakStrength)release(i,'tension');}}},
  describe(){return{length,profile,links:links.map(l=>({length:l.length,body:{id:l.body.id,mass:l.body.mass,position:l.body.position.toArray(),quaternion:l.body.quaternion.toArray()}}))};},
  snapshot(){return{revision,sections:sections(),removedBodyIds:links.filter(l=>l.retired).map(l=>l.body.id),broken:joints.map(j=>j.broken),attachments:attachments.map(a=>a?{kind:a.kind,bodyId:a.body.id,point:a.body.pointToWorldFrame(a.localPoint).toArray(),tension:a.joint.tension}:null),tension:Math.max(0,...joints.filter(j=>!j.broken).map(j=>j.tension)),compression:Math.max(0,...joints.filter(j=>!j.broken).map(j=>j.compression)),peakTension,maxGap,segments:links.filter(l=>!l.retired).length,sleeping:links.every(l=>l.body.sleepState===2),breakStrength};},
  dispose(){if(disposed)return;release(0,'dispose');release(1,'dispose');for(const j of joints)world.removeConstraint(j.constraint);for(const l of links)world.removeBody(l.body);listeners.clear();disposed=true;},
 };
}
