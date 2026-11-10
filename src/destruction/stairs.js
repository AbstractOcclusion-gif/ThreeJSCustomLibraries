import * as C from 'cannon-es';
import {resolvePart} from './catalogue.js';

// The catalogue's authored oak stringers/treads retain their own crack graphs.
// Only layout and real end/landing supports belong to this assembly.
export function resolveStairFlight(catalogue,seed=1){
 const entry=(type,sizeMm)=>resolvePart(catalogue,{type,materialId:'oak',sizeMm,seed,placementId:'stair-'+type});
 return{stringer:entry('stairs.stringer',[3000,250,60]),tread:entry('stairs.tread',[1000,40,280]),landing:entry('floor.boards',[1000,35,2000])};
}

export function createStairFlightDefinition(parts,assets){
 const get=id=>assets instanceof Map?assets.get(id):assets[id];
 const nodes=[[-.46,.1,-1.2],[.46,.1,-1.2],[-.46,.1,1.45],[.46,.1,1.45],[-.46,1.84,1.45],[.46,1.84,1.45],[-.46,.1,3.15],[.46,.1,3.15],[-.46,1.84,3.15],[.46,1.84,3.15]].map((position,i)=>({position,anchor:i<4||i===6||i===7}));
 const timber={section:'rectangle',segments:1,response:'brittle',width:.12,height:.12,density:500,massPerMetre:7.2,E:12e9,G:.75e9,stiffness:1e6,yieldMoment:15000,breakForce:60000,collisionInset:.01,color:0x846044};
 const members=[[0,1,'foundation'],[2,4,'column'],[3,5,'column'],[4,5,'beam'],[6,8,'column'],[7,9,'column'],[8,9,'beam']].map(([a,b,type])=>({a,b,type,profile:'steel',storey:1,bendable:{...timber}}));
 // The landing beam bears the stringer ends ahead of the posts. Moving the
 // posts behind those ends avoids an initial penetration at the upper joint.
 members[3].bendable.width=.6;members[3].bendable.massPerMetre=36;
 const floors=[],q=new C.Quaternion();q.setFromEuler(-Math.atan(.75),-Math.PI/2,0,'XYZ');
 function add(entry,position,quaternion,bearings=[],neighbours=[]){
  const asset=get(entry.id);if(!asset)throw Error('Stairs require authored '+entry.id);
  floors.push({storey:1,assetId:entry.id,kind:'oak',position,quaternion,halfExtents:asset.part.sizeM.map(n=>n/2),mass:asset.massKg,breakEnergy:asset.breakEnergyJ,breakForce:60000,bearingTolerance:.03,bearings,neighbours,compactCollisionAxes:true});
 }
 for(const x of [-.46,.46])add(parts.stringer,[x,1,0],q.toArray(),[{member:0,point:[x,.1,-1.2]},{member:3,point:[x,1.9,1.2]}]);
 for(let i=0;i<10;i++)add(parts.tread,[0,.3+i*.18,-1.08+i*.24],[0,0,0,1],[],[0,1]);
 add(parts.landing,[0,1.9175,2.23],[0,0,0,1],[{member:3,point:[-.4,1.9,1.3]},{member:3,point:[.4,1.9,1.3]},{member:6,point:[-.4,1.9,3.15]},{member:6,point:[.4,1.9,3.15]}],[0,1]);
 // floors.js creates each attachment from its lower panel index, as in the
 // existing catalogue-house layout. Preserve that established graph format.
 for(const [i,row]of floors.entries())for(const n of [...row.neighbours])if(n<i){floors[n].neighbours.push(i);row.neighbours=row.neighbours.filter(id=>id!==n);}
 return{version:1,name:'Destructible oak stairs · 10 treads + landing',nodes,members,floors,metadata:{height:2.1,span:1,width:4.4,stories:1,hubMass:1,stairs:true,heavy:true,heavyStep:1/120}};
}
