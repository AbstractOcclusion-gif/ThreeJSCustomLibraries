export const SUSPENSION_BUDGET=Object.freeze({cables:6,bodies:128,constraints:200,drawCalls:40});

export const JUNGLE_BRIDGE_BUDGET=Object.freeze({cables:4,bodies:240,constraints:360,drawCalls:48});
export const isRopeBridge=setup=>setup==='bridge-rope'||setup==='bridge-jungle';

export function createSuspensionBridgeDefinition({planks=false}={}){
 const halfSpan=3.88;
 const towerHeight=8;
 const planksPerSide=7;
 const plankRun=halfSpan-.64;
 const nodes=[],members=[],floors=[],mounts=[[],[]],hangerRails=[[],[]];
 const node=(position,anchor=false)=>nodes.push({position,anchor})-1;
 const beam=(a,b,type,bendable)=>members.push({a,b,type,profile:'steel',bendable:{segments:1,response:'brittle',collisionInset:.14,dampingRatio:.9,...bendable}})-1;
 const tower={width:.75,height:.75,massPerMetre:950,stiffness:3e6,yieldMoment:8e5,breakForce:2e6,fractureRotation:.12};
 const deck=planks?{width:.16,height:.18,massPerMetre:12,stiffness:2e5,yieldMoment:150000,breakForce:250000,fractureRotation:.8,color:0x875b36}:{width:.28,height:.4,massPerMetre:65,stiffness:2e5,yieldMoment:2e5,breakForce:4e5,fractureRotation:.3};
 for(const [end,sign] of [-1,1].entries()){
  const x=sign*halfSpan,tops=[],seats=[],tips=[],bearings=[];
  for(const z of [-1.55,1.55]){
   const base=node([x,0,z],true),seat=node([x,3,z]),top=node([x,towerHeight,z]),tip=node([sign*.18,3,z]);
   beam(base,seat,'foundation',tower);
   const mast=beam(seat,top,'foundation',tower);
   const buttress=node([x+sign*2.5,0,z],true);
   beam(buttress,top,'foundation',tower);
   const rail=beam(seat,tip,'beam',deck);
   members[rail].startConnection='pin';
   mounts[end].push({member:mast,point:[x-sign*.38,towerHeight-.1,z]});
   for(const distance of [2.03]){
    hangerRails[end].push({member:rail,point:[sign*distance,3.24,z]});
   }
   bearings.push({member:rail,point:[sign*2.03,3.21,z]});
   tops.push(top);seats.push(seat);tips.push(tip);
  }
  beam(...tops,'foundation',tower);
  beam(...seats,'beam',deck);
  beam(...tips,'beam',deck);
  if(planks){
   for(let index=0;index<planksPerSide;index++){
    const x=sign*(.18+plankRun*(index+.5)/planksPerSide);
    floors.push({storey:1,kind:'plank',position:[x,3.145,0],halfExtents:[.217,.045,1.67],mass:37,breakEnergy:1800,breakForce:25000,bearings:bearings.flatMap(bearing=>[-.13,.13].map(offset=>({...bearing,point:[x+offset,3.10,bearing.point[2]]}))),neighbours:[]});
   }
  }else floors.push({storey:1,kind:'slab',assetId:'slab',assetScale:[.98,1,1],position:[sign*2.03,3.28,0],halfExtents:[1.8179,.07,1.355],mass:3310.61,breakEnergy:24500,breakForce:1000000,bearingTolerance:.23,bearings,neighbours:[]});
 }
 return {version:1,name:planks?'Rope bridge · timber planks':'Suspension bridge · twin main cables',nodes,members,floors,metadata:{cableSetup:planks?'bridge-rope':'bridge-suspension',cableMounts:mounts,hangerRails,span:halfSpan*2,width:3.1,height:towerHeight,deckY:3,heavy:true,hubMass:25,heavyStep:1/120}};
}

export function createJungleBridgeDefinition(){
 const nodes=[],members=[],floors=[],cableMounts=[[],[]];
 const timber={segments:1,response:'brittle',width:.5,height:.5,massPerMetre:120,stiffness:2e6,yieldMoment:5e5,breakForce:1e6,fractureRotation:.18,collisionInset:.1,color:0x775035};
 const node=(position,anchor=false)=>nodes.push({position,anchor})-1;
 const beam=(a,b)=>members.push({a,b,type:'beam',profile:'steel',bendable:timber})-1;
 for(const [end,x] of [-9.38,9.38].entries()){
  const tops=[];
  for(const z of [-.88,.88]){
   const base=node([x,0,z],true),top=node([x,5.95,z]);
   const post=beam(base,top);
   beam(node([x+Math.sign(x)*2,0,z],true),top);
   cableMounts[end].push({member:post,point:[x-Math.sign(x)*.28,4.55,z]});
   tops.push(top);
  }
  beam(...tops);
  for(const mount of cableMounts[end].slice()){
   cableMounts[end].push({...mount,point:[mount.point[0],5.65,mount.point[2]]});
  }
 }
 for(let index=0;index<36;index++){
  const x=(index-17.5)*.49;
  floors.push({storey:1,kind:'plank',ropeSupported:true,position:[x,4.62,0],halfExtents:[.225,.04,1.02],mass:19,breakEnergy:1200,breakForce:30000,bearings:[],neighbours:[]});
 }
 return {version:1,name:'Jungle rope-and-plank footbridge',nodes,members,floors,metadata:{cableSetup:'bridge-jungle',cableMounts,span:18.76,width:2.04,height:5.95,deckY:4.55,heavy:true,hubMass:25,heavyStep:1/120}};
}
