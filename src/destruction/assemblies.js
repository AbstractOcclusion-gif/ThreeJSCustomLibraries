import * as C from 'cannon-es';
import {createBendableMember} from './bendable.js';
import {createBreakableFloors,validateFloorRows} from './floors.js';
import {validateStructure,createPrattBridgeDefinition} from './definitions.js';

export function createBridgeFrameDefinition(){
 const d=createPrattBridgeDefinition();d.name='Bendable Pratt structural frame';
 for(const m of d.members){delete m.boxes;delete m.deck;}return d;
}

export function createBuildingFrameDefinition({stories=3,floors=false,cladding=false,bays=[1,1],assets={}}={}){
 if(typeof floors!=='boolean')throw Error('Floor option must be boolean');
 if(typeof cladding!=='boolean')throw Error('Cladding option must be boolean');
 if(!Number.isInteger(stories)||stories<1||stories>15)throw Error('Buildings support 1 to 15 storeys');
 if(!Array.isArray(bays)||bays.length!==2||!bays.every(n=>Number.isInteger(n)&&n>=1&&n<=3))throw Error('Bays must be two integers between 1 and 3');
 // Column grid of nx by nz bays (8 x 6 m each). [1,1] is the original four-column sample.
 const [nx,nz]=bays,bayX=8,bayZ=6,nodes=[],members=[],levels=[],panels=[],at=(i,j)=>j*(nx+1)+i;
 for(let floor=0;floor<=stories;floor++){const row=[];for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){row.push(nodes.length);nodes.push({position:[(i-nx/2)*bayX,floor*4,(j-nz/2)*bayZ],anchor:floor===0});}levels.push(row);}
 const asset=id=>assets instanceof Map?assets.get(id):assets[id];
 const add=(a,b,type,storey)=>{members.push({a,b,type,profile:'steel',storey,loadAbove:stories-storey+1});return members.length-1;};
 for(let storey=1;storey<=stories;storey++){
  const low=levels[storey-1],high=levels[storey],column=[];for(let k=0;k<low.length;k++)column.push(add(low[k],high[k],'column',storey));
  const xBeam=[],zBeam=[];
  for(let j=0;j<=nz;j++){xBeam[j]=[];for(let i=0;i<nx;i++)xBeam[j][i]=add(high[at(i,j)],high[at(i+1,j)],'beam',storey);}
  for(let j=0;j<nz;j++){zBeam[j]=[];for(let i=0;i<=nx;i++)zBeam[j][i]=add(high[at(i,j)],high[at(i,j+1)],'beam',storey);}
  for(const i of [0,nx])for(let j=0;j<nz;j++)add(low[at(i,j)],high[at(i,j+1)],'brace',storey);
  if(floors)for(let i=0;i<nx;i++)add(low[at(storey%2?i:i+1,nz)],high[at(storey%2?i+1:i,nz)],'brace',storey);
  if(floors)for(let bj=0;bj<nz;bj++)for(let bi=0;bi<nx;bi++){const first=panels.length,cx=(bi-nx/2+.5)*bayX,cz=(bj-nz/2+.5)*bayZ;for(let zi=0;zi<2;zi++)for(let xi=0;xi<2;xi++){
   const x=cx+(xi-.5)*3.75,z=cz+(zi-.5)*2.75,y=storey*4+.34,halfExtents=[1.855,.07,1.355],mass=halfExtents[0]*2*halfExtents[1]*2*halfExtents[2]*2*2400;
   panels.push({storey,kind:'slab',assetId:'slab',bearingTolerance:.4,position:[x,y,z],halfExtents,mass:asset('slab')?.massKg??mass,breakEnergy:asset('slab')?.breakEnergyJ??25000,breakForce:180000,bearings:[{member:xBeam[bj+zi][bi],point:[x,storey*4+.23,(bj+zi-nz/2)*bayZ]},{member:zBeam[bj][bi+xi],point:[(bi+xi-nx/2)*bayX,storey*4+.23,z]}],neighbours:[first+zi*2+(1-xi),first+(1-zi)*2+xi]});
  }}
  if(cladding){
   // Four fitted strips reserve a real opening; the window never overlaps a
   // solid wall collider. The same 8 m asset also fits the 6 m side bays.
   const face=(cx,cz,width,angle,left,right,beam)=>{
    const cos=Math.cos(angle),sin=Math.sin(angle),base=(storey-1)*4;
    const point=(x,y)=>[cx+cos*x,base+y,cz-sin*x];
    const first=panels.length,side=(width-2)/2;
    const strips=[[-(width+2)/4,2,side,4,'wall'],[(width+2)/4,2,side,4,'wall'],[0,.625,2,1.25,'wall'],[0,3.375,2,1.25,'wall'],[0,2,2,1.5,'window']];
    const adjacent=[[2,3,4],[2,3,4],[0,1,4],[0,1,4],[0,1,2,3]];
    for(const [index,[x,y,w,h,id]]of strips.entries()){
     const scale=id==='wall'?[w/8,h/4,1]:[1,1,1],mass=(asset(id)?.massKg??(id==='wall'?15360:150))*scale[0]*scale[1];
     const bearings=index<2?[{member:index===0?left:right,point:point(index===0?-width/2:width/2,2)},{member:beam,point:point(x,4)}]:index===3?[{member:beam,point:point(0,4)}]:[];
     panels.push({storey,kind:id,assetId:id,assetScale:scale,quaternion:[0,Math.sin(angle/2),0,Math.cos(angle/2)],position:point(x,y),halfExtents:[w/2,h/2,id==='wall'?.1:.01],mass,breakEnergy:(asset(id)?.breakEnergyJ??(id==='wall'?25000:3))*scale[0]*scale[1],breakForce:id==='window'?15000:180000,bearingTolerance:.03,bearings:bearings.map(b=>({member:b.member,point:[...b.point]})),neighbours:adjacent[index].map(n=>first+n)});
    }
   };
   for(const j of [0,nz])for(let i=0;i<nx;i++)face((i-nx/2+.5)*bayX,(j-nz/2)*bayZ+(j===0?-.42:.42),bayX,0,column[at(i,j)],column[at(i+1,j)],xBeam[j][i]);
   for(const i of [0,nx])for(let j=0;j<nz;j++)face((i-nx/2)*bayX+(i===0?-.42:.42),(j-nz/2+.5)*bayZ,bayZ,Math.PI/2,column[at(i,j+1)],column[at(i,j)],zBeam[j][i]);
  }
 }
 // Column capacity scales with the storey mass each column carries (slabs + frame),
 // keeping the original four-column sample's safety factor for larger grids.
 const columns=(nx+1)*(nz+1),storeyMass=panels.filter(p=>p.storey===1).reduce((m,p)=>m+p.mass,0)+members.filter(m=>m.storey===1).reduce((m,r)=>{const a=nodes[r.a].position,b=nodes[r.b].position,len=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);return m+len*(r.type==='brace'?12:35);},0)+columns*120;
 for(const m of members)if(m.type==='column')m.tributaryMass=storeyMass/columns;
 return{version:1,name:stories+'-storey building'+(nx*nz>1?' ('+nx+'x'+nz+' bays)':''),nodes,members,floors:panels,metadata:{span:bayX*nx,width:bayZ*nz,height:stories*4,deckY:0,stories,bays:[nx,nz],cladding,heavy:floors||cladding||stories>3}};
}

// Detached rubble: settle quickly and sleep on its own; the attached frame keeps its authored damping.
// Column axial capacity = safety x tributary storey mass x storeys above x g (3.8 reproduces the original 15 t/storey sample).
export const COLUMN_SAFETY=3.8;
// Stronger column moment connections than floor beams. The previous 150 kNm
// top-column preset is already overloaded by the 3x2 frame's dead-load solve.
export const COLUMN_MOMENT=225000;
export const RUBBLE={sleepSpeed:.25,sleepTime:.5,singleSleepTime:.5,linearDamping:.35,angularDamping:.5,maxSpeed:50,maxSpin:30,
 // Native sleeping retains collision-driven wake-up. Permanent static retirement
 // is optional: hosts may explicitly choose a finite retireAfter for scenery.
 retireAfter:Infinity,budget:300,crowdedDamping:.7,supportTolerance:.12};

// Shared hubs transfer forces and moments between reusable bendable members.
export function createBendableStructure({world,definition,material='ductile',fractureEnabled=true,assets={},strength={}}){
 // Calibration multipliers on member capacities (yield moment and break force): strength.column for
 // columns, strength.beam for beams and braces. 1 keeps the authored presets.
 const strengthOf=row=>{const k=row.type==='column'?strength.column??1:strength.beam??1;if(!(Number.isFinite(k)&&k>0))throw Error('strength multipliers must be positive numbers');return k;};

 validateStructure(definition);if(definition.members.some(m=>m.boxes?.length))throw Error('Bendable assemblies accept bar frames only; use createBridgeFrameDefinition for the bridge');if(!world?.addBody||(!['ductile','elastic','brittle'].includes(material)||typeof fractureEnabled!=='boolean'))throw Error('Invalid bendable structure options');
 validateFloorRows(definition.floors??[],definition.members.length,assets);
 const heavy=!!definition.metadata?.heavy;
 const hubs=definition.nodes.map((n,hubIndex)=>{const body=new C.Body({mass:n.anchor?0:(definition.metadata?.hubMass??(heavy?120:1)),shape:new C.Sphere(.6),position:new C.Vec3(...n.position),collisionFilterGroup:4,collisionFilterMask:0,linearDamping:.1,angularDamping:.1,allowSleep:false});body.hubIndex=hubIndex;world.addBody(body);return body;});
 const members=[],exclusions=[],listeners=new Set();let disposed=false,lastWake=-1,sleeping=false,attachedAsleep=false,settledTime=0,lastDt=1/240,damageEnabled=true;
 const wake=()=>{if(disposed||(!attachedAsleep&&world.time-lastWake<.1))return;lastWake=world.time;sleeping=false;attachedAsleep=false;settledTime=0;for(const b of (attached??partition()))b.wakeUp();};
 let floorSystem=null,attached=null,attachedKey='',islands=[],detachedBodies=[];
 // Bodies still joined to a foundation anchor stay under whole-structure sleep;
 // detached rubble sleeps on its own through Cannon's per-body sleep.
 const partition=()=>{const key=members.reduce((n,m)=>n+m.broken,0)+':'+floorSystem.broken+':'+(floorSystem.revision??0);if(attached&&attachedKey===key)return attached;attachedKey=key;
  const parent=new Map(),find=b=>{let r=b;while(parent.get(r)!==r)r=parent.get(r);let c=b;while(parent.get(c)!==r){const n=parent.get(c);parent.set(c,r);c=n;}return r;},union=(a,b)=>{if(parent.has(a)&&parent.has(b))parent.set(find(a),find(b));},all=[...hubs,...members.flatMap(m=>m.segments.map(s=>s.body)),...(floorSystem.bodies??floorSystem.panels.flatMap(p=>p.broken?p.fragments.map(f=>f.body):[p.body]))];
  for(const b of all){parent.set(b,b);if(!b.activityListener){b.activityListener=true;b.addEventListener('wakeup',()=>{sleeping=false;if(!b.detached&&attachedAsleep)wake();});}}const hubHinges=new Map();for(const m of members)for(const h of m.hinges)if(!h.broken){union(h.a,h.b);for(const x of [h.a,h.b])if(x.hubIndex!==undefined)hubHinges.set(x,(hubHinges.get(x)??0)+1);}for(const b of floorSystem.bonds)if(b.alive)union(b.joint.bodyA,b.joint.bodyB);
  // Unit masonry owns its foundation reachability. Its standing static bodies
  // are also real support roots for the existing timber/roof attachment graph.
  const masonryRoots=definition.metadata?.masonryHouse?floorSystem.panels.filter(p=>p.asset?.masonry).flatMap(p=>p.groups.filter(g=>g.body.mass===0).map(g=>g.body)):[];
  const roots=new Set([...hubs.filter(h=>h.mass===0),...masonryRoots].map(find)),groups=new Map();attached=[];detachedBodies=[];for(const b of all){if(b.mass===0)continue;const root=find(b);if(roots.has(root)){b.allowSleep=false;attached.push(b);continue;}
  if(b.hubIndex!==undefined){if(!hubHinges.get(b)){if(!b.removed){b.removed=true;world.removeBody(b);}continue;}if(!b.detached){b.detached=true;b.collisionFilterMask=1;b.shapes[0].radius=.15;b.shapes[0].updateBoundingSphereRadius();b.updateBoundingRadius();}}
  else if(!b.detached){b.detached=true;b.linearDamping=RUBBLE.linearDamping;b.angularDamping=RUBBLE.angularDamping;}
  b.allowSleep=true;b.sleepTimeLimit=RUBBLE.singleSleepTime;detachedBodies.push(b);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(b);}
  // Single bodies sleep through Cannon. Jointed pieces sleep as one island: a
  // sleeping body acts as infinite mass in the solver, so a half-asleep joint
  // would inject false load spikes and launch the pile.
  islands=[];for(const bodies of groups.values()){if(bodies.length===1){bodies[0].sleepSpeedLimit=RUBBLE.singleSleep===false?0:RUBBLE.sleepSpeed;bodies[0].island=null;continue;}const island={bodies,quiet:0,asleep:bodies.every(b=>b.sleepState===2)};islands.push(island);for(const b of bodies){b.sleepSpeedLimit=RUBBLE.sleepSpeed;b.sleepTimeLimit=Infinity;b.island=island;if(!b.islandListener){b.islandListener=true;b.addEventListener('wakeup',()=>{const isl=b.island;if(isl&&isl.asleep){isl.asleep=false;isl.quiet=0;for(const o of isl.bodies)o.wakeUp();}});}}}
  return attached;};
 const limit2=RUBBLE.sleepSpeed*RUBBLE.sleepSpeed;
 const clampRubble=()=>{const v2=RUBBLE.maxSpeed*RUBBLE.maxSpeed,w2=RUBBLE.maxSpin*RUBBLE.maxSpin;for(const b of detachedBodies){if(b.sleepState===2)continue;const s=b.velocity.lengthSquared();if(s>v2)b.velocity.scale(RUBBLE.maxSpeed/Math.sqrt(s),b.velocity);const a=b.angularVelocity.lengthSquared();if(a>w2)b.angularVelocity.scale(RUBBLE.maxSpin/Math.sqrt(a),b.angularVelocity);}};
 let staticSupports=null;
 const freeze=b=>{if(b.mass===0)return;b.retiredMass=b.mass;b.mass=0;b.type=C.Body.STATIC;b.updateMassProperties();b.velocity.setZero();b.angularVelocity.setZero();b.force.setZero();b.torque.setZero();b.retired=true;b.allowSleep=true;b.sleep();attachedKey='';if(staticSupports&&b.collisionFilterMask!==0)staticSupports.push(b);world.dispatchEvent({type:'structure:body-retired',body:b});};
 // A piece may only freeze while resting on static support (ground, foundations or
 // frozen rubble); a quiet piece hanging in the air keeps simulating.
 const supported=b=>{b.updateAABB();const box=b.aabb,tol=RUBBLE.supportTolerance;if(!staticSupports){staticSupports=world.bodies.filter(o=>o.mass===0&&o.collisionFilterMask!==0&&(o.hubIndex===undefined||o.retired));for(const o of staticSupports)o.updateAABB();}for(const o of staticSupports){if(o===b)continue;const a=o.aabb;if(box.lowerBound.x<=a.upperBound.x+tol&&box.upperBound.x>=a.lowerBound.x-tol&&box.lowerBound.y<=a.upperBound.y+tol&&box.upperBound.y>=a.lowerBound.y-tol&&box.lowerBound.z<=a.upperBound.z+tol&&box.upperBound.z>=a.lowerBound.z-tol)return true;}return false;};
 const retireSettled=()=>{staticSupports=null;const t=world.time,limit=RUBBLE.retireAfter,v2=RUBBLE.sleepSpeed*RUBBLE.sleepSpeed,quiet=b=>b.sleepState===2||(b.velocity.lengthSquared()<v2&&b.angularVelocity.lengthSquared()<v2);
  for(const island of islands){if(island.retired)continue;if(!island.bodies.every(quiet)){island.quietSince=-1;continue;}if(!(island.quietSince>=0))island.quietSince=t;else if(t-island.quietSince>limit&&island.bodies.some(supported)){for(const b of island.bodies)freeze(b);island.retired=true;}}
  for(const b of detachedBodies){if(b.island||b.mass===0)continue;if(!quiet(b)){b.quietSince=-1;continue;}if(!(b.quietSince>=0))b.quietSince=t;else if(t-b.quietSince>limit&&supported(b))freeze(b);}
  let awake=0;for(const island of islands)if(!island.retired&&island.bodies.some(b=>b.mass>0&&b.sleepState!==2))awake++;for(const b of detachedBodies)if(!b.island&&b.mass>0&&b.sleepState!==2)awake++;if(awake>RUBBLE.budget)for(const b of detachedBodies)if(b.mass>0&&b.sleepState!==2&&b.linearDamping<RUBBLE.crowdedDamping){b.linearDamping=RUBBLE.crowdedDamping;b.angularDamping=RUBBLE.crowdedDamping;}};
 const stepIslands=dt=>{clampRubble();retireSettled();if(RUBBLE.islandSleep===false)return;for(const island of islands){const bodies=island.bodies;if(island.retired)continue;if(island.asleep){if(bodies.some(b=>b.sleepState!==2)){for(const b of bodies)b.wakeUp();island.asleep=false;island.quiet=0;}continue;}
  let quiet=true;for(let i=0;i<bodies.length&&quiet;i++){const b=bodies[i];quiet=b.velocity.lengthSquared()<limit2&&b.angularVelocity.lengthSquared()<limit2;}island.quiet=quiet?island.quiet+dt:0;if(island.quiet>RUBBLE.sleepTime){for(const b of bodies)b.sleep();island.asleep=true;}}};
 for(const [id,row]of definition.members.entries()){
  const brace=row.type==='brace'||row.type==='diagonal',length=hubs[row.a].position.distanceTo(hubs[row.b].position),stiffness=brace?6000:12000;
  const profile={segments:2,collisionInset:.25,width:brace?.16:.3,height:brace?.22:.45,massPerMetre:brace?.5:1,stiffness,damping:brace?2:10,yieldMoment:material==='elastic'?12000:6000,response:material==='brittle'?'brittle':'plastic',breakForce:18000,dampingRatio:.9,fractureRotation:material==='brittle'?.035:1.1,fractureEnabled};
  const member=createBendableMember({world,start:definition.nodes[row.a].position,end:definition.nodes[row.b].position,supports:[{body:hubs[row.a],end:'start',connection:row.startConnection??'moment'},{body:hubs[row.b],end:'end',connection:'moment'}],...profile,...(heavy?{jointStiffness:1e10,collisionInset:brace?.4:.25,segments:material==='brittle'?1:2,massPerMetre:brace?12:35,width:brace?.2:.35,height:brace?.3:.55,stiffness:brace?300000:1000000,yieldMoment:(material==='elastic'?1000000:row.type==='column'?COLUMN_MOMENT*Math.sqrt(row.loadAbove??1):150000)*strengthOf(row),breakForce:(row.type==='column'?Math.max(250000,(row.loadAbove??1)*(row.tributaryMass?row.tributaryMass*COLUMN_SAFETY:15000)*9.82):350000)*strengthOf(row),response:material==='brittle'?'brittle':'elastoplastic'}:{}),...row.bendable});member.id=id;member.type=row.type;member.row=row;member.subscribe(event=>{for(const fn of listeners)fn({...event,memberId:id});});members.push(member);for(const s of member.segments){s.body.allowSleep=false;s.body.addEventListener('collide',e=>{if(!s.body.detached&&Math.abs(e.contact.getImpactVelocityAlongNormal())>1)wake();});}
 }
 // Connected sections and crossing braces overlap at fabrication joints. Exclude
 // only their initial collider overlaps until one of those sections fractures.
 const segments=members.flatMap(m=>m.segments.map(s=>({...s,member:m})));
 for(const s of segments)s.body.updateAABB();
 for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
  const a=segments[i],b=segments[j];if(a.member===b.member||!a.body.aabb.overlaps(b.body.aabb))continue;
  const constraint=new C.Constraint(a.body,b.body,{collideConnected:false});constraint.update=()=>{};world.addConstraint(constraint);exclusions.push({a,b,constraint,alive:true});
 }
 floorSystem=createBreakableFloors({world,rows:definition.floors??[],members,assets,wake:body=>{attachedKey='';if(!body?.detached)wake();},onEvent:event=>{for(const fn of listeners)fn(event);}});floorSystem.setFracture(fractureEnabled);
 return{definition,members,hubs,floors:floorSystem,wake,get damageEnabled(){return damageEnabled;},get sleeping(){return sleeping;},
  beforeStep(dt){if(disposed)return;lastDt=dt;floorSystem.beforeStep(dt);for(const m of members)m.beforeStep(dt);for(const e of exclusions)if(e.alive&&(e.a.member.broken||e.b.member.broken)){
   // Enabling contact while authored crossing sections still penetrate would
   // manufacture an explosive separation impulse. Wait for actual clearance.
   e.a.body.updateAABB();e.b.body.updateAABB();if(!e.a.body.aabb.overlaps(e.b.body.aabb)){world.removeConstraint(e.constraint);e.alive=false;}
  }},
  afterStep(){if(disposed)return;for(const m of members)m.afterStep();floorSystem.afterStep();
   if(world.allowSleep){const bodies=partition();if(world.nativeSleep){clampRubble();retireSettled();attachedAsleep=bodies.every(b=>b.sleepState===C.Body.SLEEPING);sleeping=attachedAsleep&&detachedBodies.every(b=>b.sleepState===C.Body.SLEEPING);return;}stepIslands(lastDt);if(!attachedAsleep){let quiet=true;for(let i=0;i<bodies.length&&quiet;i++){const b=bodies[i];quiet=b.velocity.lengthSquared()<.0025&&b.angularVelocity.lengthSquared()<.0025;}settledTime=quiet?settledTime+lastDt:0;if(settledTime>1.5){for(const b of bodies)b.sleep();attachedAsleep=true;}}sleeping=attachedAsleep&&detachedBodies.every(b=>b.sleepState===C.Body.SLEEPING);}
  },
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  get broken(){return members.reduce((sum,m)=>sum+m.broken,0);},get yielded(){return members.filter(m=>m.hinges.some(h=>h.yielded)).length;},
  get totalMass(){const m=b=>b.mass||b.retiredMass||0;return hubs.reduce((sum,h)=>sum+(h.hubIndex!==undefined&&definition.nodes[h.hubIndex].anchor?0:m(h)),0)+members.reduce((sum,x)=>sum+x.segments.reduce((n,s)=>n+m(s.body),0),0)+floorSystem.mass;},
  get permanentRotation(){return Math.max(0,...members.map(m=>m.permanentRotation));},
  setDamage(enabled){damageEnabled=!!enabled;for(const m of members)m.profile.damageEnabled=!!enabled;floorSystem.setDamage(!!enabled);},
  setFracture(enabled){for(const m of members)m.profile.fractureEnabled=!!enabled;floorSystem.setFracture(!!enabled);wake();},
  dispose(){if(disposed)return;disposed=true;for(const e of exclusions)world.removeConstraint(e.constraint);floorSystem.dispose();for(const m of members)m.dispose();for(const h of hubs)if(!h.removed)world.removeBody(h);listeners.clear();}
 };
}












