import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {importDestructible} from '../src/destruction/destructible.js';
import {externalizeAtlas} from './externalize-atlas.mjs';
import {validateCatalogue} from '../src/destruction/catalogue.js';

const root=fileURLToPath(new URL('../assets/structures/',import.meta.url));
const profileSource=fileURLToPath(new URL('../src/destruction/material-profiles.json',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const profileBytes=await fs.readFile(profileSource),revision=sha(profileBytes),profiles=JSON.parse(profileBytes);
const assets=[];
async function scan(directory){
 for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
  const absolute=path.join(directory,entry.name);
  if(entry.isDirectory()){await scan(absolute);continue;}
  if(!entry.name.endsWith('.destructible.json'))continue;
  const bytes=await fs.readFile(absolute),raw=JSON.parse(bytes),asset=importDestructible(raw);
  if(asset.version!==2)throw Error(`Catalogue requires v2: ${absolute}`);
  if(asset.profileRevision!==revision)throw Error(`Stale material profiles: ${asset.assetId}`);
  const modelPath=path.join(directory,asset.model);
  if(path.dirname(modelPath)!==directory||path.basename(asset.model)!==asset.model)throw Error('Model must be alongside definition');
  const originalModel=await fs.readFile(modelPath),atlasUri=path.relative(directory,path.join(root,'atlas.png')).replaceAll('\\','/'),model=externalizeAtlas(originalModel,atlasUri);
  if(model!==originalModel)await fs.writeFile(modelPath,model);
  const jsonLength=model.readUInt32LE(12),gltf=JSON.parse(model.subarray(20,20+jsonLength).toString());
  const metadata=gltf.nodes?.map(n=>n.extras).find(e=>e?.icd_asset_id===asset.assetId);
  if(!metadata||JSON.stringify(JSON.parse(metadata.structure))!==JSON.stringify({version:2,material:raw.material,part:raw.part,profileRevision:raw.profileRevision,bonds:raw.bonds,joints:raw.joints,sockets:raw.sockets,...(raw.masonry?{masonry:raw.masonry}:{}),validation:raw.validation}))throw Error(`GLB/JSON metadata disagree: ${asset.assetId}`);
  const facade=asset.masonry?.facade,facadeNodes=facade?.variants?.map(v=>v.node)??(facade?[facade.node]:[]),facadeMeshes=new Set(facadeNodes.map(name=>gltf.nodes.find(n=>n.name===name)?.mesh));
  const names=new Set(gltf.nodes.map(n=>n.name));for(const name of [...asset.intact.nodes,...asset.pieces.map(p=>p.node),...facadeNodes])if(!names.has(name))throw Error(`Missing GLB node ${name}`);
  const binaryStart=20+jsonLength+8,atlas=profiles.atlas,expectedRow=profiles.materials[asset.material].atlas.row,inset=(atlas.paddingPixels+.5)/atlas.tilePixels;
  for(const [meshIndex,mesh]of gltf.meshes.entries())for(const primitive of mesh.primitives){
   const materialRow=facadeMeshes.has(meshIndex)?profiles.materials.render.atlas.row:expectedRow;
   const accessor=gltf.accessors[primitive.attributes.TEXCOORD_0];if(!accessor||accessor.componentType!==5126||accessor.type!=='VEC2')throw Error('Missing float atlas UVs: '+asset.assetId);
   const view=gltf.bufferViews[accessor.bufferView],offset=binaryStart+(view.byteOffset??0)+(accessor.byteOffset??0),stride=view.byteStride??8;
   for(let i=0;i<accessor.count;i++){
    const u=model.readFloatLE(offset+i*stride)*atlas.columns,v=(1-model.readFloatLE(offset+i*stride+4))*atlas.rows,column=Math.floor(u),row=Math.floor(v),x=u-column,y=v-row;
    if(!Number.isFinite(u+v)||column<0||column>=atlas.columns||row!==materialRow||Math.min(x,y)<inset-1e-5||Math.max(x,y)>1-inset+1e-5)throw Error('Atlas UV outside padded tile: '+asset.assetId);
   }
  }
  if(gltf.materials.length!==1)throw Error('Structure part must use one opaque or glass material: '+asset.assetId);
  assets.push({id:asset.assetId,type:asset.part.type,materialId:asset.part.materialId,sizeMm:asset.part.sizeM.map(n=>Math.round(n*1000)),variant:asset.part.variant,definition:path.relative(root,absolute).replaceAll('\\','/'),model:path.relative(root,modelPath).replaceAll('\\','/'),sha256:{definition:sha(bytes),model:sha(model)},physicalChunks:asset.validation.physicalChunks,collisionHulls:asset.validation.collisionHulls,renderClass:asset.material==='glass'?'glass':'opaque'});
 }
}
await scan(root);
if(!assets.length)throw Error('No validated structure parts found');
assets.sort((a,b)=>a.id<b.id?-1:1);
const catalogue=validateCatalogue({schema:'glider.structures.catalogue',version:1,profiles:{url:'material-profiles.json',sha256:revision},atlas:{url:'atlas.png'},assets});
// Leave unchanged outputs alone: authoring builds must not retrigger the dev
// watcher or invalidate browser caches merely by touching generated files.
async function writeIfChanged(file,value){
 const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
 try{if((await fs.readFile(file)).equals(bytes))return;}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.writeFile(file,bytes);
}
await writeIfChanged(path.join(root,'material-profiles.json'),profileBytes);
await writeIfChanged(path.join(root,'manifest.json'),JSON.stringify(catalogue,null,2)+'\n');
console.log(`Catalogue: ${assets.length} parts, ${assets.reduce((n,a)=>n+a.physicalChunks,0)} authored chunks`);
