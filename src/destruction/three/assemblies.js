import {isRopeBridge} from '../bridge-suspension.js';
import * as T from 'three';
import {createThreeFracturedChunkView,uploadInstanceAttribute as upload} from './chunks.js';
import {bindInstancedSurfaces} from './surface-detail.js';

// damageColours: tint yielded (amber) and fractured (red) bars; false keeps every bar in steel colour.
export function createThreeBendableStructureView({system,scene,assets,damageColours=true,surfaceAtlases=null}){
 const allSegments=system.members.flatMap(member=>member.segments.map(segment=>({member,...segment,adjacent:member.hinges.filter(h=>h.a===segment.body||h.b===segment.body),colour:-1,pose:{}}))),segments=allSegments.filter(s=>s.member.profile.section!=='round'),roundSegments=allSegments.filter(s=>s.member.profile.section==='round'),geometry=new T.BoxGeometry(1,1,1),material=new T.MeshStandardMaterial({color:0xffffff,metalness:.5,roughness:.55}),roots=[],dummy=new T.Object3D(),offset=new T.Vector3(),color=new T.Color();
 if(surfaceAtlases)bindInstancedSurfaces(material,geometry,segments.map(s=>s.member.type==='foundation'?7:s.member.profile.section==='rectangle'?2:11),surfaceAtlases);
 const steel=[0,1,2].map(()=>{const mesh=new T.InstancedMesh(geometry,material,segments.length);mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh);roots.push(mesh);return mesh;});
 const fallbackCapacity=panel=>Math.max(4,panel.asset?.pieces?.filter(piece=>piece.mode!=='cosmetic').length??0,panel.groups?.reduce((count,group)=>count+(group.pieceIds?.length??1),0)??0);
 const floorGeometry=new T.BoxGeometry(1,1,1),floorMaterial=new T.MeshStandardMaterial({color:0xffffff,roughness:.95}),capacity=Math.max(1,(system.floors?.panels??[]).reduce((count,panel)=>count+fallbackCapacity(panel),0)),floors=new T.InstancedMesh(floorGeometry,floorMaterial,capacity);floors.instanceMatrix.setUsage(T.DynamicDrawUsage);floors.castShadow=floors.receiveShadow=true;floors.frustumCulled=false;scene.add(floors);roots.push(floors);
 const plankDeck=isRopeBridge(system.definition?.metadata?.cableSetup);
 const floorSlots=Array.from({length:capacity},()=>({pose:{},colour:-1}));
 if(surfaceAtlases)bindInstancedSurfaces(floorMaterial,floorGeometry,Array(capacity).fill(plankDeck?2:7),surfaceAtlases);
 const roundGeometry=roundSegments.length?new T.CylinderGeometry(1,1,1,20):null,roundMaterial=roundSegments.length?new T.MeshStandardMaterial({color:0xffffff,roughness:.85,metalness:.05}):null,round=roundGeometry?new T.InstancedMesh(roundGeometry,roundMaterial,roundSegments.length):null;
 if(round){roundGeometry.rotateZ(-Math.PI/2);round.instanceMatrix.setUsage(T.DynamicDrawUsage);round.castShadow=round.receiveShadow=true;round.frustumCulled=false;scene.add(round);roots.push(round);}
 const chunks=createThreeFracturedChunkView({system,scene,assets}),generatedRoots=roots.slice();
 let disposed=false,wasSleeping=false,floorMatrixMin=Infinity,floorMatrixMax=-1,floorColourMin=Infinity,floorColourMax=-1;
 function poseChanged(cache,body,x,y,z){const p=body.position,q=body.quaternion;if(cache.px===p.x&&cache.py===p.y&&cache.pz===p.z&&cache.qx===q.x&&cache.qy===q.y&&cache.qz===q.z&&cache.qw===q.w&&cache.x===x&&cache.y===y&&cache.z===z)return false;cache.px=p.x;cache.py=p.y;cache.pz=p.z;cache.qx=q.x;cache.qy=q.y;cache.qz=q.z;cache.qw=q.w;cache.x=x;cache.y=y;cache.z=z;return true;}
 // Keep pending changes when update() runs several times before a render.
 // Three clears component-based update ranges after uploading the attribute.
 function invalidateBounds(mesh){mesh.boundingSphere=null;mesh.boundingBox=null;}
 function floorSlot(index,body,halfExtents,hex){const slot=floorSlots[index];if(poseChanged(slot.pose,body,halfExtents[0],halfExtents[1],halfExtents[2])){dummy.position.copy(body.position);dummy.quaternion.copy(body.quaternion);dummy.scale.set(halfExtents[0]*2,halfExtents[1]*2,halfExtents[2]*2);dummy.updateMatrix();floors.setMatrixAt(index,dummy.matrix);floorMatrixMin=Math.min(floorMatrixMin,index);floorMatrixMax=index;}if(slot.colour!==hex){slot.colour=hex;color.setHex(hex);floors.setColorAt(index,color);floorColourMin=Math.min(floorColourMin,index);floorColourMax=index;}}
 function update(){if(disposed)return;chunks.update();if(wasSleeping&&system.sleeping)return;wasSleeping=system.sleeping;
  let matrixMin=Infinity,matrixMax=-1,colourMin=Infinity,colourMax=-1;
  for(let i=0;i<segments.length;i++){
   const s=segments[i],p=s.member.profile,adjacent=s.adjacent;let hex=surfaceAtlases?0xffffff:p.color??(p.section==='rectangle'?0x96633c:0x688f9b);if(damageColours)for(const h of adjacent){if(h.broken){hex=0xbb6f57;break;}if(h.yielded)hex=0xd0ac72;}const recolour=hex!==s.colour,moved=poseChanged(s.pose,s.body,s.length,p.width,p.height);if(recolour){s.colour=hex;color.setHex(hex);colourMin=Math.min(colourMin,i);colourMax=i;}if(moved){matrixMin=Math.min(matrixMin,i);matrixMax=i;}
   if(!moved&&!recolour)continue;
   for(let part=0;part<3;part++){
    if(moved){dummy.quaternion.copy(s.body.quaternion);dummy.position.copy(s.body.position);if(p.section==='rectangle'){dummy.scale.set(s.length*.99,part===2?p.height:0,part===2?p.width:0);}else if(part<2){offset.set(0,(part?1:-1)*p.height*.41,0).applyQuaternion(dummy.quaternion);dummy.position.add(offset);dummy.scale.set(s.length*.99,p.height*.18,p.width*1.7);}else dummy.scale.set(s.length*.99,p.height*.82,p.width*.22);dummy.updateMatrix();steel[part].setMatrixAt(i,dummy.matrix);}if(recolour)steel[part].setColorAt(i,color);
   }
  }
  for(const mesh of steel){upload(mesh.instanceMatrix,matrixMin,matrixMax,16);if(matrixMax>=matrixMin)invalidateBounds(mesh);if(mesh.instanceColor)upload(mesh.instanceColor,colourMin,colourMax,3);}
  if(round){let movedMin=Infinity,movedMax=-1,colourMin=Infinity,colourMax=-1;for(let i=0;i<roundSegments.length;i++){const s=roundSegments[i],p=s.member.profile;let hex=p.color??0x93744c;if(damageColours)for(const h of s.adjacent){if(h.broken){hex=0xbb6f57;break;}if(h.yielded)hex=0xd0ac72;}if(poseChanged(s.pose,s.body,s.length,p.width,p.height)){dummy.position.copy(s.body.position);dummy.quaternion.copy(s.body.quaternion);dummy.scale.set(s.length,p.height/2,p.width/2);dummy.updateMatrix();round.setMatrixAt(i,dummy.matrix);movedMin=Math.min(movedMin,i);movedMax=i;}if(s.colour!==hex){s.colour=hex;color.setHex(hex);round.setColorAt(i,color);colourMin=Math.min(colourMin,i);colourMax=i;}}upload(round.instanceMatrix,movedMin,movedMax,16);if(movedMax>=movedMin)invalidateBounds(round);if(round.instanceColor)upload(round.instanceColor,colourMin,colourMax,3);}
  floorMatrixMin=floorColourMin=Infinity;floorMatrixMax=floorColourMax=-1;
  let count=0;for(const panel of system.floors?.panels??[]){if(chunks.hasPanel(panel))continue;if(panel.broken){for(const piece of panel.fragments){floorSlots[count].pick={panel,panelId:panel.id,body:piece.body};floorSlot(count++,piece.body,piece.halfExtents,surfaceAtlases?0xffffff:plankDeck?0xb78855:0xc6c0b5);}}else{const group=panel.groups?.[0],body=group?.body??panel.body;floorSlots[count].pick={panel,panelId:panel.id,body};floorSlot(count++,body,group?.halfExtents??panel.row.halfExtents,surfaceAtlases?0xffffff:plankDeck?0x916239:0xa6a7a3);}}
  if(floors.count!==count||floorMatrixMax>=floorMatrixMin)invalidateBounds(floors);floors.count=count;upload(floors.instanceMatrix,floorMatrixMin,floorMatrixMax,16);if(floors.instanceColor)upload(floors.instanceColor,floorColourMin,floorColourMax,3);
 }
 update();return{get roots(){return [...generatedRoots,...chunks.roots];},update,tick:dt=>chunks.tick(dt),pick(hit){const chunk=chunks.pick(hit);if(chunk)return chunk;if(hit?.object===floors)return floorSlots[hit.instanceId]?.pick??null;const segment=hit?.object===round?roundSegments[hit.instanceId]:steel.includes(hit?.object)?segments[hit.instanceId]:null;return segment?{member:segment.member,body:segment.body}:null;},dispose(){if(disposed)return;disposed=true;chunks.dispose();for(const root of generatedRoots){scene.remove(root);root.dispose();}geometry.dispose();material.dispose();floorGeometry.dispose();floorMaterial.dispose();roundGeometry?.dispose();roundMaterial?.dispose();}};
}
