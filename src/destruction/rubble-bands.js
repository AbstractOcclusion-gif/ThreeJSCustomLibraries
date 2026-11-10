import * as C from 'cannon-es';

// Host-owned policy; never freezes standing wall/support graph bodies.
export function createRubbleBands({world,floors,bandHeight=15,capacity=128,vertexCapacity=65536,retainAbove=30,largeMass=10,playerMargin=.5}={}){
 if(!(bandHeight>0&&Number.isInteger(capacity)&&capacity>0&&capacity<=128&&Number.isInteger(vertexCapacity)&&vertexCapacity>0&&vertexCapacity<=65536&&retainAbove>=0&&largeMass>=0))throw Error('Invalid rubble band policy');
 const bands=new Map(),contactsByBody=new Map(),listeners=new Map(),pendingContacts=[],pendingImpacts=new Map(),upperPoint=new C.Vec3(),lowerPoint=new C.Vec3();let disposed=false;
 function remember(upper,lower,point,bearing=true,otherPoint=point){
  if(upper.aabbNeedsUpdate)upper.updateAABB();
  if(['x','y','z'].some(k=>point[k]<upper.aabb.lowerBound[k]-.04||point[k]>upper.aabb.upperBound[k]+.04))return;
  if(!contactsByBody.has(upper))contactsByBody.set(upper,new Map());
  const contacts=contactsByBody.get(upper),record=contacts.get(lower)??{upper:new C.Vec3(),lower:new C.Vec3()};
  if(record.frame!==world.stepnumber){record.frame=world.stepnumber;record.bearing=false;}record.bearing||=bearing;
  upper.pointToLocalFrame(point,record.upper);lower.pointToLocalFrame(otherPoint,record.lower);contacts.set(lower,record);
 }
 function contactStillTouches(body,other,record){
  body.pointToWorldFrame(record.upper,upperPoint);other.pointToWorldFrame(record.lower,lowerPoint);
  // Plane AABBs are effectively infinite. Actual contact anchors must remain
  // close, otherwise an old ground contact can falsely ground an airborne body.
  return upperPoint.distanceSquared(lowerPoint)<.04*.04;
 }
 function remove(panel,entry){if(entry.collider)world.removeBody(entry.collider);entry.collider=null;entry.physics=null;panel.discardFrozen(entry);}
 function update(playerY){
  if(disposed)return;
  if(!Number.isFinite(playerY))throw Error('Invalid player height');
  for(const [band,items]of bands)if(band*bandHeight>playerY+retainAbove){for(const {panel,entry}of items)remove(panel,entry);bands.delete(band);}
  // Fresh impacts leave the static layer through the original chunk/body path.
  // Do this outside collision callbacks, before collecting this step's support.
  const removedSupports=new Set();
  function restore(panel,entry,hit){
   const items=bands.get(entry.band),index=items?.findIndex(item=>item.entry===entry)??-1;if(index<0)return;
   removedSupports.add(entry.bodyId);if(entry.collider){removedSupports.add(entry.collider.id);world.removeBody(entry.collider);}entry.collider=null;
   const group=panel.reactivate(entry);items.splice(index,1);entry.physics=null;
   if(group&&hit)panel.impact({body:group.body,point:hit.point,energy:hit.energy,source:hit.source});
  }
  for(const [entry,hit]of pendingImpacts)restore(hit.panel,entry,hit);pendingImpacts.clear();
  const retiredBodies=new Set([...bands.values()].flatMap(items=>items.map(({entry})=>entry.bodyId))),liveIds=new Set(world.bodies.map(b=>b.id));
  function lostContact(entry){
   if(entry.contactBodyIds?.some(id=>!liveIds.has(id)&&!retiredBodies.has(id)))return true;
   const q=new C.Quaternion(...entry.quaternion),position=new C.Vec3(...entry.position);
   return entry.physics?.contacts?.some(({body,upper,lower,canonicalId})=>{
    if(body.world!==world)return !retiredBodies.has(canonicalId??body.id);
    q.vmult(upper,upperPoint);upperPoint.vadd(position,upperPoint);body.pointToWorldFrame(lower,lowerPoint);return upperPoint.distanceSquared(lowerPoint)>.04*.04;
   });
  }
  let restored=true;while(restored){restored=false;for(const items of bands.values())for(const {panel,entry}of [...items])if((entry.contactBodyIds??entry.supportBodyIds)?.some(id=>removedSupports.has(id))||lostContact(entry)){restore(panel,entry);restored=true;}}
  const ownedBodies=new Set(floors.panels.filter(p=>p.asset?.masonry).flatMap(p=>p.groups.map(g=>g.body))),liveBodies=new Set(world.bodies);
  // Native adapters already forward original body IDs and world contact data.
  // Consume those events after pose synchronization; Cannon keeps its solved list.
  for(const [body,listener]of listeners)if(!ownedBodies.has(body)){body.removeEventListener('collide',listener);listeners.delete(body);}
  for(const body of ownedBodies)if(!listeners.has(body)){
   const listener=event=>{const {normal,point}=event.contact??{};if(!normal||!point)return;
    pendingContacts.push({upper:body,lower:event.body,point,bearing:normal.y<-.4});
   };body.addEventListener('collide',listener);listeners.set(body,listener);
  }
  for(const {upper,lower,point,bearing}of pendingContacts)if(ownedBodies.has(upper)&&liveBodies.has(lower))remember(upper,lower,point,bearing);
  pendingContacts.length=0;
  for(const [body,contacts] of contactsByBody){if(!ownedBodies.has(body)){contactsByBody.delete(body);continue;}for(const other of contacts.keys())if(!liveBodies.has(other))contacts.delete(other);}
  // Remember last solved bearing contacts: Cannon stops generating contacts for
  // fully sleeping pairs. Revalidate overlap and support motion before retirement.
  function rememberSolvedContact(c,isA){
   const body=isA?c.bi:c.bj,other=isA?c.bj:c.bi;if(!ownedBodies.has(body)||!liveBodies.has(other))return;
   body.position.vadd(isA?c.ri:c.rj,upperPoint);other.position.vadd(isA?c.rj:c.ri,lowerPoint);
   remember(body,other,upperPoint,isA?c.ni.y<-.4:c.ni.y>.4,lowerPoint);
  }
  for(const c of world.contacts){rememberSolvedContact(c,true);rememberSolvedContact(c,false);}
  const candidates=floors.panels.filter(p=>p.asset?.masonry).flatMap(p=>p.groups).filter(g=>g.detached&&g.body.sleepState===C.Body.SLEEPING),stable=new Set(world.bodies.filter(b=>b.type===C.Body.STATIC&&b.collisionFilterMask!==0&&!ownedBodies.has(b)));
  // Contact sleep is reversible. Standing destructible walls are not durable
  // retirement roots; if their collider disappears, resting sleepers must wake.
  for(const g of candidates){
   g.body.updateAABB();
   const bearing=[...(contactsByBody.get(g.body)??[])].some(([other,record])=>{
    if(!record.bearing||!liveBodies.has(other)||other.collisionFilterMask===0||other.type!==C.Body.STATIC&&other.sleepState!==C.Body.SLEEPING)return false;
    return contactStillTouches(g.body,other,record);
   });
   if(!bearing)g.body.wakeUp();
  }
  let progress=true;while(progress){progress=false;for(const g of candidates)if(g.body.sleepState===C.Body.SLEEPING&&!stable.has(g.body)){
   if([...(contactsByBody.get(g.body)??[])].some(([other,record])=>record.bearing&&stable.has(other)&&liveBodies.has(other)&&contactStillTouches(g.body,other,record))){stable.add(g.body);progress=true;}
  }}
  let colliderSources;
  for(const panel of floors.panels)if(panel.asset?.masonry)for(const group of [...panel.groups]){
   if(!stable.has(group.body))continue;
   const supportBodyIds=[...(contactsByBody.get(group.body)??[])].filter(([other,record])=>record.bearing&&stable.has(other)&&contactStillTouches(group.body,other,record)).map(([other])=>other.id);
   const entry=panel.retire(group);if(!entry)continue;entry.supportBodyIds=supportBodyIds;
   if(!colliderSources){colliderSources=new Map();for(const items of bands.values())for(const {entry}of items)if(entry.collider)colliderSources.set(entry.collider,entry.bodyId);}
   const dependencies=[...(contactsByBody.get(group.body)??[])].filter(([other])=>liveBodies.has(other)&&(other.type===C.Body.STATIC||other.sleepState===C.Body.SLEEPING||stable.has(other))).map(([body,record])=>({body,record,canonicalId:colliderSources.get(body)??body.id}));
   // Old contact IDs are conservative wake dependencies, never retirement proof.
   // Native adapters may omit persisted observations while a piece slides.
   entry.physics.contacts=dependencies.filter(({body,record})=>contactStillTouches(group.body,body,record)).map(({body,record,canonicalId})=>({body,canonicalId,upper:record.upper.clone(),lower:record.lower.clone()}));
   entry.contactBodyIds=[...new Set(dependencies.map(c=>c.canonicalId))];
   entry.vertices=entry.pieceIds.reduce((n,id)=>n+panel.asset.masonry.units.find(u=>u.id===id).renderVertices,0);
   contactsByBody.delete(group.body);
   const band=Math.floor(entry.position[1]/bandHeight);entry.band=band;
   if(!bands.has(band))bands.set(band,[]);bands.get(band).push({panel,entry});
  }
  for(const [band,items] of bands){
   // Only dispose a band when its entire vertical interval is above retention.

   items.sort((a,b)=>b.entry.mass-a.entry.mass||b.entry.time-a.entry.time||a.entry.id.localeCompare(b.entry.id));
   while(items.length>capacity||items.reduce((n,x)=>n+x.entry.vertices,0)>vertexCapacity){const {panel,entry}=items.pop();remove(panel,entry);}
   if(!items.length){bands.delete(band);continue;}
   for(const {panel,entry} of items){
    const q=new C.Quaternion(...entry.quaternion),h=entry.halfExtents;
    const extent=Math.abs(q.vmult(new C.Vec3(h[0],0,0)).y)+Math.abs(q.vmult(new C.Vec3(0,h[1],0)).y)+Math.abs(q.vmult(new C.Vec3(0,0,h[2])).y);
    const collide=entry.mass>=largeMass&&entry.position[1]-extent<=playerY+playerMargin;
    if(collide&&!entry.collider){
     entry.collider=new C.Body({mass:0,position:new C.Vec3(...entry.position),quaternion:q,collisionFilterGroup:2,collisionFilterMask:3});
     for(let i=0;i<entry.physics.shapes.length;i++)entry.collider.addShape(entry.physics.shapes[i],entry.physics.offsets[i],entry.physics.orientations[i]);
     const collider=entry.collider;collider.addEventListener('collide',event=>{
      if(event.body.structureImpact!==true)return;const speed=Math.abs(event.contact.getImpactVelocityAlongNormal());if(speed<1)return;
      const otherMass=event.body.mass||event.body.retiredMass||0,reduced=otherMass>0?entry.mass*otherMass/(entry.mass+otherMass):entry.mass,energy=.5*reduced*speed*speed;
      const c=event.contact,point=c.point?.clone?.()??collider.position.vadd(c.bi===collider?c.ri:c.rj);
      if(energy>(pendingImpacts.get(entry)?.energy??0))pendingImpacts.set(entry,{panel,point,energy,source:event.body});
     });
     world.addBody(entry.collider);
    }
    else if(!collide&&entry.collider){world.removeBody(entry.collider);entry.collider=null;}
   }
  }
 }
 return{bands,update,get count(){return [...bands.values()].reduce((n,items)=>n+items.length,0);},get colliders(){return [...bands.values()].flat().filter(x=>x.entry.collider).length;},dispose(){if(disposed)return;disposed=true;for(const items of bands.values())for(const {panel,entry} of items)remove(panel,entry);for(const [body,listener]of listeners)body.removeEventListener('collide',listener);listeners.clear();pendingContacts.length=0;pendingImpacts.clear();bands.clear();contactsByBody.clear();}};
}
