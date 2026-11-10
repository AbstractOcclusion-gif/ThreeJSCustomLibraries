import * as C from 'cannon-es';
import {createFracturedPanel,prepareFracturedRows} from './fractured.js';
import {connectMasonryCorners,validateMasonryCornerRows} from './masonry-corners.js';

export function validateFloorRows(rows,memberCount,assets={},prepared=null){
 const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 if(!Array.isArray(rows))throw Error('Invalid floor rows');
 for(const [id,row]of rows.entries())if(!row||!vector(row.position)||!vector(row.halfExtents)||!row.halfExtents.every(n=>n>(row.assetId?0:.025))||!['mass','breakEnergy','breakForce'].every(k=>Number.isFinite(row[k])&&row[k]>0)||!Array.isArray(row.bearings)||row.bearings.length<(row.assetId||row.kind==='plank'&&row.ropeSupported?0:2)||!row.bearings.every(b=>Number.isInteger(b.member)&&b.member>=0&&b.member<memberCount&&vector(b.point))||!Array.isArray(row.neighbours)||!row.neighbours.every(n=>Number.isInteger(n)&&n>=0&&n<rows.length&&n!==id)||row.assetId!=null&&(typeof row.assetId!=='string'||!row.assetId.trim())||row.assetScale!=null&&(!vector(row.assetScale)||!row.assetScale.every(n=>n>0))||row.quaternion!=null&&(!Array.isArray(row.quaternion)||row.quaternion.length!==4||!row.quaternion.every(Number.isFinite)||Math.hypot(...row.quaternion)<1e-8)||row.bearingTolerance!=null&&(!Number.isFinite(row.bearingTolerance)||row.bearingTolerance<0))throw Error('Invalid floor definition');
 for(const row of rows)if(row.collisionLOD!=null&&!['auto','detailed','intact'].includes(row.collisionLOD))throw Error('Invalid floor collisionLOD');
 for(const row of rows)if(row.compactCollisionAxes!=null&&typeof row.compactCollisionAxes!=='boolean')throw Error('Invalid floor compactCollisionAxes');
 if(!prepared)prepareFracturedRows(rows,assets);
 validateMasonryCornerRows(rows,assets);
 return rows;
}

// Rigid floor tiles with frame bearings and neighbour bonds; four physical shards
// inherit each failed tile's mass, velocity and spin. The host owns the frame.
export function createBreakableFloors({world,rows,members,assets={},onEvent=()=>{},wake=()=>{}}){
 validateFloorRows(rows,members.length,assets,true);
 const prepared=prepareFracturedRows(rows,assets),panels=[],bonds=[],pending=new Set();let disposed=false,fractureEnabled=true,damageEnabled=true,brokenCount=0,revision=0;
 function bond(a,b,point,kind='support'){
  const joint=kind==='tile'?new C.LockConstraint(a.body,b.body,{maxForce:1e8}):new C.PointToPointConstraint(a.body,a.body.pointToLocalFrame(point),b,b.pointToLocalFrame(point),1e8);
  joint.collideConnected=false;world.addConstraint(joint);const item={a,b:kind==='tile'?b:null,joint,alive:true,kind};bonds.push(item);a.bonds.push(item);if(kind==='tile')b.bonds.push(item);a.addExternalBond?.(item);if(kind==='tile')b.addExternalBond?.(item);
 }
 for(const row of rows){
  if(prepared.has(row)){panels.push(createFracturedPanel({world,row,id:panels.length,prepared:prepared.get(row),members,bonds,onEvent,wake,topology:()=>{revision++;}}));continue;}
  const body=new C.Body({mass:row.mass,shape:new C.Box(new C.Vec3(...row.halfExtents)),position:new C.Vec3(...row.position),quaternion:row.quaternion?new C.Quaternion(...row.quaternion):new C.Quaternion(),collisionFilterGroup:2,collisionFilterMask:3,linearDamping:.03,angularDamping:.06,allowSleep:false,sleepSpeedLimit:.12,sleepTimeLimit:1});body.quaternion.normalize();world.addBody(body);
  const panel={id:panels.length,row,body,bonds:[],broken:false,damage:0,fragments:[]};panels.push(panel);
  body.addEventListener('collide',e=>{const speed=Math.abs(e.contact.getImpactVelocityAlongNormal());if(speed>.5)wake(body);if(panel.broken||!damageEnabled||speed<1)return;const reduced=e.body.mass>0?body.mass*e.body.mass/(body.mass+e.body.mass):body.mass,energy=.5*reduced*speed*speed;if(energy>5000)onEvent({type:'floor:impact',time:world.time,energy,storey:row.storey});if(energy>row.breakEnergy*.02){panel.damage+=energy/row.breakEnergy;if(panel.damage>=1)pending.add(panel);}});
  for(const bearing of row.bearings){const target=members[bearing.member].segments.reduce((best,s)=>s.body.position.distanceTo(new C.Vec3(...bearing.point))<best.position.distanceTo(new C.Vec3(...bearing.point))?s.body:best,members[bearing.member].segments[0].body);bond(panel,target,new C.Vec3(...bearing.point));}
 }
 for(const panel of panels)for(const id of panel.row.neighbours??[])if(id>panel.id)bond(panel,panels[id],null,'tile');
 for(const panel of panels)panel.finishSetup?.();
 connectMasonryCorners(panels);let cornerRevision=revision;
 function fracture(panel){if(panel.asset)return panel.shatter();if(panel.broken)return;panel.broken=true;brokenCount++;revision++;wake(panel.body);for(const b of panel.bonds)if(b.alive){b.alive=false;world.removeConstraint(b.joint);}
  const extents=panel.row.halfExtents,thin=extents.indexOf(Math.min(...extents)),axes=[0,1,2].filter(i=>i!==thin);
  for(const x of [-1,1])for(const z of [-1,1]){
   const halfExtents=extents.map((n,i)=>i===thin?n:Math.max(n/2-.012,n/4)),offset=[0,0,0];offset[axes[0]]=x*extents[axes[0]]/2;offset[axes[1]]=z*extents[axes[1]]/2;const position=panel.body.pointToWorldFrame(new C.Vec3(...offset)),body=new C.Body({mass:panel.body.mass/4,shape:new C.Box(new C.Vec3(...halfExtents)),position,quaternion:panel.body.quaternion.clone(),collisionFilterGroup:2,collisionFilterMask:3,linearDamping:.03,angularDamping:.06,allowSleep:true,sleepSpeedLimit:.12,sleepTimeLimit:1});panel.body.getVelocityAtWorldPoint(position,body.velocity);body.angularVelocity.copy(panel.body.angularVelocity);world.addBody(body);panel.fragments.push({body,halfExtents});
  }
  world.removeBody(panel.body);onEvent({type:'floor:fractured',time:world.time,floor:panel.row.storey,panelId:panel.id,mass:panel.body.mass,...(panel.row.kind==='plank'?{kind:'plank',point:panel.body.position.toArray()}:{} )});
 }
 let groupsRevision=-1,currentGroups=[],currentBodies=[],bodyGroups=new Map();
 function groups(){if(groupsRevision!==revision){groupsRevision=revision;currentGroups=panels.flatMap(p=>p.asset?p.groups:(p.broken?p.fragments:[{body:p.body,halfExtents:p.row.halfExtents}]).map((f,i)=>({...f,id:`${p.id}:rectangle:${i}`,panel:p,pieceIds:[],localPieceTransforms:[],assetCentre:[0,0,0],bearings:p.broken?[]:p.bonds.filter(b=>b.alive&&b.kind==='support').map(b=>({bearing:p.row.bearings[p.bonds.indexOf(b)],member:members[p.row.bearings[p.bonds.indexOf(b)]?.member],bond:b})),bonds:p.broken?[]:p.bonds,detached:p.broken})));currentBodies=currentGroups.map(g=>g.body);bodyGroups=new Map(currentGroups.map(g=>[g.body,g]));}return currentGroups;}
 return{panels,bonds,
  bindRope(panel,body,point){
   bond(panel,body,point,'rope');
   panel.bonds.at(-1).joint._nativeSteps=[128,32];
  },
  get groups(){return groups().slice();},get bodies(){groups();return currentBodies.slice();},get bearingAttachments(){return groups().flatMap(g=>g.bearings.map(a=>({...a,group:g})));},groupForBody(body){groups();return bodyGroups.get(body);},get revision(){return revision;},
  beforeStep(dt){if(disposed)return;for(const b of bonds)if(b.alive&&b.configuredDt!==dt){for(const e of b.joint.equations)e.setSpookParams(1e10,4,dt);b.configuredDt=dt;}for(const p of panels)p.beforeStep?.(dt);},
  afterStep(){if(disposed||!fractureEnabled||!damageEnabled)return;for(const b of bonds)if(!b.a.asset&&b.alive&&(b.joint.bodyA.sleepState!==C.Body.SLEEPING||b.joint.bodyB.sleepState!==C.Body.SLEEPING)){const e=b.joint.equations,f=e[0].multiplier*e[0].multiplier+e[1].multiplier*e[1].multiplier+e[2].multiplier*e[2].multiplier,limit=b.a.row.breakForce;if(f>limit*limit)pending.add(b.a);}for(const panel of pending)fracture(panel);pending.clear();for(const panel of panels)panel.afterStep?.();if(cornerRevision!==revision){cornerRevision=revision;for(const panel of panels)panel.refreshMasonrySupport?.();}},
  // Detached fragments wake through actual contacts, not remote frame impacts.
  setFracture(enabled){fractureEnabled=enabled;for(const p of panels)p.setFracture?.(enabled);},impact(panel,details){return panel.impact?.(details)??false;},shatter(panel,details){if(fractureEnabled&&damageEnabled)return panel.asset?panel.shatter(details):fracture(panel);},setDamage(enabled){damageEnabled=enabled;if(!enabled)pending.clear();for(const p of panels)p.setDamage?.(enabled);},wake(){for(const p of panels)if(p.asset){for(const g of p.groups)if(!g.detached)g.body.wakeUp();}else if(!p.broken)p.body.wakeUp();},
  get broken(){return brokenCount+panels.filter(p=>p.asset&&p.broken).length;},get mass(){return panels.reduce((sum,p)=>sum+(p.asset?p.row.mass:p.body.mass||p.body.retiredMass||0),0);},
  dispose(){if(disposed)return;disposed=true;for(const b of bonds)world.removeConstraint(b.joint);for(const p of panels){if(p.asset){p.dispose();continue;}world.removeBody(p.body);for(const f of p.fragments)world.removeBody(f.body);}pending.clear();}
 };
}

