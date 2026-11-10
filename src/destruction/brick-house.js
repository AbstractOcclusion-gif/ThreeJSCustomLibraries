import {createHouseDefinition} from './house.js';

export const BRICK_HOUSE_ASSETS=Object.freeze(['slab','window','house_siding','house_roof','brick_front','brick_back','brick_side','brick_gable','cottage_door']);

// A masonry-infill specimen using the established timber roof/frame, imported
// panel graph and concrete foundation ties. Not a discrete-brick masonry solver.
export function createBrickHouseDefinition({assets={}}={}){
 const get=id=>assets instanceof Map?assets.get(id):assets[id];
 for(const id of BRICK_HOUSE_ASSETS)if(!get(id))throw Error('Brick house requires authored asset '+id);
 const d=createHouseDefinition({assets}),nodes=d.nodes,members=d.members;
 const base=members.flatMap((m,i)=>nodes[m.a].anchor&&nodes[m.b].anchor?[i]:[]);
 for(const i of base)members[i].bendable={...members[i].bendable,density:2400,width:.3,height:.3,massPerMetre:216,E:30e9,G:12e9,yieldMoment:300000,breakForce:2e6,color:0x9a968a};
 const floors=d.floors.filter(p=>p.kind==='slab'||p.kind==='roof');
 for(const p of floors)if(p.kind==='roof'){
  p.assetScale=[1.1,1,1.12];p.halfExtents=p.halfExtents.map((x,i)=>x*p.assetScale[i]);
  p.mass=get('house_roof').massKg*1.1*1.12+(p.halfExtents[0]*2)*(p.halfExtents[2]*2)*35;
  const w=p.halfExtents[0]*2,length=p.halfExtents[2]*2,cols=Math.floor(w/.31),rows=Math.floor(length/.4),physical=get('house_roof').pieces.filter(x=>x.mode!=='cosmetic');
  p.roofTiles=[];
  for(let z=0;z<rows;z++)for(let x=0;x<cols;x++){
   const position=[(x+.5)*w/cols-w/2,.06,(z+.5)*length/rows-length/2];
   const owner=physical.reduce((a,b)=>Math.abs(a.position[0]*1.1-position[0])<Math.abs(b.position[0]*1.1-position[0])?a:b);
   p.roofTiles.push({pieceId:owner.id,position});
  }
 }
 const bearing=(member,point)=>({member,point});
 const add=(assetId,kind,position,scale,bearings=[],quaternion=[0,0,0,1],size=[1,1,1])=>{
  const asset=get(assetId),mass=asset.massKg*scale.reduce((a,b)=>a*b,1),id=floors.length;
  floors.push({storey:1,assetId,kind,position,quaternion,assetScale:scale,halfExtents:size.map(x=>x/2),mass,breakEnergy:asset.breakEnergyJ*scale.reduce((a,b)=>a*b,1),breakForce:kind==='window'?12000:kind==='door'?18000:220000,bearingTolerance:.25,bearings,neighbours:[]});return id;
 };
 const along=(axis,value)=>base.filter(i=>[members[i].a,members[i].b].every(n=>Math.abs(nodes[n].position[axis]-value)<1e-6));
 const nearest=(list,point)=>list.reduce((a,b)=>{
  const distance=i=>Math.hypot(...nodes[members[i].a].position.map((v,k)=>(v+nodes[members[i].b].position[k])/2-point[k]));return distance(a)<distance(b)?a:b;
 });
 const front=add('brick_front','brick',[0,1.82,-3.22],[1,1,1],[-3,3].map(x=>{const point=[x,.49,-3.22];return bearing(nearest(along(2,-3),point),point);}),undefined,[8,2.66,.27]);
 const back=add('brick_back','brick',[0,1.82,3.22],[1,1,1],[-3,3].map(x=>{const point=[x,.49,3.22];return bearing(nearest(along(2,3),point),point);}),undefined,[8,2.66,.27]);
 const sides=[];
 for(const x of [-4.2,4.2]){
  const member=along(0,Math.sign(x)*4)[0];
  sides.push(add('brick_side','brick',[x,1.82,0],[1,1,1],[-2.5,2.5].map(z=>bearing(member,[x,.49,z])),[0,Math.SQRT1_2,0,Math.SQRT1_2],[6,2.66,.27]));
  const gable=add('brick_gable','brick',[x,3.15,0],[1,1.5/1.35,1],[],[0,Math.SQRT1_2,0,Math.SQRT1_2],[6,1.5,.24]);
  floors[gable].neighbours=[sides.at(-1)];floors[sides.at(-1)].neighbours.push(gable);
 }
 function inset(assetId,kind,position,scale,wall,q,size){const id=add(assetId,kind,position,scale,[],q,size);floors[id].neighbours=[wall];floors[wall].neighbours.push(id);return id;}
 inset('cottage_door','door',[-1.8,1.515,-3.22],[1,1,1],front,undefined,[.9,2.05,.07]);
 const openings=[{kind:'door',position:[-1.8,1.515,-3.22],size:[.9,2.05,.07]}];
 const window=(position,wall,q)=>{inset('window','window',position,[1.05/2,1.15/1.5,.3],wall,q,[1.05,1.15,.006]);openings.push({kind:'window',position,size:[1.05,1.15,.006]});};
 window([1.7,1.9,-3.22],front);for(const x of [-1.8,1.8])window([x,1.9,3.22],back);
 for(let i=0;i<2;i++)window([i?4.2:-4.2,1.9,0],sides[i],[0,Math.SQRT1_2,0,Math.SQRT1_2]);
 const physicalPieces=members.length+floors.reduce((n,p)=>n+get(p.assetId).pieces.filter(x=>x.mode!=='cosmetic').length,0),tileCount=floors.reduce((n,p)=>n+(p.roofTiles?.length??0),0);
 if(physicalPieces>280)throw Error('Brick house exceeds its 280 physical-piece prototype budget');
 return{...d,name:'Brick cottage · tiled timber roof',floors,metadata:{...d.metadata,physicalPieces,physicalPieceBudget:280,tileCount,variant:'brick',openings,approximation:'Masonry infill panels on concrete foundation ties; rigid timber roof; cohesive-region fracture, not mortar-by-mortar masonry. Tile mass is carried by roof panels; detached tiles are visual particles with ground-only collision. Closed detachable door leaf, no opening hinge.'}};
}
