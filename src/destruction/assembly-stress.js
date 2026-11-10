import * as C from 'cannon-es';
import {sectionProperties} from './cluster-math.js';
import {createStressGraph} from './stress-graph.js';

// Bridges authored masses, bearings and fracture events to the independent
// frame solver. It never creates native bodies or changes visible geometry.
// Minimum simulated time between stress solves caused only by resting-contact load changes.
export const CONTACT_SOLVE_INTERVAL=.25;

// staging: {stiffness, rate} enables graph-level ductility. An overloaded member yields instead of
// fracturing: its stiffness drops to `stiffness` x elastic (loads redistribute, the frame sags), and
// plastic damage accumulates at `rate` x (utilisation - 1) per second until it reaches 1 and the
// member fractures. A relieved member keeps its yielded stiffness without failing.
export const YIELD_STAGING=Object.freeze({stiffness:.25,rate:2,ramp:.4});
export function createAssemblyStress({world,system,responseTime=.05,staging=null}){
 const stagingRule=staging?{...YIELD_STAGING,...(staging===true?{}:staging)}:null;if(stagingRule&&!(stagingRule.stiffness>0&&stagingRule.stiffness<=1&&stagingRule.rate>0&&stagingRule.ramp>=0))throw Error('Invalid yield staging');const yielding=new Map();let lastYieldTime=null,displayResult=null;const DISPLAY_LIMIT=.5;
 const definition=system.definition,memberOf=new Map(),panelOf=new Map(),bearingsOf=new Map(),authored=new Set(system.hubs),floorAuthored=new Set(),owned=new Set(),queued=new Map(),pendingCrush=new Set();
 const members=system.members.map(m=>{const s=sectionProperties(m.profile),axes=[new C.Vec3(1,0,0),new C.Vec3(0,1,0),new C.Vec3(0,0,1)].map(v=>m.segments[0].body.quaternion.vmult(v).toArray());for(const b of m.segments){memberOf.set(b.body,m);authored.add(b.body);}return{a:m.row.a,b:m.row.b,...s,axes,massPerMetre:m.profile.massPerMetre,E:m.profile.E,G:m.profile.G,capacity:{axial:m.profile.breakForce,shear:m.profile.breakForce,bendingY:m.profile.yieldMoment,bendingZ:m.profile.yieldMoment,torsion:m.profile.yieldMoment}};});
 let floorRevision,currentGroups=[],tileNeighbours=new Map(),attachmentGraphRevision=-1;const attachmentCache=new Map();
 function syncPanels(force=false){
  const revision=system.floors.revision??system.floors.panels.map(p=>p.broken?p.fragments.map(f=>f.body.id).join(','):p.body.id).join(';');if(!force&&revision===floorRevision)return;
  floorRevision=revision;for(const b of floorAuthored)authored.delete(b);floorAuthored.clear();panelOf.clear();bearingsOf.clear();tileNeighbours=new Map();attachmentCache.clear();
  currentGroups=system.floors.groups??system.floors.panels.flatMap(p=>{if(p.broken)return p.fragments.map(f=>({...f,panel:p,bearings:[],detached:true}));const bonds=p.bonds.filter(b=>b.joint instanceof C.PointToPointConstraint);return[{panel:p,body:p.body,bearings:p.row.bearings.map((bearing,i)=>({bearing,member:system.members[bearing.member],bond:bonds[i]}))}];});
  for(const g of currentGroups){panelOf.set(g.body,g);authored.add(g.body);floorAuthored.add(g.body);bearingsOf.set(g,(g.bearings??[]).map(x=>({...x,member:typeof x.member==='number'?system.members[x.member]:x.member??system.members[x.bearing.member]})));}
  for(const b of system.floors.bonds)if(b.b){const a=panelOf.get(b.joint.bodyA),c=panelOf.get(b.joint.bodyB);if(!a||!c||a===c)continue;if(!tileNeighbours.has(a))tileNeighbours.set(a,[]);if(!tileNeighbours.has(c))tileNeighbours.set(c,[]);tileNeighbours.get(a).push({other:c,bond:b});tileNeighbours.get(c).push({other:a,bond:b});}
  dirty=true;
 }
 const graph=createStressGraph({nodes:definition.nodes.map((n,i)=>({...n,mass:system.hubs[i].mass})),members});let dirty=true,contactDirty=false,lastContactSolve=-1,lastGravity='',lastFracture=null,lastResult=null,contacts=new Map(),observed=new Map(),disposed=false;
 const externalLoadSets=new Map();
 const stats={status:'pending',solves:0,passes:0,failures:0,yields:0,yielding:0,ms:0,maxMs:0,totalMs:0,maxUtilisation:0,storage:0,externalLoadCount:0,externalForce:[0,0,0]};
 const previousDamage=system.members.map(m=>m.profile.damageEnabled);
 const enabled=()=>system.damageEnabled!==false&&system.members[0]?.profile.fractureEnabled!==false;
 const isAnchored=b=>{syncPanels();return owned.has(memberOf.get(b)?.id)||b.hubIndex!==undefined&&graph.supported[b.hubIndex]||panelOf.has(b)&&panelSupports(panelOf.get(b)).some(x=>x.supported);};
 function attachments(group,preferAnchored=false){
  if(!group)return[];
  if(attachmentGraphRevision!==graph.topologyRevision){attachmentCache.clear();attachmentGraphRevision=graph.topologyRevision;}
  const cacheable=Number.isInteger(system.floors.revision),key=preferAnchored?'anchored':'direct';let cache=cacheable?attachmentCache.get(group):null;
  if(cache?.[key])return cache[key];
  const result=resolveAttachments(group,preferAnchored);
  if(cacheable){if(!cache){cache={};attachmentCache.set(group,cache);}cache[key]=result;}
  return result;
 }
 function resolveAttachments(group,preferAnchored=false){
  if(!group)return[];const direct=(bearingsOf.get(group)??[]).filter(x=>x.bond?.alive),supported=x=>graph.edges[x.bearing.member]?.active&&graph.supported[graph.edges[x.bearing.member].a];if(!group.panel.asset||direct.length&&(!preferAnchored||direct.some(supported)))return direct;
  // Windows may transfer weight through adjacent wall strips. Follow actual
  // surviving panel constraints; proximity alone never creates support.
  const result=[],seen=new Set([group]),bonds=new Set(),pending=[group];while(pending.length){const g=pending.pop();for(const x of bearingsOf.get(g)??[])if(x.bond?.alive&&!bonds.has(x.bond)){bonds.add(x.bond);result.push(x);}for(const {other,bond}of tileNeighbours.get(g)??[])if(bond.alive&&!seen.has(other)){seen.add(other);pending.push(other);}}
  return result;
 }
 function panelSupports(group){const supported=graph.supported;return attachments(group,true).map(({bearing,member,bond})=>({bearing,member,bond,supported:!!bond?.alive&&!!graph.edges[bearing.member]?.active&&supported[graph.edges[bearing.member].a]}));}
 function onMember(id,point,force){const e=graph.edges[id],start=new C.Vec3(...definition.nodes[e.a].position),r=point.vsub(start),axis=new C.Vec3(...e.axes[0]),t=Math.max(0,Math.min(1,r.dot(axis)/e.L)),onLine=start.vadd(axis.scale(t*e.L)),offset=point.vsub(onLine);return{member:id,t,force:force.toArray(),moment:offset.cross(force).toArray()};}
 function sync(){for(const id of yielding.keys())if(system.members[id].hinges.every(h=>h.broken))yielding.delete(id);for(const m of system.members){if(owned.has(m.id)&&m.hinges.some(h=>h.broken)&&m.hinges.some(h=>!h.broken))m.fracture({reason:'stress:connection-lost'});graph.setActive(m.id,m.hinges.every(h=>!h.broken));}}
 function floorLoads(){
  const loads=[];let changed=false;
  if(system.floors.panels.some(p=>!p.asset&&!p.broken)){
  const support=system.floors.panels.map(p=>p.broken?[]:panelSupports(panelOf.get(p.body))),parent=system.floors.panels.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};for(const b of system.floors.bonds)if(b.alive&&b.b)parent[find(b.a.id)]=find(b.b.id);
  const supportedRegions=new Set(support.flatMap((s,i)=>s.some(x=>x.supported)?[find(i)]:[]));
  for(const p of system.floors.panels){if(p.asset||p.broken)continue;const bearings=support[p.id].filter(x=>x.supported);
   // The slab model requires two bearings. A panel bridging a newly unsupported
   // region must not become an infinitely strong substitute for a failed beam.
   if(supportedRegions.has(find(p.id))&&bearings.length<p.row.bearings.length&&enabled()){system.floors.shatter(p);if(p.broken){changed=true;continue;}}
  }
  }
  if(changed)syncPanels(true);
  for(const group of currentGroups){const p=group.panel;if(!p.asset&&p.broken||group.body.world!==world)continue;const bearings=panelSupports(group).filter(x=>x.supported);if(!bearings.length)continue;const force=world.gravity.scale(group.body.mass/bearings.length);
   for(const {bearing}of bearings){const at=new C.Vec3(...bearing.point),load=onMember(bearing.member,at,force),couple=group.body.position.vsub(at).cross(force);load.moment=load.moment.map((v,i)=>v+couple.toArray()[i]);loads.push(load);}
  }
  return{loads,changed};
 }
 function update(){
  if(disposed)return;syncPanels();for(const [id,c]of contacts)if(c.source.world!==world){contacts.delete(id);dirty=true;}const gravity=world.gravity.toString(),allow=enabled();if(gravity!==lastGravity||allow!==lastFracture){dirty=true;lastGravity=gravity;lastFracture=allow;}
  // Resting-contact load changes (debris settling on the frame) are coalesced;
  // damage, impacts, topology and gravity changes still solve immediately.
  // Yielding members accumulate plastic damage with time: keep solving while any exist.
  if(yielding.size)dirty=true;
  if(!dirty&&contactDirty&&world.time-lastContactSolve>=CONTACT_SOLVE_INTERVAL)dirty=true;if(!dirty)return;contactDirty=false;lastContactSolve=world.time;
  const start=performance.now();dirty=false;stats.passes=0;const impulses=[...queued.values()];queued.clear();let pulseAvailable=true;
  // A hit beyond local crushing capacity is a graph damage event, not an
  // interface reaction applied independently to every column in a storey.
  for(const m of pendingCrush)if(allow&&m.fracture({reason:'stress:local-crush'}))stats.failures++;pendingCrush.clear();
  for(let pass=0;pass<48;pass++){
   stats.passes++;sync();const floor=floorLoads();if(floor.changed){sync();}
   const load=floor.loads.slice(),pulsed=pulseAvailable&&impulses.length>0;if(pulseAvailable)for(const impulse of impulses)if(graph.edges[impulse.member]?.active)load.push(impulse);for(const contact of contacts.values())for(const item of contact.loads)if(graph.edges[item.member]?.active)load.push(item);
   for(const set of externalLoadSets.values())for(const item of set.loads)if(graph.edges[item.member]?.active)load.push(item);
   const result=graph.solve({gravity:world.gravity.toArray(),memberLoads:load});pulseAvailable=false;lastResult=result;if(!pulsed)displayResult=result;stats.status=result.status;stats.storage=result.storage;stats.maxUtilisation=Math.max(0,...(result.demands??[]).map(d=>d.utilisation));
   if(result.status!=='stable'){
    // Do not lock a numerically/kinematically unstable component into scenery.
    // Isolate the component containing the reported free DOF for release.
    const freeNodes=result.supported.flatMap((yes,i)=>yes&&!definition.nodes[i].anchor?[i]:[]),node=freeNodes[Math.floor(result.singularDof/6)],root=new Set([node]);let changed=true;while(changed){changed=false;for(const e of graph.edges)if(e.active&&(root.has(e.a)||root.has(e.b))){if(!root.has(e.a)){root.add(e.a);changed=true;}if(!root.has(e.b)){root.add(e.b);changed=true;}}}for(const m of system.members)if(root.has(m.row.a)&&m.fracture({reason:'stress:mechanism'}))stats.failures++;sync();break;
   }
   owned.clear();for(const e of graph.edges)if(e.active&&result.supported[e.a])owned.add(e.id);
   if(stagingRule){const elapsed=lastYieldTime===null?0:Math.max(0,world.time-lastYieldTime);lastYieldTime=world.time;for(const [id,state]of yielding){const target=stagingRule.stiffness,current=graph.edges[id].scale;if(current>target){const next=stagingRule.ramp>0?Math.max(target,current-(1-target)*elapsed/stagingRule.ramp):target;if(next<current)graph.setStiffnessScale(id,next);}}for(const d of result.demands){const state=yielding.get(d.member);if(!state)continue;state.plastic+=Math.max(0,d.utilisation-1)*stagingRule.rate*elapsed;state.utilisation=d.utilisation;}}
   const overloaded=result.demands.filter(d=>allow&&system.members[d.member].profile.fractureEnabled&&d.utilisation>1+1e-6&&!yielding.has(d.member)).sort((a,b)=>b.utilisation-a.utilisation);
   // Yielded members fail once their accumulated plastic damage is spent, not on the next overload.
   let spent=null;for(const [id,state]of yielding)if(allow&&state.plastic>=1){spent=id;break;}
   if(spent!==null){yielding.delete(spent);if(!system.members[spent].fracture({reason:'stress:yield',plastic:1}))break;stats.failures++;continue;}
   if(!overloaded.length)break;
   if(stagingRule){const worst=overloaded[0],m=system.members[worst.member];yielding.set(worst.member,{plastic:0,utilisation:worst.utilisation,peak:worst.utilisation});if(stagingRule.ramp<=0)graph.setStiffnessScale(worst.member,stagingRule.stiffness);for(const h of m.hinges)h.yielded=true;stats.yields++;if(pass===47)dirty=true;continue;}
   // Release the most overloaded bond, then recompute. Failing all overloads
   // at once would destroy columns whose demand is relieved by a weak beam.
   const worst=overloaded[0];if(!system.members[worst.member].fracture({reason:'stress:overload',utilisation:worst.utilisation,force:worst.axial,moment:Math.hypot(worst.bendingY,worst.bendingZ)}))break;stats.failures++;if(pass===47)dirty=true;
  }
  // Contact impulses are transient. Gravity must be re-evaluated after the
  // impact window, not left permanently in the supported load case.
  if(impulses.length)dirty=true;
  stats.yielding=yielding.size;for(const m of system.members)m.profile.damageEnabled=system.damageEnabled!==false&&!owned.has(m.id);stats.solves=graph.solves;stats.ms=performance.now()-start;stats.maxMs=Math.max(stats.maxMs,stats.ms);stats.totalMs+=stats.ms;
 }
 function queueImpact(part,other,force,point=part.position){syncPanels();const m=memberOf.get(part),group=panelOf.get(part);if(m&&owned.has(m.id)){const key=m.id+':'+other.id;if(!queued.has(key)){queued.set(key,onMember(m.id,point,force));dirty=true;}}else if(group){const supports=panelSupports(group).filter(x=>x.supported);for(const x of supports){const key=x.member.id+':'+other.id+':floor'+group.panel.id;queued.set(key,onMember(x.member.id,point,force.scale(1/supports.length)));dirty=true;}}}
 return{graph,stats,update,isAnchored,owns:m=>owned.has(m.id),get result(){return lastResult;},get yielding(){return yielding;},
  // Explicit consumer loads (e.g. native cable-fixing reactions). Replace by
  // owner key, rather than accumulating a fresh persistent load every step.
  setExternalLoads(key,items,{immediate=true}={}){
   if(disposed)return;if(typeof key!=='string'||!Array.isArray(items))throw Error('Invalid external load set');
   const loads=items.map(item=>{const member=memberOf.get(item.body),p=item.point?.toArray?.()??item.point,f=item.force?.toArray?.()??item.force;if(!member||![p,f].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw Error('External load requires a structural body and finite world point/force');return onMember(member.id,new C.Vec3(...p),new C.Vec3(...f));});
   const signature=JSON.stringify(loads);if(externalLoadSets.get(key)?.signature===signature||!loads.length&&!externalLoadSets.has(key))return;
   const changedCount=externalLoadSets.get(key)?.loads.length!==loads.length;if(loads.length)externalLoadSets.set(key,{loads,signature});else externalLoadSets.delete(key);if(immediate||changedCount)dirty=true;else contactDirty=true;
   stats.externalLoadCount=0;stats.externalForce=[0,0,0];for(const set of externalLoadSets.values())for(const item of set.loads){stats.externalLoadCount++;for(let i=0;i<3;i++)stats.externalForce[i]+=item.force[i];}
  },
  // Elastic analysis displacement of an authored node (metres, from the last stable solve) or null.
  // Rendering uses the last gravity/resting solve, never an impact-pulse load case, clamped per axis.
  displacementOf(node){const d=displayResult?.status==='stable'?displayResult.displacements[node]:null;return d?[d[0],d[1],d[2]].map(x=>Math.max(-DISPLAY_LIMIT,Math.min(DISPLAY_LIMIT,x))):null;},attachmentsForBody(body){syncPanels();return attachments(panelOf.get(body)).slice();},
  invalidate(value){if(!value||authored.has(value)||value.equations?.length&&(authored.has(value.bodyA)||authored.has(value.bodyB))){dirty=true;attachmentCache.clear();}},
  // Native regrouping can replace a proxy while its original source parts remain.
  // Retaining that sleeping proxy would count its weight again through its replacement.
  forgetContactProxy(proxy){if(disposed)return;const removed=contacts.delete(proxy.id);observed.delete(proxy.id);if(removed)dirty=true;},
  crush(part,other){const m=memberOf.get(part);if(!enabled()||!m||!owned.has(m.id)||!m.profile.fractureEnabled)return false;const relative=other.velocity.vsub(part.velocity),force=relative.scale(other.mass/responseTime);if(force.length()<=m.profile.breakForce)return false;pendingCrush.add(m);queueImpact(part,other,force);return true;},
  beginContacts(){observed=new Map();},
  contact(part,other,otherProxy,contact){if(!isAnchored(part)||!otherProxy.mass)return;const speed=Math.abs(contact.getImpactVelocityAlongNormal());if(contact.phase!=='persisted'&&speed>1&&contact.normalImpulse>0)queueImpact(part,other,contact.normal.scale(-contact.normalImpulse/responseTime),contact.point);
   if(speed<1&&contact.normal.y>.5){if(!observed.has(otherProxy.id))observed.set(otherProxy.id,{body:otherProxy,source:other,items:new Map()});observed.get(otherProxy.id).items.set(part.id,{part,point:contact.point});}
  },
  endContacts(){const next=new Map();for(const [id,c]of observed){const list=[...c.items.values()],loads=[];for(const item of list){const m=memberOf.get(item.part),p=panelOf.get(item.part),f=world.gravity.scale(c.body.mass/list.length);if(m)loads.push(onMember(m.id,item.point,f));else if(p){const supports=panelSupports(p).filter(x=>x.supported);for(const s of supports)loads.push(onMember(s.member.id,item.point,f.scale(1/supports.length)));}}const key=loads.map(l=>l.member+':'+l.t.toFixed(2)+':'+l.force.join(',')+':'+l.moment.join(',')).join('|');next.set(id,{...c,key,loads});const before=contacts.get(id);if(!before)dirty=true;else if(before.key!==key)contactDirty=true;}
   for(const [id,c]of contacts)if(!next.has(id)){if(c.body.sleepState===C.Body.SLEEPING)next.set(id,c);else dirty=true;}contacts=next;
  },
  dispose(){disposed=true;queued.clear();contacts.clear();pendingCrush.clear();externalLoadSets.clear();for(const [i,m]of system.members.entries()){if(previousDamage[i]===undefined)delete m.profile.damageEnabled;else m.profile.damageEnabled=previousDamage[i];}},
 };
}
