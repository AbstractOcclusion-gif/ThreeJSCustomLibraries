import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import init from 'jolt-physics';
import * as C from 'cannon-es';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {createBendableMember} from '../../src/destruction/bendable.js';

const J=await init();

// Inspect actual native bodies without adding a production debug API.
function fixture(run,options={}){
 const nativeBySource=new Map(),create=J.BodyInterface.prototype.CreateBody;
 J.BodyInterface.prototype.CreateBody=function(settings){const native=create.call(this,settings);nativeBySource.set(settings.mUserData,native);return native;};
 const world=new C.World({gravity:new C.Vec3(0,0,0),allowSleep:true}),driver=createJoltDriver(J,options);
 try{return run({world,driver,native:body=>nativeBySource.get(body.id+1)});}
 finally{driver.dispose();J.BodyInterface.prototype.CreateBody=create;}
}
function retire(body){body.retiredMass=body.mass;body.mass=0;body.type=C.Body.STATIC;body.updateMassProperties();body.velocity.setZero();body.angularVelocity.setZero();body.retired=true;body.sleep();}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const hullBox=(half,offset=new C.Vec3())=>{const source=new C.Box(half).convexPolyhedronRepresentation;return new C.ConvexPolyhedron({vertices:source.vertices.map(v=>v.vadd(offset)),faces:source.faces.map(f=>f.slice())});};

test('a real thin window hull rests visibly above native ground and retains authored material values',()=>fixture(({world,driver,native})=>{
 const asset=JSON.parse(fs.readFileSync(new URL('./fixtures/window.destructible.json',import.meta.url),'utf8')),piece=asset.pieces.find(p=>p.mode==='dynamic'),shape=new C.ConvexPolyhedron({vertices:piece.collider.vertices.map(v=>new C.Vec3(...v)),faces:piece.collider.faces.map(f=>f.slice())});
 world.gravity.set(0,-9.82,0);const ground=new C.Body({mass:0,shape:new C.Box(new C.Vec3(5,.5,5)),position:new C.Vec3(0,-.5,0)}),material=new C.Material({friction:.25,restitution:.01}),body=new C.Body({mass:piece.massKg,shape,position:new C.Vec3(0,2,0),material});body.quaternion.setFromEuler(Math.PI/2,0,0);world.addBody(ground);world.addBody(body);let contacts=0;body.addEventListener('collide',()=>contacts++);driver.attach(world);
 for(let i=0;i<240;i++)world.step(1/60);
 const lowest=Math.min(...shape.vertices.map(v=>body.quaternion.vmult(v).y));assert.ok(contacts>0);assert.ok(body.position.y+lowest>-.003&&body.position.y+lowest<.01,body.position.toString());assert.ok(body.position.y>.005,'The 2 cm thick glass must remain visible above the ground');assert.ok(Number.isFinite(body.position.lengthSquared()));close(native(body).GetFriction(),.25);close(native(body).GetRestitution(),.01);
},{penetrationSlop:.001}));

test('a single off-centre convex hull keeps Cannon body and joint origins at native centre of mass',()=>fixture(({world,driver,native})=>{
 const anchor=new C.Body({mass:0,shape:new C.Sphere(.1),position:new C.Vec3(0,4,0),collisionFilterMask:0}),body=new C.Body({mass:2,shape:hullBox(new C.Vec3(1,.01,.75),new C.Vec3(1,0,0)),position:anchor.position.clone()});world.addBody(anchor);world.addBody(body);world.addConstraint(new C.PointToPointConstraint(anchor,new C.Vec3(),body,new C.Vec3()));driver.attach(world);
 const centre=native(body).GetShape().GetCenterOfMass();close(centre.GetX(),0);close(centre.GetY(),0);close(centre.GetZ(),0);
 for(let i=0;i<60;i++){body.force.set(10,0,0);world.step(1/60);}assert.ok(body.position.distanceTo(anchor.position)<.001);assert.ok(driver.inspect()[0].error<.001);
}));

test('retiring an individual body commits its final pose and native static motion type',()=>fixture(({world,driver,native})=>{
 const body=new C.Body({mass:140,shape:new C.Box(new C.Vec3(.5,.25,.25)),velocity:new C.Vec3(1,0,0)});world.addBody(body);driver.attach(world);world.step(1/60);
 const physical=native(body),id=physical.GetID().GetIndexAndSequenceNumber();assert.ok(physical.IsDynamic());
 body.position.set(1.25,2,-3);body.quaternion.setFromEuler(0,.3,0);retire(body);world.step(1/60);
 assert.equal(physical.GetID().GetIndexAndSequenceNumber(),id,'Retirement must preserve native identity');
 assert.ok(physical.IsStatic());assert.ok(!physical.IsActive());assert.equal(physical.GetObjectLayer(),0);
 const p=physical.GetPosition();close(p.GetX(),body.position.x);close(p.GetY(),body.position.y);close(p.GetZ(),body.position.z);
 const q=physical.GetRotation();close(q.GetY(),body.quaternion.y);close(q.GetW(),body.quaternion.w);
}));

test('a heavy collision cannot move the retired native collider away from its rendered pose',()=>fixture(({world,driver,native})=>{
 const body=new C.Body({mass:140,shape:new C.Box(new C.Vec3(.5,.5,.5)),position:new C.Vec3(0,2,0)});world.addBody(body);driver.attach(world);retire(body);world.step(1/60);
 const physical=native(body),start=body.position.clone();let collisions=0;
 body.addEventListener('collide',()=>collisions++);
 const shot=new C.Body({mass:1000,shape:new C.Sphere(.25),position:new C.Vec3(-3,2,0),velocity:new C.Vec3(20,0,0),linearDamping:0});world.addBody(shot);
 for(let i=0;i<30;i++)world.step(1/60);
 assert.ok(collisions>0,'The projectile must actually strike the retired collider');
 assert.ok(physical.IsStatic());const p=physical.GetPosition();close(p.GetX(),start.x);close(p.GetY(),start.y);close(p.GetZ(),start.z);assert.ok(body.position.almostEquals(start));
 assert.ok(shot.velocity.x<1,'The frozen collider must stop the projectile instead of moving invisibly');
}));

function cantilever(euler,settings,run){
 const q=new C.Quaternion().setFromEuler(...euler),world=new C.World({gravity:new C.Vec3()}),support=new C.Body({mass:0,shape:new C.Sphere(.1),quaternion:q.clone(),collisionFilterMask:0});world.addBody(support);
 const member=createBendableMember({world,start:[0,0,0],end:q.vmult(new C.Vec3(4,0,0)).toArray(),segments:1,response:'brittle',width:.35,height:.55,massPerMetre:35,breakForce:1e20,yieldMoment:150,fractureEnabled:true,supports:[{body:support,end:'start',connection:'moment'}],...settings}),body=member.segments[0].body,driver=createJoltDriver(J,{velocitySteps:64,positionSteps:16});
 driver.attach(world);
 const tick=(load,steps=60)=>{for(let i=0;i<steps;i++){body.wakeUp();body.force.copy(q.vmult(new C.Vec3(0,-load,0)));member.beforeStep(1/240);world.step(1/240);member.afterStep();if(member.broken)break;}};
 try{return run({member,body,tick,q});}finally{member.dispose();driver.dispose();assert.equal(world.constraints.length,0);assert.deepEqual(world.bodies,[support]);}
}

test('native cantilever reactions are measured at the authored hinge in horizontal, vertical and rotated frames',()=>{
 for(const euler of [[0,0,0],[0,0,Math.PI/2],[.5,.8,-.4]])cantilever(euler,{fractureEnabled:false},({member,tick,q})=>{
  tick(100);const hinge=member.hinges[0],e=hinge.joint.equations,force=new C.Vec3(...e.slice(0,3).map(x=>x.multiplier)),rawMoment=Math.hypot(...e.slice(3).map(x=>x.multiplier));
  assert.equal(hinge.joint._structureWorldWrench,true);assert.ok(q.conjugate().vmult(force).distanceTo(new C.Vec3(0,100,0))<.1);
  assert.ok(Math.abs(rawMoment-100)<.1,'Native couple belongs to its midpoint anchor, 1 m from the support');
  assert.ok(Math.abs(hinge.moment-200)<.2,'A 100 N load 2 m from the authored support requires 200 Nm');assert.equal(member.broken,0);
 });
});

test('native authored-hinge capacity breaks an overloaded weld and preserves a sub-threshold weld',()=>{
 for(const euler of [[0,0,0],[0,0,Math.PI/2]]){
  cantilever(euler,{},({member,tick})=>{tick(50);assert.equal(member.broken,0);assert.ok(Math.abs(member.hinges[0].moment-100)<.2);});
  cantilever(euler,{},({member,tick})=>{const events=[];member.subscribe(e=>events.push(e));tick(100);assert.equal(member.broken,1);assert.ok(events[0].moment>150);assert.ok(Math.hypot(...member.hinges[0].joint.equations.slice(3).map(e=>e.multiplier))<150,'The uncorrected midpoint moment would miss this overload');});
 }
});

test('native hinge transport respects fracture and damage switches',()=>{
 for(const disabled of ['fractureEnabled','damageEnabled'])cantilever([0,0,Math.PI/2],{[disabled]:false},({member,tick})=>{
  tick(100);assert.equal(member.broken,0);member.profile[disabled]=true;tick(100,1);assert.equal(member.broken,1);
 });
});

test('native wrench metadata is restored when constraints are removed or the driver is disposed',()=>fixture(({world,driver})=>{
 const a=new C.Body({mass:0,shape:new C.Box(new C.Vec3(.1,.1,.1))}),b=new C.Body({mass:1,shape:new C.Box(new C.Vec3(.1,.1,.1)),position:new C.Vec3(1,0,0)});world.addBody(a);world.addBody(b);
 const original=new C.LockConstraint(a,b);original._structureWorldWrench='host value';world.addConstraint(original);driver.attach(world);assert.equal(original._structureWorldWrench,true);
 world.removeConstraint(original);assert.equal(original._structureWorldWrench,'host value');world.addConstraint(original);assert.equal(original._structureWorldWrench,true);
 const added=new C.PointToPointConstraint(a,new C.Vec3(),b,new C.Vec3());world.addConstraint(added);assert.equal(added._structureWorldWrench,true);world.removeConstraint(added);assert.ok(!Object.prototype.hasOwnProperty.call(added,'_structureWorldWrench'));
 world.addConstraint(added);driver.dispose();assert.equal(original._structureWorldWrench,'host value');assert.ok(!Object.prototype.hasOwnProperty.call(added,'_structureWorldWrench'));
}));

test('quiet native debris leaves a never-sleeping island, wakes under a later physical strike and settles again',()=>fixture(({world,driver,native})=>{
 world.gravity.set(0,-9.82,0);
 const ground=new C.Body({mass:0,shape:new C.Box(new C.Vec3(10,.5,10)),position:new C.Vec3(0,-.5,0)});world.addBody(ground);
 // Six touching blocks form one native island; a host wake every step on the
 // first block keeps that island from ever sleeping natively.
 const blocks=[];for(let i=0;i<6;i++){const block=new C.Body({mass:40,shape:new C.Box(new C.Vec3(.3,.2,.3)),position:new C.Vec3(i*.605-1.5,.25,0)});world.addBody(block);blocks.push(block);}
 driver.attach(world);
 let minFrozen=Infinity;const step=(seconds,chatter)=>{for(let i=0;i<Math.round(seconds*60);i++){if(chatter)blocks[0].wakeUp();world.step(1/60);minFrozen=Math.min(minFrozen,driver.frozen);}};
 step(3,true);
 assert.equal(driver.frozen,blocks.length-1,'Quiet blocks must leave the awake island');
 assert.ok(native(blocks[0]).IsDynamic()&&native(blocks[0]).IsActive(),'A host-woken body stays dynamic');
 for(const block of blocks.slice(1)){assert.ok(native(block).IsStatic());assert.ok(!native(block).IsActive());assert.equal(block.sleepState,C.Body.SLEEPING);assert.equal(block.mass,40);}
 const target=blocks[4],rest=target.position.clone(),frozenBefore=driver.frozen;minFrozen=Infinity;
 const ball=new C.Body({mass:200,shape:new C.Sphere(.25),position:rest.vadd(new C.Vec3(0,3,0))});world.addBody(ball);
 step(1.5,false);
 assert.ok(minFrozen<frozenBefore,'A real strike must release frozen debris');
 assert.ok(target.position.distanceTo(rest)>.01,'Released debris must move physically');
 assert.ok(target.position.y>0,'Released debris keeps colliding with the ground');
 step(4,false);
 for(const body of [...blocks,ball]){assert.ok(!native(body).IsActive(),'Everything settles again');assert.ok(Number.isFinite(body.position.lengthSquared()));}
 assert.equal([...blocks,ball].filter(body=>native(body).IsStatic()).length,driver.frozen,'Frozen count matches native static debris');
 const index=blocks.findIndex(block=>native(block).IsStatic()),frozen=blocks[index],count=driver.frozen,neighbours=[blocks[index-1],blocks[index+1]].filter(block=>block&&native(block).IsStatic());world.removeBody(frozen);
 assert.equal(driver.frozen,count-1,'Removing a frozen body releases its count');world.step(1/60);
 assert.equal(driver.frozen,count-1-neighbours.length,'The next step releases the frozen neighbours it touched');
 for(const block of neighbours)assert.ok(native(block).IsDynamic()&&block.sleepState!==C.Body.SLEEPING,'A neighbour of a removed body is released to re-check its support');
}));

test('settle freezing can be disabled and rejects invalid thresholds',()=>{
 assert.throws(()=>createJoltDriver(J,{settleSpeed:0}),/settle thresholds/);
 fixture(({world,driver,native})=>{
  world.gravity.set(0,-9.82,0);
  const ground=new C.Body({mass:0,shape:new C.Box(new C.Vec3(10,.5,10)),position:new C.Vec3(0,-.5,0)});world.addBody(ground);
  const block=new C.Body({mass:40,shape:new C.Box(new C.Vec3(.3,.2,.3)),position:new C.Vec3(0,.25,0)});world.addBody(block);
  driver.attach(world);for(let i=0;i<180;i++)world.step(1/60);
  assert.equal(driver.frozen,0);assert.ok(native(block).IsDynamic());assert.ok(!native(block).IsActive(),'Native island sleep still applies');
 },{settleFreeze:false});
});

test('resting debris is released when its support is removed or slides away, frozen or natively asleep',()=>{
 for(const frozenPath of [true,false])for(const removal of [true,false])fixture(({world,driver,native})=>{
  world.gravity.set(0,-9.82,0);
  world.addBody(new C.Body({mass:0,shape:new C.Box(new C.Vec3(10,.5,10)),position:new C.Vec3(0,-.5,0)}));
  const support=new C.Body({mass:200,shape:new C.Box(new C.Vec3(.6,.3,.6)),position:new C.Vec3(0,.3,0)}),top=new C.Body({mass:50,shape:new C.Box(new C.Vec3(.3,.2,.3)),position:new C.Vec3(0,.8,0)});
  // A host-woken neighbour touching the stack keeps its island awake, so the stack
  // settles through the freeze; placed away from it, the stack sleeps natively instead.
  const chatter=new C.Body({mass:10,shape:new C.Box(new C.Vec3(.2,.2,.2)),position:new C.Vec3(frozenPath?.805:3,.2,0)});
  world.addBody(support);world.addBody(top);world.addBody(chatter);driver.attach(world);
  const step=n=>{for(let i=0;i<n;i++){chatter.wakeUp();world.step(1/60);}};
  step(180);
  assert.equal(native(top).IsStatic(),frozenPath,'Settling path');assert.ok(!native(top).IsActive());
  if(removal)world.removeBody(support);else{support.wakeUp();support.velocity.set(6,0,0);}
  step(90);
  assert.ok(top.position.y<.3,`Unsupported debris must fall (frozen ${frozenPath}, removal ${removal}): y ${top.position.y.toFixed(2)}`);
 });
});


test('masonry houses retain native dynamics while moving slowly and require a longer quiet period',()=>{
 const context={system:{definition:{metadata:{masonryHouse:true}},floors:{panels:[]}}};
 fixture(({world,driver,native})=>{
  const body=new C.Body({mass:200,shape:new C.Box(new C.Vec3(1,.5,.1)),velocity:new C.Vec3(.1,0,0),linearDamping:0});world.addBody(body);driver.attach(world,context);
  for(let i=0;i<180;i++)world.step(1/60);
  assert.ok(native(body).IsDynamic());assert.ok(native(body).IsActive(),'slow visible motion must not sleep');assert.ok(body.position.x>.29);assert.equal(driver.frozen,0);
 });
 fixture(({world,driver,native})=>{
  const body=new C.Body({mass:200,shape:new C.Box(new C.Vec3(1,.5,.1))});world.addBody(body);driver.attach(world,context);
  for(let i=0;i<60;i++)world.step(1/60);assert.ok(native(body).IsActive(),'one second quiet is insufficient');
  for(let i=0;i<60;i++)world.step(1/60);assert.ok(!native(body).IsActive(),'native sleep remains available after sustained rest');assert.ok(native(body).IsDynamic(),'native sleep does not turn the body static');assert.equal(driver.frozen,0);
 });
});
