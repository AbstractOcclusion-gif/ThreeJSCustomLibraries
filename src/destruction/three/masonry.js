import * as T from 'three';
import {createChips} from '../../particles/chips.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry IDs are read AFTER glTF export/loading. No dependency on Blender's
// vertex order, polygon order, or pre-export mesh ranges.
export function extractMasonryUnits({asset,gltf},clusters=asset.masonry.clusters){
 return extractTaggedGeometry({asset,gltf},clusters,asset.masonry.units,'_unit_id');
}

export function extractFacadePatches(resource,pattern){
 const {asset}=resource,f=asset.masonry.facade;
 if(f.version===1)return extractMasonryUnits(resource,[{node:f.node,unitIds:asset.masonry.units.map(u=>u.id)}]);
 pattern??=f.variants?.find(v=>v.node===f.node)??f;
 return extractTaggedGeometry(resource,[{node:pattern.node,unitIds:pattern.patches.map(p=>p.id)}],pattern.patches,'_patch_id');
}

function extractTaggedGeometry({asset,gltf},clusters,units,attribute){
 const root=gltf.scene??gltf;root.updateMatrixWorld(true);
 const inverse=new T.Matrix4().copy(root.matrixWorld).invert(),result=new Map();
 for(const cluster of clusters){
  const node=root.getObjectByName(cluster.node);if(!node)throw Error('Missing masonry cluster '+cluster.node);
  const mesh=[];node.traverse(o=>{if(o.isMesh)mesh.push(o);});
  if(mesh.length!==1)throw Error('Masonry cluster must have one mesh');
  const source=mesh[0],geometry=source.geometry,index=geometry.index;
  const ids=geometry.getAttribute(attribute);if(!ids)throw Error('Missing exported '+attribute);
  for(const unit of units.filter(u=>cluster.unitIds.includes(u.id))){
   const indices=[];
   for(let i=0;i<(index?.count??ids.count);i+=3){const tri=[0,1,2].map(j=>index?index.getX(i+j):i+j),members=tri.map(v=>ids.getX(v)===unit.renderId);
    if(members.some(Boolean)&&!members.every(Boolean))throw Error('Triangle crosses masonry units');
    if(members.every(Boolean))indices.push(...tri);
   }
   if(!indices.length)throw Error('Missing unit triangles '+unit.id);
   const selected=geometry.clone();selected.setIndex(indices);
   const compact=selected.toNonIndexed();selected.dispose();compact.deleteAttribute(attribute);
   compact.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,source.matrixWorld));
   result.set(unit.id,{geometry:compact,material:source.material});
  }
 }
 return result;
}

export function createThreeMasonryView({system,scene,assets,facadeEnabled=true,onFacadeReveal}){
 const panels=(system.floors?.panels??[]).filter(p=>p.asset?.masonry),sources=new Map(),facades=new Map(),sheetChoices=new Map(),draws=new Map(),bands=new Map();
 let disposed=false,lastRevision=-1,pendingBands=false;
 let crackMaterial=null,falling=null;
 const lookup=id=>assets instanceof Map?assets.get(id):assets[id];
 for(const panel of panels)if(!sources.has(panel.asset.assetId)){
  const resource=lookup(panel.asset.assetId);sources.set(panel.asset.assetId,extractMasonryUnits(resource));
  if(panel.asset.masonry.facade)facades.set(panel.asset.assetId,extractFacadePatches(resource));
 }
 const compose=(position,quaternion)=>new T.Matrix4().compose(new T.Vector3(...position),new T.Quaternion(...quaternion),new T.Vector3(1,1,1));
 function geometry(panel,ids,centre,source=sources.get(panel.asset.assetId)){
  const parts=ids.map(id=>source.get(id).geometry.clone().translate(-centre[0],-centre[1],-centre[2]));
  const merged=mergeGeometries(parts,false);for(const p of parts)p.dispose();if(!merged)throw Error('Incompatible masonry geometry');return merged;
 }
 function removeDraw(key){const draw=draws.get(key);if(!draw)return;scene.remove(draw.mesh);if(draw.owned)draw.mesh.geometry.dispose();draws.delete(key);}
 function drawSheet(panel,coating,live,pattern=panel.asset.masonry.facade){
  const spec=panel.asset.masonry.facade,patches=pattern.patches,standing=new Set(panel.groups.filter(g=>!g.detached).flatMap(g=>g.pieceIds));
  const removed=new Set(patches.filter(p=>p.unitIds.some(id=>!standing.has(id))).map(p=>p.id)),byId=new Map(patches.map(p=>[p.id,p])),cracked=new Set(removed);
  const origin=pattern.origin??[0,0];
  for(let ring=0;ring<spec.revealBorder*2+1;ring++){
   const previous=[...cracked];for(const id of previous)for(const n of byId.get(id).neighbours){
    const p=byId.get(n),centre=p.outline.reduce((v,point)=>[v[0]+point[0]/p.outline.length,v[1]+point[1]/p.outline.length],[0,0]);
    const angle=Math.atan2(centre[1]-origin[1],centre[0]-origin[0]);
    const reach=spec.revealBorder===0?0:Math.max(1,Math.round(spec.revealBorder*(1+.65*Math.sin(angle*3.7+1.2)+.35*Math.sin(angle*7.1-.8))));
    if(ring<reach)cracked.add(n);
   }
  }
  const ids=patches.filter(p=>!removed.has(p.id)).map(p=>p.id),key=panel.id+':facade',signature=(pattern.id??'')+':'+ids.join('|'),previous=draws.get(key);
  const depth=panel.asset.part.sizeM[2]/2+.0005+spec.thicknessM;
  if(previous&&previous.signature!==signature){
   const old=new Set(previous.unitIds),lost=patches.filter(p=>removed.has(p.id)&&(previous.patternId!==pattern.id||old.has(p.id)));
   if(lost.length){const point=new T.Vector3(),rotation=new T.Quaternion(...(panel.row.quaternion??[0,0,0,1])),offset=new T.Vector3(...panel.row.position);
    falling??=createChips(scene,{authored:true,material:coating.values().next().value.material,pool:256,life:[7,10],groundOffset:.02,bounce:.12});falling.setGround(()=>0);
    for(const patch of lost){const geo=coating.get(patch.id).geometry.clone();geo.computeBoundingBox();const centre=geo.boundingBox.getCenter(new T.Vector3());geo.translate(-centre.x,-centre.y,-centre.z);
     const position=centre.clone().applyQuaternion(rotation).add(offset),velocity=new T.Vector3((Math.random()-.5)*.15,-.15,.35).applyQuaternion(rotation);
     falling.emitPiece(geo,position,rotation,velocity);geo.dispose();}

    for(const p of lost){const centre=p.outline.reduce((v,p)=>v.add(new T.Vector2(...p)),new T.Vector2()).divideScalar(p.outline.length);point.add(new T.Vector3(centre.x,centre.y,depth));}
    point.divideScalar(lost.length).applyQuaternion(new T.Quaternion(...(panel.row.quaternion??[0,0,0,1]))).add(new T.Vector3(...panel.row.position));
    onFacadeReveal?.({point:point.toArray(),areaM2:lost.reduce((sum,p)=>sum+p.areaM2,0),thicknessM:spec.thicknessM});
   }
  }
  const place=mesh=>{mesh.position.fromArray(panel.row.position);mesh.quaternion.fromArray(panel.row.quaternion??[0,0,0,1]);scene.add(mesh);};
  if(ids.length){live.add(key);if(previous?.signature!==signature){removeDraw(key);
   const mesh=new T.Mesh(geometry(panel,ids,[0,0,0],coating),coating.get(ids[0]).material);mesh.name=panel.asset.assetId+':facade';mesh.userData.facadeWeb=pattern.id;mesh.castShadow=mesh.receiveShadow=true;place(mesh);draws.set(key,{mesh,panel,facade:true,owned:true,signature,unitIds:ids,patternId:pattern.id});
  }}
  const crackKey=key+':cracks',edges=new Map();
  for(const id of cracked){const p=byId.get(id);for(let i=0;i<p.outline.length;i++){
   const a=p.outline[i],b=p.outline[(i+1)%p.outline.length],key=[a.join(','),b.join(',')].sort().join('|');
   const edge=edges.get(key)??{a,b,owners:0,retained:false};edge.owners++;edge.retained||=!removed.has(id);edges.set(key,edge);
  }}
  // Only shared interior seams: no closed outline around the propagation front.
  for(const [key,e]of edges){
   const dx=e.b[0]-e.a[0],dy=e.b[1]-e.a[1],rx=(e.a[0]+e.b[0])/2-origin[0],ry=(e.a[1]+e.b[1])/2-origin[1];
   const radial=Math.abs(dx*rx+dy*ry)/Math.max(1e-9,Math.hypot(dx,dy)*Math.hypot(rx,ry));
   let hash=2166136261;for(const c of key)hash=Math.imul(hash^c.charCodeAt(0),16777619);
   if(e.owners<2||!e.retained||(hash>>>0)/4294967296<(radial<.55?.3:.06))edges.delete(key);
   else edges.set(key,[...e.a,depth+.0008,...e.b,depth+.0008]);
  }
  if(edges.size){live.add(crackKey);if(draws.get(crackKey)?.signature!==signature){removeDraw(crackKey);
   crackMaterial??=new T.LineBasicMaterial({color:0x625748});
   const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute([...edges.values()].flat(),3));
   const mesh=new T.LineSegments(geo,crackMaterial);mesh.name=panel.asset.assetId+':facade-cracks';place(mesh);draws.set(crackKey,{mesh,panel,facade:true,cracks:true,owned:true,signature});
  }}
 }
 function update(){
  if(disposed)return;
  const revision=system.floors?.revision??0;
  if(revision!==lastRevision||pendingBands){
   pendingBands=false;
   lastRevision=revision;const live=new Set(),frozen=new Map();
   for(const panel of panels){
    let coating=facades.get(panel.asset.assetId);
    const spec=panel.asset.masonry.facade;
    if(coating&&facadeEnabled&&spec.version===3){
     let selected=sheetChoices.get(panel.id)??spec.variants.find(v=>v.node===spec.node);
     if(!sheetChoices.has(panel.id)){
      const standing=new Set(panel.groups.filter(g=>!g.detached).flatMap(g=>g.pieceIds)),lost=panel.asset.masonry.units.filter(u=>!standing.has(u.id));
      if(lost.length){const centre=[0,0];for(const u of lost)for(let k=0;k<2;k++)centre[k]+=(u.bounds[0][k]+u.bounds[1][k])/2/lost.length;
       selected=spec.variants.reduce((a,b)=>Math.hypot(...a.origin.map((n,k)=>n-centre[k]))<Math.hypot(...b.origin.map((n,k)=>n-centre[k]))?a:b);sheetChoices.set(panel.id,selected);
      }
     }
     const cacheKey=panel.asset.assetId+':'+selected.id;
     if(!facades.has(cacheKey))facades.set(cacheKey,selected.node===spec.node?coating:extractFacadePatches(lookup(panel.asset.assetId),selected));
     drawSheet(panel,facades.get(cacheKey),live,selected);
    }
    else if(coating&&facadeEnabled&&spec.version===2)drawSheet(panel,coating,live);
    else if(coating&&facadeEnabled){
     const units=panel.asset.masonry.units,standing=new Set(panel.groups.filter(g=>!g.detached).flatMap(g=>g.pieceIds)),exposed=new Set(units.filter(u=>!standing.has(u.id)).map(u=>u.id));
     for(let ring=0;ring<panel.asset.masonry.facade.revealBorder;ring++){
      const previous=new Set(exposed);for(const unit of units)if(previous.has(unit.id))for(const id of unit.neighbours)exposed.add(id);
     }
     const ids=units.filter(u=>standing.has(u.id)&&!exposed.has(u.id)).map(u=>u.id),key=panel.id+':facade',signature=ids.join('|');
     const previous=draws.get(key);
     if(previous&&previous.signature!==signature&&onFacadeReveal){
      const old=new Set(previous.unitIds),lost=units.filter(u=>old.has(u.id)&&exposed.has(u.id));
      if(lost.length){
       const point=new T.Vector3(),depth=panel.asset.part.sizeM[2]/2+panel.asset.masonry.facade.thicknessM;
       for(const u of lost)point.add(new T.Vector3((u.bounds[0][0]+u.bounds[1][0])/2,(u.bounds[0][1]+u.bounds[1][1])/2,depth));
       point.divideScalar(lost.length).applyQuaternion(new T.Quaternion(...(panel.row.quaternion??[0,0,0,1]))).add(new T.Vector3(...panel.row.position));
       onFacadeReveal({point:point.toArray(),areaM2:lost.reduce((sum,u)=>sum+(u.bounds[1][0]-u.bounds[0][0])*(u.bounds[1][1]-u.bounds[0][1]),0),thicknessM:panel.asset.masonry.facade.thicknessM});
      }
     }
     if(ids.length){live.add(key);if(draws.get(key)?.signature!==signature){removeDraw(key);
      const mesh=new T.Mesh(geometry(panel,ids,[0,0,0],coating),coating.get(ids[0]).material);mesh.name=panel.asset.assetId+':facade';mesh.castShadow=mesh.receiveShadow=true;
      mesh.position.fromArray(panel.row.position);mesh.quaternion.fromArray(panel.row.quaternion??[0,0,0,1]);scene.add(mesh);draws.set(key,{mesh,panel,facade:true,owned:true,signature,unitIds:ids});
     }}
    }
    // All masonry exposes authored units and joints before damage; bodies stay shared.
    for(const group of panel.groups){
     // Static remnants are drawn in authored clusters; released components in
     // their current unit subsets. No reconstruction of fracture surfaces.
     const partitions=group.detached||!panel.broken&&['running_bond','coursed_stone'].includes(panel.asset.masonry.pattern)?[group.pieceIds]:panel.asset.masonry.clusters.map(c=>c.unitIds.filter(id=>group.pieceIds.includes(id))).filter(a=>a.length);
     for(const ids of partitions){const key=group.id+':'+ids.join(',');live.add(key);if(!draws.has(key)){
      const geo=geometry(panel,ids,group.assetCentre),mesh=new T.Mesh(geo,sources.get(panel.asset.assetId).get(ids[0]).material);mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);draws.set(key,{mesh,panel,group,owned:true});
     }}
    }
    for(const entry of panel.frozen??[]){const key=entry.band;if(!frozen.has(key))frozen.set(key,[]);frozen.get(key).push({panel,entry});}
   }
   for(const items of frozen.values())for(const {entry} of items)if(!bands.get(entry.band)?.entries.has(entry.id))for(const [key,draw]of draws)if(draw.group?.id===entry.id){live.add(key);draw.frozenEntry=entry;}
   for(const key of draws.keys())if(!live.has(key))removeDraw(key);
   for(const [key,band]of bands)if(!frozen.has(key)){scene.remove(band.mesh);band.mesh.dispose();bands.delete(key);}
   for(const [key,items]of frozen){
    const signature=items.map(x=>x.entry.id).join('|');let band=bands.get(key);
    if(band?.signature===signature)continue;
    // Reuse each existing band's allocation and slots; insertion copies only
    // new geometry. Capacity has explicit vertex/index ceilings.
    if(!band){const material=sources.get(items[0].panel.asset.assetId).values().next().value.material;
     const mesh=new T.BatchedMesh(128,65536,0,material);mesh.perObjectFrustumCulled=true;mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);band={mesh,entries:new Map()};bands.set(key,band);
    }
    const ids=new Set(items.map(x=>x.entry.id));for(const [id,slot]of band.entries)if(!ids.has(id)){band.mesh.deleteGeometry(slot.geometry);band.entries.delete(id);}
    let additions=0;
    for(const {panel,entry}of items)if(!band.entries.has(entry.id)){
     if(additions++>=4){pendingBands=true;continue;}
     const geo=geometry(panel,entry.pieceIds,entry.assetCentre);
     // Reclaim deleted ranges only on insertion, never every render frame.
     band.mesh.optimize();
     const geometryId=band.mesh.addGeometry(geo),instance=band.mesh.addInstance(geometryId);geo.dispose();
     band.mesh.setMatrixAt(instance,compose(entry.position,entry.quaternion));band.entries.set(entry.id,{geometry:geometryId,instance,entry});
     for(const [drawKey,draw]of draws)if(draw.group?.id===entry.id)removeDraw(drawKey);
    }
    band.signature=pendingBands?null:signature;
   }
  }
  for(const draw of draws.values()){
   if(draw.facade)continue;
   if(draw.frozenEntry){draw.mesh.position.fromArray(draw.frozenEntry.position);draw.mesh.quaternion.fromArray(draw.frozenEntry.quaternion);continue;}
   const group=draw.intact?draw.panel.groups[0]:draw.group;if(!group)continue;
   if(draw.intact){draw.mesh.matrix.copy(compose(group.body.position.toArray(),group.body.quaternion.toArray())).multiply(new T.Matrix4().makeTranslation(...group.assetCentre.map(n=>-n))).multiply(draw.offset);draw.mesh.matrixWorldNeedsUpdate=true;}
   else{draw.mesh.position.copy(group.body.position);draw.mesh.quaternion.copy(group.body.quaternion);}
  }
 }
 return{get roots(){return [...draws.values()].filter(d=>!d.cracks).map(d=>d.mesh);},hasPanel:p=>!!p.asset?.masonry,update,
  tick(dt){falling?.tick(dt);},get fallingCount(){return falling?.active??0;},
  setFacadeEnabled(enabled){if(facadeEnabled!==!!enabled){facadeEnabled=!!enabled;lastRevision=-1;}},
  pick(hit){const d=[...draws.values()].find(d=>d.mesh===hit?.object);return d?{panel:d.panel,group:d.group,body:d.group?.body}:null;},
  dispose(){if(disposed)return;disposed=true;for(const key of draws.keys())removeDraw(key);for(const b of bands.values()){scene.remove(b.mesh);b.mesh.dispose();}bands.clear();falling?.dispose();crackMaterial?.dispose();for(const source of new Set([...sources.values(),...facades.values()]))for(const unit of source.values())unit.geometry.dispose();sources.clear();facades.clear();sheetChoices.clear();}
 };
}
