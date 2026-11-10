import * as T from 'three';
import {STRUCTURE_ATLAS} from '../material-profiles.js';
import {structureMaterial} from '../material-profiles.js';
import {prepareStructureAtlas} from './atlas.js';
export const SURFACE_REPEAT_METRES={0:.5,1:.5,2:.5,3:.3,5:.3,6:.5,7:.5,8:.5,11:.5};

// A second coordinate set stays in authored metres when views re-centre,
// instance or batch the geometry. Existing UVs still own material/cut identity.
export function prepareSurfaceCoordinates(geometry,assetMatrix,{grainAxis=[1,0,0]}={}){
 const positions=geometry.attributes.position,normals=geometry.attributes.normal,uv=geometry.attributes.uv;
 if(!positions||!normals||!uv)return;
 const values=new Float32Array(positions.count*3),point=new T.Vector3(),normal=new T.Vector3(),normalMatrix=new T.Matrix3().getNormalMatrix(assetMatrix),grain=grainAxis.map(Math.abs).indexOf(Math.max(...grainAxis.map(Math.abs)));
 for(let i=0;i<positions.count;i++){
  point.fromBufferAttribute(positions,i).applyMatrix4(assetMatrix);normal.fromBufferAttribute(normals,i).applyNormalMatrix(normalMatrix);
  const n=normal.toArray().map(Math.abs),axis=n.indexOf(Math.max(...n)),axes=[0,1,2].filter(k=>k!==axis),p=point.toArray();
  const row=Math.floor((1-uv.getY(i))*STRUCTURE_ATLAS.rows),end=row===2&&axis===grain,repeats=end?4:1/(SURFACE_REPEAT_METRES[row]??.5);
  if(row===2&&!end&&axes[1]!==grain)axes.reverse();
  values[i*3]=p[axes[0]]*repeats;values[i*3+1]=p[axes[1]]*repeats;values[i*3+2]=end?1:0;
 }
 geometry.setAttribute('structureDetail',new T.BufferAttribute(values,3));
}

export async function loadSurfaceAtlases(base,{loadTexture=url=>new T.TextureLoader().loadAsync(url)}={}){
 const files=['atlas-realistic-v2.png','atlas-normal-roughness-v2.png'];
 const loaded=await Promise.allSettled(files.map(file=>loadTexture(new URL(file,base).href)));
 const textures=loaded.filter(r=>r.status==='fulfilled').map(r=>r.value),failure=loaded.find(r=>r.status==='rejected');
 if(failure){for(const texture of textures)texture.dispose();throw failure.reason;}
 try{textures.forEach((texture,i)=>{texture.flipY=false;texture.colorSpace=i===0?T.SRGBColorSpace:T.NoColorSpace;prepareStructureAtlas(texture);});}
 catch(error){for(const texture of textures)texture.dispose();throw error;}
 return{colour:textures[0],normal:textures[1],dispose(){for(const texture of textures)texture.dispose();}};
}

export function bindSurfaceDetail(material,atlases){
 const original={map:material.map,normalMap:material.normalMap,roughnessMap:material.roughnessMap,roughness:material.roughness,metalness:material.metalness,normalScale:material.normalScale.clone(),onBeforeCompile:material.onBeforeCompile,customProgramCacheKey:material.customProgramCacheKey};
 const {columns,rows,tilePixels,paddingPixels}=STRUCTURE_ATLAS,inset=(paddingPixels+.5)/tilePixels,span=1-2*inset;
 function compile(shader){
  const generated=material.userData.structureInstanceRows===true;
  shader.vertexShader=(generated?'attribute float instanceAtlasRow;varying float vStructureRow;\n':'attribute vec3 structureDetail;\n')+'varying vec3 vStructureDetail;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+(generated?`
   vStructureRow=instanceAtlasRow;
   vec3 surfaceP=position*vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
   vec3 surfaceN=abs(objectNormal);bool axisX=surfaceN.x>surfaceN.y&&surfaceN.x>surfaceN.z;
   vec2 surfaceUV=axisX?surfaceP.yz:(surfaceN.y>surfaceN.z?surfaceP.xz:surfaceP.xy);
   bool wood=abs(instanceAtlasRow-2.)<.1;
   if(wood&&!axisX)surfaceUV=surfaceN.y>surfaceN.z?surfaceP.zx:surfaceP.yx;
   vStructureDetail=vec3(surfaceUV*(wood&&axisX?4.:2.),wood&&axisX?1.:0.);
  `:'vStructureDetail=structureDetail;'));
  shader.fragmentShader=(generated?'varying float vStructureRow;\n':'')+'varying vec3 vStructureDetail;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
   vec2 structureTile=floor(vec2(vMapUv.x,1.-vMapUv.y)*vec2(${columns}.,${rows}.));
   ${generated?'structureTile=vec2(0.,vStructureRow);':''}
   bool detailed=${Object.keys(SURFACE_REPEAT_METRES).map(row=>`abs(structureTile.y-${row}.)<.1`).join('||')};
   vec2 structureUv=vMapUv,structureTangentUv=vMapUv;
   vec2 structureDx=dFdx(vMapUv),structureDy=dFdy(vMapUv);
   if(detailed){
    if(abs(structureTile.y-2.)<.1)structureTile.x=step(.5,vStructureDetail.z);
    vec2 localUv=fract(vStructureDetail.xy)*${span}+${inset};
    structureUv=vec2((structureTile.x+localUv.x)/${columns}.,1.-(structureTile.y+localUv.y)/${rows}.);
    structureTangentUv=vStructureDetail.xy;
    structureDx=dFdx(vStructureDetail.xy)*vec2(${span/columns},${-span/rows});
    structureDy=dFdy(vStructureDetail.xy)*vec2(${span/columns},${-span/rows});
   }
   diffuseColor*=textureGrad(map,structureUv,structureDx,structureDy);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`float roughnessFactor=roughness*textureGrad(normalMap,structureUv,structureDx,structureDy).a;`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>','float metalnessFactor=abs(structureTile.y-11.)<.1?.9:metalness;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',T.ShaderChunk.normal_fragment_begin.replace('vNormalMapUv','structureTangentUv'));
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',T.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv )','textureGrad( normalMap, structureUv, structureDx, structureDy )'));
 }
 return{setEnabled(enabled){
  material.map=enabled?atlases.colour:original.map;material.normalMap=enabled?atlases.normal:original.normalMap;material.roughnessMap=enabled?null:original.roughnessMap;material.roughness=enabled?1:original.roughness;
  material.metalness=enabled?0:original.metalness;
  material.normalScale.copy(enabled?new T.Vector2(.45,.45):original.normalScale);
  material.onBeforeCompile=enabled?compile:original.onBeforeCompile;material.customProgramCacheKey=enabled?()=> 'structure-surfaces-v2'+(material.userData.structureInstanceRows?'-instances':''):original.customProgramCacheKey;material.needsUpdate=true;
 }};
}

// Render-only bridge for the older v1 exports. Keep their original geometry and
// materials available for comparison; no asset manifest or collider is modified.
export function bindLegacySurfaces({asset,gltf},atlases){
 const kind={concrete:'rc',wood:'oak',brick:'brick',stone:'stone_rubble',metal:'steel'}[asset.material];
 if(!kind)return null;
 const records=[],materials=new Map();gltf.scene.updateMatrixWorld(true);const inverse=new T.Matrix4().copy(gltf.scene.matrixWorld).invert();
 gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;if(Array.isArray(mesh.material))throw Error('Legacy surface adapter expects GLTF primitive materials');
  const name=mesh.material.name;if(/painted|brass/.test(name))return;
  const role=name.includes('mortar')?'render':name.includes('oak')?'oak':kind,row=structureMaterial(role).atlas.row,key=role+(name.includes('light')?'-light':'');
  if(!materials.has(key)){const material=new T.MeshStandardMaterial({color:name.includes('light')?0xffeee2:0xffffff});bindSurfaceDetail(material,atlases).setEnabled(true);materials.set(key,material);}
  const geometry=mesh.geometry.clone(),count=geometry.attributes.position.count,uv=new Float32Array(count*2),column=mesh.material.name.includes('interior')?1:0;
  for(let i=0;i<count;i++){uv[i*2]=(column+.5)/STRUCTURE_ATLAS.columns;uv[i*2+1]=1-(row+.5)/STRUCTURE_ATLAS.rows;}
  geometry.setAttribute('uv',new T.BufferAttribute(uv,2));prepareSurfaceCoordinates(geometry,new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));
  records.push({mesh,geometry,material:materials.get(key),originalGeometry:mesh.geometry,originalMaterial:mesh.material});
 });
 const setEnabled=enabled=>{for(const r of records){r.mesh.geometry=enabled?r.geometry:r.originalGeometry;r.mesh.material=enabled?r.material:r.originalMaterial;}};
 return{setEnabled,dispose(){setEnabled(false);for(const r of records)r.geometry.dispose();for(const material of materials.values())material.dispose();records.length=0;materials.clear();}};
}

export function bindInstancedSurfaces(material,geometry,rows,atlases){
 geometry.setAttribute('instanceAtlasRow',new T.InstancedBufferAttribute(new Float32Array(rows),1));material.userData.structureInstanceRows=true;
 const binding=bindSurfaceDetail(material,atlases);binding.setEnabled(true);return binding;
}
