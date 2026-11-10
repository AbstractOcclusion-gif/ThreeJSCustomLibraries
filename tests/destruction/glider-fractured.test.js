import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as C from 'cannon-es';
import {createBreakableFloors,validateFloorRows} from '../../src/destruction/floors.js';
import {importDestructible} from '../../src/destruction/destructible.js';

const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function box(size=[1,.2,1],offset=[0,0,0]){return{type:'convex',vertices:[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(p=>p.map((n,i)=>n*size[i]/2+offset[i])),faces:[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]]};}
function asset(pieces=[-1,0,1].map((x,i)=>({id:`p${i}`,node:`piece_${i}`,section:'body',mode:'dynamic',massKg:10,position:[x,0,0],collider:box()}))){return importDestructible({schema:'impact-club.destructible',version:1,assetId:'panel',model:'panel.glb',units:'m',upAxis:'Y',material:'concrete',anchoring:'loose',breakMode:'full',massKg:pieces.reduce((s,p)=>s+p.massKg,0),breakEnergyJ:12,friction:.6,restitution:.03,intact:{nodes:['intact'],colliders:[{...box([3,.2,1]),position:[0,0,0]}]},pieces});}
function row(overrides={}){return{assetId:'panel',collisionLOD:'auto',position:[0,4,0],halfExtents:[1.5,.1,.5],mass:30,breakEnergy:12,breakForce:100000,bearings:[{member:0,point:[-1.5,4,0]},{member:1,point:[1.5,4,0]}],neighbours:[],...overrides};}
function fixture(options={}){
 const world=new C.World({gravity:new C.Vec3(0,-9.82,0),allowSleep:true});world.solver.iterations=30;world.defaultContactMaterial.restitution=.03;
 const members=[-1.5,1.5].map(x=>{const body=new C.Body({mass:0,position:new C.Vec3(x,4,0),collisionFilterMask:0});world.addBody(body);return{segments:[{body}],hinges:[{broken:false}],broken:0};});
 const rows=options.rows??[row()],assets=options.assets??{panel:asset()},events=[];
 const floors=createBreakableFloors({world,members,rows,assets,onEvent:e=>events.push(e)});
 const advance=seconds=>{for(let i=0;i<seconds*240;i++){floors.beforeStep(1/240);world.step(1/240);floors.afterStep();}};
 return{world,members,rows,assets,events,floors,advance};
}
function momentum(groups){const linear=new C.Vec3(),angular=new C.Vec3();for(const group of groups){const b=group.body,m=group.mass??b.mass;linear.vadd(b.velocity.scale(m),linear);const q=b.quaternion,R=new C.Mat3();R.setRotationFromQuaternion(q);const local=q.conjugate().vmult(b.angularVelocity),spin=q.vmult(new C.Mat3(b._massTensor).vmult(local));angular.vadd(spin.vadd(b.position.cross(b.velocity.scale(m))),angular);}return{linear,angular};}

test('asset compounds expose serializable COM-relative pieces and conserve mass/linear/angular momentum across recursive splits',()=>{
 const f=fixture(),panel=f.floors.panels[0],original=panel.body;
 assert.equal(original.shapes.length,1);assert.ok(original.shapes[0] instanceof C.Box);assert.equal(panel.groups[0].collisionLOD,'intact');assert.equal(f.floors.groups.length,1);assert.equal(f.floors.bearingAttachments.length,2);
 original.velocity.set(2,-3,4);original.angularVelocity.set(.4,.5,.6);const before=momentum(panel.groups);
 assert.equal(f.floors.impact(panel,{point:[-.5,4,0],energy:3,radius:.1}),false);close(panel.internalBonds[0].damageJ,3);assert.equal(panel.broken,false);
 assert.equal(f.floors.impact(panel,{point:[-.5,4,0],energy:3,radius:.1}),true);assert.equal(panel.groups.length,2);assert.ok(!f.world.bodies.includes(original));assert.ok(panel.groups.every(g=>!g.detached));
 const target=panel.groups.find(g=>g.pieceIds.includes('p1'));
 f.floors.impact(panel,{point:[.5,4,0],energy:6,radius:.1,body:target.body});
 assert.equal(panel.groups.length,3);assert.equal(panel.groups.filter(g=>g.detached).length,1);assert.equal(f.floors.broken,1);assert.equal(f.floors.mass,30);assert.equal(panel.groups.reduce((s,g)=>s+g.body.mass,0),30);
 const after=momentum(panel.groups);close(after.linear.distanceTo(before.linear),0);close(after.angular.distanceTo(before.angular),0);
 assert.equal(f.world.constraints.length,2);assert.ok(f.floors.bearingAttachments.every(a=>a.bond.alive&&f.world.bodies.includes(a.group.body)));
 for(const g of panel.groups){assert.equal(f.floors.groupForBody(g.body),g);assert.equal(g.localPieceTransforms.length,g.pieceIds.length);assert.doesNotThrow(()=>JSON.stringify(g.localPieceTransforms));}
 assert.equal(f.events.filter(e=>e.type==='floor:fractured').length,2);assert.ok(f.events.every(e=>Array.isArray(e.pieces)));assert.ok(f.floors.revision>1);
 f.floors.dispose();f.floors.dispose();assert.equal(f.world.bodies.length,2);assert.equal(f.world.constraints.length,0);
});

test('a distant hit cannot damage bonds and switches prevent contact and explicit fracture damage',()=>{
 const f=fixture(),p=f.floors.panels[0];
 f.floors.impact(p,{point:[100,4,0],energy:100000,radius:.1});assert.ok(p.internalBonds.every(b=>b.damageJ===0));
 f.floors.setDamage(false);f.floors.shatter(p);f.floors.impact(p,{point:[0,4,0],energy:100000});assert.equal(p.broken,false);
 f.floors.setDamage(true);f.floors.setFracture(false);f.floors.shatter(p);assert.equal(p.broken,false);
 f.floors.setFracture(true);f.floors.shatter(p);assert.equal(p.groups.length,3);assert.equal(f.world.constraints.length,0);assert.ok(p.groups.every(g=>g.detached));
});

test('validated runtime asset loading preserves imported material strength and contact tolerance overrides',()=>{
 const source=asset(),custom=importDestructible(source,{tolerance:.006,materials:{concrete:123}}),f=fixture({assets:{panel:custom}}),p=f.floors.panels[0];
 assert.equal(p.asset.tolerance,.006);assert.equal(p.asset.materialStrengthPa,123);close(p.internalBonds[0].capacity,.2*123);
});

test('material bond force capacity carries gravity and inertial loads inside the compound',()=>{
 const weak=importDestructible(asset(),{materials:{concrete:100}}),weakFixture=fixture({assets:{panel:weak}}),normal=fixture();
 weakFixture.advance(.05);normal.advance(.05);
 assert.equal(normal.floors.panels[0].broken,false);assert.ok(weakFixture.floors.panels[0].broken);assert.ok(weakFixture.events.some(e=>e.reason==='bond:force'));
 const sleeping=fixture({assets:{panel:weak}});sleeping.floors.panels[0].body.sleep();sleeping.floors.beforeStep(1/60);sleeping.floors.afterStep();assert.ok(sleeping.floors.panels[0].broken,'initial sleeping/native-static compounds still check their own weight');
});

test('losing the supporting column releases its bearing joints without leaving invisible constraints',()=>{
 const f=fixture({rows:[row({bearings:[{member:0,point:[-1.5,4,0]}]})]}),p=f.floors.panels[0];
 assert.equal(f.world.constraints.length,1);f.members[0].hinges[0].broken=true;f.floors.afterStep();
 assert.equal(f.world.constraints.length,0);assert.equal(p.broken,true);assert.equal(p.groups.length,1);assert.equal(p.groups[0].detached,true);assert.equal(p.body.mass,30);
 f.advance(.1);assert.ok(p.body.position.y<4);assert.equal(f.floors.bearingAttachments.filter(a=>a.bond.alive).length,0);
});

test('asset anchors apply only free-standing, and cosmetics move in their dynamic follower group',()=>{
 const a=asset();a.pieces[0].mode='anchored';a.bearings=['p0'];a.pieces.push({id:'trim',node:'trim',section:'body',mode:'cosmetic',massKg:0,position:[1,.1,0],collider:null,followPieceId:'p2'});
 const f=fixture({rows:[row({bearings:[]})],assets:{panel:a}}),p=f.floors.panels[0];assert.equal(p.body.mass,0);close(f.floors.mass,30);
 f.floors.shatter(p);const anchor=p.groups.find(g=>g.pieceIds.includes('p0')),moving=p.groups.find(g=>g.pieceIds.includes('p2'));
 assert.equal(anchor.body.mass,0);assert.equal(moving.body.mass,10);assert.ok(moving.localPieceTransforms.some(t=>t.id==='trim'));assert.ok(!anchor.localPieceTransforms.some(t=>t.id==='trim'));
 const placed=fixture({assets:{panel:a}});assert.equal(placed.floors.panels[0].body.mass,30,'frame placement replaces authored anchors');
});

test('scaled off-centre hulls use true mass centroids and summed volume inertia',()=>{
 const pieces=[{id:'offset',node:'offset_node',section:'body',mode:'dynamic',massKg:12,position:[2,0,0],collider:box([2,4,6],[1,0,0])}];
 const a=asset(pieces),q=new C.Quaternion();q.setFromEuler(0,0,Math.PI/2);
 const f=fixture({assets:{panel:a},rows:[row({mass:12,position:[10,4,0],bearings:[],assetScale:[2,1,.5],quaternion:q.toArray()})]}),group=f.floors.groups[0];
 close(group.body.position.x,10);close(group.body.position.y,10);assert.deepEqual(group.assetCentre,[6,0,0]);assert.deepEqual(group.localPieceTransforms[0].position,[-2,0,0]);assert.deepEqual(group.localPieceTransforms[0].scale,[2,1,.5]);
 close(group.body._massTensor[0],25);close(group.body._massTensor[4],25);close(group.body._massTensor[8],32);
});

test('window-style panels inherit neighbor support and lose the lock when a neighbor fractures',()=>{
 const rows=[row({neighbours:[1]}),row({position:[3,4,0],bearings:[],neighbours:[0]})],f=fixture({rows}),window=f.floors.panels[1];
 assert.equal(window.groups[0].detached,false);const tile=f.floors.bonds.find(b=>b.kind==='tile');assert.ok(tile.alive);
 f.floors.shatter(f.floors.panels[0]);f.floors.afterStep();assert.equal(tile.alive,false);assert.equal(window.groups[0].detached,true);assert.ok(!f.world.constraints.includes(tile.joint));
});

test('a sleeping neighbor losing its last local support wakes after detachment and falls without repeated wake events',()=>{
 const f=fixture({rows:[row({neighbours:[1]}),row({position:[3,4,0],bearings:[],neighbours:[0]})]}),p=f.floors.panels[1],body=p.body;
 body.sleep();let wakes=0;body.addEventListener('wakeup',()=>{wakes++;assert.equal(body.detached,true);assert.equal(body.allowSleep,true);});
 const height=body.position.y;f.floors.shatter(f.floors.panels[0]);f.floors.afterStep();
 assert.equal(wakes,1);assert.notEqual(body.sleepState,C.Body.SLEEPING);assert.equal(body.detached,true);assert.equal(f.floors.bonds.filter(b=>b.alive&&b.kind==='tile').length,0);
 f.advance(.15);assert.ok(body.position.y<height-.02);assert.equal(wakes,1);
 body.sleep();f.floors.afterStep();assert.equal(body.sleepState,C.Body.SLEEPING);assert.equal(wakes,1,'unchanged support state must not wake settled debris every frame');
});

test('locally live bearings never clear the host falling-island sleeping ownership',()=>{
 const f=fixture(),group=f.floors.groups[0];group.body.detached=true;group.body.allowSleep=true;group.body.sleep();
 f.floors.beforeStep(1/60);f.floors.afterStep();
 assert.equal(group.body.detached,true);assert.equal(group.body.allowSleep,true);assert.equal(group.body.sleepState,C.Body.SLEEPING);assert.ok(group.bearings.some(a=>a.bond.alive));
});

test('cached sleeping loads invalidate under changed gravity and facade arrays cannot mutate cached ownership',()=>{
 const a=importDestructible(asset(),{materials:{concrete:500}}),f=fixture({assets:{panel:a}}),p=f.floors.panels[0],g=p.groups[0];g.body.sleep();
 f.floors.beforeStep(1/60);f.floors.afterStep();assert.equal(p.broken,false);
 const groups=f.floors.groups,bodies=f.floors.bodies;groups.length=0;bodies.length=0;assert.equal(f.floors.groups.length,1);assert.equal(f.floors.bodies.length,1);assert.equal(f.floors.groupForBody(g.body),g);
 f.world.gravity.y=-98.2;f.floors.beforeStep(1/60);f.floors.afterStep();assert.equal(p.broken,true);assert.ok(f.events.some(e=>e.reason==='bond:force'));assert.equal(f.floors.groupForBody(g.body),undefined);
 for(const attachment of f.floors.bearingAttachments)assert.equal(f.floors.groupForBody(attachment.group.body),attachment.group);
});

test('invalid assets, bearing contact, placement and mass fail before adding any floor body',()=>{
 for(const change of [a=>{a.pieces[0].collider.faces.pop();},a=>{a.massKg++;}]){
  const a=asset();change(a);const world=new C.World(),member={segments:[{body:new C.Body()}]};assert.throws(()=>createBreakableFloors({world,rows:[row()],members:[member,member],assets:{panel:a}}));assert.equal(world.bodies.length,0);assert.equal(world.constraints.length,0);
 }
 const a=asset();assert.throws(()=>validateFloorRows([row({bearings:[{member:0,point:[100,4,0]}]})],2,{panel:a}),/bearing tolerance/);
 assert.throws(()=>validateFloorRows([row({assetScale:[1,0,1]})],2,{panel:a}),/floor/);
 assert.throws(()=>validateFloorRows([row({quaternion:[0,0,0,0]})],2,{panel:a}),/floor/);
});

test('missing assets keep a rotated thin rectangular fallback while ordinary rectangles retain four shards',()=>{
 const f=fixture({assets:{},rows:[row({assetId:'unloaded',position:[0,4,0],halfExtents:[1,.75,.01],bearings:[]})]}),p=f.floors.panels[0];
 assert.equal(p.asset,undefined);f.floors.shatter(p);assert.equal(p.fragments.length,4);assert.ok(p.fragments.every(g=>g.halfExtents.every(n=>n>0)));close(p.fragments.reduce((s,g)=>s+g.body.mass,0),30);
});

test('a real ten-tonne projectile fractures the authored slab into mass-conserving connected debris groups',()=>{
 const a=importDestructible(fs.readFileSync(new URL('./fixtures/slab.destructible.json',import.meta.url),'utf8'));
 const f=fixture({assets:{slab:a},rows:[row({assetId:'slab',mass:a.massKg,breakEnergy:a.breakEnergyJ,halfExtents:[1.855,.07,1.355],bearings:[{member:0,point:[-1.5,4,0]},{member:1,point:[1.5,4,0]}],bearingTolerance:.03})]});
 const projectile=new C.Body({mass:10000,shape:new C.Sphere(.5),position:new C.Vec3(0,7,0),collisionFilterGroup:2,collisionFilterMask:3});f.world.addBody(projectile);f.advance(2);
 const p=f.floors.panels[0];assert.ok(p.broken);assert.ok(p.groups.length>1);close(p.groups.reduce((s,g)=>s+g.mass,0),a.massKg);assert.ok(f.events.some(e=>e.type==='floor:impact'));assert.ok(f.events.some(e=>e.type==='floor:fractured'&&e.pieces.length>0));assert.ok(p.groups.every(g=>Number.isFinite(g.body.position.length())));
});

test('certified authored slab, wall and window partitions use one exact-envelope box with unchanged detailed mass properties',()=>{
 const defaultRow=row();delete defaultRow.collisionLOD;const defaultPanel=fixture({rows:[defaultRow]}).floors.panels[0];assert.equal(defaultPanel.collisionLOD.requested,'detailed');assert.equal(defaultPanel.groups[0].collisionLOD,'pieces');assert.equal(defaultPanel.body.shapes.length,3);
 for(const id of ['slab','wall','window']){
  const a=importDestructible(fs.readFileSync(new URL(`./fixtures/${id}.destructible.json`,import.meta.url),'utf8')),q=new C.Quaternion();q.setFromEuler(.2,.4,.1);
  const placement={assetId:id,mass:a.massKg,bearings:[],assetScale:[.7,1.3,.9],quaternion:q.toArray()};
  const fast=fixture({assets:{[id]:a},rows:[row(placement)]}),detailed=fixture({assets:{[id]:a},rows:[row({...placement,collisionLOD:'detailed'})]}),p=fast.floors.panels[0],g=p.groups[0],reference=detailed.floors.groups[0];
  assert.equal(p.collisionLOD.certified,true,id);assert.equal(g.body.shapes.length,1);assert.ok(g.body.shapes[0] instanceof C.Box);assert.equal(reference.body.shapes.length,a.pieces.length);
  close(g.body.mass,reference.body.mass);close(g.body.position.distanceTo(reference.body.position),0);g.body._massTensor.forEach((n,i)=>close(n,reference.body._massTensor[i]));close(g.damageRadius,reference.body.boundingRadius,1e-6);
  g.body.updateAABB();reference.body.updateAABB();for(const side of ['lowerBound','upperBound'])close(g.body.aabb[side].distanceTo(reference.body.aabb[side]),0,2e-6);
  for(const candidate of [g,reference]){candidate.body.velocity.set(1,2,3);candidate.body.angularVelocity.set(.2,.3,.4);}
  const one=momentum([g]),many=momentum([reference]);close(one.linear.distanceTo(many.linear),0);close(one.angular.distanceTo(many.angular),0,1e-6);
  fast.floors.dispose();detailed.floors.dispose();
 }
});

test('losing a cycle edge keeps the intact collision until an actual component split promotes detailed hulls',()=>{
 const pieces=[[-.5,0,-.5],[.5,0,-.5],[-.5,0,.5],[.5,0,.5]].map((position,i)=>({id:`q${i}`,node:`quad_${i}`,section:'body',mode:'dynamic',massKg:10,position,collider:box()})),a=asset(pieces);
 a.intact.colliders=[{...box([2,.2,2]),position:[0,0,0]}];
 const f=fixture({assets:{panel:a},rows:[row({mass:40,bearings:[],halfExtents:[1,.1,1]})]}),p=f.floors.panels[0],original=p.body;
 assert.equal(p.internalBonds.length,4);assert.ok(original.shapes[0] instanceof C.Box);
 f.floors.impact(p,{point:[0,4,-.5],energy:3,radius:.01});assert.equal(p.broken,true);assert.equal(p.groups.length,1);assert.equal(p.groups[0].body,original);assert.equal(original.shapes.length,1);assert.equal(p.groups[0].collisionLOD,'intact');
 f.floors.impact(p,{point:[-.5,4,0],energy:3,radius:.01});assert.equal(p.groups.length,2);assert.ok(!f.world.bodies.includes(original));
 for(const group of p.groups){assert.equal(group.collisionLOD,'pieces');assert.equal(group.body.shapes.length,group.pieceIds.length);assert.ok(group.body.shapes.every(s=>s instanceof C.ConvexPolyhedron));}
 assert.equal(p.groups.reduce((s,g)=>s+g.mass,0),40);assert.equal(f.world.constraints.length,0);
});

test('automatic collision LOD rejects unsafe generic proxies and overlapping pieces with an equal-volume hole',()=>{
 for(const id of ['stone_boulder']){
  const a=importDestructible(fs.readFileSync(new URL(`./fixtures/${id}.destructible.json`,import.meta.url),'utf8')),f=fixture({assets:{[id]:a},rows:[row({assetId:id,mass:a.massKg,bearings:[]})]}),p=f.floors.panels[0];
  assert.equal(p.collisionLOD.certified,false);assert.equal(p.groups[0].collisionLOD,'pieces');assert.equal(p.body.shapes.length,a.pieces.filter(x=>x.mode!=='cosmetic').length);f.floors.dispose();
 }
 const a=asset();a.pieces[1].position[0]=-.2;
 const f=fixture({assets:{panel:a}}),p=f.floors.panels[0];assert.equal(p.collisionLOD.eligible,false);assert.match(p.collisionLOD.reason,/overlap/);assert.equal(p.body.shapes.length,3);
 const explicit=fixture({assets:{panel:a},rows:[row({collisionLOD:'intact'})]}).floors.panels[0];assert.equal(explicit.collisionLOD.certified,false);assert.equal(explicit.body.shapes.length,1,'approximation requires explicit row opt-in');
 assert.throws(()=>validateFloorRows([row({collisionLOD:true})],2,{panel:a}),/collisionLOD/);
});

test('a certified non-box intact convex proxy remains convex, and disabled damage keeps its selected representation',()=>{
 const tetra={type:'convex',vertices:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],faces:[[0,2,1],[0,1,3],[0,3,2],[1,2,3]]},a=asset([{id:'tetra',node:'tetra_node',section:'body',mode:'dynamic',massKg:12,position:[0,0,0],collider:tetra}]);a.intact.colliders=[{...tetra,position:[0,0,0]}];
 const p=fixture({assets:{panel:a},rows:[row({mass:12,bearings:[]})]}).floors.panels[0];assert.equal(p.collisionLOD.certified,true);assert.equal(p.groups[0].collisionLOD,'intact');assert.ok(p.body.shapes[0] instanceof C.ConvexPolyhedron);
 const f=fixture(),before=f.floors.panels[0].body;f.floors.setDamage(false);f.floors.shatter(f.floors.panels[0]);assert.equal(f.floors.panels[0].body,before);assert.equal(before.shapes.length,1);assert.ok(before.shapes[0] instanceof C.Box);
});

test('LOD-refined fragments sleep with their mass and wake under a later physical ground impact',()=>{
 const f=fixture({rows:[row({bearings:[],position:[0,.5,0]})]}),ground=new C.Body({mass:0,shape:new C.Plane(),collisionFilterGroup:1});ground.quaternion.setFromEuler(-Math.PI/2,0,0);f.world.addBody(ground);f.floors.shatter(f.floors.panels[0]);f.advance(3);
 const groups=f.floors.groups;assert.ok(groups.every(g=>g.body.mass===10&&g.body.sleepState===C.Body.SLEEPING));assert.equal(f.world.constraints.length,0);
 const target=groups[0].body,before=target.position.clone(),ball=new C.Body({mass:10,shape:new C.Sphere(.2),position:new C.Vec3(before.x,.2,before.z-1.1),velocity:new C.Vec3(0,0,12),collisionFilterGroup:2,collisionFilterMask:3});f.world.addBody(ball);f.advance(.25);
 assert.equal(target.mass,10);assert.notEqual(target.sleepState,C.Body.SLEEPING);assert.ok(target.position.distanceTo(before)>.005);assert.equal(f.world.constraints.length,0);
});

test('components under the chip threshold leave the simulation as a mass-conserving chips event',()=>{
 const f=fixture({rows:[row({chipsBelowKg:15})]}),panel=f.floors.panels[0];
 panel.body.velocity.set(2,-3,4);
 assert.equal(f.floors.impact(panel,{point:[-.5,4,0],energy:6,radius:.1}),true);
 // p0 (10 kg) split off alone: below 15 kg it becomes chips; p1+p2 (20 kg) stay physical and carry its mass.
 assert.equal(panel.groups.length,1);assert.deepEqual(panel.chips,['p0']);assert.deepEqual(panel.groups[0].pieceIds.sort(),['p1','p2']);
 assert.equal(panel.groups[0].body.mass,30,'Chip mass folds into the surviving group');assert.equal(f.floors.mass,30);
 const chips=f.events.filter(e=>e.type==='floor:chips');assert.equal(chips.length,1);
 assert.equal(chips[0].mass,10);assert.deepEqual(chips[0].pieces,['p0']);assert.equal(chips[0].point.length,3);assert.ok(Math.hypot(...chips[0].velocity)>1,'Chips inherit the parent velocity');
 assert.ok(f.events.find(e=>e.type==='floor:fractured').point,'Fracture events carry a world point for effects');
 // A later split keeps conserving: the heavier piece now weighs 20 kg, so a 10 kg piece splitting off is chips again.
 assert.equal(f.floors.impact(panel,{point:[.5,4,0],energy:6,radius:.1,body:panel.groups[0].body}),true);
 assert.equal(panel.groups.length,1);assert.equal(panel.groups[0].body.mass,30);assert.equal(panel.chips.length,2);
 const threshold0=fixture(),p0=threshold0.floors.panels[0];threshold0.floors.impact(p0,{point:[-.5,4,0],energy:6,radius:.1});assert.equal(p0.groups.length,2);assert.equal(p0.chips.length,0,'Default threshold keeps every piece physical');
 f.floors.dispose();threshold0.floors.dispose();
});
