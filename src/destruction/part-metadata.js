import {structureMaterial} from './material-profiles.js';
import {readMasonryMetadata} from './masonry-metadata.js';

const fail=message=>{throw Error(`Invalid destructible v2: ${message}`);};
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const text=v=>typeof v==='string'&&v.trim().length>0;
const positive=v=>Number.isFinite(v)&&v>0;
const unit=v=>vector(v)&&Math.abs(Math.hypot(...v)-1)<1e-5;
export function readPartMetadata(input,asset){
 const p=input.part;
 if(!p||!text(p.type)||p.materialId!==asset.material||!vector(p.sizeM)||!p.sizeM.every(positive)||!Number.isInteger(p.variant)||p.variant<0||!Number.isSafeInteger(p.seed)||p.seed<0||p.grainAxis!==null&&!unit(p.grainAxis))fail('part identity, size, seed or grain');
 if(!/^[a-f0-9]{64}$/.test(input.profileRevision??''))fail('profileRevision');
 const profile=structureMaterial(p.materialId),pieces=new Set(asset.pieces.filter(p=>p.mode!=='cosmetic').map(p=>p.id)),ids=new Set(),pairs=new Set();
 if(!Array.isArray(input.bonds))fail('bonds array required');
 const bonds=input.bonds.map(b=>{
  const pair=[b.a,b.b].sort().join(':');
  if(!text(b.id)||ids.has(b.id)||!pieces.has(b.a)||!pieces.has(b.b)||b.a===b.b||pairs.has(pair)||!vector(b.position)||!unit(b.normal)||!positive(b.areaM2)||!['cohesive','mortar'].includes(b.kind))fail('bond references, geometry or duplicate');
  if(b.breakable!=null&&typeof b.breakable!=='boolean')fail('bond breakable flag');
  if(b.fractureLevel!=null&&![1,2].includes(b.fractureLevel))fail('bond fracture level');
  ids.add(b.id);pairs.add(pair);
  return{id:b.id,a:b.a,b:b.b,position:b.position.slice(),normal:b.normal.slice(),areaM2:b.areaM2,kind:b.kind,...(b.breakable==null?{}:{breakable:b.breakable}),...(b.fractureLevel==null?{}:{fractureLevel:b.fractureLevel})};
 });
 if(!Array.isArray(input.joints)||input.joints.length)fail('chunk hinges are not supported yet; joints must be empty');
 if(!Array.isArray(input.sockets))fail('sockets array required');
 const socketIds=new Set(),sockets=input.sockets.map(s=>{
  if(!text(s.id)||socketIds.has(s.id)||!pieces.has(s.pieceId)||!vector(s.position)||!unit(s.axis)||!['bearing','rigid','pivot'].includes(s.connection))fail('socket');socketIds.add(s.id);return{id:s.id,pieceId:s.pieceId,position:s.position.slice(),axis:s.axis.slice(),connection:s.connection};
 });
 let detail;
 if(p.detail!=null){if(!p.detail||!Number.isInteger(p.detail.secondaryCells)||p.detail.secondaryCells<2||p.detail.secondaryCells>64||!Number.isFinite(p.detail.cutReliefM)||p.detail.cutReliefM<0||p.detail.cutReliefM>.02)fail('part detail');detail={secondaryCells:p.detail.secondaryCells,cutReliefM:p.detail.cutReliefM};}
 const v=input.validation;
 if(!v||!['physicalChunks','collisionHulls','renderTriangles','connectedComponents'].every(k=>Number.isInteger(v[k])&&v[k]>=0)||v.physicalChunks!==pieces.size||v.collisionHulls!==pieces.size)fail('validation counts');
 const masonry=readMasonryMetadata(input,asset);
 return{profileRevision:input.profileRevision,part:{type:p.type,materialId:p.materialId,sizeM:p.sizeM.slice(),variant:p.variant,seed:p.seed,grainAxis:p.grainAxis?.slice()??null,...(detail?{detail}:{})},bonds,joints:[],sockets,validation:{...v},profile,...(masonry?{masonry}:{})};
}
