// The casters of a shadow pass, shared by the sun cascades and the light shadows. While a pass draws, each mesh that
// casts wears a depth material and sits on a layer of its own, so a light camera on that layer sees the casters and
// nothing else; release() puts every material and layer back. The depth itself is read from the depth buffer, so any
// depth material does: the mesh's own (cutout, wind) when it has one, else a plain one with its side and its cutout.
import * as THREE from 'three';

export const SHADOW_LAYER = 31;   // layer the casters are put on while a pass draws
const SIDE_FOR_SHADOW = Object.freeze({[THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide});   // as Three's shadow pass

export function createShadowCasters() {
  const casters = [], materials = [];   // the meshes that cast this pass, and the material each one had
  const depthMaterials = new Map();     // one depth material per side / cutout a caster needs
  function depthMaterialOf(mesh) {
    if (mesh.customDepthMaterial) return mesh.customDepthMaterial;
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const cutout = source.alphaTest > 0 && source.map ? source.map : null;
    const side = source.shadowSide ?? SIDE_FOR_SHADOW[source.side];
    const key = `${side}|${cutout ? cutout.id : ''}|${cutout ? source.alphaTest : 0}`;
    let material = depthMaterials.get(key);
    if (!material) depthMaterials.set(key, material = new THREE.MeshDepthMaterial({side, map: cutout, alphaTest: cutout ? source.alphaTest : 0}));
    return material;
  }
  // Transparent meshes cast nothing here: the light goes through.
  const casts = material => !material.transparent && material.depthWrite && material.visible;
  function collect(object) {
    if (!object.isMesh || !object.castShadow) return;
    const material = object.material;
    if (!(Array.isArray(material) ? material.some(casts) : casts(material))) return;
    casters.push(object); materials.push(material);
    object.material = depthMaterialOf(object); object.layers.enable(SHADOW_LAYER);
  }
  return {
    // Dresses the visible casters of a scene for the pass. Always followed by release().
    collect(scene) { scene.traverseVisible(collect); return casters.length; },
    release() {
      for (let index = 0; index < casters.length; index++) { casters[index].material = materials[index]; casters[index].layers.disable(SHADOW_LAYER); }
      casters.length = materials.length = 0;
    },
    dispose() { for (const material of depthMaterials.values()) material.dispose(); depthMaterials.clear(); },
  };
}

// Runs draw() with the casters of `scene` dressed and the scene and renderer set for a depth pass, then puts
// everything back, even when draw() throws.
export function withShadowCasters(casters, scene, renderer, draw) {
  const background = scene.background, override = scene.overrideMaterial, autoClear = renderer.autoClear;
  casters.collect(scene);
  scene.background = null; scene.overrideMaterial = null; renderer.autoClear = false;
  try { return draw(); } finally {
    scene.background = background; scene.overrideMaterial = override; renderer.autoClear = autoClear;
    casters.release();
  }
}
