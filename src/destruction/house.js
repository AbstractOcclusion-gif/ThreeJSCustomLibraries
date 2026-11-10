// One bounded house experiment. Member ends are moment connections with brittle
// capacities; boards use the existing isotropic seam model, not wood grain.
export const TIMBER_PROFILE=Object.freeze({section:'rectangle',density:500,E:11e9,G:.69e9,width:.2,height:.3,massPerMetre:30,segments:1,response:'brittle',stiffness:200000,jointStiffness:1e10,yieldMoment:18000,breakForce:90000,fractureRotation:.035,collisionInset:.08});

export function createHouseDefinition({assets={}}={}){
 const get=id=>assets instanceof Map?assets.get(id):assets[id];
 for(const id of ['slab','window','house_siding','house_roof'])if(!get(id))throw Error('House requires authored asset '+id);
 const nodes=[],members=[],floors=[],node=(x,y,z,anchor=false)=>(nodes.push({position:[x,y,z],anchor}),nodes.length-1);
 const add=(a,b,type,base=false)=>(members.push({a,b,type,profile:'steel',storey:1,bendable:{...TIMBER_PROFILE,...(base?{width:.25,height:.35,massPerMetre:43.75,yieldMoment:60000}:{}),connection:'moment'}}),members.length-1);
 const bottom=[-3,3].map(z=>[-4,0,4].map(x=>node(x,.15,z,true))),top=[-3,3].map(z=>[-4,0,4].map(x=>node(x,3,z))),ridge=[-4,0,4].map(x=>node(x,4.5,0));
 const baseX=[[],[]],eaves=[[],[]],posts=[[],[]],ties=[],rafters=[[],[]];
 for(let s=0;s<2;s++){
  for(let i=0;i<3;i++)posts[s][i]=add(bottom[s][i],top[s][i],'column');
  for(let i=0;i<2;i++){baseX[s][i]=add(bottom[s][i],bottom[s][i+1],'beam',true);eaves[s][i]=add(top[s][i],top[s][i+1],'beam');}
 }
 const baseZ=[];for(let i=0;i<3;i++){baseZ[i]=add(bottom[0][i],bottom[1][i],'beam',true);ties[i]=add(top[0][i],top[1][i],'beam');for(let s=0;s<2;s++)rafters[s][i]=add(top[s][i],ridge[i],'rafter');}
 for(let i=0;i<2;i++)add(ridge[i],ridge[i+1],'ridge');
 const bearing=(member,point)=>({member,point});
 const panel=(id,kind,position,size,scale,bearings,quaternion=[0,0,0,1])=>{const asset=get(id),volumeScale=scale.reduce((n,x)=>n*x,1);floors.push({storey:1,kind,assetId:id,position,halfExtents:size.map(x=>x/2),assetScale:scale,quaternion,mass:asset.massKg*volumeScale,breakEnergy:asset.breakEnergyJ*volumeScale,breakForce:kind==='window'?15000:kind==='slab'?180000:40000,bearingTolerance:kind==='slab'?.4:.24,bearings,neighbours:[]});return floors.length-1;};
 for(let s=0;s<2;s++)for(let i=0;i<2;i++){
  const x=(i-.5)*3.75,z=(s-.5)*2.75;
  panel('slab','slab',[x,.42,z],[3.71,.14,2.71],[1,1,1],[bearing(baseX[s][i],[x,.325,(s-.5)*6]),bearing(baseZ[i],[i*4-4,.325,z])]);
 }
 const slope=Math.atan(.5),roofLength=Math.hypot(3,1.5);
 for(let s=0;s<2;s++)for(let i=0;i<2;i++){
  const x=(i-.5)*4,z=(s-.5)*3,angle=s===0?-slope:slope;
  panel('house_roof','roof',[x,3.96,z],[3.9,.08,roofLength],[1,1,1],[bearing(rafters[s][i],[i*4-4,3.75,z]),bearing(rafters[s][i+1],[(i+1)*4-4,3.75,z])],[Math.sin(angle/2),0,0,Math.cos(angle/2)]);
 }
 // Front/back openings contain real glass, never overlapping solid wall shapes.
 for(let s=0;s<2;s++){
  const z=(s-.5)*6.4,first=floors.length,rows=[[-2.5,1.65,3,3],[2.5,1.65,3,3],[0,.525,2,.75],[0,2.775,2,.75]];
  for(const [index,[x,y,w,h]]of rows.entries())panel('house_siding','wall',[x,y,z],[w,h,.06],[w/8,h/3,1],index===2?[]:index===3?[bearing(eaves[s][0],[0,3,z])]:[bearing(eaves[s][x<0?0:1],[x,3,z]),bearing(posts[s][x<0?0:2],[x<0?-4:4,y,z])]);
  panel('window','window',[0,1.65,z],[2,1.5,.02],[1,1,1],[]);
  const adjacency=[[2,3,4],[2,3,4],[0,1,4],[0,1,4],[0,1,2,3]];for(let i=0;i<5;i++)floors[first+i].neighbours=adjacency[i].map(j=>first+j);
 }
 for(const i of [0,2])panel('house_siding','wall',[(i-1)*4.22,1.65,0],[6,3,.06],[.75,1,1],[bearing(ties[i],[(i-1)*4,3,0])],[0,Math.SQRT1_2,0,Math.SQRT1_2]);
 const physicalPieces=members.length+floors.reduce((n,p)=>n+get(p.assetId).pieces.filter(x=>x.mode!=='cosmetic').length,0);
 if(physicalPieces>250)throw Error('House physical-piece budget exceeded: '+physicalPieces);
 return{version:1,name:'Timber house · 8 × 6 m',nodes,members,floors,metadata:{span:8,width:6,height:4.5,deckY:0,stories:1,heavy:true,house:true,hubMass:8,physicalPieces,physicalPieceBudget:250,approximation:'Rigid rectangular timber; moment-connected brittle ends; isotropic board seams; no grain or joinery model.'}};
}
