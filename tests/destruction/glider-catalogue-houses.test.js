import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from 'cannon-es';
import init from 'jolt-physics';
import {CATALOGUE_HOUSES,resolveCatalogueHouse,createCatalogueHouseDefinition} from '../../src/destruction/catalogue-houses.js';
import {createAssemblySimulation} from '../../src/destruction/assembly-simulation.js';
import {createJoltClusterDriver} from '../../src/destruction/jolt-clusters.js';
import {importDestructible} from '../../src/destruction/destructible.js';
import {prepareFracturedRows} from '../../src/destruction/fractured.js';
const catalogue=JSON.parse(fs.readFileSync(new URL('../../assets/structures/manifest.json',import.meta.url))),J=await init();
function fixture(id){const house=resolveCatalogueHouse(catalogue,id),assets={};for(const {entry}of house.instances)assets[entry.id]??=importDestructible(JSON.parse(fs.readFileSync(new URL('../../assets/structures/'+entry.definition,import.meta.url))));const tileEntry=catalogue.assets.find(a=>a.type==='roof.tile_patch'),tile=JSON.parse(fs.readFileSync(new URL('../../assets/structures/'+tileEntry.definition,import.meta.url)));return{house,assets,definition:createCatalogueHouseDefinition(house,assets,tile)};}
function advance(sim,seconds){const target=sim.world.time+seconds;sim.advance(seconds);for(let i=0;sim.world.time+sim.dt/2<target&&i<10000;i++)sim.advance(0);assert.ok(sim.world.time+sim.dt/2>=target);}

for(const id of ['log-cabin','wooden-house'])test(`${id}: timber walls retain authored grain, openings, atlas profile and bounded chunks`,()=>{
 const {house,assets,definition}=fixture(id);
 for(const instance of house.instances.slice(0,6)){
  const asset=assets[instance.entry.id];assert.equal(asset.material,'oak');assert.ok(asset.validation.physicalChunks<=64);
  assert.deepEqual(asset.part.grainAxis,id==='wooden-house'&&instance.entry.type.includes('plank')?[0,1,0]:[1,0,0]);
 }
 const sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver:createJoltClusterDriver(J,{dynamicFrame:1}),collisionLOD:'auto',material:'brittle'});
 try{
  for(const index of [0,2]){const wall=sim.system.floors.panels[index],q=new C.Quaternion(...wall.row.quaternion),origin=new C.Vec3(...wall.row.position),x=index===2?-1:1;
   const ray=new C.Ray(q.vmult(new C.Vec3(x,0,1)).vadd(origin),q.vmult(new C.Vec3(x,0,-1)).vadd(origin)),result=new C.RaycastResult();ray.intersectBody(wall.body,result);assert.equal(result.hasHit,false,'authored door/window remains open');
  }
  const walls=sim.system.floors.panels.slice(0,4),initial=walls.map(p=>p.body.position.clone());
  advance(sim,8);assert.equal(sim.system.floors.broken,0);assert.ok(walls.every((p,i)=>p.body.position.distanceTo(initial[i])<.005));
  const wall=walls[2],mass=wall.groups.reduce((sum,g)=>sum+g.mass,0);
  sim.command({type:'fire',target:[-1.5,1.2,2.2],origin:[-1.5,1.2,6],mass:350,speed:20});advance(sim,2);
  assert.ok(wall.broken,'real projectile breaks the timber facade');assert.ok(wall.groups.length>1);
  assert.ok(Math.abs(wall.groups.reduce((sum,g)=>sum+g.mass,0)-mass)<1e-4);
 }finally{sim.dispose();}
});

for(const id of ['cottage','brick-cottage'])for(const mode of ['clustered Jolt','dynamic Jolt',...(id==='brick-cottage'?['Cannon']:[])])test(`${id}: ${mode} survives idle, impact and disposal`,()=>{
 const {assets,definition}=fixture(id),driver=mode==='Cannon'?null:createJoltClusterDriver(J,{dynamicFrame:mode==='dynamic Jolt'?1:0});
 const sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver,collisionLOD:driver?'auto':'intact',material:'brittle',chipsBelowKg:0});
 try{
  const walls=sim.system.floors.panels.slice(0,4),initial=walls.map(p=>p.body.position.clone());advance(sim,1);
  assert.equal(sim.system.floors.broken,0,'no untouched fracture');
  assert.ok(walls.every((p,i)=>p.body.position.distanceTo(initial[i])<.02),'intact walls stay in place');
  const wall=walls[2],mass=wall.groups.reduce((sum,g)=>sum+g.mass,0);
  sim.command({type:'fire',target:[-1.5,1.2,2.2],origin:[-1.5,1.2,6],mode:'projectile',mass:350,speed:20});advance(sim,2);
  assert.ok(wall.broken,'real projectile damages the facade');
  const retained=wall.groups.reduce((sum,g)=>sum+g.mass,0)+(wall.frozen??[]).reduce((sum,g)=>sum+g.mass,0);
  assert.ok(Math.abs(retained-mass)<1e-4,`fracture and band retirement preserve wall mass: ${retained} / ${mass}`);
  assert.ok(sim.world.bodies.every(b=>b.position.toArray().every(Number.isFinite)),'finite positions after impact');
 }finally{sim.dispose();assert.equal(sim.world.bodies.length,0);assert.equal(sim.world.constraints.length,0);}
});

test('dynamic house clusters keep a roof on standing masonry static and release it with its supports',()=>{
 const {assets,definition}=fixture('brick-cottage'),driver=createJoltClusterDriver(J,{dynamicFrame:1});
 const sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver,collisionLOD:'auto',material:'brittle',chipsBelowKg:0});
 try{
  const roof=sim.system.floors.panels.find(p=>p.row.roofTiles),initial=roof.body.position.clone();
  sim.command({type:'fire',target:[-1.5,1.2,2.2],origin:[-1.5,1.2,6],mass:350,speed:20});advance(sim,2);
  const body=roof.groups[0].body,native=driver.describePart(body);
  assert.equal(native.supported,true);assert.equal(native.framed,false);assert.equal(native.motion,'static');
  assert.equal(body.position.distanceTo(initial),0,'a local wall hit cannot shake the supported roof compound');
  sim.command({type:'releaseFoundations'});advance(sim,.1);
  const released=driver.describePart(roof.groups[0].body);
  assert.equal(released.supported,false);assert.equal(released.framed,false);
  assert.equal(released.motion,'dynamic','released walls can still bear weight through contacts, but cannot statically pin the roof');
 }finally{sim.dispose();assert.equal(sim.world.bodies.length,0);assert.equal(sim.world.constraints.length,0);}
});

test('experimental facade reserves fine cracks for a later hit on detached coarse debris',()=>{
 const {assets,definition}=fixture('rough-cottage'),sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver:createJoltClusterDriver(J,{dynamicFrame:0}),collisionLOD:'auto',material:'brittle'});
 try{
  const wall=sim.system.floors.panels[2],fine=wall.internalBonds.filter(b=>b.fractureLevel===2),permanent=wall.internalBonds.filter(b=>b.breakable===false),mass=wall.groups.reduce((s,g)=>s+g.mass,0);
  assert.ok(fine.length>0);assert.ok(permanent.length>0);
  sim.system.floors.impact(wall,{point:wall.body.position,energy:1e9,radius:20});
  assert.ok(wall.groups.length>1);assert.ok(fine.every(b=>b.alive&&b.damageJ===0),'first impact must not spend leftover energy on fine cracks');
  const attached=wall.groups.find(g=>!g.detached&&fine.some(b=>g.pieceIds.includes(b.a)&&g.pieceIds.includes(b.b)));
  assert.ok(attached);assert.equal(sim.system.floors.impact(wall,{body:attached.body,point:attached.body.position,energy:1e9,radius:20}),false,'supported coarse debris cannot refine');
  const target=wall.groups.find(g=>g.detached&&fine.some(b=>g.pieceIds.includes(b.a)&&g.pieceIds.includes(b.b)));assert.ok(target);
  const untouched=fine.filter(b=>!target.pieceIds.includes(b.a)),count=wall.groups.length;
  target.body.velocity.set(1,2,3);target.body.angularVelocity.set(.2,.4,.6);
  const linear=()=>wall.groups.reduce((v,g)=>v.vadd(g.body.velocity.scale(g.mass)),new C.Vec3());
  const angular=()=>wall.groups.reduce((sum,g)=>{const b=g.body,spin=b.quaternion.vmult(new C.Mat3(b._massTensor).vmult(b.quaternion.conjugate().vmult(b.angularVelocity)));return sum.vadd(spin.vadd(b.position.cross(b.velocity.scale(g.mass))));},new C.Vec3());
  const before=linear(),spin=angular();
  assert.ok(sim.system.floors.impact(wall,{body:target.body,point:target.body.position,energy:1e9,radius:20}));
  assert.ok(wall.groups.length>count);assert.ok(fine.some(b=>!b.alive));assert.ok(untouched.every(b=>b.alive));assert.ok(permanent.every(b=>b.alive));
  assert.ok(Math.abs(wall.groups.reduce((s,g)=>s+g.mass,0)-mass)<1e-5);
  assert.ok(before.distanceTo(linear())<1e-5);assert.ok(spin.distanceTo(angular())<1e-4);
 }finally{sim.dispose();}
});

for(const frame of [0,1])test(`second-hit house: frame ${frame} keeps grounded house static through debris refinement`,()=>{
 const {assets,definition}=fixture('rough-cottage'),driver=createJoltClusterDriver(J,{dynamicFrame:frame});
 const sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver,collisionLOD:'auto',material:'brittle',chipsBelowKg:0});
 try{
  const wall=sim.system.floors.panels[2],roof=sim.system.floors.panels.find(p=>p.row.roofTiles),roofPosition=roof.body.position.clone();
  const others=sim.system.floors.panels.slice(0,4).filter(p=>p!==wall).map(p=>({panel:p,position:p.body.position.clone()}));
  sim.system.floors.impact(wall,{point:wall.body.position,energy:1e9,radius:20});
  const target=wall.groups.find(g=>g.detached&&wall.internalBonds.some(b=>b.alive&&b.fractureLevel===2&&g.pieceIds.includes(b.a)&&g.pieceIds.includes(b.b)));assert.ok(target);
  const count=wall.groups.length;assert.ok(wall.impact({body:target.body,point:target.body.position,energy:1e9,radius:20}));assert.ok(wall.groups.length>count);
  advance(sim,.5);
  assert.equal(driver.describePart(roof.groups[0].body).motion,'static','a second hit on released debris cannot mobilize the supported roof');
  assert.ok(roof.groups[0].body.position.distanceTo(roofPosition)<1e-9);
  for(const {panel,position}of others){assert.equal(driver.describePart(panel.groups[0].body).motion,'static');assert.ok(panel.groups[0].body.position.distanceTo(position)<1e-9);}
  assert.ok(wall.groups.some(g=>g.detached&&driver.describePart(g.body)?.motion==='dynamic'),'released facade remains physical');
  sim.command({type:'releaseFoundations'});advance(sim,.1);
  assert.equal(driver.describePart(roof.groups[0].body).supported,false,'actual support failure still releases the house');
 }finally{sim.dispose();assert.equal(sim.world.bodies.length,0);assert.equal(sim.world.constraints.length,0);}
});

for(const {id}of CATALOGUE_HOUSES.filter(h=>!h.masonry&&!h.timber))test(`${id}: four coherent walls stand under native gravity and split internally`,()=>{
 const {assets,definition}=fixture(id),sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver:createJoltClusterDriver(J,{dynamicFrame:0}),collisionLOD:'auto',material:'brittle'});
 const failures=[];sim.system.subscribe(e=>{if(e.type==='floor:fractured')failures.push({id:e.panelId,asset:sim.system.floors.panels[e.panelId].assetId,reason:e.reason,time:e.time,edges:sim.system.floors.panels[e.panelId].internalBonds.filter(b=>!b.alive).map(b=>({a:b.a,b:b.b,area:b.areaM2,capacity:b.capacity,point:b.position}))});});
 const walls=sim.system.floors.panels.slice(0,4),initial=walls.map(p=>({position:p.body.position.clone(),quaternion:p.body.quaternion.clone()}));
 try{
  for(const wall of walls){assert.equal(wall.groups.length,1);assert.equal(wall.groups[0].collisionLOD,'intact');assert.ok(wall.groups[0].body.shapes.length<wall.asset.pieces.length,'whole wall uses coarse opening-preserving regions');}
  advance(sim,8);
  const drift=Math.max(...walls.map((p,i)=>p.body.position.distanceTo(initial[i].position))),rotation=Math.max(...walls.map((p,i)=>2*Math.acos(Math.min(1,Math.abs(['x','y','z','w'].reduce((n,k)=>n+p.body.quaternion[k]*initial[i].quaternion[k],0))))));
  console.log(JSON.stringify({house:id,driftM:drift,rotationRad:rotation,fractured:sim.system.floors.broken,failures}));
  assert.equal(sim.system.floors.broken,0,'no untouched damage');assert.ok(drift<.005,`wall drift ${drift}`);assert.ok(rotation<.005,`wall rotation ${rotation}`);
  const wall=walls[0],mass=wall.groups.reduce((n,g)=>n+g.mass,0);sim.system.floors.impact(wall,{point:wall.body.position,energy:wall.row.breakEnergy*2,radius:20});assert.ok(wall.groups.length>1);assert.ok(Math.abs(wall.groups.reduce((n,g)=>n+g.mass,0)-mass)<1e-4);
  const released=wall.groups.filter(g=>g.detached).map(g=>({group:g,y:g.body.position.y}));assert.ok(released.length>0);advance(sim,.5);assert.ok(released.some(({group,y})=>group.body.world===sim.world&&group.body.position.y<y-.02),'released chunks must physically fall');
 }finally{sim.dispose();assert.equal(sim.world.bodies.length,0);assert.equal(sim.world.constraints.length,0);}
});

test('whole-wall automatic proxy rejects an intact collider filling a real opening',()=>{
 const {definition,assets}=fixture('cottage'),row={...definition.floors[0],collisionLOD:'auto'},raw=structuredClone(assets[row.assetId]);
 raw.intact.colliders[0].vertices[0][0]-=.2;
 const prepared=prepareFracturedRows([row],{[row.assetId]:raw}).get(row);assert.equal(prepared.collisionLOD.certified,false);
});

test('a physical projectile breaks a whole facade through the worker simulation API',()=>{
 const {assets,definition}=fixture('cottage'),sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver:createJoltClusterDriver(J,{dynamicFrame:0}),collisionLOD:'auto',material:'brittle'});
 try{advance(sim,1);sim.command({type:'fire',target:[-1.5,1.2,2.2],origin:[-1.5,1.2,6],mode:'projectile',mass:350,speed:20});advance(sim,2);assert.ok(sim.system.floors.panels[2].broken,'the targeted whole facade must fracture');assert.ok(sim.system.floors.panels[2].groups.length>1);}finally{sim.dispose();}
});

test('the door facade keeps shared-cell construction regions together when all real cracks are broken',()=>{
 const {assets,definition}=fixture('cottage'),sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver:createJoltClusterDriver(J,{dynamicFrame:0}),collisionLOD:'auto',material:'brittle'});
 try{const facade=sim.system.floors.panels[2],rigid=facade.internalBonds.filter(b=>b.breakable===false);assert.ok(rigid.length>0);sim.system.floors.shatter(facade);advance(sim,.5);assert.ok(rigid.every(b=>b.alive));assert.ok(facade.groups.length<facade.asset.pieces.length);console.log('Door facade:',facade.asset.pieces.length,'convex regions ->',facade.groups.length,'coherent Voronoi chunks');}finally{sim.dispose();}
});

for(const id of ['exposed-fieldstone','plastered-brick','plastered-farmhouse'])test(id+': existing assets, grounded idle, real impact and complete disposal',()=>{
 const {house,assets,definition}=fixture(id);assert.ok(house.instances.every(i=>assets[i.entry.id]));assert.equal(definition.metadata.wholeWalls,true);
 const sim=createAssemblySimulation({scene:'catalogue-house',definition,assets,driver:createJoltClusterDriver(J,{dynamicFrame:0}),collisionLOD:'auto',material:'brittle',chipsBelowKg:0});
 try{advance(sim,1);assert.equal(sim.system.floors.broken,0);sim.command({type:'fire',target:[-1.5,1.2,house.depth/2+.2],origin:[-1.5,1.2,house.depth/2+4],mass:350,speed:20});advance(sim,2);assert.ok(sim.system.floors.panels[2].broken);assert.ok(sim.world.bodies.every(b=>b.position.toArray().every(Number.isFinite)));}
 finally{sim.dispose();assert.equal(sim.world.bodies.length,0);assert.equal(sim.world.constraints.length,0);}
});
