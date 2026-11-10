import {isRopeBridge} from './bridge-suspension.js';
import {isCableBridge} from './bridge-stays.js';
import {CABLE_PRESETS} from './cable.js';
import {createCableRigDefinition,createCableRig} from './cable-rigs.js';
import * as C from 'cannon-es';
import {createSteelShapeDefinition,STEEL_SHAPES} from './steel-shapes.js';
import {createBrickHouseDefinition} from './brick-house.js';
import {createHouseDefinition} from './house.js';
import {createBendableStructure,createBridgeFrameDefinition,createBuildingFrameDefinition} from './assemblies.js';
import {ActiveBodySolver,CachedInertiaSolver} from './active-solver.js';
import {ConnectedSAPBroadphase} from './cannon-broadphase.js';
import {importDestructible} from './destructible.js';
import {createBreakableFloors} from './floors.js';
import {createRubbleBands} from './rubble-bands.js';

// Standalone masonry composes the existing panel runtime without inventing a
// supporting frame. The host still owns the world and its fixed-step clock.
function masonrySystem(world,definition,assets,fractureEnabled){
 if(!definition?.floors?.length||definition.floors.some(row=>!assets[row.assetId]?.masonry||row.bearings.length||row.neighbours.length))throw Error('Masonry scene requires standalone authored masonry rows');
 const listeners=new Set(),floors=createBreakableFloors({world,rows:definition.floors,members:[],assets,onEvent:e=>{for(const f of listeners)f(e);}});
 floors.setFracture(fractureEnabled);
 return{definition,members:[],hubs:[],floors,broken:0,yielded:0,permanentRotation:0,
  get sleeping(){return world.bodies.every(b=>b.mass===0||b.sleepState===C.Body.SLEEPING);},get totalMass(){return floors.mass;},
  beforeStep:dt=>floors.beforeStep(dt),afterStep(){floors.afterStep();for(const g of floors.groups)if(g.detached){g.body.linearDamping=.35;g.body.angularDamping=.5;g.body.sleepSpeedLimit=.25;g.body.sleepTimeLimit=.5;}},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},setFracture:enabled=>floors.setFracture(enabled),setDamage:enabled=>floors.setDamage(enabled),wake:()=>floors.wake(),dispose(){floors.dispose();listeners.clear();}};
}

// The lab's simulation owner. No rendering, DOM, worker, or gameplay dependency.
export function createAssemblySimulation({scene='building15',floors=true,cladding=false,assets={},collisionLOD='detailed',material='brittle',fractureEnabled=true,bays=[1,1],driver=null,chipsBelowKg=0,strength={},staging=null,sag=0,shape={},definition:authoredDefinition=null,cable:cableOptions={}}={}){
 if(!['cable','bridge','building','building10','building15','house','brick-house','catalogue-house','masonry',...STEEL_SHAPES].includes(scene))throw Error('Unknown assembly scene');
 if(scene==='masonry'&&(!authoredDefinition||driver))throw Error('Masonry batch requires an authored definition and Cannon');
 if(scene==='catalogue-house'&&!authoredDefinition)throw Error('Catalogue house requires a definition');
 if(!['auto','detailed','intact'].includes(collisionLOD))throw Error('Invalid collisionLOD');
 assets=Object.fromEntries([...(assets instanceof Map?assets.entries():Object.entries(assets))].map(([id,asset])=>[id,asset.bonds?asset:importDestructible(asset)]));
 if(scene==='cable'&&isCableBridge(cableOptions.setup)&&!isRopeBridge(cableOptions.setup)&&!assets.slab)throw Error('The bridge test requires the authored slab asset');
 const cableDefinition=scene==='cable'?createCableRigDefinition(cableOptions):null;
 if(cableDefinition){if(cableOptions.loadMass!==undefined&&(!Number.isFinite(cableOptions.loadMass)||cableOptions.loadMass<5||cableOptions.loadMass>500))throw Error('Load mass must be 5–500 kg');const {slack=.08,preset='rope',segments=16,breakStrength=5000}=cableOptions;if(!(driver?.name==='Jolt'||cableOptions.setup==='transmission'&&(!driver||typeof driver.setExternalLoads==='function'))||!CABLE_PRESETS[preset]||!Number.isFinite(slack)||slack<.01||slack>.3||!Number.isInteger(segments)||segments<4||segments>24||!Number.isFinite(breakStrength)||breakStrength<=0)throw Error('Invalid cable lab settings: a supported cable backend, 4–24 links, 1–30% slack and positive strength required');}
 const world=new C.World({gravity:new C.Vec3(0,-9.82,0),allowSleep:true});world.solver=cableDefinition&&!driver?new CachedInertiaSolver():new ActiveBodySolver();world.solver.iterations=30;world.solver.tolerance=1e-7;world.broadphase=cableDefinition&&!driver?new ConnectedSAPBroadphase(world):new C.SAPBroadphase(world);world.broadphase.useBoundingBoxes=true;Object.assign(world.defaultContactMaterial,{friction:.5,restitution:.03,contactEquationRelaxation:16});
 const ground=new C.Body({mass:0,shape:new C.Plane(),collisionFilterGroup:1});ground.quaternion.setFromEuler(-Math.PI/2,0,0);ground.updateAABB();world.addBody(ground);
 const cableScene=scene==='cable',bridge=scene==='bridge',stories=scene==='building15'?15:scene==='building10'?10:3,definition=cableScene?cableDefinition:authoredDefinition?structuredClone(authoredDefinition):scene==='brick-house'?createBrickHouseDefinition({assets}):STEEL_SHAPES.includes(scene)?createSteelShapeDefinition({...shape,form:scene}):bridge?createBridgeFrameDefinition():scene==='house'?createHouseDefinition({assets}):createBuildingFrameDefinition({stories,floors,cladding,bays,assets});world.broadphase.axisIndex=bridge?0:1;
 if(!(Number.isFinite(chipsBelowKg)&&chipsBelowKg>=0))throw Error('chipsBelowKg must be a non-negative number');for(const row of definition.floors??[])if(row.assetId){row.collisionLOD=collisionLOD;row.chipsBelowKg=chipsBelowKg;}
 if(definition.metadata.heavyStep!=null&&(!Number.isFinite(definition.metadata.heavyStep)||definition.metadata.heavyStep<1/480||definition.metadata.heavyStep>1/120))throw Error('Invalid authored rigid assembly step');
 const dt=cableScene?1/120:definition.metadata.heavy?(material==='brittle'&&driver?.rigidStep?driver.rigidStep:driver?.heavyStep??definition.metadata.heavyStep??1/240):1/480;world.solver.iterations=cableScene&&!driver?64:definition.metadata.heavy?12:30;
 const system=scene==='masonry'?masonrySystem(world,definition,assets,fractureEnabled):createBendableStructure({world,definition,material,fractureEnabled,assets,strength}),supports=bridge?[-24,24].map(x=>({position:[x,4.875,0],size:[2.4,9.75,12.5]})):definition.nodes.filter(n=>n.anchor).map(n=>({position:[n.position[0],-(definition.metadata.footingSize?.[1]??.2)/2,n.position[2]],size:definition.metadata.footingSize??[1,.2,1]}));
 // These authored footings lie below grade and are tied to ground anchors.
 // A ground-plane penetration must not push them through their own anchors.
 if(definition.metadata.masonryHouse)for(const m of system.members)if(definition.nodes[m.row.a].anchor&&definition.nodes[m.row.b].anchor)for(const segment of m.segments)segment.body.collisionFilterMask&=~1;
 const rubble=scene==='masonry'||definition.metadata.masonryHouse?createRubbleBands({world,floors:system.floors}):null;let playerY=0;
 for(const s of supports)world.addBody(new C.Body({mass:0,shape:new C.Box(new C.Vec3(...s.size.map(n=>n/2))),position:new C.Vec3(...s.position),collisionFilterGroup:1}));
 // Seconds. Rendered frame displacement follows the solve with this time constant: load
 // redistribution after a member is lost reads as a quick dip instead of a snap.
 const sagState=new Map(),SAG_SMOOTHING=.3;let inspection=null,accumulator=0,lastAxisCheck=-1,disposed=false,pendingEnergy=0,lastPhysicsMs=0,lastSteps=0,lastSimDelta=0,droppedSeconds=0,lastImpact=null;const shots=[],sentPanels=new Map(),sentRetired=new Set(),sentPoses=new WeakMap();
 // Effect events for the host: chips leaving the simulation, measured impacts and crushed panels, with world points.
 const pendingEvents=[];
 system.subscribe(event=>{if(event.type==='floor:impact')pendingEnergy=Math.max(pendingEnergy,event.energy);if(event.point&&['floor:chips','floor:impact','floor:fractured','floor:landing'].includes(event.type)&&pendingEvents.length<256)pendingEvents.push({type:event.type,time:event.time,panelId:event.panelId,groupId:event.groupId,point:event.point,velocity:event.velocity??null,mass:event.mass??0,energy:event.energy??0,speed:event.speed??0,kind:event.kind??null});});
 if(!(Number.isFinite(sag)&&sag>=0))throw Error('sag must be a non-negative scale');const lashBeforeAttach=cableScene&&cableOptions.setup==='bridge-jungle';
 if(!lashBeforeAttach)driver?.attach(world,{system,definition,staging});
 const cableRig=cableScene?createCableRig({world,system,driver,options:cableOptions,fire}):null,cables=cableRig?.cables??[];
 if(lashBeforeAttach)driver?.attach(world,{system,definition,staging});
 if(cableRig&&(world.bodies.length>cableRig.budget.bodies||world.constraints.length>cableRig.budget.constraints))throw Error('Cable rig exceeds its body/constraint budget');
 for(const c of cables)c.setFracture(fractureEnabled);
 for(const c of cables)c.subscribe(event=>{if(pendingEvents.length<256)pendingEvents.push({...event,cableId:cables.indexOf(c)});});
 const bodyData=body=>({id:body.id,mass:body.mass,position:body.position.toArray(),quaternion:body.quaternion.toArray()});
 const groupData=group=>({id:group.id,body:bodyData(group.body),pieceIds:group.pieceIds?[...group.pieceIds]:undefined,localPieceTransforms:group.localPieceTransforms,assetCentre:group.assetCentre,halfExtents:group.halfExtents,detached:group.detached});
 const frozenData=p=>p.frozen?.map(({collider,physics,...entry})=>entry)??[];
 const panelData=p=>({id:p.id,row:p.row,body:p.body?bodyData(p.body):null,broken:p.broken,revision:p.revision??0,asset:p.asset?.masonry?p.asset:p.asset?{id:p.asset.id,assetId:p.asset.assetId}:undefined,groups:p.groups?.map(groupData),...(p.asset?.masonry?{frozen:frozenData(p)}:{})});
 // Debug: sleeping dynamic bodies above ground whose collision shapes touch no other
// collider within a small margin, with the driver's view of them. Per-shape bounds
// keep a large compound from counting as support for everything inside its box.
function unsupportedSleepers(margin=.05){const bodies=world.bodies,mn=new C.Vec3(),mx=new C.Vec3(),wp=new C.Vec3(),wq=new C.Quaternion(),box=new C.AABB(),probe=new C.AABB(),out=[];
 const touches=(o,pr)=>{for(let i=0;i<o.shapes.length;i++){o.pointToWorldFrame(o.shapeOffsets[i],wp);o.quaternion.mult(o.shapeOrientations[i],wq);o.shapes[i].calculateWorldAABB(wp,wq,mn,mx);box.lowerBound.copy(mn);box.upperBound.copy(mx);if(pr.overlaps(box))return true;}return false;};
 for(const b of bodies){if(b.mass<=0||!b.shapes.length||b.collisionFilterMask===0||(b.sleepState!==C.Body.SLEEPING&&b.velocity.lengthSquared()>.01))continue;if(b.aabbNeedsUpdate)b.updateAABB();const lo=b.aabb.lowerBound,hi=b.aabb.upperBound;if(lo.y-margin<=0)continue;probe.lowerBound.set(lo.x-margin,lo.y-margin,lo.z-margin);probe.upperBound.set(hi.x+margin,hi.y+margin,hi.z+margin);
  if(bodies.some(o=>o!==b&&o.shapes.length&&o.collisionFilterMask!==0&&touches(o,probe)))continue;
  const member=system.members.find(m=>m.segments.some(s=>s.body===b)),panel=system.floors.panels.find(p=>p.groups.some(g=>g.body===b));
  const described=driver?.describePart?.(b)??null;if(described?.supported)continue;
  out.push({sleep:b.sleepState,speed:+b.velocity.length().toFixed(3),id:b.id,what:member?`member ${member.id} ${member.type}`:panel?`panel ${panel.id} ${panel.row.kind} group ${panel.groups.find(g=>g.body===b).id}`:'body',y:+b.position.y.toFixed(2),mass:Math.round(b.mass),detached:b.detached,driver:described});}
 return out;}
function removeShot(shot){if(shot.joint)world.removeConstraint(shot.joint);world.removeBody(shot.body);if(shot.anchor)world.removeBody(shot.anchor);}
 function fire({target,mode='projectile',mass=350,speed=30,origin=null}){
  if(!Array.isArray(target)||target.length!==3||!target.every(Number.isFinite)||!['projectile','pendulum','drop'].includes(mode)||!Number.isFinite(mass)||mass<=0||!Number.isFinite(speed)||speed<=0)throw Error('Invalid impact command');
  lastImpact={target:[...target],mode,mass,speed,time:world.time};system.wake();const [x,y,z]=target,duration=18/speed,position=mode==='pendulum'?new C.Vec3(x,y+12-Math.sqrt(44),z-10):mode==='drop'?new C.Vec3(x,y+10,z):new C.Vec3(x,y+1.5,z-18),velocity=mode==='projectile'?new C.Vec3(0,(-1.5+4.91*duration*duration)/duration,speed):new C.Vec3();
  const radius=Math.cbrt(3*mass/(4*Math.PI*7850)),body=new C.Body({mass,shape:new C.Sphere(radius),position,velocity,linearDamping:.005,collisionFilterGroup:2,collisionFilterMask:3});if(origin&&mode==='projectile'){if(!Array.isArray(origin)||origin.length!==3||!origin.every(Number.isFinite))throw Error('Invalid projectile origin');const start=new C.Vec3(...origin);body.position.copy(start);const delta=new C.Vec3(...target).vsub(start),duration=delta.length()/speed;if(duration<.001)throw Error('Projectile origin is too close');body.velocity.set(delta.x/duration,delta.y/duration+4.91*duration,delta.z/duration);}
  if(scene==='masonry'||definition.metadata.masonryHouse)body.structureImpact=true;world.addBody(body);body.addEventListener('collide',e=>{const v=Math.abs(e.contact.getImpactVelocityAlongNormal()),reduced=e.body.mass>0?body.mass*e.body.mass/(body.mass+e.body.mass):body.mass;pendingEnergy=Math.max(pendingEnergy,.5*reduced*v*v);});const shot={body,radius};
  if(mode==='pendulum'){shot.anchor=new C.Body({mass:0,position:new C.Vec3(x,y+12,z),collisionFilterGroup:4,collisionFilterMask:0});world.addBody(shot.anchor);shot.joint=new C.DistanceConstraint(shot.anchor,body,12,1e7);shot.joint.distanceEquation.maxForce=0;shot.joint.collideConnected=false;world.addConstraint(shot.joint);}

  shots.push(shot);if(shots.length>(cableScene?4:8))removeShot(shots.shift());
 }
 return{world,system,cables,cableRig,dt,
  describe(){return{definition,supports,cableBudget:cableRig?.budget,payloads:(cableRig?.payloads??[]).map(p=>({...p,body:bodyData(p.body)})),hardware:(cableRig?.hardware??[]).map(h=>({...h,body:bodyData(h.body)})),cables:cables.map(c=>c.describe()),members:system.members.map(m=>({id:m.id,type:m.type,row:m.row,profile:m.profile,segments:m.segments.map(s=>({body:bodyData(s.body),length:s.length})),hinges:m.hinges.map(h=>({a:bodyData(h.a),b:bodyData(h.b)}))})),panels:system.floors.panels.map(panelData)};},
  command(command){if(disposed)return;if(cableRig?.command(command)){}else if(command.type==='fire')fire(command);else if(command.type==='fracture'){system.setFracture(!!command.enabled);for(const c of cables)c.setFracture(!!command.enabled);}else if(command.type==='removePost'){if(scene!=='house'&&scene!=='brick-house')throw Error('Post removal is a house experiment');const member=system.members.find(m=>m.type==='column'&&!m.broken);if(member){member.fracture({reason:'experiment:post-removal'});system.wake();}}else if(command.type==='releaseFoundations'&&scene==='masonry'){for(const p of system.floors.panels)p.releaseFoundation();}else if(command.type==='playerHeight'&&rubble){if(!Number.isFinite(command.y))throw Error('Invalid player height');playerY=command.y;rubble.update(playerY);}else if(command.type==='releaseFoundations'){if(scene!=='catalogue-house')throw Error('Not a catalogue house');if(definition.metadata.masonryHouse){for(const p of system.floors.panels)if(p.asset?.masonry)p.releaseFoundation();}else for(const member of system.members)member.fracture({reason:'experiment:foundation-release'});system.wake();}else if(command.type==='clearShots'){for(const shot of shots)removeShot(shot);shots.length=0;}else if(command.type==='inspect')inspection={panels:system.floors.panels.map(p=>({id:p.id,revision:p.revision??0,broken:!!p.broken,groups:p.groups.map(g=>({id:g.id,body:g.body.id,mass:g.body.mass,position:g.body.position.toArray(),sleep:g.body.sleepState,detached:g.detached,foundationUnits:p.asset?.masonry?g.pieceIds.filter(id=>p.asset.masonry.units.find(u=>u.id===id)?.foundation).length:undefined,liveBearings:g.bearings?.filter(a=>!a.disabled&&a.bond.alive).length,native:driver?.describePart?.(g.body)??null}))})),bodies:unsupportedSleepers(),shots:shots.map(s=>({id:s.body.id,inWorld:world.bodies.includes(s.body),y:+s.body.position.y.toFixed(2),speed:+s.body.velocity.length().toFixed(2),sleep:s.body.sleepState,driver:driver?.describePart?.(s.body)??null}))};else throw Error('Unknown simulation command');},
  advance(seconds){if(disposed)return;if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid elapsed time');const start=performance.now();lastSteps=0;accumulator+=seconds;
   driver?.prepare?.();
   const idle=system.sleeping&&cables.every(c=>c.sleeping)&&!cableRig?.active&&world.bodies.every(b=>b.type===C.Body.STATIC||b.sleepState===C.Body.SLEEPING);
   if(!idle&&world.time-lastAxisCheck>.5){lastAxisCheck=world.time;world.broadphase.autoDetectAxis();}
   // Keep owed simulation time. Yield between fixed steps for commands/poses;
   // an overloaded worker must not silently turn normal speed into slow motion.
   while(accumulator+1e-12>=dt&&lastSteps<64&&(lastSteps===0||performance.now()-start<12)){
    cableRig?.beforeStep(dt);system.beforeStep(dt);if(idle){world.time+=dt;world.stepnumber++;}else{world.step(dt);system.afterStep();cableRig?.afterStep(dt);}rubble?.update(playerY);accumulator=Math.max(0,accumulator-dt);lastSteps++;
   }
   lastSimDelta=lastSteps*dt;lastPhysicsMs=performance.now()-start;},
  snapshot(recycled,{delta=false}={}){
   // One pre-sized transferable pose buffer: every part, four shards per slab and the
   // impactor budget fit without reallocating while a collapse adds bodies.
   const dynamic=world.bodies.filter(b=>b.mass>0),poseBodies=world.bodies.filter(b=>b.mass>0||b.retired&&!sentRetired.has(b.id)),needed=poseBodies.length*9*4,capacity=(world.bodies.length+4*system.floors.panels.length+16)*9*4,buffer=recycled?.byteLength>=needed?recycled:new ArrayBuffer(Math.max(needed,capacity)),poses=new Float32Array(buffer);let poseCount=0;
   // Retirement removes a part from later dynamic snapshots. Send its final pose
   // once first, so interpolation cannot leave its visible collider behind.
   for(let i=0;i<poseBodies.length;i++){const b=poseBodies[i],o=poseCount*9;poses[o]=b.id;poses[o+1]=b.sleepState;let d=sag?driver?.displacementOf?.(b):null;if(sag){const prev=sagState.get(b),target=d??[0,0,0];if(prev){const k=1-Math.exp(-Math.max(0,lastSimDelta)/SAG_SMOOTHING);for(let i=0;i<3;i++)prev[i]+=(target[i]-prev[i])*k;d=prev;}else{sagState.set(b,target.slice());d=target;}}poses[o+2]=b.position.x+(d?d[0]*sag:0);poses[o+3]=b.position.y+(d?d[1]*sag:0);poses[o+4]=b.position.z+(d?d[2]*sag:0);poses[o+5]=b.quaternion.x;poses[o+6]=b.quaternion.y;poses[o+7]=b.quaternion.z;poses[o+8]=b.quaternion.w;if(delta){let previous=sentPoses.get(b),changed=!previous||b.retired&&!sentRetired.has(b.id);if(!changed)for(let j=0;j<9;j++)if(previous[j]!==poses[o+j]){changed=true;break;}if(!changed)continue;if(!previous){previous=new Float32Array(9);sentPoses.set(b,previous);}for(let j=0;j<9;j++)previous[j]=poses[o+j];}poseCount++;if(b.retired)sentRetired.add(b.id);}
   const fractures=[];for(const p of system.floors.panels){const revision=p.revision??(p.broken?1:0);if(revision>0&&sentPanels.get(p.id)!==revision){sentPanels.set(p.id,revision);fractures.push({id:p.id,revision,broken:p.broken,groups:p.groups?.map(groupData),pieces:p.groups?.flatMap(g=>g.pieceIds),fragments:p.fragments.map(groupData),...(p.asset?.masonry?{frozen:frozenData(p)}:{})});}}
   const cableStates=cables.map(c=>c.snapshot());
   const hinges=new Uint8Array(system.members.reduce((n,m)=>n+m.hinges.length,0));{let h=0;for(const m of system.members)for(const x of m.hinges)hinges[h++]=(x.broken?1:0)|(x.yielded?2:0);}const stats={cableBudget:cableRig?.budget,cableStates,cable:cableStates[0],inspection,lastImpact,stress:driver?.stress?{...driver.stress}:null,backend:driver?.name??'Cannon',solverBodies:driver?.solverBodies??world.bodies.length,frozen:rubble?.count??driver?.frozen??0,rubbleBands:rubble?.bands.size??0,rubbleColliders:rubble?.colliders??0,masonry:scene==='masonry'?{revision:3,chunks:system.floors.groups.filter(g=>g.detached&&g.pieceIds.length>1).length,looseUnits:system.floors.groups.filter(g=>g.detached&&g.pieceIds.length===1).length}:undefined,collisionShapes:driver?.collisionShapes??world.bodies.reduce((n,b)=>n+b.shapes.length,0),collisionLOD,time:world.time,broken:system.broken,yielded:system.yielded,permanentRotation:system.permanentRotation,totalMass:system.totalMass+(cableRig?.mass??0),floorBreaks:system.floors.broken,sleeping:system.sleeping&&cables.every(c=>c.sleeping)&&(cableRig?.payloads??[]).every(p=>p.body.sleepState===C.Body.SLEEPING),awake:dynamic.filter(b=>b.sleepState!==C.Body.SLEEPING).length,bodies:dynamic.length,physicsMs:lastPhysicsMs,steps:lastSteps,simDelta:lastSimDelta,fixedStep:dt,backlog:accumulator,droppedSeconds};const energy=pendingEnergy;pendingEnergy=0;inspection=null;
   const events=pendingEvents.splice(0);return{buffer,count:poseCount,cables:cableStates,fractures,hinges,stats,energy,events,shots:shots.map(s=>({body:bodyData(s.body),radius:s.radius,anchor:s.anchor?.position.toArray()??null}))};
  },
  dispose(){if(disposed)return;disposed=true;for(const shot of shots)removeShot(shot);shots.length=0;rubble?.dispose();cableRig?.dispose();system.dispose();for(const b of [...world.bodies])world.removeBody(b);driver?.dispose();}
 };
}

