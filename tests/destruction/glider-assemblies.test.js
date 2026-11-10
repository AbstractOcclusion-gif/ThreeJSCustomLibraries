import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import * as T from 'three';
import {createBendableStructure,createBuildingFrameDefinition,createBridgeFrameDefinition,createBendableMember} from '../../src/destruction/index.js';
import {createThreeBendableStructureView} from '../../src/destruction/three.js';
function fixture(kind,material='ductile'){const world=new C.World({gravity:new C.Vec3(0,-9.82,0)});world.solver.iterations=15;world.solver.tolerance=1e-7;world.defaultContactMaterial.friction=.5;world.defaultContactMaterial.restitution=.03;world.defaultContactMaterial.contactEquationRelaxation=16;world.broadphase=new C.SAPBroadphase(world);world.broadphase.useBoundingBoxes=true;world.broadphase.axisIndex=kind==='bridge'?0:1;const ground=new C.Body({mass:0,shape:new C.Plane(),collisionFilterGroup:1});ground.quaternion.setFromEuler(-Math.PI/2,0,0);ground.updateAABB();ground.updateAABB();world.addBody(ground);
 if(kind==='bridge')for(const x of [-24,24])world.addBody(new C.Body({mass:0,shape:new C.Box(new C.Vec3(1.2,4.875,6.25)),position:new C.Vec3(x,4.875,0),collisionFilterGroup:1}));
 if(kind==='building')for(const [x,z]of [[-4,-3],[4,-3],[-4,3],[4,3]])world.addBody(new C.Body({mass:0,shape:new C.Box(new C.Vec3(.5,.1,.5)),position:new C.Vec3(x,-.1,z),collisionFilterGroup:1}));
 const definition=kind==='bridge'?createBridgeFrameDefinition():createBuildingFrameDefinition(),system=createBendableStructure({world,definition,material});const advance=s=>{for(let i=0;i<s*480;i++){system.beforeStep(1/480);world.step(1/480);system.afterStep();}};return{world,system,advance};}
for(const kind of ['bridge','building'])test(`${kind}: stable self-weight, physical impact, retained damage and safe lifecycle`,()=>{
 const f=fixture(kind),positions=f.system.hubs.map(b=>b.position.clone());f.advance(8);assert.equal(f.system.broken,0);assert.equal(f.system.yielded,0);assert.ok(Math.max(...f.system.hubs.map((b,i)=>b.position.distanceTo(positions[i])))<.4);
 const member=f.system.members.find(m=>m.type===(kind==='bridge'?'endpost':'column')),target=member.segments[0].body.position,body=new C.Body({mass:350,shape:new C.Sphere(.8),position:new C.Vec3(target.x,target.y+1.5,target.z-18),velocity:new C.Vec3(0,(-1.5+4.91*.6*.6)/.6,30),collisionFilterGroup:2,collisionFilterMask:1|2});f.world.addBody(body);f.advance(5);assert.ok(f.system.yielded>0);assert.ok(f.system.permanentRotation>.03||f.system.broken>0);f.world.removeBody(body);f.advance(2);assert.ok(f.world.bodies.every(b=>Number.isFinite(b.position.length())&&Number.isFinite(b.angularVelocity.length())));
 const scene=new T.Scene(),sentinel=new T.Group();scene.add(sentinel);const view=createThreeBendableStructureView({system:f.system,scene});view.update();view.dispose();view.dispose();assert.deepEqual(scene.children,[sentinel]);f.system.setFracture(false);assert.ok(f.system.members.every(m=>!m.profile.fractureEnabled));f.system.dispose();f.system.dispose();assert.equal(f.world.constraints.length,0);assert.equal(f.world.bodies.length,kind==='bridge'?3:5);
});
test('rotated member support spring applies restoring torque in its authored frame',()=>{
 const world=new C.World(),support=new C.Body({mass:0});world.addBody(support);const member=createBendableMember({world,start:[0,0,0],end:[0,0,8],supports:[{body:support,end:'start',connection:'moment'}]});const body=member.segments[0].body;body.quaternion=new C.Quaternion().setFromAxisAngle(new C.Vec3(1,0,0),.01).mult(body.quaternion);member.beforeStep(1/960);assert.ok(body.torque.x<0);assert.ok(Math.abs(body.torque.x)>Math.abs(body.torque.z)*10);member.dispose();
});


for(const kind of ['building','bridge'])test(`${kind}: brittle sample stands for 30 seconds with browser foundations and fails on impact`,()=>{
 const f=fixture(kind,'brittle');f.advance(30);assert.equal(f.system.broken,0);assert.equal(f.system.yielded,0);
 const target=f.system.members.find(m=>m.type===(kind==='bridge'?'endpost':'column')).segments[0].body.position;
 const ball=new C.Body({mass:350,shape:new C.Sphere(.8),position:new C.Vec3(target.x,target.y+1.5,target.z-18),velocity:new C.Vec3(0,(-1.5+4.91*.36)/.6,30),collisionFilterGroup:2,collisionFilterMask:3});f.world.addBody(ball);f.advance(3);
 assert.ok(f.system.broken>0);assert.equal(f.system.yielded,0);assert.ok(f.world.bodies.every(b=>Number.isFinite(b.position.length())));f.system.dispose();
});
