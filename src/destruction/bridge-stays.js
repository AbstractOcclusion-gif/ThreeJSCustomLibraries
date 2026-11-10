// A symmetric bridge test bay: a portal pylon, two deck arms and four stays.
// Dimensions are for gameplay. The deck bearings reuse the authored slab asset.
export const BRIDGE_STAYS_BUDGET=Object.freeze({cables:4,bodies:96,constraints:160,drawCalls:32});
export function createBridgeStaysDefinition(){
 const nodes=[],members=[],floors=[],starts=[],ends=[],sides=[];
 const node=(position,anchor=false)=>{nodes.push({position,anchor});return nodes.length-1;};
 const member=(a,b,type,bendable)=>{members.push({a,b,type,profile:'steel',bendable:{segments:1,collisionInset:.14,dampingRatio:.9,...bendable}});return members.length-1;};
 const pylon={width:.65,height:.65,massPerMetre:800,stiffness:2e6,yieldMoment:4e5,breakForce:1e6,response:'brittle',color:0xa6a7a3,fractureRotation:.12};
 const deck={segments:2,width:.28,height:.4,massPerMetre:65,stiffness:2e5,yieldMoment:1.5e5,breakForce:4e5,response:'elastoplastic',color:0x516775};
 for(const z of [-1.55,1.55]){
  const base=node([0,0,z],true),seat=node([0,3,z]),tip=node([0,8,z]);
  member(base,seat,'foundation',pylon);const upper=member(seat,tip,'foundation',pylon);
  const edges=[-1,1].map(sign=>{
   const x=sign*3.7,end=node([x,3,z]),rail=member(seat,end,'beam',deck);members[rail].startConnection='pin';
   starts.push({member:upper,point:[sign*.35,7.9,z]});ends.push({member:rail,point:[x,3.24,z]});return{end,rail,z};
  });sides.push({seat,tip,edges});
 }
 member(sides[0].tip,sides[1].tip,'foundation',pylon);member(sides[0].seat,sides[1].seat,'beam',deck);
 for(let i=0;i<2;i++){
  const [left,right]=sides.map(s=>s.edges[i]);member(left.end,right.end,'beam',deck);
  const x=(i===0?-1:1)*1.85;
  floors.push({storey:1,kind:'slab',assetId:'slab',assetScale:[.98,1,1],position:[x,3.28,0],halfExtents:[1.8179,.07,1.355],mass:3310.61,breakEnergy:24500,breakForce:180000,bearingTolerance:.23,bearings:[left,right].map(e=>({member:e.rail,point:[x,3.21,e.z]})),neighbours:[]});
 }
 return{version:1,name:'Cable-stayed bridge · load sharing bay',nodes,members,floors,metadata:{cableSetup:'bridge-stays',cableMounts:[starts,ends],span:7.4,width:3.1,height:8,deckY:3,heavy:true,hubMass:25,heavyStep:1/120}};
}

export const BRIDGE_CROSSING_BUDGET=Object.freeze({cables:8,bodies:180,constraints:320,drawCalls:48});
export const isCableBridge=setup=>setup==='bridge-stays'||setup==='bridge-crossing'||setup==='bridge-suspension'||setup==='bridge-rope'||setup==='bridge-jungle';

export function createBridgeCrossingDefinition(){
 const crossing=createBridgeStaysDefinition();
 const nodeOffset=crossing.nodes.length;
 const memberOffset=crossing.members.length;
 const second=createBridgeStaysDefinition();
 // Leave an expansion gap between the two stay-supported deck halves.
 for(const [bay,offset] of [[crossing,-3.88],[second,3.88]]){
  for(const node of bay.nodes)node.position[0]+=offset;
  for(const panel of bay.floors){
   panel.position[0]+=offset;
   for(const bearing of panel.bearings)bearing.point[0]+=offset;
  }
  for(const mounts of bay.metadata.cableMounts)for(const mount of mounts)mount.point[0]+=offset;
 }
 for(const member of second.members){member.a+=nodeOffset;member.b+=nodeOffset;}
 for(const panel of second.floors)for(const bearing of panel.bearings)bearing.member+=memberOffset;
 for(const [index,mounts] of second.metadata.cableMounts.entries()){
  for(const mount of mounts)mount.member+=memberOffset;
  crossing.metadata.cableMounts[index].push(...mounts);
 }
 crossing.nodes.push(...second.nodes);
 crossing.members.push(...second.members);
 crossing.floors.push(...second.floors);
 crossing.name='Cable-stayed bridge · twin pylons';
 Object.assign(crossing.metadata,{cableSetup:'bridge-crossing',span:15.16});
 return crossing;
}
