import * as T from 'three';
import {STRUCTURE_ATLAS,structureMaterial} from '../material-profiles.js';
import {extractFacadePatches} from './masonry.js';

// Reuse the existing chip simulation, borrowing the actual GLB material/map.
// Small shards reuse authored fracture silhouettes, with interior-tile UVs.
export function createStructureDebrisBindings(fx){
 const geometries=new Map();
 return{
  register({asset,gltf}){
   if(asset.masonry?.facade?.version>=2&&!geometries.has('render')){
    const f=asset.masonry.facade,pattern=f.variants?.find(v=>v.node===f.node)??f;
    const patches=extractFacadePatches({asset,gltf}),ordered=[...pattern.patches].sort((a,b)=>a.areaM2-b.areaM2),id=ordered[Math.floor(ordered.length/2)].id,selected=patches.get(id);
    const geometry=selected.geometry;geometry.computeBoundingBox();
    const centre=geometry.boundingBox.getCenter(new T.Vector3()),size=geometry.boundingBox.getSize(new T.Vector3()),scale=1/Math.max(size.x,size.y,size.z);geometry.translate(-centre.x,-centre.y,-centre.z);geometry.scale(scale,scale,scale);
    for(const [key,p]of patches)if(key!==id)p.geometry.dispose();
    geometries.set('render',geometry);fx.registerChips('render',{geometry,material:selected.material,pool:96,baseSize:[.1,.25],groundOffset:.05});
   }
   if(geometries.has(asset.material))return;
   let material,bestGeometry,bestScore=-Infinity;
   for(const piece of asset.pieces){if(piece.mode==='cosmetic')continue;gltf.scene.getObjectByName(piece.node).traverse(node=>{
    if(!node.isMesh)return;node.geometry.computeBoundingBox();const size=node.geometry.boundingBox.getSize(new T.Vector3()),sides=[size.x,size.y,size.z].sort((a,b)=>a-b);
    if(sides[2]<=0)return;
    const ratio=asset.material==='oak'?sides[2]/Math.max(sides[1],1e-6):asset.material==='glass'||asset.material==='clay_tile'?sides[1]/Math.max(sides[0],1e-6):sides[0]/sides[2];
    const score=ratio-Math.max(0,node.geometry.attributes.position.count-300)*.01;
    if(score>bestScore){bestScore=score;bestGeometry=node.geometry;material=Array.isArray(node.material)?node.material[0]:node.material;}
   });}
   if(!material?.map)throw Error(`Missing atlas material for ${asset.assetId}`);
   const geometry=bestGeometry.clone(),centre=geometry.boundingBox.getCenter(new T.Vector3()),size=geometry.boundingBox.getSize(new T.Vector3()),scale=1/Math.max(size.x,size.y,size.z);geometry.translate(-centre.x,-centre.y,-centre.z);geometry.scale(scale,scale,scale);
   const uv=geometry.attributes.uv,{columns,rows,tilePixels,paddingPixels}=STRUCTURE_ATLAS,row=structureMaterial(asset.material).atlas.row,inset=(paddingPixels+.5)/tilePixels;
   let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
   for(let i=0;i<uv.count;i++){minU=Math.min(minU,uv.getX(i));maxU=Math.max(maxU,uv.getX(i));minV=Math.min(minV,uv.getY(i));maxV=Math.max(maxV,uv.getY(i));}
   for(let i=0;i<uv.count;i++){const u=(uv.getX(i)-minU)/Math.max(maxU-minU,1e-6),v=(uv.getY(i)-minV)/Math.max(maxV-minV,1e-6);uv.setXY(i,(1+inset+u*(1-2*inset))/columns,1-(row+inset+v*(1-2*inset))/rows);}
   uv.needsUpdate=true;geometries.set(asset.material,geometry);fx.registerChips(asset.material,{geometry,material,pool:96,baseSize:asset.material==='brick'?[.018,.05]:[.035,.09],...(asset.material==='brick'?{bounce:.12,life:[1.4,2.4]}:{})});
  },
  dispose(){for(const geometry of geometries.values())geometry.dispose();geometries.clear();},
 };
}
