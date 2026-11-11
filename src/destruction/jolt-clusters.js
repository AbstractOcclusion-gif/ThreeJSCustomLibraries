import * as C from 'cannon-es';
import {createJoltDriver} from './jolt-driver.js';
import {massProperties,distributeWrench,inertiaWorld} from './cluster-math.js';
import {createAssemblyStress} from './assembly-stress.js';

// Assumed duration over which a struck member absorbs an impactor's momentum (local crushing).
export const CRUSH_TIME=.05;
// softStoreyUnbraces: a softened storey's braces also become pins (they then tear under sway). Off by
// default: it turns a hard hit into a full collapse; with it off the graph alone decides brace loss,
// and a storey leans once its braces have gone.
export const CLUSTER_OPTIONS={inertialSlabs:true,crush:true,softStoreyUnbraces:false,kink:true};
// Dynamic frame: permanent end rotation (radians) a graph-yielded member shows when its plastic
// damage reaches fracture; the visible kink grows linearly with the graph's plastic fraction.
export const KINK_ROTATION=.05;
// Rotational stiffness of those plastic hinges relative to the member's authored lumped stiffness:
// a column end in a frame is far stiffer than the single-member lab value, and an unbraced storey
// needs it to hold the storeys above against overturning (P-delta) while it leans.
export const FRAME_HINGE_STIFFNESS=10;
// Hinged frame columns rupture like any connection: tension past the member's breakForce, twist
// about the member axis past FRAME_TWIST_LIMIT, or a fold past FRAME_HINGE_LIMIT (where the capped hinge
// torque is spent and the connection would otherwise hang the block above on a free pin); all
// radians, all fractured through the graph so the pieces separate.
export const FRAME_HINGE_LIMIT=.12,FRAME_TWIST_LIMIT=.12;
// Minimum native mass (kg) of a hinged frame column: a 140 kg bar pinned between 100+ t blocks is a
// mass ratio the iterative solver cannot hold, and the storey drifts whatever its hinge stiffness.
export const FRAME_COLUMN_MASS=5000;
// Solver iterations for the few joints of the dynamic frame (velocity, position): the chain of heavy
// zones drifts at the world's 12/4.
export const FRAME_JOINT_STEPS=[32,8];
// Seconds a storey is kept awake after its kink changes so the sway can play out; a kink the frame
// cannot reach (bracing still intact) must not keep the building awake forever.
export const KINK_SETTLE_TIME=2;

// The frame graph owns anchored failure. Jolt keeps each supported structure
// rigid, and refines falling components on impact. Original part IDs still own
// rendering and material state; the physics representation is independent.
export function createJoltClusterDriver(J,{staticZoneStories=0,dynamicFrame=2,filterPersistentContacts=true,cacheHulls=true,profile=false,native:nativeOptions={},label=''}={}){
 if(staticZoneStories!==undefined&&(!Number.isInteger(staticZoneStories)||staticZoneStories<0))throw Error('staticZoneStories must be a non-negative integer');
 if(!Number.isInteger(dynamicFrame)||dynamicFrame<0)throw Error('dynamicFrame must be a non-negative integer (storeys per dynamic zone, 0 = static frame)');
 const native=createJoltDriver(J,{velocitySteps:12,positionSteps:4,cacheHulls,profile,...nativeOptions}),shadow=new C.World({allowSleep:true,gravity:new C.Vec3(0,-9.82,0)});
 let world,system,definition,original,stress,stagingRule=null,dirty=true,disposed=false,groups=[],routes=[],fallback=false,anchored=()=>true;const membership=new Map(),levels=new Map(),memberOf=new Map(),panelOf=new Map(),floorBodies=new Set(),refined=new Set(),absorptions=new Map();
 const pair=(a,b)=>a.id<b.id?a.id+':'+b.id:b.id+':'+a.id;let exclusions=new Set(),filteredGroupPairs=new Set();
 const reactionWrenchFlags=new Map();
 const markWorldWrench=c=>{if(!reactionWrenchFlags.has(c))reactionWrenchFlags.set(c,{own:Object.prototype.hasOwnProperty.call(c,'_structureWorldWrench'),value:c._structureWorldWrench});c._structureWorldWrench=true;};
 const restoreWorldWrench=c=>{if(!reactionWrenchFlags.has(c))return;const previous=reactionWrenchFlags.get(c);if(previous.own)c._structureWorldWrench=previous.value;else delete c._structureWorldWrench;reactionWrenchFlags.delete(c);};
 // Native reaction components are world-space wrenches at the source JOINT
 // pivot. Capacity evaluation transports these to the authored member endpoint.
 const write=(c,f,m=new C.Vec3())=>{markWorldWrench(c);const values=[...f.toArray(),...m.toArray()];for(let i=0;i<c.equations.length;i++)c.equations[i].multiplier=values[i]??0;};
 const reactionHistory=new WeakMap();
 const onRetired=()=>{dirty=true;};let panelRevision,zoneStories=0;
 const counters={rebuilds:0,createdProxies:0,reusedProxies:0,createdLeaves:0};
 function syncPanels(force=false){
  const revision=system.floors.revision??system.floors.panels.map(p=>p.broken?p.fragments.map(f=>f.body.id).join(','):p.body.id).join(';');if(!force&&revision===panelRevision)return;
  panelRevision=revision;for(const body of floorBodies)levels.delete(body);floorBodies.clear();panelOf.clear();
  const parts=system.floors.groups??system.floors.panels.flatMap(p=>p.broken?p.fragments.map(f=>({...f,panel:p,bearings:[],detached:true})):[{panel:p,body:p.body}]);
  for(const part of parts){if(part.body.world!==world)continue;levels.set(part.body,part.panel.row.storey);floorBodies.add(part.body);panelOf.set(part.body,part);}
  // Preserve the established joint rest-frame reset at panel revisions.
  dirty=true;
 }
 function clearNative(){for(const c of [...shadow.constraints])shadow.removeConstraint(c);for(const b of [...shadow.bodies])shadow.removeBody(b);}
 function cloneShape(s){if(s instanceof C.Box)return new C.Box(s.halfExtents.clone());if(s instanceof C.Sphere)return new C.Sphere(s.radius);if(s instanceof C.Plane)return new C.Plane();if(s instanceof C.ConvexPolyhedron)return new C.ConvexPolyhedron({vertices:s.vertices.map(v=>v.clone()),faces:s.faces.map(f=>f.slice())});throw Error('Unsupported cluster shape');}
 let lastFramedFrom=Infinity;
 // Lowest storey the dynamic frame starts at: the lowest damaged or yielding storey.
 function framedStorey(damaged){
  // Catalogue whole-wall houses have masonry/footings, not a yielding frame
  // storey. A facade chip or its second hit must not mobilize every grounded
  // wall, footing and roof. Support connectivity still releases free compounds.
  if(!dynamicFrame||definition?.metadata?.wholeWalls)return Infinity;
  let from=Infinity;for(const storey of damaged)from=Math.min(from,storey);for(const id of stress?.yielding?.keys()??[])from=Math.min(from,system.members[id].row.storey);return from;
 }
 // Dynamic frame: a member the graph yields gets its end connections turned into plastic hinges so
 // the storeys above lean on it physically; the graph still owns its failure.
 let lastPush=null,softStorey=true;const recordPush=(hit,other)=>{if(!dynamicFrame||!(other.mass>0)||!levels.has(hit)||!anchored(hit))return;const v=other.velocity;if(v.x*v.x+v.z*v.z>1){lastPush=new C.Vec3(v.x,0,v.z).unit();pushes.set(storeyOfBody(hit),lastPush);}};
 const plasticised=new Set(),kinks=new Map(),pushes=new Map(),storeyOfBody=b=>Math.max(1,levels.get(b)??1);
 const supportHinges=m=>{const own=new Set(m.segments.map(s=>s.body));return m.hinges.filter(h=>!own.has(h.a)||!own.has(h.b));};
 const plasticise=m=>{if(plasticised.has(m))return;plasticised.add(m);const own=new Set(m.segments.map(s=>s.body));if(m.plasticise?.(h=>!own.has(h.a)||!own.has(h.b),{stiffnessScale:FRAME_HINGE_STIFFNESS})>0)dirty=true;for(const h of m.hinges)if(h.plasticised&&!h.effectiveInverse)h.effectiveInverse=axis=>{let sum=0;for(const b of [h.a,h.b]){const proxy=membership.get(b)?.proxy;if(!proxy||!(proxy.mass>0))continue;if(proxy._massTensor){const local=proxy.quaternion.conjugate().vmult(axis),solved=new C.Mat3(proxy._massTensor).solve(local);sum+=local.dot(solved);}else sum+=axis.dot(proxy.invInertiaWorld.vmult(axis));}return sum;};};
 // Soft storey: the first yield on a storey (beam or column) turns every column end of that storey
 // into a plastic hinge, and the storey sways in the direction it was last pushed by an angle set by
 // the overload at yield (the impact pulse is too short for the graph's plastic integration to show
 // it) and grown by the graph's accumulated plastic damage afterwards.
 const softenStorey=(storey,overload=0)=>{let kink=kinks.get(storey);if(!kink){kink={angle:0,axis:null,overload};kinks.set(storey,kink);}
  // The contact that caused a yield is processed after the frame solve: resolve the push direction lazily.
  if(!kink.axis){const push=pushes.get(storey)??pushes.get(storey+1)??pushes.get(storey-1)??lastPush;if(push)kink.axis=new C.Vec3(0,1,0).cross(push);}kink.overload=Math.max(kink.overload,overload);for(const other of system.members){if(other.row.storey!==storey)continue;if(other.type==='column')plasticise(other);
  // Bracing holds a storey straight whatever its columns do. A softened storey's braces become
  // pin-ended members as well: they keep the storey straight after a light blow and tear (tension
  // past their own break force, below) when a hard one sways it, so the lean is earned.
  else if(CLUSTER_OPTIONS.softStoreyUnbraces&&(other.type==='brace'||other.type==='diagonal'))plasticise(other);}return kink;};
 // A sway is slower than native sleeping: keep a kinked storey's columns awake until their plastic
 // hinges have relaxed to the rest rotation they were given.
 const settleKink=storey=>{for(const column of system.members){if(column.row.storey!==storey||!plasticised.has(column)||!stress.owns(column))continue;const isColumn=column.type==='column';for(const h of supportHinges(column)){if(h.broken||h.locked)continue;const relative=h.a.quaternion.conjugate().mult(h.b.quaternion),elastic=h.rest.conjugate().mult(relative),total=h.initialRest.conjugate().mult(relative);// Joint reaction along the member, pointing into it: positive is compression (the graph's business,
   // it carries the building), negative is the connection being pulled apart.
   const e=h.joint.equations,F=new C.Vec3(e[0]?.multiplier??0,e[1]?.multiplier??0,e[2]?.multiplier??0),into=column.segments[Math.floor(column.segments.length/2)].body.position.vsub(h.a.pointToWorldFrame(h.pivotA)),tension=into.lengthSquared()>1e-6?-F.dot(into.unit()):0;if(tension>column.profile.breakForce){column.fracture({reason:'stress:tension',force:tension});break;}
   const sine=Math.hypot(total.x,total.y,total.z),angle=2*Math.atan2(sine,Math.abs(total.w)),dir=h.a.quaternion.conjugate().vmult(column.segments[0].body.quaternion.vmult(new C.Vec3(1,0,0))),twist=sine>1e-9?angle*Math.abs((total.x*dir.x+total.y*dir.y+total.z*dir.z)/sine):0;if(twist>FRAME_TWIST_LIMIT){column.fracture({reason:'stress:torsion',rotation:twist});break;}if(angle>FRAME_HINGE_LIMIT){column.fracture({reason:'stress:hinge-folded',rotation:angle});break;}if(isColumn&&world.time-(kinks.get(storey)?.changedAt??-Infinity)<KINK_SETTLE_TIME&&2*Math.acos(Math.min(1,Math.abs(elastic.w)))>.01){h.a.wakeUp();h.b.wakeUp();}}}};
 // A hinged column whose storey has left the frame (no longer graph-owned) has failed with it: its
 // hinges are rigid-material connections that cannot run as free springs, so it fractures and
 // separates like the rest of the rubble.
 function releaseFallen(){for(const m of plasticised){if(stress.owns(m))continue;plasticised.delete(m);for(const h of m.hinges){h.plasticised=false;h.stiffnessScale=1;delete h.effectiveInverse;}m.fracture({reason:'stress:released'});}}
 function plasticiseYielded(){releaseFallen();if(!softStorey)return;
  // A storey that lost members (graph fractures) softens too: its surviving columns hinge, so an
  // off-centre load leans the storeys above instead of a rigid lock holding them straight.
  for(const storey of damagedStoreys())softenStorey(storey);
  for(const [id,state]of stress.yielding){const m=system.members[id],storey=m.row.storey;const kink=softenStorey(storey,Math.max(0,(state.peak??state.utilisation??1)-1));
   if(!kink.axis||!CLUSTER_OPTIONS.kink)continue;const angle=Math.min(1,Math.max(kink.overload,state.plastic))*KINK_ROTATION;settleKink(storey);if(Math.abs(angle-kink.angle)<1e-4)continue;kink.angle=angle;kink.changedAt=world.time;
   for(const column of system.members){if(column.type!=='column'||column.row.storey!==storey)continue;const own=new Set(column.segments.map(s=>s.body));
    for(const h of supportHinges(column)){if(h.broken||h.locked)continue;const local=h.a.quaternion.conjugate().vmult(kink.axis),turn=new C.Quaternion().setFromAxisAngle(local,own.has(h.b)?angle:-angle);turn.mult(h.initialRest,h.rest);h.rest.normalize();h.a.wakeUp();h.b.wakeUp();}}
  }
 }
 function damagedStoreys(){const damaged=new Set();for(const m of system.members)if(m.hinges.some(h=>h.broken))damaged.add(m.row.storey);for(const panel of system.floors.panels)if(panel.broken)damaged.add(panel.row.storey);return damaged;}
 function rebuild(){
  syncPanels();
  // Preserve the previous rebuild/rest-frame behavior. Retaining older native
  // joint frames changes the response of imperfectly solved debris chains.
  for(const c of [...shadow.constraints])shadow.removeConstraint(c);const previous=new Map(groups.map(g=>[g.key,g]));membership.clear();groups=[];routes=[];exclusions=new Set(world.constraints.filter(c=>!c.collideConnected).map(c=>pair(c.bodyA,c.bodyB)));
  counters.rebuilds++;
  const all=world.bodies,parent=new Map(all.map(b=>[b,b])),find=b=>{let r=b;while(parent.get(r)!==r)r=parent.get(r);while(parent.get(b)!==r){const next=parent.get(b);parent.set(b,r);b=next;}return r;},join=(a,b)=>parent.set(find(a),find(b));
  // Anchors are the definition's anchor nodes (the house's sit at y=0.15, not on level 0).
  const anchors=all.filter(b=>b.mass===0&&(b.hubIndex!==undefined&&definition.nodes[b.hubIndex]?.anchor!==undefined?!!definition.nodes[b.hubIndex].anchor:levels.get(b)===0));for(const b of anchors.slice(1))join(anchors[0],b);
  // Supported parts share a compound across storeys. The stress graph can break
  // beams inside it before regrouping; Jolt interface reactions cannot do that.
  const attachedParent=new Map(all.map(b=>[b,b])),findA=b=>{let r=b;while(attachedParent.get(r)!==r)r=attachedParent.get(r);while(attachedParent.get(b)!==r){const next=attachedParent.get(b);attachedParent.set(b,r);b=next;}return r;},joinA=(a,b)=>attachedParent.set(findA(a),findA(b));for(const b of anchors.slice(1))joinA(anchors[0],b);for(const c of world.constraints)if(c.equations.length)joinA(c.bodyA,c.bodyB);const anchorRoot=anchors.length?findA(anchors[0]):null,anchoredParts=new Set(anchorRoot===null?[]:all.filter(b=>findA(b)===anchorRoot));anchored=b=>anchoredParts.has(b);
  const anchorSet=new Set(anchors),anchorPosts=new Set();if(!softStorey)for(const m of system.members)if(m.type==='column'&&m.hinges.some(h=>anchorSet.has(h.a)||anchorSet.has(h.b)))for(const seg of m.segments)anchorPosts.add(seg.body);
  // A falling connected block stays coarse until impact, then refines through
  // the existing storey/member representation. A debris budget is separate.
  const zone=b=>Math.floor((Math.max(1,levels.get(b)??1)-1)/zoneStories);
  const damaged=damagedStoreys();
  // Dynamic frame (experimental): once the graph damages a storey, that storey and every anchored
  // storey above it leave the static compound and become native dynamic compounds (one per
  // dynamicFrame storeys) locked to each other and to the still-static root below the damage, so
  // the frame leans and settles physically while the graph keeps owning member failure.
  const framedFrom=framedStorey(damaged);lastFramedFrom=framedFrom;
  // Single-storey assemblies (no soft storey) keep their posts in the static root too: the structure
  // rocks on its columns instead of translating on its anchor joints.
  const postRooted=b=>!softStorey&&anchorPosts.has(b);
  const storeyOf=b=>Math.max(1,levels.get(b)??1),rooted=b=>anchored(b)&&(storeyOf(b)<framedFrom||postRooted(b)),framedZone=b=>Math.floor((storeyOf(b)-framedFrom)/dynamicFrame);
  // A plasticised member is its own rigid body: its hinges must sit between compounds to act.
  const plasticMember=b=>{const m=memberOf.get(b);return m&&plasticised.has(m)?m:null;};
  const condense=(a,b)=>(plasticMember(a)||plasticMember(b))?plasticMember(a)===plasticMember(b):(anchored(a)&&anchored(b)&&(rooted(a)&&rooted(b)?(!zoneStories||zone(a)===zone(b)):!rooted(a)&&!rooted(b)&&framedZone(a)===framedZone(b)))||(!anchored(a)&&!anchored(b)&&(!refined.has(a)&&!refined.has(b)||levels.get(a)===levels.get(b)&&!damaged.has(levels.get(a))));
  // A panel bearing on a bare anchor is not condensed with it: cladding whose frame has gone must not
  // become a static wall standing on its ground bearings.
  const bareAnchor=b=>b.mass===0&&!memberOf.has(b)&&anchorSet.has(b);
  for(const c of world.constraints)if(levels.has(c.bodyA)&&levels.has(c.bodyB)&&condense(c.bodyA,c.bodyB)&&((c instanceof C.LockConstraint)||(c instanceof C.PointToPointConstraint&&floorBodies.has(c.bodyA)&&!bareAnchor(c.bodyB)&&!bareAnchor(c.bodyA))))join(c.bodyA,c.bodyB);
  const buckets=new Map();for(const b of all){const r=find(b);if(!buckets.has(r))buckets.set(r,[]);buckets.get(r).push(b);}
  for(const parts of buckets.values()){
   // Supported means frame members or hubs standing on the root; panels alone are not a structure.
   const supported=parts.some(b=>levels.has(b)&&rooted(b)&&!floorBodies.has(b)),framed=!supported&&parts.some(b=>levels.has(b)&&anchored(b)),key=(supported?'S':framed?'F':'D')+parts.map(b=>b.id+(b.retired?'s':'')).sort().join(',');const kept=previous.get(key);if(kept){counters.reusedProxies++;previous.delete(key);for(const b of parts){membership.set(b,kept);b._structureFramed=framed;}groups.push(kept);continue;}
   counters.createdProxies++;
   for(const b of parts)if(b.mass&&b.shapes.length===1&&!b._massTensor){b.shapes[0].calculateLocalInertia(b.mass,b.inertia);b.invInertia.set(b.inertia.x?1/b.inertia.x:0,b.inertia.y?1/b.inertia.y:0,b.inertia.z?1/b.inertia.z:0);b.updateInertiaWorld(true);}
   // A hinged frame column is a pin between heavy blocks: give it the frame mass and an isotropic
   // tensor (its own slender-bar tensor leaves the hinge springs explicit-unstable in torsion).
   const props=massProperties(parts);let boost=1;if(framed&&plasticMember(parts[0])&&props.mass<FRAME_COLUMN_MASS){boost=FRAME_COLUMN_MASS/props.mass;props.mass*=boost;const t=props.tensor.map(v=>v*boost),top=Math.max(t[0],t[4],t[8]);t[0]=t[4]=t[8]=top;props.tensor=t;}
   const proxy = new C.Body({
    mass: supported ? 0 : props.mass,
    position: props.position,
    velocity: supported ? new C.Vec3() : props.velocity,
    angularVelocity: supported ? new C.Vec3() : props.angularVelocity,
    collisionFilterGroup: parts.some(body => body.collisionFilterGroup === 2) ? 2 : parts[0].collisionFilterGroup,
    collisionFilterMask: parts.some(body => body.collisionFilterMask !== 0) ? 3 : 0,
    allowSleep: true,
   });
   proxy._massTensor = props.tensor;
   const single = parts.length === 1 ? parts[0] : null;
   proxy._originalSingle = single;
   if (single) {
    proxy.quaternion.copy(single.quaternion);
    proxy.quaternion.normalize();
    const {x, y, z} = single.inertia;
    proxy._massTensor = single._massTensor?.slice() ?? [x, 0, 0, 0, y, 0, 0, 0, z];
    proxy.material = single.material;
    if (boost > 1) {
     const tensor = proxy._massTensor.map(value => value * boost);
     const dominantInertia = Math.max(tensor[0], tensor[4], tensor[8]);
     tensor[0] = tensor[4] = tensor[8] = dominantInertia;
     proxy._massTensor = tensor;
    }
   }
   proxy._partIDs = [];
   proxy._partMap = new Map();
   proxy._structureSupported=supported||framed;
   // A dynamic-frame zone is one link of a jointed chain: freezing links one by one makes the chain
   // creep and re-release, so these rely on native island sleeping instead.
   if(framed)proxy._noSettleFreeze=true;
   const group={key,proxy,parts,supported,framed,locals:new Map(),members:new Set(parts.map(b=>memberOf.get(b)).filter(Boolean))};
   for(const b of parts){b._structureFramed=framed;const offset=proxy.pointToLocalFrame(b.position);group.locals.set(b,{offset,quaternion:proxy.quaternion.conjugate().mult(b.quaternion),velocity:b.velocity.clone(),spin:b.angularVelocity.clone()});membership.set(b,group);proxy._partMap.set(b.id+1,b);if(b.collisionFilterMask===0||!b.shapes.length)continue;for(let i=0;i<b.shapes.length;i++){const shape=cloneShape(b.shapes[i]),shapePosition=proxy.pointToLocalFrame(b.pointToWorldFrame(b.shapeOffsets[i])),shapeRotation=proxy.quaternion.conjugate().mult(b.quaternion.mult(b.shapeOrientations[i]));shapeRotation.normalize();proxy.shapes.push(shape);proxy.shapeOffsets.push(shapePosition);proxy.shapeOrientations.push(shapeRotation);shape.body=proxy;proxy._partIDs.push(b.id+1);}}
   // Cannon addShape finalizes the whole compound on every child. These fresh
   // shape/pose objects have the same ownership; finalize once after assembly.
   counters.createdLeaves+=proxy.shapes.length;proxy.updateMassProperties();proxy.updateBoundingRadius();proxy.aabbNeedsUpdate=true;
   // A new free or framed compound starts awake, parts included: a block whose support failed below it
   // has all its own parts still asleep, and a proxy slept from them would hang in the air.
   if(supported)proxy.sleep();else for(const b of parts)if(b.mass>0)b.wakeUp();proxy.addEventListener('collide',e=>collision(group,e));shadow.addBody(proxy);groups.push(group);
  }
  filteredGroupPairs=new Set();for(const c of world.constraints)if(!c.collideConnected){const a=membership.get(c.bodyA),b=membership.get(c.bodyB);if(a&&b&&a!==b)filteredGroupPairs.add(pair(a.proxy,b.proxy));}
  const welds=new Map();for(const c of world.constraints){if(!c.equations.length)continue;const a=membership.get(c.bodyA),b=membership.get(c.bodyB);if(a===b||a.supported&&b.supported)continue;
   if(c instanceof C.LockConstraint){const key=pair(a.proxy,b.proxy);if(!welds.has(key))welds.set(key,{a,b,links:[]});welds.get(key).links.push(c);}
   else{const point=c instanceof C.DistanceConstraint?null:c.bodyA.pointToWorldFrame(c.pivotA),joint=c instanceof C.DistanceConstraint?new C.DistanceConstraint(a.proxy,b.proxy,c.distance):new C.PointToPointConstraint(a.proxy,a.proxy.pointToLocalFrame(point),b.proxy,b.proxy.pointToLocalFrame(point),1e8);joint.collideConnected=c.collideConnected||a.parts.length!==1||b.parts.length!==1;if(c._nativeSteps)joint._nativeSteps=c._nativeSteps.slice();if(joint.distanceEquation)joint.distanceEquation.maxForce=0;if(a.framed||b.framed)joint._nativeSteps=FRAME_JOINT_STEPS;shadow.addConstraint(joint);routes.push({joint,links:[c],a,b,point});}
  }
  // Original per-part exclusions remain in contactFilter. Suppressing an entire
  // compound pair would also suppress unrelated slab/debris contacts.
  for(const weld of welds.values()){const joint=new C.LockConstraint(weld.a.proxy,weld.b.proxy,{maxForce:1e9});joint.collideConnected=true;if(weld.a.framed||weld.b.framed)joint._nativeSteps=FRAME_JOINT_STEPS;shadow.addConstraint(joint);routes.push({...weld,joint});}
  for(const stale of previous.values()){stress.forgetContactProxy(stale.proxy);shadow.removeBody(stale.proxy);}
  // Cannon constraints wake both endpoints on creation; a static supported compound must stay asleep
  // or its parts are kept awake (and their loads re-accounted) every step.
  for(const g of groups)if(g.supported&&g.proxy.sleepState!==C.Body.SLEEPING)g.proxy.sleep();
  shadow.time=world.time;dirty=false;
 }
 function collision(group,event){
  const hit=event.contact.partA,other=event.contact.partB;if(!hit||!other||hit.world!==world||other.world!==world)return;
  // Anchored structure bumping anchored structure (zones, hinged columns) is not an impact load on
  // the graph either; free bodies are.
  if(!event.body?._structureSupported)stress.contact(hit,other,event.body,event.contact);if(event.contact.phase==='persisted')return;
  recordPush(hit,other);
  if(!group.supported&&!group.framed&&group.parts.length>1&&Math.abs(event.contact.getImpactVelocityAlongNormal())>2){for(const b of group.parts)refined.add(b);dirty=true;}
  hit.dispatchEvent({type:'collide',body:other,contact:event.contact});
  const member=memberOf.get(hit);if(!member||stress.owns(member))return;const speed=Math.abs(event.contact.getImpactVelocityAlongNormal());if(speed<1)return;
  // Resolve one contact wrench across the surviving connections. Previously the
  // complete impulse was copied to EVERY hinge, multiplying local damage.
  const hinges=member.hinges.filter(h=>!h.broken),links=hinges.map(h=>({body:hit,point:h.joint.bodyA.pointToWorldFrame(h.joint.pivotA),profile:member.profile,length:member.length,area:member.profile.section==='rectangle'?member.profile.width*member.profile.height:member.profile.massPerMetre/(member.profile.density??7850)}));if(!links.length)return;
  const otherGroup=membership.get(other),M=group.proxy.mass,N=otherGroup?.proxy.mass??0,reduced=M&&N?M*N/(M+N):Math.max(M,N),impulse=event.contact.normalImpulse??reduced*speed*1.03,force=event.contact.normal.scale(impulse/lastDt),loads=distributeWrench(links,force,new C.Vec3(),event.contact.point);
  for(let n=0;n<hinges.length;n++){const h=hinges[n];if(membership.get(h.a)!==membership.get(h.b))continue;markWorldWrench(h.joint);const values=[...loads[n].force.toArray(),...loads[n].moment.toArray()];for(let i=0;i<h.joint.equations.length;i++)h.joint.equations[i].multiplier+=values[i]??0;}
 }
 // Native float readback at the 100 rad/s cap can square just above 10000.
 // The input guard admits that rounding only, and still rejects non-finite spin.
 let lastDt=1/60,pendingCollisions=[];
 function step(dt){lastDt=dt;const start=performance.now();syncPanels();stress.update();if(dynamicFrame){plasticiseYielded();if(!dirty&&framedStorey(damagedStoreys())!==lastFramedFrom)dirty=true;}if(dirty)rebuild();timing.rebuild+=performance.now()-start;shadow.time=world.time;shadow.stepnumber=world.stepnumber;shadow.gravity.copy(world.gravity);pendingCollisions=[];stress.beginContacts();
  for(const g of groups){const p=g.proxy;if(!p.mass)continue;const deltaP=new C.Vec3(),deltaL=new C.Vec3();p.force.setZero();p.torque.setZero();let ld=0,ad=0;
   for(const b of g.parts){const local=g.locals.get(b),r=b.position.vsub(p.position),dv=b.velocity.vsub(local.velocity),dw=b.angularVelocity.vsub(local.spin);if(dv.lengthSquared()){const momentum=dv.scale(b.mass);deltaP.vadd(momentum,deltaP);deltaL.vadd(r.cross(momentum),deltaL);}if(dw.lengthSquared())deltaL.vadd(new C.Mat3(inertiaWorld(b)).vmult(dw),deltaL);p.force.vadd(b.force,p.force);p.torque.vadd(b.torque.vadd(r.cross(b.force)),p.torque);ld+=b.linearDamping*b.mass/p.mass;ad+=b.angularDamping*b.mass/p.mass;}
   p.velocity.vadd(deltaP.scale(1/p.mass),p.velocity);if(deltaL.lengthSquared()>1e-16){const local=p.quaternion.conjugate().vmult(deltaL),dw=new C.Mat3(p._massTensor).solve(local);p.angularVelocity.vadd(p.quaternion.vmult(dw),p.angularVelocity);}if(!Number.isFinite(p.angularVelocity.lengthSquared())||p.angularVelocity.lengthSquared()>10000.01)throw Error('Input spin at '+world.time+' w='+p.angularVelocity.toString()+' delta='+deltaL.toString()+' mass='+p.mass+' tensor='+p._massTensor+' locals='+g.parts.map(b=>b.angularVelocity.toString()).join(';'));p.linearDamping=ld;p.angularDamping=ad;if(g.parts.every(b=>b.mass===0||b.sleepState===C.Body.SLEEPING))p.sleep();else if(p.sleepState===C.Body.SLEEPING)p.wakeUp();
  }
  // Dynamic-frame zones are one locked chain hanging off the static root: a sleeping zone forced
  // inactive natively would pin its awake neighbours, so the whole chain sleeps or wakes together.
  // (Only a moving zone wakes the others: a quiet one re-activated every step would reset the native
  // sleep timers of zones in other islands and the frame would never rest.)
  if(dynamicFrame&&groups.some(g=>g.framed&&g.proxy.sleepState!==C.Body.SLEEPING&&g.proxy.velocity.lengthSquared()+g.proxy.angularVelocity.lengthSquared()>.0025))for(const g of groups)if(g.framed&&g.proxy.sleepState===C.Body.SLEEPING)g.proxy.wakeUp();
  // Native callbacks are queued until the original part poses and reactions
  // have been synchronized, so fracture reads one consistent completed step.
  const solveStart=performance.now();collecting=true;shadow.step(dt);collecting=false;timing.native+=performance.now()-solveStart;const syncStart=performance.now();world.time=shadow.time;world.stepnumber=shadow.stepnumber;
  for(const g of groups){const p=g.proxy,n=p.quaternion.x**2+p.quaternion.y**2+p.quaternion.z**2+p.quaternion.w**2;if(!Number.isFinite(p.position.lengthSquared())||p.position.lengthSquared()>1e8||Math.abs(n-1)>.001)throw Error('Cluster pose invalid at '+world.time+' p='+p.position.toString()+' q='+p.quaternion.toString()+' parts='+g.parts.length);}
  for(const g of groups)for(const b of g.parts){if(!b.mass)continue;const p=g.proxy;if(p.sleepState===C.Body.SLEEPING&&b.sleepState===C.Body.SLEEPING)continue;const local=g.locals.get(b),r=p.quaternion.vmult(local.offset);p.position.vadd(r,b.position);p.quaternion.mult(local.quaternion,b.quaternion);b.quaternion.normalize();p.velocity.vadd(p.angularVelocity.cross(r),b.velocity);b.angularVelocity.copy(p.angularVelocity);b.updateInertiaWorld(true);b.aabbNeedsUpdate=true;b.force.setZero();b.torque.setZero();if(p.sleepState===C.Body.SLEEPING)b.sleep();else if(b.sleepState===C.Body.SLEEPING)b.wakeUp();local.velocity.copy(b.velocity);local.spin.copy(b.angularVelocity);}
  timing.sync+=performance.now()-syncStart;const loadsStart=performance.now();const awake=new Set(groups.filter(g=>g.proxy.mass>0&&g.proxy.sleepState!==C.Body.SLEEPING)),live=b=>awake.has(membership.get(b)),active=pendingCollisions.length>0||absorptions.size>0||awake.size>0;
  if(!active){stress.endContacts();stress.update();timing.loads+=performance.now()-loadsStart;return;}
  // Only joints, members and slabs of awake proxies carry changing loads.
  const liveConstraints=[];for(const c of world.constraints){if(!c.equations.length)continue;if(live(c.bodyA)||live(c.bodyB)){liveConstraints.push(c);for(const e of c.equations)e.multiplier=0;}}
  // Between two anchored groups (dynamic-frame zones and the root) the interface reaction is the
  // frame's own weight path: it goes to member connections only. Panel bonds and bearings crossing
  // the boundary are no more loaded than they were inside one static compound.
  const anchoredPair=route=>(route.a.supported||route.a.framed)&&(route.b.supported||route.b.framed),memberLink=c=>memberOf.has(c.bodyA)||memberOf.has(c.bodyB);
  for(const route of routes){if(!awake.has(route.a)&&!awake.has(route.b))continue;const e=route.joint.equations,F=new C.Vec3(...e.slice(0,3).map(e=>e.multiplier)),M=e.length===6?new C.Vec3(...e.slice(3).map(e=>e.multiplier)):new C.Vec3();const frameOnly=anchoredPair(route);if(!(route.joint instanceof C.LockConstraint)){if(!frameOnly||memberLink(route.links[0]))write(route.links[0],F,M);continue;}
   const routeLinks=frameOnly?route.links.filter(memberLink):route.links;if(!routeLinks.length)continue;
   const centre=route.a.proxy.pointToWorldFrame(route.joint.pivotA),links=routeLinks.map(c=>{const body=memberOf.has(c.bodyB)?c.bodyB:c.bodyA,member=memberOf.get(body);return{body,point:c.bodyA.pointToWorldFrame(c.pivotA),profile:member?.profile,length:member?.length,area:member?.profile.section==='rectangle'?member.profile.width*member.profile.height:(member?.profile.massPerMetre??35)/(member?.profile.density??7850)};}),loads=distributeWrench(links,F,M,centre);for(let i=0;i<loads.length;i++){const sign=membership.get(routeLinks[i].bodyB)===route.b?1:-1;write(routeLinks[i],loads[i].force.scale(sign),loads[i].moment.scale(sign));}
  }
  // Transfer each member's end wrench through its still-rigid internal joints.
  const liveMembers=new Set();for(const g of awake)for(const m of g.members)liveMembers.add(m);
  for(const m of liveMembers){const external=m.hinges.find(h=>!h.broken&&membership.get(h.a)!==membership.get(h.b));if(!external)continue;const e=external.joint.equations,F=new C.Vec3(...e.slice(0,3).map(e=>e.multiplier)),M=e.length===6?new C.Vec3(...e.slice(3).map(e=>e.multiplier)):new C.Vec3(),point=external.joint.bodyA.pointToWorldFrame(external.joint.pivotA);for(const h of m.hinges)if(!h.broken&&h!==external&&membership.get(h.a)===membership.get(h.b)){const r=point.vsub(h.joint.bodyA.pointToWorldFrame(h.joint.pivotA));write(h.joint,F.negate(),M.vadd(r.cross(F)).negate());}}
  for(const g of awake){const p=g.proxy;g.acceleration=g.previousVelocity?p.velocity.vsub(g.previousVelocity).scale(1/dt):new C.Vec3();g.previousVelocity=p.velocity.clone();}
  // Slab bearings inside a compound carry the slab's weight plus its inertial load,
  // so a storey slamming into the ground loads its slabs as a real deceleration does.
  const bearingForces=new Map();for(const body of floorBodies){const part=panelOf.get(body),panel=part.panel;if(!panel.asset&&panel.broken)continue;const g=membership.get(body);if(!g||!awake.has(g))continue;const bearings=stress.attachmentsForBody(body);if(!bearings.length)continue;// (A dynamic-frame zone is still anchored structure: its impact loads reach the graph through the
  // contact path, so its bearings carry self-weight only; the jolt of a whole storey block moving as
  // one body would otherwise tear every cladding fixing on it at once.)
  const a=CLUSTER_OPTIONS.inertialSlabs&&!g.framed?g.acceleration:new C.Vec3(),support=(panel.asset?a.vsub(world.gravity):new C.Vec3(a.x,a.y+9.82,a.z)).scale(body.mass/(panel.asset?bearings.length:2));for(const {bond}of bearings)if(bond.alive&&bond.joint instanceof C.PointToPointConstraint&&membership.get(bond.joint.bodyA)===membership.get(bond.joint.bodyB)){if(!bearingForces.has(bond.joint))bearingForces.set(bond.joint,new C.Vec3());bearingForces.get(bond.joint).vadd(support,bearingForces.get(bond.joint));}}
  for(const [joint,force]of bearingForces)write(joint,force);
  for(const [group,event]of pendingCollisions)collision(group,event);
  for(const {other,part,capacity}of absorptions.values()){const rel=other.velocity.vsub(part.velocity),speed=rel.length();if(speed>1e-6){const loss=Math.min(speed,capacity*CRUSH_TIME/other.mass);other.velocity.vsub(rel.scale(loss/speed),other.velocity);}}absorptions.clear();stress.endContacts();stress.update();
  // Condensed rigid joints produce step-wide impulse peaks, not resolved elastic
  // stress waves. Preserve their impulse while spreading damage demand over a
  // short response time. Keep history on the original joint across regrouping.
  const alpha=1-Math.exp(-dt/.06);for(const c of liveConstraints){let history=reactionHistory.get(c);if(!history){history=c.equations.map(e=>e.multiplier);reactionHistory.set(c,history);}for(let i=0;i<c.equations.length;i++){history[i]+=alpha*(c.equations[i].multiplier-history[i]);c.equations[i].multiplier=history[i];}}
  timing.loads+=performance.now()-loadsStart;
 }
 const timing={rebuild:0,native:0,sync:0,loads:0};let collecting=false;const collisionNow=collision;collision=(group,event)=>{if(collecting){pendingCollisions.push([group,event]);return;}collisionNow(group,event);};
 return{
  get name(){return (fallback?'Jolt individual':'Jolt stress graph 1.5')+label;},heavyStep:1/60,rigidStep:1/60,
  attach(target,context){world=target;system=context.system;stagingRule=context.staging??(dynamicFrame?true:null);definition=context.definition;if(!definition.metadata?.stories){fallback=true;native.attach(world);return;}zoneStories=staticZoneStories;
   // The soft storey is a storey mechanism (hinged column line under a static root). A single-storey
   // assembly such as the house has no such line: it still becomes one dynamic compound locked to
   // its anchors once damaged (the blow is absorbed by motion), but its members never hinge.
   softStorey=(definition.metadata.stories??1)>=2;
   world.nativeSleep=true;for(const h of system.hubs)levels.set(h,definition.nodes[h.hubIndex].position[1]/4);for(const m of system.members)for(const s of m.segments){levels.set(s.body,m.row.storey);memberOf.set(s.body,m);}syncPanels(true);// Local crushing: an impactor whose momentum exceeds a condensed member's
   // capacity fractures that member before the contact is resolved, so the blow
   // is absorbed locally instead of shoving the whole rigid storey.
   const impactor=b=>b&&b.mass>0&&b.shapes[0] instanceof C.Sphere&&b.hubIndex===undefined;
   const absorb=(other,part,capacity)=>{absorptions.set(other.id+':'+part.id,{other,part,capacity});};
   const crush=(part,other)=>{if(!CLUSTER_OPTIONS.crush||!impactor(other))return false;recordPush(part,other);const g=membership.get(part);if(!g||g.parts.length<=1)return false;const force=other.mass*other.velocity.vsub(part.velocity).length()/CRUSH_TIME;
    const member=memberOf.get(part);if(member){if(!stress.crush(part,other))return false;absorb(other,part,member.profile.breakForce);return true;}
    const panel=panelOf.get(part)?.panel;if(panel&&(panel.asset||!panel.broken)&&force>panel.row.breakForce){const before=system.floors.revision,broken=panel.broken,targetMass=g.proxy.mass,reduced=targetMass>0?other.mass*targetMass/(other.mass+targetMass):other.mass;const changed=system.floors.shatter(panel,panel.asset?{point:other.position,body:part,energy:.5*reduced*other.velocity.vsub(part.velocity).lengthSquared(),radius:(other.shapes[0]?.radius??1)*1.5}:undefined);if(changed===true||system.floors.revision!==before||!broken&&panel.broken){absorb(other,part,panel.row.breakForce);return true;}}return false;};
   shadow.contactFilter=(a,b)=>{if(!a||!b||exclusions.has(pair(a,b)))return false;return !crush(a,b)&&!crush(b,a);};shadow.contactPairFilter=(a,b)=>a&&b&&!filteredGroupPairs.has(pair(a,b))&&!(a._originalSingle&&impactor(a._originalSingle))&&!(b._originalSingle&&impactor(b._originalSingle));shadow.observePersistentContacts=true;
   if(filterPersistentContacts){
    // All contacts still solve in Jolt. Persisted events are consumed only by
    // supported-frame resting-load accounting; moving rubble has no consumer.
    // Anchored structure touching anchored structure (dynamic-frame zones, hinged columns) is the
    // frame's own weight path, already in the graph: only free bodies are resting loads.
    shadow.observePersistentPair=(a,b)=>!!a&&!!b&&((a._structureSupported&&b.mass>0&&!b._structureSupported)||(b._structureSupported&&a.mass>0&&!a._structureSupported));
    shadow.observePersistentContact=(a,b,partA,partB)=>!!partA&&!!partB&&((b.mass>0&&stress.isAnchored(partA))||(a.mass>0&&stress.isAnchored(partB)));
   }
   native.attach(shadow,{system});original={addBody:world.addBody,removeBody:world.removeBody,addConstraint:world.addConstraint,removeConstraint:world.removeConstraint,step:world.step};for(const method of ['addBody','removeBody','addConstraint','removeConstraint'])world[method]=function(value){dirty=true;stress?.invalidate(value);if(method==='removeConstraint')restoreWorldWrench(value);return original[method].call(world,value);};world.addEventListener('structure:body-retired',onRetired);stress=createAssemblyStress({world,system,responseTime:CRUSH_TIME,staging:stagingRule});stress.update();world.step=step;rebuild();},
  setExternalLoads(key,loads,options){stress?.setExternalLoads(key,loads,options);},
  moveFixedBody(body){if(fallback)return native.moveFixedBody(body);if(dirty)rebuild();const g=membership.get(body);if(!g||g.parts.length!==1||body.mass!==0)throw Error('Driven fixing requires an independent static body');g.proxy.position.copy(body.position);g.proxy.quaternion.copy(body.quaternion);native.moveFixedBody(g.proxy);},
  get solverBodies(){return fallback?world.bodies.length:groups.length;},get frozen(){return native.frozen;},
  // Elastic analysis displacement (metres) of an anchored part from the last frame solve: member
  // segments and hubs by their authored nodes, attached panels by their bearing members. null when
  // the part is not anchored or no stable solve exists; the renderer may add it to the rigid pose.
  displacementOf(body){if(fallback||!stress?.displacementOf)return null;const m=memberOf.get(body);if(m){if(!stress.owns(m))return null;const a=stress.displacementOf(m.row.a),b=stress.displacementOf(m.row.b);return a&&b?[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2]:null;}
   const hub=system.hubs.indexOf(body);if(hub>=0)return stress.isAnchored(body)?stress.displacementOf(system.hubs[hub].hubIndex):null;
   if(!panelOf.has(body)||!stress.isAnchored(body))return null;const nodes=[];for(const attachment of stress.attachmentsForBody(body)){const member=attachment.member??system.members[attachment.memberIndex];if(member&&stress.owns(member)){nodes.push(member.row.a,member.row.b);}}
   if(!nodes.length)return null;const sum=[0,0,0];let n=0;for(const node of nodes){const d=stress.displacementOf(node);if(!d)continue;sum[0]+=d[0];sum[1]+=d[1];sum[2]+=d[2];n++;}return n?[sum[0]/n,sum[1]/n,sum[2]/n]:null;},describePart(part){if(fallback)return native.describeBody(part);const g=membership.get(part);return g?{proxy:g.proxy.id,proxyMass:Math.round(g.proxy.mass),supported:!!g.supported,framed:!!g.framed,proxySleep:g.proxy.sleepState,parts:g.parts.length,...native.describeBody(g.proxy)}:null;},get collisionShapes(){return fallback?world.bodies.reduce((n,b)=>n+(b.collisionFilterMask===0?0:b.shapes.length),0):groups.reduce((n,g)=>n+g.proxy.shapes.length,0);},get timing(){return timing;},get profile(){return profile?{native:native.profile,...counters,leaves:groups.reduce((n,g)=>n+g.proxy.shapes.length,0),staticZoneStories:zoneStories,dynamicFrame,framedGroups:groups.filter(g=>g.framed).length,plasticised:plasticised.size,kinks:[...kinks.entries()].map(([storey,k])=>[storey,+k.angle.toFixed(3),+k.overload.toFixed(2)])}:null;},get stress(){return stress?.stats;},
  prepare(){if(fallback)return;syncPanels();stress.update();if(dynamicFrame){plasticiseYielded();if(!dirty&&framedStorey(damagedStoreys())!==lastFramedFrom)dirty=true;}if(dirty)rebuild();},
  dispose(){if(disposed)return;disposed=true;if(fallback){native.dispose();return;}world.removeEventListener('structure:body-retired',onRetired);stress?.dispose();clearNative();native.dispose();for(const c of [...reactionWrenchFlags.keys()])restoreWorldWrench(c);Object.assign(world,original);delete world.nativeSleep;}
 };
}
