import * as C from 'cannon-es';

// Metres. Jolt's own default (cDefaultConvexRadius); clamped per hull by Jolt.
const HULL_CONVEX_RADIUS=.05;
// Metres. Neighbour search margin around a body whose support changed.
const WAKE_MARGIN=.05;
// m/s. Jolt's point-velocity sleep threshold. It is above one step of free fall, so
// a body whose support leaves is caught through the removed contact instead.
const NATIVE_SLEEP_SPEED=.25;

// Uses the existing Cannon data objects as the structural model only. Jolt owns
// integration and contacts; there is no second body solver or render dependency.
export function createJoltDriver(J,{velocitySteps=12,positionSteps=4,splitIslands=false,penetrationSlop,cacheHulls=true,profile=false,settleFreeze=true,settleSpeed=.05,settleSpin=.1,settleTime=.5,wakeSpeed=.3,workerThreads}={}){
 if(penetrationSlop!==undefined&&(!Number.isFinite(penetrationSlop)||penetrationSlop<=0))throw Error('Jolt penetrationSlop must be positive and finite');
 if(settleFreeze&&![settleSpeed,settleSpin,settleTime,wakeSpeed].every(n=>Number.isFinite(n)&&n>0))throw Error('Jolt settle thresholds must be positive and finite');
 const settings=new J.JoltSettings();settings.mMaxBodies=8192;settings.mMaxBodyPairs=32768;settings.mMaxContactConstraints=8192;if(workerThreads!==undefined)settings.mMaxWorkerThreads=workerThreads;
 const pairs=new J.ObjectLayerPairFilterTable(4);pairs.EnableCollision(0,1);pairs.EnableCollision(1,1);pairs.EnableCollision(0,3);
 const broad=new J.BroadPhaseLayerInterfaceTable(4,2),fixed=new J.BroadPhaseLayer(0),moving=new J.BroadPhaseLayer(1);for(let i=0;i<4;i++)broad.MapObjectToBroadPhaseLayer(i,i===0?fixed:moving);
 settings.mObjectLayerPairFilter=pairs;settings.mBroadPhaseLayerInterface=broad;settings.mObjectVsBroadPhaseLayerFilter=new J.ObjectVsBroadPhaseLayerFilterTable(broad,2,pairs,4);
 const engine=new J.JoltInterface(settings);J.destroy(settings);J.destroy(fixed);J.destroy(moving);
 const physics=engine.GetPhysicsSystem(),api=physics.GetBodyInterface(),config=new J.PhysicsSettings();config.mNumVelocitySteps=velocitySteps;config.mNumPositionSteps=positionSteps;config.mUseLargeIslandSplitter=splitIslands;config.mTimeBeforeSleep=.5;config.mPointVelocitySleepThreshold=NATIVE_SLEEP_SPEED;if(penetrationSlop!==undefined)config.mPenetrationSlop=penetrationSlop;physics.SetPhysicsSettings(config);J.destroy(config);
 const groupFilter=new J.GroupFilterTable(8192);groupFilter.AddRef();
 const vector=new J.Vec3(0,0,0),spin=new J.Vec3(0,0,0),position=new J.RVec3(0,0,0),rotation=new J.Quat(0,0,0,1);
 const bodies=new Map(),byId=new Map(),joints=new Map(),blocked=new Map(),hullCache=new Map(),freeSlots=[],events=[],estimate=new J.CollisionEstimationResult();
 // Jolt sleeps whole islands, so one moving fragment keeps an entire rubble pile
 // solving. A body quiet for settleTime becomes static (leaving the island) and
 // returns to dynamic on a real contact, a joint partner waking, or a host wake.
 // Quiet is measured like Jolt's sleep test, at the bounding radius: a tall wall
 // that is still toppling moves fast at its ends while its centre barely moves.
 const settleSpeedSq=settleSpeed*settleSpeed,settleSpinSq=settleSpin*settleSpin,pendingWake=new Set();let frozenCount=0;
  // Debug history: the last few settle/release events per body, read by describe().
 const note=(r,event)=>{(r.log??=[]).push(`${event}@${world.time.toFixed(2)}`);if(r.log.length>6)r.log.shift();};
 function freeze(b,r){note(r,'freeze');r.departure=null;const id=r.native.GetID();vector.Set(0,0,0);spin.Set(0,0,0);api.SetLinearAndAngularVelocity(id,vector,spin);api.SetMotionType(id,J.EMotionType_Static,J.EActivation_DontActivate);r.frozen=true;r.quiet=0;frozenCount++;b.velocity.setZero();b.angularVelocity.setZero();r.v.setZero();r.w.setZero();b.sleep();}
 function unfreeze(b,r){if(!r.frozen)return;note(r,'unfreeze');r.frozen=false;r.quiet=0;frozenCount--;r.departure=b.position.clone();api.SetMotionType(r.native.GetID(),J.EMotionType_Dynamic,J.EActivation_Activate);b.wakeUp();for(const [c]of joints){if(c.bodyA===b)unfreeze(c.bodyB,bodies.get(c.bodyB)??{});else if(c.bodyB===b)unfreeze(c.bodyA,bodies.get(c.bodyA)??{});}}
 // Jolt does not wake bodies touching a removed body, and a frozen (static) body has
 // left the island graph, so a support that moves, splits or disappears must release
 // its resting neighbours here. Waking goes through the Cannon mirrors because the
 // input loop re-imposes a sleeping mirror onto its native body every step.
 const byNativeId=new Map(),probe=new C.AABB();
 function releaseAround(b,{above=false,reason='removed'}={}){if(b.aabbNeedsUpdate)b.updateAABB();const lower=b.aabb.lowerBound,upper=b.aabb.upperBound;probe.lowerBound.set(lower.x-WAKE_MARGIN,lower.y-WAKE_MARGIN,lower.z-WAKE_MARGIN);probe.upperBound.set(upper.x+WAKE_MARGIN,upper.y+WAKE_MARGIN,upper.z+WAKE_MARGIN);
  for(const [other,r]of bodies){if(other===b||!r.dynamic||!(r.frozen||other.sleepState===C.Body.SLEEPING))continue;if(above&&other.position.y<b.position.y)continue;if(other.aabbNeedsUpdate)other.updateAABB();if(probe.overlaps(other.aabb)){note(r,'release:'+reason+' '+b.id);pendingWake.add(other);}}}let nextSlot=0,world,original,disposed=false;
 const metrics=profile?{steps:0,stepMs:0,inputMs:0,engineMs:0,syncMs:0,reactionMs:0,dispatchMs:0,validateCount:0,validateMs:0,acceptedPairs:0,acceptedContacts:0,rejectedContacts:0,addedCount:0,addedMs:0,persistedCount:0,persistedMs:0,persistedSkipped:0,eventCount:0,estimateCount:0,estimateMs:0,hullCookCount:0,hullCookMs:0,hullLookupMs:0,hullCacheHits:0,compoundCookCount:0,compoundCookMs:0,compoundLeaves:0}:null;
 const put=(out,v)=>{out.Set(v.x,v.y,v.z);return out;},read=(out,v)=>{out.set(v.GetX(),v.GetY(),v.GetZ());},layer=b=>b.collisionFilterMask===0?2:b.collisionFilterGroup===4?3:b.mass===0?0:1;
 const key=(a,b)=>a.id<b.id?a.id+':'+b.id:b.id+':'+a.id;
 const owned=shape=>{shape.AddRef();return shape;};
 function created(setup,label,kind){
  const start=metrics?performance.now():0;
  try{const result=setup.Create();
   if(result.HasError()){const message=result.GetError().c_str();result.Clear();throw Error(`${label}: ${message}`);}
   const shape=owned(result.Get());result.Clear();return shape;
  }finally{if(metrics&&kind)metrics[kind+'CookMs']+=performance.now()-start;}
 }
 function primitive(s){
  if(s instanceof C.Box)return owned(new J.BoxShape(put(vector,s.halfExtents),.005,null));
  if(s instanceof C.Sphere)return owned(new J.SphereShape(s.radius,null));
  if(s instanceof C.Plane){vector.Set(0,0,1);const plane=new J.Plane(vector,0),shape=owned(new J.PlaneShape(plane,null,100000));J.destroy(plane);return shape;}
  if(s instanceof C.ConvexPolyhedron){
   // Shape data is copied into the key on every request: changing a source hull
   // later cannot silently reuse the previous immutable native geometry.
   const start=metrics?performance.now():0,key=cacheHulls?JSON.stringify([s.vertices.map(p=>[p.x,p.y,p.z]),s.faces]):null,cached=key===null?null:hullCache.get(key);
   if(metrics)metrics.hullLookupMs+=performance.now()-start;
   if(cached){if(metrics)metrics.hullCacheHits++;return owned(cached);}
   // A nonzero convex radius lets Jolt resolve shallow hull contacts without EPA;
   // Jolt shrinks it per hull where the piece is thinner than twice the radius.
   const setup=new J.ConvexHullShapeSettings();setup.mMaxConvexRadius=HULL_CONVEX_RADIUS;
   try{for(const point of s.vertices)setup.mPoints.push_back(put(vector,point));if(metrics)metrics.hullCookCount++;const shape=created(setup,'Invalid Jolt convex hull','hull');if(key!==null){hullCache.set(key,shape);return owned(shape);}return shape;}
   finally{J.destroy(setup);}
  }
  throw Error('Unsupported Jolt structure collision shape');
 }
 function centred(shape){
  // Cannon pivots and supplied inertia are relative to its body origin. A hull
  // may have an off-centre vertex cloud even when it is the body's only shape.
  const centre=shape.GetCenterOfMass();spin.Set(-centre.GetX(),-centre.GetY(),-centre.GetZ());
  const result=owned(new J.OffsetCenterOfMassShape(shape,spin));shape.Release();return result;
 }
 function shapeFor(b){
  if(!b.shapes.length)return{shape:owned(new J.EmptyShape()),partIDs:null,partMask:0};
  const offset=b.shapeOffsets[0],q=b.shapeOrientations[0],identity=!offset.lengthSquared()&&q.x===0&&q.y===0&&q.z===0&&q.w===1;
  if(b.shapes.length===1&&identity&&(!b._partIDs||b._originalSingle)){const shape=primitive(b.shapes[0]);return{shape:b.shapes[0] instanceof C.ConvexPolyhedron?centred(shape):shape,partIDs:null,partMask:0};}
  const setup=new J.StaticCompoundShapeSettings();
  try{for(let i=0;i<b.shapes.length;i++){const child=primitive(b.shapes[i]);try{put(vector,b.shapeOffsets[i]);const q=b.shapeOrientations[i];rotation.Set(q.x,q.y,q.z,q.w);setup.AddShapeShape(vector,rotation,child,b._partIDs?.[i]??b.id+1);}finally{child.Release();}}
   if(metrics){metrics.compoundCookCount++;metrics.compoundLeaves+=b.shapes.length;}
   const shape=created(setup,'Invalid Jolt compound','compound');
   // Jolt optimizes a one-child compound into its child/decorated child. There
   // are then no compound index bits, and casting it to CompoundShape is invalid.
   if(b.shapes.length===1)return{shape:centred(shape),partIDs:new Uint32Array([b._partIDs?.[0]??b.id+1]),partMask:0};
   if(shape.GetType()!==J.EShapeType_Compound){shape.Release();throw Error('Jolt returned a non-compound for multiple primitive children');}
   const compound=J.castObject(shape,J.StaticCompoundShape),count=compound.GetNumSubShapes(),partIDs=new Uint32Array(count);
   // Flat compounds encode their child index in the low ceil(log2(count))
   // SubShapeID bits. Read FINAL child metadata, preserving any native reorder.
   // Cached leaf shapes remain untagged and can safely be shared by sources.
   for(let i=0;i<count;i++)partIDs[i]=compound.GetSubShape(i).mUserData;
   return{shape:centred(shape),partIDs,partMask:2**Math.ceil(Math.log2(count))-1};
  }finally{J.destroy(setup);}
 }
 function addBody(b){
  b.quaternion.normalize();const {shape,partIDs,partMask}=shapeFor(b);put(position,b.position);rotation.Set(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);
  const setup=new J.BodyCreationSettings(shape,position,rotation,b.mass===0?J.EMotionType_Static:J.EMotionType_Dynamic,layer(b)),slot=freeSlots.pop()??nextSlot++;shape.Release();
  if(slot>=8192)throw Error('Jolt structure body budget exceeded');setup.mCollisionGroup.SetGroupFilter(groupFilter);setup.mCollisionGroup.SetGroupID(1);setup.mCollisionGroup.SetSubGroupID(slot);setup.mUserData=b.id+1;setup.mFriction=b.material?.friction>=0?b.material.friction:.5;setup.mRestitution=b.material?.restitution>=0?b.material.restitution:.03;
  setup.mLinearDamping=-Math.log(1-b.linearDamping);setup.mAngularDamping=-Math.log(1-b.angularDamping);setup.mMaxLinearVelocity=500;setup.mMaxAngularVelocity=100;setup.mMotionQuality=b.mass>0&&b.shapes[0] instanceof C.Sphere&&b.hubIndex===undefined?J.EMotionQuality_LinearCast:J.EMotionQuality_Discrete;
  put(setup.mLinearVelocity,b.velocity);put(setup.mAngularVelocity,b.angularVelocity);
  if(b.mass>0){setup.mMassPropertiesOverride.mMass=b.mass;if(b._massTensor){setup.mOverrideMassProperties=J.EOverrideMassProperties_MassAndInertiaProvided;const matrix=new J.Mat44(),column=new J.Vec4(0,0,0,0);for(let c=0;c<4;c++){column.Set(c<3?b._massTensor[c]:0,c<3?b._massTensor[3+c]:0,c<3?b._massTensor[6+c]:0,c===3?1:0);matrix.SetColumn4(c,column);}setup.mMassPropertiesOverride.mInertia=matrix;J.destroy(column);J.destroy(matrix);}else{setup.mOverrideMassProperties=J.EOverrideMassProperties_CalculateInertia;b.shapes[0].calculateLocalInertia(b.mass,b.inertia);b.invInertia.set(b.inertia.x?1/b.inertia.x:0,b.inertia.y?1/b.inertia.y:0,b.inertia.z?1/b.inertia.z:0);b.updateInertiaWorld(true);}}
  const native=api.CreateBody(setup);J.destroy(setup);api.AddBody(native.GetID(),b.mass>0?J.EActivation_Activate:J.EActivation_DontActivate);bodies.set(b,{native,slot,partIDs,partMask,dynamic:b.mass>0,layer:layer(b),radius:b.shapes[0]?.radius,linearDamping:b.linearDamping,angularDamping:b.angularDamping,v:b.velocity.clone(),w:b.angularVelocity.clone()});byId.set(b.id+1,b);byNativeId.set(native.GetID().GetIndexAndSequenceNumber(),b);
 }
 function removeBody(b){const record=bodies.get(b);if(!record)return;releaseAround(b);if(record.frozen)frozenCount--;byNativeId.delete(record.native.GetID().GetIndexAndSequenceNumber());api.RemoveBody(record.native.GetID());api.DestroyBody(record.native.GetID());freeSlots.push(record.slot);bodies.delete(b);byId.delete(b.id+1);}
 function filter(c,delta){if(c.collideConnected)return;const a=bodies.get(c.bodyA),b=bodies.get(c.bodyB);if(!a||!b)return;const k=key(c.bodyA,c.bodyB),count=(blocked.get(k)??0)+delta;if(count>0){blocked.set(k,count);groupFilter.DisableCollision(a.slot,b.slot);}else{blocked.delete(k);groupFilter.EnableCollision(a.slot,b.slot);}}
 function addJoint(c){
  filter(c,1);if(!c.equations.length){joints.set(c,{native:null});return;}const a=bodies.get(c.bodyA)?.native,b=bodies.get(c.bodyB)?.native;if(!a||!b)throw Error('Jolt joint refers to an unknown body');let setup,kind,Type;
  if(c instanceof C.LockConstraint){setup=new J.SixDOFConstraintSettings();setup.mSpace=J.EConstraintSpace_WorldSpace;const point=c.bodyA.pointToWorldFrame(c.pivotA);put(setup.mPosition1,point);put(setup.mPosition2,point);for(let axis=0;axis<6;axis++)setup.MakeFixedAxis(axis);kind='lock';Type=J.SixDOFConstraint;}
  else if(c instanceof C.PointToPointConstraint){setup=new J.PointConstraintSettings();setup.mSpace=J.EConstraintSpace_LocalToBodyCOM;put(setup.mPoint1,c.pivotA);put(setup.mPoint2,c.pivotB);kind='point';Type=J.PointConstraint;}
  else if(c instanceof C.DistanceConstraint){setup=new J.DistanceConstraintSettings();setup.mSpace=J.EConstraintSpace_WorldSpace;put(setup.mPoint1,c.bodyA.position);put(setup.mPoint2,c.bodyB.position);setup.mMinDistance=0;setup.mMaxDistance=c.distance;kind='distance';Type=J.DistanceConstraint;}
  else throw Error('Unsupported Jolt structure joint');
  if(c._nativeSteps){setup.mNumVelocityStepsOverride=c._nativeSteps[0];setup.mNumPositionStepsOverride=c._nativeSteps[1];}
  const native=J.castObject(setup.Create(a,b),Type);native.AddRef();physics.AddConstraint(native);J.destroy(setup);const hadWorldWrench=Object.prototype.hasOwnProperty.call(c,'_structureWorldWrench'),worldWrench=c._structureWorldWrench;c._structureWorldWrench=true;joints.set(c,{native,kind,hadWorldWrench,worldWrench});
 }
 function removeJoint(c){const record=joints.get(c);if(!record)return;filter(c,-1);if(record.native){physics.RemoveConstraint(record.native);record.native.Release();if(record.hadWorldWrench)c._structureWorldWrench=record.worldWrench;else delete c._structureWorldWrench;}joints.delete(c);}
 const source=(proxy,id)=>{if(proxy?._originalSingle)return proxy._originalSingle;const route=bodies.get(proxy);return route?.partIDs?proxy._partMap?.get(route.partIDs[id.GetValue()&route.partMask])??proxy:proxy;};
 const contact=new J.ContactListenerJS();
 function validateContact(pa,pb,offset,result){if(!world.contactFilter)return J.ValidateResult_AcceptAllContactsForThisBodyPair;const n1=J.wrapPointer(pa,J.Body),n2=J.wrapPointer(pb,J.Body),a=byId.get(n1.GetUserData()),b=byId.get(n2.GetUserData());if(world.contactPairFilter?.(a,b))return J.ValidateResult_AcceptAllContactsForThisBodyPair;const hit=J.wrapPointer(result,J.CollideShapeResult);return world.contactFilter(source(a,hit.mSubShapeID1),source(b,hit.mSubShapeID2))?J.ValidateResult_AcceptContact:J.ValidateResult_RejectContact;}
 function queueContact(p1,p2,pm,ps,phase){
  const n1=J.wrapPointer(p1,J.Body),n2=J.wrapPointer(p2,J.Body),a=byId.get(n1.GetUserData()),b=byId.get(n2.GetUserData());if(!a||!b)return;
  // This controls JavaScript observations only. Jolt still creates and solves
  // every physical contact, including rubble pairs with no structural consumer.
  if(phase==='persisted'&&world.observePersistentPair&&!world.observePersistentPair(a,b)){if(metrics)metrics.persistedSkipped++;return;}
  const manifold=J.wrapPointer(pm,J.ContactManifold),partA=source(a,manifold.mSubShapeID1),partB=source(b,manifold.mSubShapeID2);
  if(phase==='persisted'&&world.observePersistentContact&&!world.observePersistentContact(a,b,partA,partB)){if(metrics)metrics.persistedSkipped++;return;}
  const normal=manifold.mWorldSpaceNormal,point=manifold.GetWorldSpaceContactPointOn1(0),worldPoint=new C.Vec3(point.GetX(),point.GetY(),point.GetZ()),va=new C.Vec3(),vb=new C.Vec3();a.getVelocityAtWorldPoint(worldPoint,va);b.getVelocityAtWorldPoint(worldPoint,vb);const speed=(vb.x-va.x)*normal.GetX()+(vb.y-va.y)*normal.GetY()+(vb.z-va.z)*normal.GetZ(),direction=new C.Vec3(normal.GetX(),normal.GetY(),normal.GetZ());let normalImpulse=0;if(phase==='added'&&Math.abs(speed)>1){const start=metrics?performance.now():0;engine.sEstimateCollisionResponse(n1,n2,manifold,estimate,J.wrapPointer(ps,J.ContactSettings),1,1);if(metrics){metrics.estimateCount++;metrics.estimateMs+=performance.now()-start;}const impulses=estimate.mContactImpulse;for(let i=0;i<impulses.size();i++)normalImpulse+=impulses.at(i);}events.push({a,b,speed,normalImpulse,phase,point:worldPoint,normal:direction,partA,partB});if(phase==='added'&&Math.abs(speed)>wakeSpeed){if(bodies.get(a)?.frozen&&b.mass>0)pendingWake.add(a);if(bodies.get(b)?.frozen&&a.mass>0)pendingWake.add(b);}if(metrics)metrics.eventCount++;
 }
 const addedContact=(p1,p2,pm,ps)=>queueContact(p1,p2,pm,ps,'added');
 const persistedContact=(p1,p2,pm,ps)=>{if(world.observePersistentContacts)queueContact(p1,p2,pm,ps,'persisted');else if(metrics)metrics.persistedSkipped++;};
 contact.OnContactValidate=metrics?function(...args){const start=performance.now();metrics.validateCount++;try{const result=validateContact(...args);if(result===J.ValidateResult_AcceptAllContactsForThisBodyPair)metrics.acceptedPairs++;else if(result===J.ValidateResult_AcceptContact)metrics.acceptedContacts++;else metrics.rejectedContacts++;return result;}finally{metrics.validateMs+=performance.now()-start;}}:validateContact;
 contact.OnContactAdded=metrics?function(...args){const start=performance.now();metrics.addedCount++;try{return addedContact(...args);}finally{metrics.addedMs+=performance.now()-start;}}:addedContact;
 contact.OnContactPersisted=metrics?function(...args){const start=performance.now();metrics.persistedCount++;try{return persistedContact(...args);}finally{metrics.persistedMs+=performance.now()-start;}}:persistedContact;
 // A removed contact means support loss for a resting body only when the other body
 // has been removed or is dynamic and actually moving. Static pairs (ground, frame,
 // another frozen body) are dropped by Jolt right after freezing, and quiet neighbours
 // micro-separate while settling; neither is a load change. Jolt reports the removal
 // after its sleep check, so a body whose sleep timer expired while supported is
 // already asleep in mid-air by then: resting covers frozen and natively sleeping.
 // A natively sleeping body needs this only when Jolt deactivated it during this very
 // step (it was active at step start) and the leaving neighbour sat below it; a body
 // asleep for longer is woken by Jolt itself as soon as anything active touches it.
 const movedAway=(r,other)=>!r||(r.dynamic&&!r.frozen&&other.velocity.lengthSquared()>settleSpeedSq),lostSupport=(r,body,other)=>r&&r.dynamic&&(r.frozen||r.wasActive&&!r.native.IsActive()&&(!other||other.position.y<body.position.y));
 contact.OnContactRemoved=pair=>{const ids=J.wrapPointer(pair,J.SubShapeIDPair),a=byNativeId.get(ids.GetBody1ID().GetIndexAndSequenceNumber()),b=byNativeId.get(ids.GetBody2ID().GetIndexAndSequenceNumber()),ra=a&&bodies.get(a),rb=b&&bodies.get(b);if(lostSupport(ra,a,b)&&movedAway(rb,b)){note(ra,'release:contact '+(b?.id??'gone'));pendingWake.add(a);}if(lostSupport(rb,b,a)&&movedAway(ra,a)){note(rb,'release:contact '+(a?.id??'gone'));pendingWake.add(b);}};
 physics.SetContactListener(contact);
 function step(dt){
  let phaseStart=metrics?performance.now():0;const stepStart=phaseStart;
  events.length=0;put(vector,world.gravity);physics.SetGravity(vector);
  for(const [b,r]of bodies){
   // Retiring a Cannon mirror must retire the native collider too. Keep the
   // body/constraint identity and commit the final pose before freezing it.
   if(r.dynamic&&b.mass===0){const id=r.native.GetID();put(position,b.position);rotation.Set(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);api.SetPositionAndRotation(id,position,rotation,J.EActivation_DontActivate);vector.Set(0,0,0);spin.Set(0,0,0);api.SetLinearAndAngularVelocity(id,vector,spin);r.native.ResetForce();r.native.ResetTorque();api.SetMotionType(id,J.EMotionType_Static,J.EActivation_DontActivate);r.dynamic=false;if(r.frozen){r.frozen=false;frozenCount--;}b.velocity.setZero();b.angularVelocity.setZero();r.v.setZero();r.w.setZero();}
   const targetLayer=layer(b);if(targetLayer!==r.layer){api.SetObjectLayer(r.native.GetID(),targetLayer);r.layer=targetLayer;}if(b.mass===0)continue;
   if(b.shapes[0] instanceof C.Sphere&&b.shapes[0].radius!==r.radius){const next=shapeFor(b);try{api.SetShape(r.native.GetID(),next.shape,false,J.EActivation_DontActivate);r.partIDs=next.partIDs;r.partMask=next.partMask;}finally{next.shape.Release();}r.radius=b.shapes[0].radius;}
   if(b.sleepState===C.Body.SLEEPING){if(r.native.IsActive())api.DeactivateBody(r.native.GetID());r.wasActive=false;continue;}if(r.frozen)unfreeze(b,r);r.wasActive=true;
   if(!r.native.IsActive())api.ActivateBody(r.native.GetID());if(r.linearDamping!==b.linearDamping||r.angularDamping!==b.angularDamping){const motion=r.native.GetMotionProperties();motion.SetLinearDamping(-Math.log(1-b.linearDamping));motion.SetAngularDamping(-Math.log(1-b.angularDamping));r.linearDamping=b.linearDamping;r.angularDamping=b.angularDamping;}if(!b.velocity.almostEquals(r.v,1e-12)||!b.angularVelocity.almostEquals(r.w,1e-12))api.SetLinearAndAngularVelocity(r.native.GetID(),put(vector,b.velocity),put(spin,b.angularVelocity));if(b.force.lengthSquared())r.native.AddForce(put(vector,b.force));if(b.torque.lengthSquared())r.native.AddTorque(put(vector,b.torque));
  }
  if(metrics){const now=performance.now();metrics.inputMs+=now-phaseStart;phaseStart=now;}
  engine.Step(dt,1);world.time+=dt;world.stepnumber++;for(const woken of pendingWake){const r=bodies.get(woken);if(!r)continue;if(r.frozen)unfreeze(woken,r);else if(!r.native.IsActive()||woken.sleepState===C.Body.SLEEPING){api.ActivateBody(r.native.GetID());woken.wakeUp();}}pendingWake.clear();
  if(metrics){const now=performance.now();metrics.engineMs+=now-phaseStart;phaseStart=now;}
  for(const [b,r]of bodies){if(b.mass===0)continue;const active=r.native.IsActive();if(!active&&b.sleepState===C.Body.SLEEPING)continue;if(active&&b.sleepState===C.Body.SLEEPING)b.wakeUp();api.GetPositionAndRotation(r.native.GetID(),position,rotation);if(r.departure&&!r.frozen){if(r.departure.distanceSquared(b.position)>WAKE_MARGIN*WAKE_MARGIN){r.departure=null;releaseAround(b,{above:true,reason:'departed'});}}read(b.position,position);b.quaternion.set(rotation.GetX(),rotation.GetY(),rotation.GetZ(),rotation.GetW());api.GetLinearAndAngularVelocity(r.native.GetID(),vector,spin);read(b.velocity,vector);read(b.angularVelocity,spin);r.v.copy(b.velocity);r.w.copy(b.angularVelocity);b.updateInertiaWorld(true);b.aabbNeedsUpdate=true;b.force.setZero();b.torque.setZero();if(settleFreeze&&active&&r.dynamic&&!r.frozen&&!b._noSettleFreeze){if(b.velocity.length()+b.angularVelocity.length()*b.boundingRadius<settleSpeed&&b.angularVelocity.lengthSquared()<settleSpinSq){r.quiet=(r.quiet??0)+dt;if(r.quiet>=settleTime){freeze(b,r);continue;}}else r.quiet=0;}if(!active)b.sleep();}
  if(metrics){const now=performance.now();metrics.syncMs+=now-phaseStart;phaseStart=now;}
  for(const [c,r]of joints){for(const eq of c.equations)eq.multiplier=0;if(!r.native||!r.native.IsActive())continue;if(r.kind==='distance'){c.equations[0].multiplier=r.native.GetTotalLambdaPosition()/dt;continue;}const force=r.native.GetTotalLambdaPosition();c.equations[0].multiplier=force.GetX()/dt;c.equations[1].multiplier=force.GetY()/dt;c.equations[2].multiplier=force.GetZ()/dt;if(r.kind==='lock'){const torque=r.native.GetTotalLambdaRotation();c.equations[3].multiplier=torque.GetX()/dt;c.equations[4].multiplier=torque.GetY()/dt;c.equations[5].multiplier=torque.GetZ()/dt;}}
  if(metrics){const now=performance.now();metrics.reactionMs+=now-phaseStart;phaseStart=now;}
  for(const e of events){const collision={getImpactVelocityAlongNormal:()=>e.speed,phase:e.phase,normalImpulse:e.normalImpulse,point:e.point,normal:e.normal,partA:e.partA,partB:e.partB};e.a.dispatchEvent({type:'collide',body:e.b,contact:collision});e.b.dispatchEvent({type:'collide',body:e.a,contact:{...collision,normal:e.normal.negate(),partA:e.partB,partB:e.partA}});}
  if(metrics){const now=performance.now();metrics.dispatchMs+=now-phaseStart;metrics.stepMs+=now-stepStart;metrics.steps++;}
 }
 return{
  name:'Jolt',heavyStep:1/120,rigidStep:1/60,optimizeBroadPhase(){physics.OptimizeBroadPhase();},
  // Explicit fixed attachment motion; ordinary static scenery is untouched.
  moveFixedBody(body){const r=bodies.get(body);if(!r||body.mass!==0)throw Error('Unknown fixed attachment');put(position,body.position);rotation.Set(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);api.SetPositionAndRotation(r.native.GetID(),position,rotation,J.EActivation_DontActivate);releaseAround(body,{reason:'attachment-moved'});for(const [c]of joints)if(c.bodyA===body||c.bodyB===body){const other=c.bodyA===body?c.bodyB:c.bodyA;other.wakeUp();const o=bodies.get(other);if(o)api.ActivateBody(o.native.GetID());}},
  get frozen(){return frozenCount;},
  describeBody(b){const r=bodies.get(b);return r?{frozen:!!r.frozen,active:r.native.IsActive(),motion:r.native.IsStatic()?'static':r.native.IsDynamic()?'dynamic':'kinematic',quiet:+(r.quiet??0).toFixed(2),log:r.log??[]}:null;},
  get profile(){return metrics?{...metrics,frozen:frozenCount,hullCacheEntries:hullCache.size,engineExclusiveMs:Math.max(0,metrics.engineMs-metrics.validateMs-metrics.addedMs-metrics.persistedMs)}:null;},
  resetProfile(){if(metrics)for(const key of Object.keys(metrics))metrics[key]=0;},
  inspect(){const rows=[];for(const [c,r]of joints){if(!r.native||r.kind==='distance')continue;
   // Value-returning WebIDL temporaries may alias across calls: copy each frame
   // immediately and never destroy a borrowed/value-returned wrapper.
   const ma=r.native.GetConstraintToBody1Matrix(),pa=ma.GetTranslation(),la=new C.Vec3(pa.GetX(),pa.GetY(),pa.GetZ()),qa=ma.GetQuaternion(),lqa=new C.Quaternion(qa.GetX(),qa.GetY(),qa.GetZ(),qa.GetW());
   const mb=r.native.GetConstraintToBody2Matrix(),pb=mb.GetTranslation(),lb=new C.Vec3(pb.GetX(),pb.GetY(),pb.GetZ()),qb=mb.GetQuaternion(),lqb=new C.Quaternion(qb.GetX(),qb.GetY(),qb.GetZ(),qb.GetW());
   const a=c.bodyA.pointToWorldFrame(la),b=c.bodyB.pointToWorldFrame(lb),ra=c.bodyA.quaternion.mult(lqa),rb=c.bodyB.quaternion.mult(lqb);rows.push({kind:r.kind,error:a.distanceTo(b),rotation:Math.abs(ra.x*rb.x+ra.y*rb.y+ra.z*rb.z+ra.w*rb.w),a:a.toArray(),b:b.toArray()});}return rows;},
  attach(target,context){world=target;
   // Masonry remains dynamic until native sleep; the per-body static shortcut
   // can pin a quiet wall chunk while its rubble island is still rearranging.
   if(context?.system?.definition?.metadata?.masonryHouse){
    settleFreeze=false;const sleepSettings=physics.GetPhysicsSettings();sleepSettings.mTimeBeforeSleep=1.5;sleepSettings.mPointVelocitySleepThreshold=.05;physics.SetPhysicsSettings(sleepSettings);
   }
   if(penetrationSlop===undefined&&context?.system?.floors.panels.some(p=>p.asset)){const settings=physics.GetPhysicsSettings();settings.mPenetrationSlop=.001;physics.SetPhysicsSettings(settings);}world.nativeSleep=true;original={addBody:world.addBody,removeBody:world.removeBody,addConstraint:world.addConstraint,removeConstraint:world.removeConstraint,step:world.step};for(const b of world.bodies)addBody(b);for(const c of world.constraints)addJoint(c);physics.OptimizeBroadPhase();world.addBody=function(b){original.addBody.call(world,b);addBody(b);return world;};world.removeBody=function(b){removeBody(b);original.removeBody.call(world,b);return world;};world.addConstraint=function(c){original.addConstraint.call(world,c);addJoint(c);};world.removeConstraint=function(c){removeJoint(c);original.removeConstraint.call(world,c);};world.step=step;},
  dispose(){if(disposed)return;disposed=true;for(const c of [...joints.keys()])removeJoint(c);for(const b of [...bodies.keys()])removeBody(b);if(world){Object.assign(world,original);delete world.nativeSleep;}J.destroy(engine);J.destroy(contact);for(const shape of hullCache.values())shape.Release();hullCache.clear();groupFilter.Release();for(const object of [vector,spin,position,rotation,estimate])J.destroy(object);}
 };
}
