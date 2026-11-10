import * as T from 'three';
import {createThreeMasonryView} from './masonry.js';

// Preserve pending uploads when simulation snapshots arrive before a render.
export function uploadInstanceAttribute(attribute,min,max,size){
 if(max<min)return;
 let start=min*size,end=(max+1)*size;
 for(const range of attribute.updateRanges){start=Math.min(start,range.start);end=Math.max(end,range.start+range.count);}
 attribute.clearUpdateRanges();attribute.addUpdateRange(start,end-start);attribute.needsUpdate=true;
}

// GLB geometries/materials belong to the caller's asset cache. This view owns
// only instance buffers and never reparents or changes the source GLB nodes.
export function createThreeFracturedChunkView(options){
 const standard=createStandardChunkView(options),masonry=createThreeMasonryView(options);
 return{get roots(){return [...standard.roots,...masonry.roots];},hasPanel:p=>standard.hasPanel(p)||masonry.hasPanel(p),update(){standard.update();masonry.update();},tick:dt=>masonry.tick(dt),setFacadeEnabled:enabled=>masonry.setFacadeEnabled(enabled),pick:hit=>standard.pick(hit)??masonry.pick(hit),dispose(){standard.dispose();masonry.dispose();}};
}
function createStandardChunkView({system,scene,assets}){
 const roots=[],batches=new Map(),panels=new Map(),bodyMatrix=new T.Matrix4(),localMatrix=new T.Matrix4(),drawMatrix=new T.Matrix4(),translation=new T.Matrix4(),scaleMatrix=new T.Matrix4(),position=new T.Vector3(),quaternion=new T.Quaternion(),scale=new T.Vector3();
 const lookup=id=>assets instanceof Map?assets.get(id):assets?.[id];
 const idOf=panel=>panel.row.assetId??panel.asset?.assetId;
 const cache=new Map();

 function prepare(id,entry){
  if(cache.has(id))return cache.get(id);
  const asset=entry.asset,source=entry.gltf?.scene??entry.gltf;
  if(!asset||!source?.isObject3D)return null;
  source.updateMatrixWorld(true);
  const inverse=new T.Matrix4().copy(source.matrixWorld).invert();
  function meshes(name,origin=[0,0,0]){
   const node=source.getObjectByName(name);
   if(!node)throw Error(`Destructible ${id} is missing GLB node ${name}`);
   const result=[];
   node.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    const key=mesh.geometry.uuid+':'+materials.map(material=>material.uuid).join(',');
    let batch=batches.get(key);
    if(!batch){batch={geometry:mesh.geometry,material:mesh.material,capacity:0,picks:[],mesh:null};batches.set(key,batch);}
    const offset=new T.Matrix4().makeTranslation(-origin[0],-origin[1],-origin[2]).multiply(inverse).multiply(mesh.matrixWorld);
    result.push({batch,offset});
   });
   return result;
  }
  const record={intact:asset.intact.nodes.flatMap(name=>meshes(name)),pieces:new Map(asset.pieces.map(piece=>[piece.id,meshes(piece.node,piece.position)]))};
  cache.set(id,record);return record;
 }

 // Prepare everything before adding owned scene content, so missing nodes fail
 // without leaving a half-built view. Capacity covers either intact or pieces.
 for(const panel of system.floors?.panels??[]){
  if(panel.asset?.masonry)continue;
  const id=idOf(panel),entry=lookup(id);
  if(!entry||!panel.groups)continue;
  const sources=prepare(id,entry);if(!sources)continue;
  panels.set(panel.id,sources);
  for(const item of [...sources.intact,...[...sources.pieces.values()].flat()])item.batch.capacity++;
 }
 for(const batch of batches.values()){
  if(!batch.capacity)continue;
  const mesh=new T.InstancedMesh(batch.geometry,batch.material,batch.capacity);
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.count=0;
  batch.mesh=mesh;scene.add(mesh);roots.push(mesh);
 }
 let disposed=false,wasSleeping=false,lastRevision;

 function draw(item,transform,panel,group,pieceId=null){
  const batch=item.batch,index=batch.count++,mesh=batch.mesh;
  drawMatrix.multiplyMatrices(transform,item.offset);
  const elements=drawMatrix.elements,offset=index*16,stored=mesh.instanceMatrix.array;
  let changed=false;
  for(let i=0;i<16;i++)if(stored[offset+i]!==Math.fround(elements[i])){changed=true;break;}
  if(changed){mesh.setMatrixAt(index,drawMatrix);batch.min=Math.min(batch.min,index);batch.max=Math.max(batch.max,index);}
  const pick=batch.picks[index]??(batch.picks[index]={});
  pick.panel=panel;pick.panelId=panel.id;pick.assetId=idOf(panel);pick.groupId=group.id;pick.body=group.body;pick.pieceId=pieceId;
 }
 function pose(body){
  position.copy(body.position);quaternion.copy(body.quaternion);scale.set(1,1,1);
  bodyMatrix.compose(position,quaternion,scale);
 }
 function update(){
  if(disposed)return;
  const revision=system.floors?.revision;
  if(wasSleeping&&system.sleeping&&revision===lastRevision)return;
  wasSleeping=system.sleeping;lastRevision=revision;
  for(const batch of batches.values()){batch.count=0;batch.min=Infinity;batch.max=-1;}
  for(const panel of system.floors?.panels??[]){
   const sources=panels.get(panel.id);if(!sources)continue;
   if(!panel.broken){
    const group=panel.groups[0];if(!group)continue;
    pose(group.body);
    const centre=group.assetCentre??[0,0,0],fit=panel.row.assetScale??[1,1,1];
    translation.makeTranslation(-centre[0],-centre[1],-centre[2]);scaleMatrix.makeScale(...fit);
    localMatrix.copy(bodyMatrix).multiply(translation).multiply(scaleMatrix);
    for(const item of sources.intact)draw(item,localMatrix,panel,group);
   }else for(const group of panel.groups){
    pose(group.body);
    for(const piece of group.localPieceTransforms){
     const items=sources.pieces.get(piece.id);if(!items)continue;
     position.fromArray(piece.position);quaternion.fromArray(piece.quaternion??[0,0,0,1]);scale.fromArray(piece.scale??panel.row.assetScale??[1,1,1]);
     localMatrix.compose(position,quaternion,scale).premultiply(bodyMatrix);
     for(const item of items)draw(item,localMatrix,panel,group,piece.id);
    }
   }
  }
  for(const batch of batches.values()){
   const mesh=batch.mesh;if(!mesh)continue;
   if(mesh.count!==batch.count||batch.max>=batch.min){mesh.boundingSphere=null;mesh.boundingBox=null;}
   mesh.count=batch.count;batch.picks.length=batch.count;
   uploadInstanceAttribute(mesh.instanceMatrix,batch.min,batch.max,16);
  }
 }
 return{roots,hasPanel:panel=>panels.has(panel.id),update,
  pick(hit){const batch=[...batches.values()].find(item=>item.mesh===hit?.object);return batch?.picks[hit.instanceId]??null;},
  dispose(){if(disposed)return;disposed=true;for(const mesh of roots){scene.remove(mesh);mesh.dispose();}for(const batch of batches.values())batch.picks.length=0;},
 };
}
