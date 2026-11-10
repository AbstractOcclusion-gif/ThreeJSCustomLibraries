import {createSuspensionBridgeDefinition,createJungleBridgeDefinition,SUSPENSION_BUDGET,JUNGLE_BRIDGE_BUDGET,isRopeBridge} from './bridge-suspension.js';
import {createBridgeStaysDefinition,BRIDGE_STAYS_BUDGET,createBridgeCrossingDefinition,BRIDGE_CROSSING_BUDGET,isCableBridge} from './bridge-stays.js';
import {createTransmissionTowerDefinition,TRANSMISSION_BUDGET} from './transmission-tower.js';
import * as C from 'cannon-es';
import {createCable,createCablePolesDefinition} from './cable.js';
import {createSteelShapeDefinition} from './steel-shapes.js';

let nextRigId=0;
export const CABLE_RIGS=Object.freeze(['single','triple','tower','transmission','suspended','pull','bridge-stays','bridge-crossing','bridge-suspension','bridge-rope','bridge-jungle']);
export const CABLE_RIG_BUDGET=Object.freeze({cables:3,bodies:192,constraints:384,drawCalls:24});

// Definitions reuse structural members, hubs, bending and failure. Cosmetic
// pole insulators are local followers; transmission strings are pin-jointed
// bodies owned by the rig. Neither introduces electrical gameplay.
export function createCableRigDefinition({setup='single',span}={}){
 if(!CABLE_RIGS.includes(setup))throw Error('Unknown cable setup');
 if(setup==='bridge-jungle')return createJungleBridgeDefinition();
 if(setup==='bridge-rope')return createSuspensionBridgeDefinition({planks:true});
 if(setup==='bridge-suspension')return createSuspensionBridgeDefinition();
 if(setup==='bridge-crossing')return createBridgeCrossingDefinition();
 if(setup==='bridge-stays')return createBridgeStaysDefinition();
 if(setup==='transmission')return createTransmissionTowerDefinition({span:span??60});
 span??=10;const d=createCablePolesDefinition({span});d.metadata.cableSetup=setup;
 if(setup==='single'||setup==='pull')return d;
 const appendNode=(p,anchor=false)=>{d.nodes.push({position:p,anchor});return d.nodes.length-1;};
 const arm=(a,b,metal=false)=>{d.members.push({a,b,type:'beam',profile:'steel',bendable:{segments:1,response:'brittle',width:.16,height:.2,massPerMetre:metal?8:5,section:'rectangle',color:metal?0x87939c:0x98764b,stiffness:50000,yieldMoment:9000,breakForce:35000,dampingRatio:.9,collisionInset:.015}});return d.members.length-1;};
 if(setup==='suspended'){
  const member=arm(1,3);Object.assign(d.members[member].bendable,{segments:2,response:'elastoplastic',yieldMoment:18000,breakForce:50000});d.name='Rope · suspended load';d.metadata.cableMounts=[{member,point:[0,5.8,0]}];return d;
 }
 let tops=[1,3],height=6;
 if(setup==='tower'){
  const tower=createSteelShapeDefinition({form:'pyramid',levels:3,sides:4,radius:3,storeyHeight:3});
  d.nodes=tower.nodes.map(n=>({...n,position:[n.position[0]-span/2,n.position[1],n.position[2]]}));d.members=tower.members.map(m=>({...m,bendable:{segments:2,response:'elastoplastic',width:m.type==='brace'?.14:.22,height:m.type==='brace'?.18:.32,massPerMetre:m.type==='brace'?8:18,stiffness:300000,yieldMoment:m.type==='brace'?12000:40000,breakForce:m.type==='brace'?45000:140000,dampingRatio:.9,collisionInset:.1}}));
  d.metadata.cableTowerBaseNodes=d.nodes.flatMap((n,i)=>n.anchor?[i]:[]);
  height=9;const top=d.nodes.findIndex(n=>n.position[1]===height),base=appendNode([span/2,0,0],true),remoteTop=appendNode([span/2,height,0]);
  d.members.push({a:base,b:remoteTop,type:'column',profile:'steel',bendable:{segments:3,response:'elastoplastic',massPerMetre:16,width:.25,height:.25,section:'round',color:0x93744c,stiffness:65000,yieldMoment:14000,breakForce:45000,fractureRotation:1.1,dampingRatio:.9,collisionInset:.02}});
  tops=[top,remoteTop];d.metadata.height=height;d.metadata.width=6;
 }
 const mounts=[[],[]];
 for(let end=0;end<2;end++){
  const top=tops[end],x=d.nodes[top].position[0],left=appendNode([x,height,-1.5]),right=appendNode([x,height,1.5]),leftArm=arm(top,left,setup==='tower'),rightArm=arm(top,right,setup==='tower');
  // Centre phase uses the arm near the common hub, not an invisible anchor.
  for(const z of [-1.2,0,1.2])mounts[end].push({member:z<=0?leftArm:rightArm,point:[x,height+.3,z],insulator:true});
 }
 d.name=setup==='tower'?'Destructible frame tower · three lines':'Utility poles · three lines';d.metadata.cableMounts=mounts;d.metadata.cableSupportMembers=tops.map(top=>d.members.findIndex(m=>m.b===top&&m.type==='column'));return d;
}

export function createCableRig({world,system,driver,options={},fire}){
 const setup=options.setup??'single',cables=[],payloads=[],hardware=[],fixings=[],connectors=[];if(!CABLE_RIGS.includes(setup))throw Error('Unknown cable setup');
 const jungle=setup==='bridge-jungle',ropeBridge=isRopeBridge(setup),suspension=ropeBridge||setup==='bridge-suspension',bridge=isCableBridge(setup),failedTowerBases=new Set(),externalKey='cable-rig:'+nextRigId++;
 let driven=null,pendingShot=options.recipe==='strike'?2:null,selected=0;
 const pointAttachment=mount=>{
  if(mount.fixed)return{spec:{kind:'fixed',position:mount.point},member:null};
  const member=system.members[mount.member],point=new C.Vec3(...mount.point),body=member.segments.reduce((best,l)=>l.body.position.distanceTo(point)<best.body.position.distanceTo(point)?l:best).body,localPoint=body.pointToLocalFrame(point);
  if(mount.hangingLength){const length=mount.hangingLength,insulator=new C.Body({mass:25,shape:new C.Box(new C.Vec3(.1,length/2,.1)),position:point.vadd(new C.Vec3(0,-length/2,0)),linearDamping:.08,angularDamping:.1,collisionFilterGroup:2,collisionFilterMask:3});insulator._noSettleFreeze=true;world.addBody(insulator);const joint=new C.PointToPointConstraint(body,localPoint,insulator,new C.Vec3(0,length/2,0),1e8);joint.collideConnected=false;joint._nativeSteps=[32,8];world.addConstraint(joint);const connector={body:insulator,joint,support:body,pivot:localPoint,force:null};connectors.push(connector);hardware.push({body:insulator,point:[0,-length/2,0],axis:[0,1,0],length,discs:18});return{spec:{kind:'body',body:insulator,localPoint:[0,-length/2,0]},member:mount.member,connector};}
  if(mount.insulator)hardware.push({body,point:localPoint.toArray(),axis:body.vectorToLocalFrame(new C.Vec3(0,1,0)).toArray()});return{spec:{kind:'body',body,localPoint:localPoint.toArray()},member:mount.member};
 };
 const poleMount=end=>{const member=system.members[end],body=member.segments.at(-1).body;return{spec:{kind:'body',body,localPoint:body.pointToLocalFrame(new C.Vec3(...system.definition.nodes[member.row.b].position)).toArray()},member:end};};
 const add=(mounts,preset=options.preset??'rope',{slack=options.slack??.08,segments}={})=>{const points=mounts.map(m=>m.spec.kind==='body'?m.spec.body.pointToWorldFrame(new C.Vec3(...m.spec.localPoint)):new C.Vec3(...m.spec.position)),length=points[0].distanceTo(points[1])*(1+slack);cables.push(createCable({world,endpoints:mounts.map(m=>m.spec),length,retentionDistance:setup==='transmission'?300:120,segments:segments??options.segments??(bridge?4:['suspended','pull'].includes(setup)?8:16),solverSteps:bridge?[128,32]:['suspended','pull'].includes(setup)?((options.loadMass??25)>25?[128,32]:[64,16]):[32,8],preset,breakStrength:options.breakStrength??5000,moveFixedBody:driver?.moveFixedBody?b=>driver.moveFixedBody(b):undefined}));fixings.push(mounts);};
 if(setup==='single')add([poleMount(0),poleMount(1)]);
 else if(jungle){
  const {cableMounts}=system.definition.metadata;
  for(let line=0;line<4;line++)add(cableMounts.map(row=>pointAttachment(row[line])),options.preset??'rope',{segments:24});
  const axis=new C.Vec3(1,0,0),tangent=new C.Vec3();
  for(const panel of system.floors.panels){
   const x=panel.body.position.x;
   const links=cables.slice(0,2).map(cable=>cable.links.reduce((best,link)=>Math.abs(link.body.position.x-x)<Math.abs(best.body.position.x-x)?link:best).body);
   links[0].quaternion.vmult(axis,tangent);
   const ropeY=links[0].position.y+(x-links[0].position.x)*tangent.y/tangent.x;
   panel.body.position.y=ropeY+cables[0].profile.radius+panel.row.halfExtents[1];
   panel.body.quaternion.setFromVectors(axis,tangent);
   for(const link of links)for(const offset of [-.12,.12]){
    const point=panel.body.pointToWorldFrame(new C.Vec3(offset,-panel.row.halfExtents[1],link.position.z));
    system.floors.bindRope(panel,link,point);
   }
  }
 }
 else if(suspension){
  const {cableMounts,hangerRails}=system.definition.metadata;
  for(let side=0;side<2;side++)add(cableMounts.map(row=>pointAttachment(row[side])),options.preset??(ropeBridge?'rope':'suspension'),{segments:8});
  for(const rails of hangerRails)for(const rail of rails){
   const side=rail.point[2]<0?0:1;
   const links=cables[side].links;
   const top=links.reduce((best,link)=>Math.abs(link.body.position.x-rail.point[0])<Math.abs(best.body.position.x-rail.point[0])?link:best).body;
   const lower=pointAttachment({...rail,point:[top.position.x,rail.point[1],rail.point[2]]});
   add([{spec:{kind:'body',body:top,localPoint:[0,0,0]},member:null},lower],ropeBridge?'rope':'support',{slack:.01,segments:4});
  }
 }
 else if((bridge||['triple','tower','transmission'].includes(setup)))for(let i=0;i<system.definition.metadata.cableMounts[0].length;i++)add(system.definition.metadata.cableMounts.map(row=>pointAttachment(row[i])),options.preset??(setup==='transmission'?'transmission':'utility'));
 else{
  const mass=options.loadMass??25;if(!Number.isFinite(mass)||mass<5||mass>500)throw Error('Load mass must be 5–500 kg');
  const suspended=setup==='suspended',halfExtents=suspended?[.45,.35,.3]:[.5,.4,.4],body=new C.Body({mass,shape:new C.Box(new C.Vec3(...halfExtents)),position:new C.Vec3(...(suspended?[0,2,0]:[1,.42,0])),linearDamping:.1,angularDamping:.15,collisionFilterGroup:2,collisionFilterMask:3});body._noSettleFreeze=true;world.addBody(body);payloads.push({body,halfExtents,color:suspended?0xcf9a4d:0x579cab});
  const mount=suspended?pointAttachment(system.definition.metadata.cableMounts[0]):{spec:{kind:'body',body:system.members[0].segments[0].body,localPoint:system.members[0].segments[0].body.pointToLocalFrame(new C.Vec3(...system.definition.nodes[0].position).vadd(new C.Vec3(0,1,0))).toArray()},member:0};
  add([mount,{spec:{kind:'body',body,localPoint:suspended?[0,.35,0]:[-.5,0,0]},member:null}]);
 }
 const chosen=command=>{const i=command.cable??selected;if(!Number.isInteger(i)||!cables[i])throw Error('Invalid cable selection');return i;};
 const wake=()=>{system.wake();for(const c of cables)c.wake();for(const p of payloads)p.body.wakeUp();};
 function strike(){const c=cables[selected],link=c.links[Math.floor((c.links.length-1)/2)],p=link.body.position.toArray(),big=setup==='transmission',distance=big?2:8,speed=big?30:12,target=big?p.map((n,i)=>n+link.body.velocity.toArray()[i]*distance/speed):p;fire({target,origin:[p[0],p[1],p[2]-distance],mass:big?350:35,speed});}
 function command(command){
  if(!command.type?.startsWith('cable'))return false;
  const i=chosen(command),c=cables[i];selected=i;
  if(command.type==='cableSelect')return true;
  if(command.type==='cableStrike'){strike();wake();return true;}
  if(command.type==='cableRecipe')pendingShot=Math.max(2,world.time);
  else if(command.type==='cableRelease')c.release(command.end??0,'lab:release');
  else if(command.type==='cableRetire')for(const c of cables)c.retireDistant(command.position);
  else if(command.type==='cableCut')c.breakAt(command.joint??Math.floor((c.joints.length-1)/2),'lab:cut');
  else if(command.type==='cablePoleFailure'){
   if(setup==='tower'||setup==='transmission'){const base=system.definition.metadata.cableTowerBaseNodes.find(n=>!failedTowerBases.has(n));if(base!==undefined){failedTowerBases.add(base);for(const m of system.members)if(m.row.a===base||m.row.b===base)m.fracture({reason:'lab:footing-failure'});}}
   else{const memberId=system.definition.metadata.cableSupportMembers?.[0]??fixings[i][0].member;if(memberId!=null)system.members[memberId].fracture({reason:'lab:fixing-failure'});for(let k=0;k<cables.length;k++)for(let end=0;end<2;end++)if(fixings[k][end].member===memberId||setup==='triple'&&end===0)cables[k].release(end,'support-failed');}
  }
  else if(command.type==='cableDrive'){
   const end=['pull','suspended'].includes(setup)?0:1,a=c.attachments[end];if(a){const p=a.body.pointToWorldFrame(a.localPoint).toArray();c.attach(end,{kind:'driven',position:p});driven={index:i,end,start:world.time,point:p,delta:setup==='pull'?[-1.5,0,0]:setup==='suspended'?[1,0,0]:[0,0,1]};}
  }
  else if(command.type==='cableLoadImpulse'){for(const p of payloads)p.body.applyImpulse(new C.Vec3(40,0,15));}
  else return false;
  wake();return true;
 }
 return{cables,payloads,hardware,budget:jungle?JUNGLE_BRIDGE_BUDGET:suspension?SUSPENSION_BUDGET:setup==='bridge-crossing'?BRIDGE_CROSSING_BUDGET:bridge?BRIDGE_STAYS_BUDGET:setup==='transmission'?TRANSMISSION_BUDGET:setup==='single'?{cables:1,bodies:64,constraints:48,drawCalls:16}:CABLE_RIG_BUDGET,get mass(){return cables.reduce((n,c)=>n+c.length*c.profile.massPerMetre,0)+payloads.reduce((n,p)=>n+p.body.mass,0)+connectors.reduce((n,c)=>n+c.body.mass,0);},command,get active(){return driven!==null||pendingShot!==null;},
  beforeStep(dt){
   for(let i=0;i<cables.length;i++)for(let end=0;end<2;end++){const a=cables[i].attachments[end],m=fixings[i][end].member;if(a?.kind==='body'&&m!=null&&!bridge&&(system.members[m].broken||a.body.detached||system.members[m].segments.some(l=>l.body.detached))){const connector=fixings[i][end].connector;if(connector){world.removeConstraint(connector.joint);connector.joint=null;}cables[i].release(end,'support-failed');}}
   if(driven){const c=cables[driven.index],t=Math.min(1,(world.time-driven.start)/2);if(c.attachments[driven.end]?.kind==='driven')c.moveEndpoint(driven.end,driven.point.map((n,i)=>n+driven.delta[i]*t));else driven=null;if(t>=1)driven=null;}
   if(pendingShot!==null&&world.time+1e-10>=pendingShot){strike();pendingShot=null;}
   for(const c of cables)c.beforeStep(dt);
  },
  afterStep(dt){for(const c of cables)c.afterStep(dt);if(typeof driver?.setExternalLoads==='function'){const loads=[];let immediate=false;for(const c of connectors){if(!c.joint)continue;if(c.body.sleepState!==C.Body.SLEEPING){const force=new C.Vec3(...c.joint.equations.slice(0,3).map(e=>-e.multiplier));if(!c.force||force.vsub(c.force).length()>Math.max(1000,c.force.length()*.25))immediate=true;c.force=force;}if(c.force)loads.push({body:c.support,point:c.support.pointToWorldFrame(c.pivot),force:c.force});}driver.setExternalLoads(externalKey,loads,{immediate});}},
  dispose(){driver?.setExternalLoads?.(externalKey,[]);for(const c of cables)c.dispose();for(const c of connectors){if(c.joint)world.removeConstraint(c.joint);world.removeBody(c.body);}for(const p of payloads)world.removeBody(p.body);},
 };
}
