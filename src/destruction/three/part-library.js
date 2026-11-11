import {prepareStructureAtlas} from './atlas.js';
import {Matrix4} from 'three';
import {prepareSurfaceCoordinates,loadSurfaceAtlases,bindSurfaceDetail} from './surface-detail.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {importDestructible} from '../destructible.js';
import {resolvePart,validateCatalogue} from '../catalogue.js';

// Only for newly loaded GLBs, before any cached material is borrowed by them.
function disposeUnshared(gltf){
 const resources=new Set();gltf.scene.traverse(mesh=>{if(mesh.geometry)resources.add(mesh.geometry);for(const material of mesh.material?(Array.isArray(mesh.material)?mesh.material:[mesh.material]):[]){resources.add(material);for(const value of Object.values(material))if(value?.isTexture)resources.add(value);}});
 for(const resource of resources)resource.dispose();
}

// Asset cache owns GLB resources; views only borrow them, matching chunks.js.
export async function loadPartLibrary(url='/assets/structures/manifest.json',{surfaceDetail=true}={}){
 const base=new URL(url,location.href),response=await fetch(base);if(!response.ok)throw Error(`Catalogue: ${response.status}`);
 const catalogue=validateCatalogue(await response.json()),loader=new GLTFLoader(),cache=new Map(),materials=new Map(),resources=new Set();let disposed=false;
 const atlases=surfaceDetail?await loadSurfaceAtlases(base):null,bindings=[];let surfacesEnabled=surfaceDetail;
 const fetchJSON=async url=>{const response=await fetch(url);if(!response.ok)throw Error(`Part definition: ${response.status}`);return response.json();};
 return{catalogue,resolve:request=>resolvePart(catalogue,request),
  setSurfaceDetail(enabled){surfacesEnabled=!!enabled;for(const binding of bindings)binding.setEnabled(surfacesEnabled);},
  async load(entry){
   if(disposed)throw Error('Part library is disposed');
   if(!catalogue.assets.some(a=>a===entry))throw Error('Part entry must belong to this catalogue');
   if(!cache.has(entry.id))cache.set(entry.id,(async()=>{
    const definitionURL=new URL(entry.definition,base),modelURL=new URL(entry.model,base);definitionURL.searchParams.set('v',entry.sha256.definition);modelURL.searchParams.set('v',entry.sha256.model);
    const results=await Promise.allSettled([fetchJSON(definitionURL),loader.loadAsync(modelURL.href)]),gltf=results[1].status==='fulfilled'?results[1].value:null;
    if(disposed||results.some(r=>r.status==='rejected')){if(gltf)disposeUnshared(gltf);throw disposed?Error('Part library is disposed'):results.find(r=>r.status==='rejected').reason;}
    let asset;
    try{
    asset=importDestructible(results[0].value);
    const assetRoot=gltf.scene.getObjectByName(asset.assetId);
    if(!assetRoot?.userData.structure)throw Error('Missing structure extras');
    assetRoot.userData.structure=JSON.parse(assetRoot.userData.structure);
    if(asset.assetId!==entry.id||asset.profileRevision!==catalogue.profiles.sha256)throw Error('Part identity or profile revision mismatch');
    if(atlases){gltf.scene.updateMatrixWorld(true);const inverse=new Matrix4().copy(gltf.scene.matrixWorld).invert();gltf.scene.traverse(mesh=>{if(mesh.isMesh)prepareSurfaceCoordinates(mesh.geometry,new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),{grainAxis:asset.part?.grainAxis??[1,0,0]});});}
    }catch(error){disposeUnshared(gltf);throw error;}
    const replaced = new Set();
    const shareMaterial = original => {
     const cached = materials.get(original.name);
     if (cached) {
      if (cached !== original) {
       replaced.add(original);
       for (const value of Object.values(original)) {
        if (value?.isTexture) replaced.add(value);
       }
      }
      return cached;
     }

     materials.set(original.name, original);
     resources.add(original);
     if (original.map) prepareStructureAtlas(original.map);
     for (const value of Object.values(original)) {
      if (value?.isTexture) resources.add(value);
     }
     if (atlases && original.name === 'structure_opaque') {
      const binding = bindSurfaceDetail(original, atlases);
      binding.setEnabled(surfacesEnabled);
      bindings.push(binding);
     }
     return original;
    };
    gltf.scene.traverse(mesh => {
     if (!mesh.isMesh) return;
     resources.add(mesh.geometry);
     mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(shareMaterial)
      : shareMaterial(mesh.material);
    });
    for (const resource of replaced) {
     if (!resources.has(resource)) resource.dispose();
    }
    return{asset,gltf};
   })().catch(error=>{cache.delete(entry.id);throw error;}));
   return cache.get(entry.id);
  },
  dispose(){if(disposed)return;disposed=true;for(const resource of resources)resource.dispose();resources.clear();cache.clear();materials.clear();bindings.length=0;atlases?.dispose();},
 };
}
