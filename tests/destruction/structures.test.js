import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import * as T from 'three';
import {createStructureSystem,validateStructure} from '../../src/destruction/index.js';
import {createThreeStructureView} from '../../src/destruction/three.js';
const definition=()=>({version:1,name:'Independent test beam',nodes:[{position:[-3,2,0],anchor:true},{position:[3,2,0],anchor:true}],members:[{a:0,b:1,profile:'steel'}]});
test('independent assembly: external projectile fracture, events, optional view and clean disposal',()=>{
 const world=new C.World(),foreign=new C.Body({mass:35,shape:new C.Sphere(.4),position:new C.Vec3(0,2,-3),velocity:new C.Vec3(0,0,25)});foreign.structureImpact=true;world.addBody(foreign);
 const system=createStructureSystem({world,definition:definition()}),events=[];const unsubscribe=system.subscribe(e=>events.push(e));
 const scene=new T.Scene(),sentinel=new T.Group();scene.add(sentinel);const view=createThreeStructureView({system,scene});assert.equal(view.members.length,1);
 for(let i=0;i<60;i++){world.step(1/120);system.update(1/120);}view.update();
 assert.equal(system.hits,1);assert.equal(system.members[0].fragments.length,2);assert.equal(events[0].type,'member:fractured');
 unsubscribe();view.dispose();view.dispose();assert.deepEqual(scene.children,[sentinel]);system.dispose();system.dispose();assert.deepEqual(world.bodies,[foreign]);assert.equal(world.constraints.length,0);
});
test('definition validation fails before adding any physics bodies',()=>{
 const world=new C.World(),d=definition();d.members[0].b=99;assert.throws(()=>createStructureSystem({world,definition:d}),/endpoints/);assert.equal(world.bodies.length,0);
 const valid=definition();valid.members[0].properties={massPerMetre:-1};assert.throws(()=>validateStructure(valid),/profile/);
});
