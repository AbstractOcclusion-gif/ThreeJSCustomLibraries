import * as C from 'cannon-es';
import {MATERIAL_PROFILES,validateStructure} from './definitions.js';

// Host owns its world, clock, input, characters and renderer.
export function createStructureSystem({world,definition,canDamage=body=>body.structureImpact===true}){
 validateStructure(definition);
 if(!world?.addBody)throw new Error('A Cannon world is required');
 const nodes=[],members=[],joints=[],pending=new Set(),listeners=new Set();let hits=0,time=0,broken=0,disposed=false;
 const emit=event=>{for(const listener of listeners)listener(event);};
 function node(x,y,z,anchor=false){
  const body=new C.Body({mass:anchor?0:10,position:new C.Vec3(x,y,z),linearDamping:.15,collisionFilterGroup:4,collisionFilterMask:0});world.addBody(body);
  const n={id:nodes.length,body,anchor};nodes.push(n);return n;
 }
 function member(a,b,type,profile){
  const delta=b.body.position.vsub(a.body.position),length=delta.length(),thickness=profile.thickness;
  const body=new C.Body({mass:length*profile.massPerMetre,shape:new C.Box(new C.Vec3(thickness/2,(length-.45)/2,thickness/2)),position:a.body.position.vadd(b.body.position).scale(.5),linearDamping:.06,angularDamping:.1,collisionFilterGroup:2,collisionFilterMask:1|2});
  body.quaternion.setFromVectors(new C.Vec3(0,1,0),delta.scale(1/length));world.addBody(body);
  const m={id:members.length,a,b,type,body,length,thickness,start:body.position.clone(),removed:false,failed:false,load:0,overload:0,joints:[],capacity:profile.connectionForce};members.push(m);
  body.addEventListener('collide',e=>{if(canDamage(e.body)&&!m.destroyed&&.5*e.body.mass*e.contact.getImpactVelocityAlongNormal()**2>profile.impactEnergy)pending.add(m);});
  for(const n of [a,b]){
   const pivot=body.pointToLocalFrame(n.body.position),joint=new C.PointToPointConstraint(body,pivot,n.body,new C.Vec3(),1e7);joint.collideConnected=false;world.addConstraint(joint);m.joints.push(joint);joints.push(joint);
  }
  return m;
 }
 for(const n of definition.nodes)node(...n.position,!!n.anchor);
 for(const row of definition.members){
  const profile={...MATERIAL_PROFILES[row.profile??'steel'],...row.properties};
  const m=member(nodes[row.a],nodes[row.b],row.type??'bar',profile);
  m.deck=!!row.deck;m.profile=profile;
  for(const s of row.boxes??[]){m.body.addShape(new C.Box(new C.Vec3(...s.halfExtents)),new C.Vec3(...s.offset));m.body.mass+=s.mass??0;}m.body.updateMassProperties();
 }
 for(const c of definition.rigidConnections??[]){
  const a=members[c.a],b=members[c.b],joint=new C.LockConstraint(a.body,b.body,{maxForce:1e7});joint.collideConnected=false;world.addConstraint(joint);a.joints.push(joint);b.joints.push(joint);joints.push(joint);
 }
 // Exclude contacts between bars meeting at an authored joint or crossed brace.
 // These steel sections overlap at their fabrication connections, not as impact debris.
 const exclusions=[];
 for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++){
  const a=members[i],b=members[j];
  if(a.deck||b.deck||a.a===b.a||a.a===b.b||a.b===b.a||a.b===b.b||a.start.distanceTo(b.start)<.01){
   const c=new C.Constraint(a.body,b.body,{collideConnected:false});c.update=()=>{};world.addConstraint(c);exclusions.push({a,b,c,alive:true});
  }
 }
 function disconnect(m){for(const e of exclusions)if(e.alive&&(e.a===m||e.b===m)){world.removeConstraint(e.c);e.alive=false;}for(const j of m.joints){world.removeConstraint(j);j.demolitionDetached=true;}m.body.wakeUp();m.a.body.wakeUp();m.b.body.wakeUp();}
 function fracture(m){
   if(!m||m.destroyed)return false;hits++;m.destroyed=true;emit({type:"member:fractured",memberId:m.id,time});
   disconnect(m);
   // A deck/floor-beam assembly remains physical as one released section.
   if(m.deck){m.failed=true;}
   else{
    m.removed=true;m.fragments=[];const length=(m.length-.45)*.5;
    for(const sign of [-1,1]){
     const position=m.body.pointToWorldFrame(new C.Vec3(0,sign*(length/2+.035),0));
     const body=new C.Body({mass:m.body.mass/2,shape:new C.Box(new C.Vec3(m.thickness/2,length/2,m.thickness/2)),position,quaternion:m.body.quaternion.clone(),linearDamping:.06,angularDamping:.1,collisionFilterGroup:2,collisionFilterMask:1|2});
     m.body.getVelocityAtWorldPoint(position,body.velocity);body.angularVelocity.copy(m.body.angularVelocity);
     world.addBody(body);m.fragments.push({body,length});
    }
    world.removeBody(m.body);
   }
   for(const n of nodes)n.body.wakeUp();return true;
  }
 return {world,definition,nodes,members,get hits(){return hits;},get broken(){return broken;},get time(){return time;},
 subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
 dispose(){if(disposed)return;disposed=true;for(const c of [...joints,...exclusions.map(e=>e.c)])world.removeConstraint(c);for(const n of nodes)world.removeBody(n.body);for(const m of members){world.removeBody(m.body);for(const f of m.fragments??[])world.removeBody(f.body);}pending.clear();listeners.clear();},
  update(dt=1/120){if(disposed)return;time+=dt;
   for(const m of pending)fracture(m);pending.clear();
   for(const m of members)if(!m.removed&&!m.failed){
    let peak=0;for(const j of m.joints){if(j.demolitionDetached)continue;let q=0;for(const e of j.equations)q+=e.multiplier*e.multiplier;if(q>peak)peak=q;}m.load=Math.sqrt(peak)/m.capacity;
    m.overload=m.load>1?m.overload+dt:Math.max(0,m.overload-dt);
    if(m.overload>.05){m.failed=true;broken++;disconnect(m);emit({type:"member:detached",memberId:m.id,time});}
   }
  },
  get fallen(){let n=0;for(const m of members)if(!m.removed&&m.body.position.distanceTo(m.start)>1.5)n++;return n;}
 };
}
