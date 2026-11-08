import * as C from 'cannon-es';
import {createStructureSystem,createPrattBridgeDefinition} from '../../src/destruction/index.js';

// Test client: environment and character launch are not owned by the library.
export function createDemolition(){
 const definition=createPrattBridgeDefinition(),{span,width,deckY,height}=definition.metadata;
 const world=new C.World({gravity:new C.Vec3(0,-9.82,0)});world.solver.iterations=100;world.solver.tolerance=.0001;world.broadphase=new C.SAPBroadphase(world);world.defaultContactMaterial.friction=.55;world.defaultContactMaterial.restitution=.05;
 const ground=new C.Body({mass:0,shape:new C.Plane(),collisionFilterGroup:1});ground.quaternion.setFromEuler(-Math.PI/2,0,0);world.addBody(ground);
 for(const x of [-span/2,span/2])world.addBody(new C.Body({mass:0,shape:new C.Box(new C.Vec3(1.2,(deckY-.25)/2,(width+3)/2)),position:new C.Vec3(x,(deckY-.25)/2,0),collisionFilterGroup:1}));
 const system=createStructureSystem({world,definition}),projectiles=[];let shots=0;
 return {definition,kind:'bridge',span,width,deckY,height,world,nodes:system.nodes,members:system.members,projectiles,get hits(){return system.hits;},get broken(){return system.broken;},get time(){return system.time;},get fallen(){return system.fallen;},get shots(){return shots;},
  launch(rig,target,{speed=32}={}){
   if(!rig?.length||!Number.isFinite(target?.x)||!Number.isFinite(target?.y)||!Number.isFinite(target?.z))return null;
   const position=new C.Vec3(target.x,target.y+1.5,-30),body=new C.Body({mass:rig.reduce((sum,b)=>sum+b.mass,0),position,linearDamping:.015,angularDamping:.12,collisionFilterGroup:2,collisionFilterMask:1|2});
   for(const bone of rig){const center=new C.Vec3(bone.position.x,bone.position.y,bone.position.z);if(bone.offset)center.vadd(new C.Quaternion(bone.quaternion.x,bone.quaternion.y,bone.quaternion.z,bone.quaternion.w).vmult(new C.Vec3(bone.offset.x,bone.offset.y,bone.offset.z)),center);body.addShape(new C.Sphere(bone.radius??.15),center);}
   const delta=new C.Vec3(target.x-position.x,0,target.z-position.z),duration=Math.max(.1,delta.length()/Math.max(18,Math.min(50,speed)));
   body.velocity.set(delta.x/duration,(target.y-position.y+4.91*duration*duration)/duration,delta.z/duration);body.structureImpact=true;world.addBody(body);projectiles.push(body);shots++;
   // Bound retained character bodies across repeated launches.
   if(projectiles.length>12)world.removeBody(projectiles.shift());
   return body;
  },
 step(dt=1/120){world.step(dt);system.update(dt);},
 dispose(){system.dispose();for(const b of projectiles)world.removeBody(b);}
 };
}
