import * as C from 'cannon-es';
const inactive=body=>body.type===C.Body.STATIC||body.sleepState===C.Body.SLEEPING;

export const BENDABLE_PRESET=Object.freeze({segments:8,width:.22,height:.4,massPerMetre:5,stiffness:12000,damping:28,yieldMoment:900,fractureRotation:.55,fractureEnabled:true,response:'plastic',breakForce:15000,dampingRatio:0});
export const BENDING_MATERIALS=Object.freeze({
 elastic:Object.freeze({yieldMoment:18000,fractureRotation:1.8}),
 ductile:Object.freeze({yieldMoment:600,fractureRotation:1.8}),
 brittle:Object.freeze({response:'brittle',yieldMoment:900,breakForce:15000,fractureRotation:.025}),
});

// Lumped rotational plasticity over rigid collision segments. Host owns world/clock.
export function createBendableMember({world,start,end,supports=[],...settings}){
 const p={...BENDABLE_PRESET,...settings},finite=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 if(!world?.addBody||!finite(start)||!finite(end)||!Number.isInteger(p.segments)||p.segments<(p.response==='brittle'?1:2)||p.segments>32)throw Error('Invalid bendable member geometry');
 if(!['width','height','massPerMetre','stiffness','damping','yieldMoment','fractureRotation'].every(k=>Number.isFinite(p[k])&&p[k]>0))throw Error('Invalid bendable member material');
 if(p.section==='round'&&Math.abs(p.width-p.height)>1e-9)throw Error('Round member width and height must be the same diameter');
 if(p.nativeSteps!==undefined&&(!Array.isArray(p.nativeSteps)||p.nativeSteps.length!==2||p.nativeSteps.some((n,i)=>!Number.isInteger(n)||n<1||n>(i?32:128))))throw Error('Invalid member native solver steps');
 if(typeof p.fractureEnabled!=='boolean')throw Error('Invalid fracture option');
 if(!['plastic','brittle','elastoplastic'].includes(p.response)||!Number.isFinite(p.breakForce)||p.breakForce<=0||!Number.isFinite(p.dampingRatio)||p.dampingRatio<0)throw Error('Invalid material response');
 if(p.jointStiffness!==undefined&&(!Number.isFinite(p.jointStiffness)||p.jointStiffness<=0))throw Error('Invalid joint stiffness');
 const collisionInset=settings.collisionInset??0;if(!Number.isFinite(collisionInset)||collisionInset<0)throw Error('Invalid collision inset');
 const a=new C.Vec3(...start),b=new C.Vec3(...end),delta=b.vsub(a),length=delta.length(),segmentLength=length/p.segments;
 if(segmentLength<.15)throw Error('Beam segments must be at least 0.15 m');
 if(segmentLength/2-Math.max(segmentLength*.01,collisionInset)<=.025)throw Error('Collision inset leaves no beam collider');
 for(const s of supports)if(!s.body||!['start','end'].includes(s.end)||!['pin','moment'].includes(s.connection))throw Error('Invalid beam support');
 const direction=delta.scale(1/length),orientation=new C.Quaternion().setFromVectors(new C.Vec3(1,0,0),direction),segments=[],hinges=[],listeners=new Set(),reactionOffset=new C.Vec3(),worldReactionOffset=new C.Vec3(),expectedLockedRotation=new C.Quaternion();let disposed=false,time=0;
 const emit=e=>{for(const fn of listeners)fn({...e,time});};
 for(let i=0;i<p.segments;i++){
  const halfLength=segmentLength/2-Math.max(segmentLength*.01,collisionInset);let shape;
  if(p.section==='round'){const cylinder=new C.Cylinder(p.width/2,p.width/2,halfLength*2,20),turn=new C.Quaternion().setFromAxisAngle(new C.Vec3(0,0,1),-Math.PI/2);shape=new C.ConvexPolyhedron({vertices:cylinder.vertices.map(v=>turn.vmult(v)),faces:cylinder.faces.map(f=>f.slice())});}
  else shape=new C.Box(new C.Vec3(halfLength,p.height/2,p.width/2));
  const position=a.vadd(direction.scale(segmentLength*(i+.5))),body=new C.Body({mass:segmentLength*p.massPerMetre,shape,position,quaternion:orientation.clone(),linearDamping:.025,angularDamping:.04,collisionFilterGroup:2,collisionFilterMask:1|2});world.addBody(body);segments.push({body,length:segmentLength});
 }
 function connect(bodyA,bodyB,point,rotates=true){
  const joint=p.response!=='plastic'&&rotates?new C.LockConstraint(bodyA,bodyB,{maxForce:1e7}):new C.PointToPointConstraint(bodyA,bodyA.pointToLocalFrame(point),bodyB,bodyB.pointToLocalFrame(point),1e7);joint.collideConnected=false;if(p.nativeSteps)joint._nativeSteps=p.nativeSteps.slice();world.addConstraint(joint);
  const rest=bodyA.quaternion.conjugate().mult(bodyB.quaternion);hinges.push({a:bodyA,b:bodyB,joint,rest,initialRest:rest.clone(),plastic:0,moment:0,rotation:0,broken:false,yielded:false,rotates,locked:p.response!=='plastic'&&rotates,pivotA:bodyA.pointToLocalFrame(point),pivotB:bodyB.pointToLocalFrame(point)});
 }
 for(let i=1;i<segments.length;i++)connect(segments[i-1].body,segments[i].body,a.vadd(direction.scale(i*segmentLength)));
 for(const s of supports)connect(s.body,segments[s.end==='start'?0:segments.length-1].body,s.end==='start'?a:b,s.connection==='moment');
 return {segments,hinges,profile:p,length,get time(){return time;},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  beforeStep(dt){
   if(disposed)return;if(!Number.isFinite(dt)||dt<=0||dt>(p.response==='plastic'?1/120:1/60))throw Error('Members require a fixed step <= 1/120 s for explicit plastic response, or <= 1/60 s for rigid/implicit response');time+=dt;
   for(const h of hinges){
    if(p.jointStiffness&&h.configuredDt!==dt){for(const e of h.joint.equations)e.setSpookParams(p.jointStiffness,4,dt);h.configuredDt=dt;}
    if(h.broken||!h.rotates||h.locked||(inactive(h.a)&&inactive(h.b)))continue;
    const relative=h.a.quaternion.conjugate().mult(h.b.quaternion),elastic=h.rest.conjugate().mult(relative);elastic.normalize();
    if(elastic.w<0){elastic.x*=-1;elastic.y*=-1;elastic.z*=-1;elastic.w*=-1;}
    const sine=Math.hypot(elastic.x,elastic.y,elastic.z),angle=2*Math.atan2(sine,Math.max(0,elastic.w)),axis=sine>1e-8?new C.Vec3(elastic.x/sine,elastic.y/sine,elastic.z/sine):new C.Vec3(0,0,1);
    h.rotation=angle;const k=p.stiffness*(h.stiffnessScale??1),yieldAngle=p.yieldMoment/k;
    let elasticAngle=angle;
    // A plasticised hinge is driven by an external analysis (its rest is set from outside and
    // that analysis owns failure): it stays a capped elastic spring here.
    if(angle>yieldAngle&&!h.plasticised){
     const increment=angle-yieldAngle;h.plastic+=increment;elasticAngle=yieldAngle;
     const limited=new C.Quaternion().setFromAxisAngle(axis,yieldAngle);h.rest=relative.mult(limited.conjugate());h.rest.normalize();
     if(!h.yielded){h.yielded=true;emit({type:'member:yielded',hinge:hinges.indexOf(h)});}
     if(p.fractureEnabled&&h.plastic>=p.fractureRotation){h.broken=true;world.removeConstraint(h.joint);h.a.wakeUp();h.b.wakeUp();emit({type:'member:fractured',hinge:hinges.indexOf(h)});continue;}
    }
    const worldAxis=h.a.quaternion.mult(h.rest).vmult(axis),relativeSpin=h.b.angularVelocity.vsub(h.a.angularVelocity),torque=worldAxis.scale(k*elasticAngle);
    if(p.dampingRatio>0){
     // Backward-Euler damping impulse: (IA^-1 + IB^-1 + 1/(c dt)) P = wB-wA.
     // Unlike explicit viscous torque, this cannot reverse relative motion into
     // a larger oscillation when a light hub has several connected members.
     const inverse=new C.Mat3(h.a.invInertiaWorld.elements.map((v,i)=>v+h.b.invInertiaWorld.elements[i]));
     const trace=inverse.elements[0]+inverse.elements[4]+inverse.elements[8];
     if(trace>1e-12){const direction=relativeSpin.lengthSquared()>1e-16?relativeSpin.unit():worldAxis,effectiveInverse=direction.dot(inverse.vmult(direction)),effectiveInertia=effectiveInverse>1e-12?1/effectiveInverse:3/trace;
      const damping=2*p.dampingRatio*Math.sqrt(k*effectiveInertia),regularizer=1/(damping*dt);for(const i of [0,4,8])inverse.elements[i]+=regularizer;const impulse=inverse.solve(relativeSpin);
      h.a.angularVelocity.vadd(h.a.invInertiaWorld.vmult(impulse),h.a.angularVelocity);h.b.angularVelocity.vsub(h.b.invInertiaWorld.vmult(impulse),h.b.angularVelocity);
     }
    }else torque.vadd(relativeSpin.scale(p.damping),torque);
    // Implicit stiffness scaling. A plasticised hinge's bodies may stand for much larger compounds:
    // the host then supplies the effective inverse inertia (h.effectiveInverse), else the bodies' own.
    if(p.response==='elastoplastic'||h.plasticised){const inverse=h.effectiveInverse?h.effectiveInverse(worldAxis):worldAxis.dot(h.a.invInertiaWorld.vmult(worldAxis))+worldAxis.dot(h.b.invInertiaWorld.vmult(worldAxis));torque.scale(1/(1+k*dt*dt*inverse),torque);}
    const magnitude=torque.length(),limit=p.yieldMoment*1.5;if(magnitude>limit)torque.scale(limit/magnitude,torque);
    h.moment=Math.min(p.yieldMoment,k*elasticAngle);h.a.applyTorque(torque);h.b.applyTorque(torque.negate());
   }
  },
  afterStep(){if(disposed||p.response==='plastic'||p.damageEnabled===false)return;
   for(const h of hinges)if(!h.broken&&!(inactive(h.a)&&inactive(h.b))){const e=h.joint.equations,force=Math.hypot(...e.slice(0,3).map(e=>e.multiplier));let moment=Math.hypot(...e.slice(3).map(e=>e.multiplier));
    // The native adapter reports world force/couple at the joint's own anchor.
    // A LockConstraint's default anchor is a COM midpoint, while material
    // capacity belongs to the authored connection. Cannon rotational equation
    // multipliers use their Jacobian axes, so keep their existing read path.
    if(h.joint._structureWorldWrench===true&&e.length>=6){h.joint.pivotA.vsub(h.pivotA,reactionOffset);h.a.vectorToWorldFrame(reactionOffset,worldReactionOffset);const r=worldReactionOffset,fx=e[0].multiplier,fy=e[1].multiplier,fz=e[2].multiplier;moment=Math.hypot(e[3].multiplier+r.y*fz-r.z*fy,e[4].multiplier+r.z*fx-r.x*fz,e[5].multiplier+r.x*fy-r.y*fx);}
    h.moment=moment;let rotationFailed=false;
    if(p.response==='brittle'&&h.locked){
     // Iterative rigid constraints can under-report load while permitting a
     // large angle error. Brittle connections cannot retain that deformation
     // as an invisible elastic/plastic joint: enforce their authored limit.
     h.a.quaternion.mult(h.rest,expectedLockedRotation);const a=expectedLockedRotation,b=h.b.quaternion,norm=Math.sqrt((a.x*a.x+a.y*a.y+a.z*a.z+a.w*a.w)*(b.x*b.x+b.y*b.y+b.z*b.z+b.w*b.w));
     const cosine=norm>0?Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)/norm:1;h.rotation=2*Math.acos(Math.min(1,cosine));rotationFailed=h.rotation>p.fractureRotation;
    }
    if(p.fractureEnabled&&(force>p.breakForce||(p.response==='brittle'&&moment>p.yieldMoment)||rotationFailed)){h.broken=true;world.removeConstraint(h.joint);h.a.wakeUp();h.b.wakeUp();emit({type:'member:fractured',hinge:hinges.indexOf(h),force,moment,rotation:h.rotation,...(rotationFailed?{reason:'connection:rotation'}:{})});}
    else if(p.response==='elastoplastic'&&h.locked&&moment>p.yieldMoment){world.removeConstraint(h.joint);h.joint=new C.PointToPointConstraint(h.a,h.pivotA,h.b,h.pivotB,1e7);h.joint.collideConnected=false;world.addConstraint(h.joint);h.configuredDt=0;h.locked=false;h.yielded=true;emit({type:'member:yielded',hinge:hinges.indexOf(h),moment});}
   }
  },
  // Turn rigid (locked) connections into plastic hinges: the joint keeps the pivot, the lumped
  // rotational law takes over from the current relative rotation. Used when a frame analysis
  // yields a member so the rigid body representation bends where the analysis says it does.
  plasticise(select=()=>true,{stiffnessScale=1}={}){if(disposed||p.response==='plastic')return 0;let count=0;for(const [i,h]of hinges.entries()){if(h.broken||!h.rotates||!h.locked||!select(h,i))continue;h.stiffnessScale=stiffnessScale;world.removeConstraint(h.joint);h.joint=new C.PointToPointConstraint(h.a,h.pivotA,h.b,h.pivotB,1e7);h.joint.collideConnected=false;world.addConstraint(h.joint);h.configuredDt=0;h.locked=false;h.plasticised=true;h.rest=h.a.quaternion.conjugate().mult(h.b.quaternion);h.rest.normalize();if(!h.yielded){h.yielded=true;emit({type:'member:yielded',hinge:i,reason:'plasticised'});}count++;}return count;},
  fracture(details={}){if(disposed||!p.fractureEnabled)return false;let changed=false;for(const [i,h]of hinges.entries())if(!h.broken){h.broken=true;world.removeConstraint(h.joint);h.a.wakeUp();h.b.wakeUp();changed=true;emit({...details,type:'member:fractured',hinge:i});}return changed;},
  get broken(){return hinges.filter(h=>h.broken).length;},get plasticRotation(){return hinges.reduce((sum,h)=>sum+h.plastic,0);},
  get permanentRotation(){return Math.max(0,...hinges.filter(h=>h.rotates&&!h.broken).map(h=>{const q=h.initialRest.conjugate().mult(h.rest);q.normalize();return 2*Math.acos(Math.min(1,Math.abs(q.w)));}));},
  dispose(){if(disposed)return;disposed=true;for(const h of hinges)world.removeConstraint(h.joint);for(const s of segments)world.removeBody(s.body);listeners.clear();}
 };
}
