import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import {importDestructible} from '../../src/destruction/destructible.js';
import {createAssemblySimulation} from '../../src/destruction/assembly-simulation.js';
import {createAssemblyClient} from '../../bench/destruction/assembly-client.js';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-5,`${actual} != ${expected}`);
const nearArray=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((value,index)=>near(value,expected[index]));};
function box(size){
 const shape=new C.Box(new C.Vec3(...size.map(n=>n/2))).convexPolyhedronRepresentation;
 return{type:'convex',authorShape:'BOX',vertices:shape.vertices.map(v=>v.toArray()),faces:shape.faces.map(face=>face.slice())};
}
function slabChain(){
 const size=[3.71,.14,2.71],mass=size.reduce((product,n)=>product*n,2400),ids=['left','middle','right'];
 return importDestructible({schema:'impact-club.destructible',version:1,assetId:'slab',model:'slab.glb',units:'m',upAxis:'Y',material:'concrete',anchoring:'loose',breakMode:'full',massKg:mass,breakEnergyJ:120,friction:.6,restitution:.03,
  intact:{nodes:['slab_intact'],colliders:[{...box(size),position:[0,0,0]}]},
  pieces:ids.map((id,index)=>({id,node:`slab_${id}`,section:'body',mode:'dynamic',massKg:mass/3,position:[(index-1)*size[0]/3,0,0],collider:box([size[0]/3,size[1],size[2]])})),
 });
}
class WorkerDouble{
 sent=[];terminated=0;
 postMessage(message,transfer=[]){this.sent.push(structuredClone(message,{transfer}));}
 terminate(){this.terminated++;}
 emit(message,transfer=[]){this.onmessage?.({data:structuredClone(message,{transfer})});}
}
const poseIds=state=>Array.from({length:state.count},(_,index)=>new Float32Array(state.buffer)[index*9]);
// Exercise the transport case where topology arrives after the engine reports
// sleep. Physics is deliberately never advanced by this protocol regression.
function sleepingPacket(state){state.stats.sleeping=true;state.stats.awake=0;return state;}

test('successive graph splits transport piece IDs, compound centres, poses and sleeping topology revisions',()=>{
 const asset=slabChain(),simulation=createAssemblySimulation({scene:'building',floors:true,assets:{slab:asset}}),worker=new WorkerDouble();
 let ready=0,replies=0;
 const client=createAssemblyClient({worker,options:{scene:'building',floors:true,assets:{slab:asset}},onReady:()=>ready++,onState:()=>replies++});
 const panel=simulation.system.floors.panels[0],mass=panel.row.mass,totalMass=simulation.system.totalMass,sourceIds=asset.pieces.map(piece=>piece.id).sort();
 try{
  assert.equal(asset.bonds.length,2);assert.equal(panel.groups.length,1);assert.equal(simulation.world.time,0);
  const model=simulation.describe(),initial=sleepingPacket(simulation.snapshot());
  assert.deepEqual(model.panels[0].groups[0].pieceIds.sort(),sourceIds);
  assert.deepEqual(model.panels[0].asset,{id:'slab',assetId:'slab'});
  worker.emit({type:'ready',model,state:initial},[initial.buffer]);assert.equal(initial.buffer.byteLength,0,'pose buffer transfers ownership');
  client.update(performance.now()+1000);assert.equal(ready,1);assert.equal(client.system.sleeping,true);
  const mirror=client.system.floors.panels[panel.id],initialRevision=client.system.floors.revision;

  function split(bond){
   const parent=panel.groups.find(group=>group.pieceIds.includes(bond.a)&&group.pieceIds.includes(bond.b));assert.ok(parent);
   const parentId=parent.body.id,point=parent.body.pointToWorldFrame(new C.Vec3(...bond.position).vsub(new C.Vec3(...parent.assetCentre)));
   assert.equal(panel.impact({point,energy:bond.energyJ+.001,radius:.0001,body:parent.body}),true);
   return parentId;
  }
  function verifyPacket(state,groups,removedParent){
   const payload=state.fractures.find(row=>row.id===panel.id);assert.ok(payload);assert.equal(payload.groups.length,groups);
   assert.equal(payload.fragments.length,groups);assert.equal(payload.broken,true);assert.equal(payload.revision,panel.revision);
   const ids=payload.groups.flatMap(group=>group.pieceIds);assert.deepEqual(ids.slice().sort(),sourceIds);assert.equal(new Set(ids).size,3);
   assert.deepEqual(payload.pieces.slice().sort(),sourceIds);near(payload.groups.reduce((sum,group)=>sum+group.body.mass,0),mass);
   assert.ok(payload.groups.every(group=>group.body.id!==removedParent));assert.ok(!poseIds(state).includes(removedParent),'removed compound is absent from current poses');
   for(const group of payload.groups){
    const current=panel.groups.find(candidate=>candidate.id===group.id);assert.ok(current);
    nearArray(group.assetCentre,current.assetCentre);nearArray(group.body.position,current.body.position.toArray());nearArray(group.body.quaternion,current.body.quaternion.toArray());
    const expectedCentre=[0,0,0];for(const id of group.pieceIds){const piece=asset.pieces.find(piece=>piece.id===id);piece.position.forEach((n,axis)=>expectedCentre[axis]+=n/group.pieceIds.length);}
    nearArray(group.assetCentre,expectedCentre);
    assert.deepEqual(group.localPieceTransforms.map(piece=>piece.id).sort(),group.pieceIds.slice().sort());
    for(const transform of group.localPieceTransforms){
     const piece=asset.pieces.find(piece=>piece.id===transform.id);assert.equal(transform.node,piece.node);assert.equal(transform.mode,'dynamic');
     nearArray(transform.position,piece.position.map((n,axis)=>n-group.assetCentre[axis]));assert.deepEqual(transform.quaternion,[0,0,0,1]);assert.deepEqual(transform.scale,[1,1,1]);
    }
   }
   near(state.stats.totalMass,totalMass);return payload;
  }
  function verifyMirrors(payload,revision){
   client.update(performance.now()+1000);assert.equal(client.system.sleeping,true);assert.equal(client.system.floors.revision,revision);
   assert.equal(mirror.revision,payload.revision);assert.equal(mirror.groups.length,payload.groups.length);
   for(const group of mirror.groups){
    const expected=payload.groups.find(candidate=>candidate.id===group.id);assert.ok(expected);assert.equal(group.body.id,expected.body.id);
    nearArray(group.body.position.toArray(),expected.body.position);nearArray(group.body.quaternion.toArray(),expected.body.quaternion);
    assert.deepEqual(group.pieceIds,expected.pieceIds);assert.deepEqual(group.localPieceTransforms,expected.localPieceTransforms);assert.deepEqual(group.assetCentre,expected.assetCentre);
   }
  }

  const firstParent=split(panel.internalBonds[0]);assert.equal(panel.groups.length,2);
  const moving=panel.groups.find(group=>group.pieceIds.length===2);moving.body.position.vadd(new C.Vec3(2,3,1),moving.body.position);moving.body.quaternion.setFromEuler(.1,.2,.3);
  const first=sleepingPacket(simulation.snapshot()),firstPayload=verifyPacket(first,2,firstParent),replay=structuredClone(first);
  worker.emit({type:'state',state:first},[first.buffer]);verifyMirrors(firstPayload,initialRevision+1);
  worker.emit({type:'state',state:replay},[replay.buffer]);verifyMirrors(firstPayload,initialRevision+1);
  assert.equal(simulation.snapshot().fractures.length,0,'unchanged topology is sent only once');

  const secondParent=split(panel.internalBonds.find(bond=>bond.alive));assert.equal(panel.groups.length,3);
  const second=sleepingPacket(simulation.snapshot()),secondPayload=verifyPacket(second,3,secondParent);assert.ok(secondPayload.revision>firstPayload.revision);
  worker.emit({type:'state',state:second},[second.buffer]);verifyMirrors(secondPayload,initialRevision+2);
  assert.ok(mirror.groups.every(group=>group.body.id!==firstParent&&group.body.id!==secondParent));
  assert.equal(simulation.snapshot().fractures.length,0);near(simulation.system.totalMass,totalMass);assert.equal(simulation.world.time,0);
  assert.equal(worker.sent.length,1,'transport checks enqueue no physics advance');assert.equal(replies,4);
 }finally{
  client.dispose();client.dispose();simulation.dispose();assert.equal(worker.terminated,1);assert.equal(worker.onmessage,null);assert.equal(simulation.world.bodies.length,0);assert.equal(simulation.world.constraints.length,0);
 }
});
