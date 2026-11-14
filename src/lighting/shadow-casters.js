// The casters of a shadow pass, shared by the sun cascades and the light shadows. While a pass draws, each mesh that
// casts wears a depth material and sits on a layer of its own, so a light camera on that layer sees the casters and
// nothing else; release() puts every material and layer back. The depth itself is read from the depth buffer, so any
// depth material does: the mesh's own (cutout, wind) when it has one, else a plain one with its side and its cutout.
// With `translucent`, transparent meshes cast too, as coloured glass: a second draw of the tile, behind the opaque
// depth, multiplies what each lets through into the colour of the atlas and keeps the depth of the nearest one.
import * as THREE from 'three';

export const SHADOW_LAYER = 31;   // layer the opaque casters are put on while a pass draws
const GLASS_LAYER = 30;           // layer of the transparent ones
const SIDE_FOR_SHADOW = Object.freeze({[THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide});   // as Three's shadow pass
const NO_GLASS = new THREE.Color(1, 1, 1);   // colour of the atlas where nothing tints the light; its alpha 1 = no glass before the far plane

// What a transparent mesh lets through, drawn from the light: rgb = (1 - alpha) + alpha x colour, multiplied into the
// atlas; a = its depth from the light, 0..1 and linear (the nearest is kept). uGlassFar: far plane of a perspective
// light camera, 0 for the sun's (whose depth is linear as it is). The material is Three's basic one, so maps,
// cutout, instancing and skinning come with it.
function createGlassMaterial(far) {
  const material = new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, toneMapped: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendEquationAlpha: THREE.MinEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor});
  material.onBeforeCompile = shader => {
    shader.uniforms.uGlassFar = far;
    shader.vertexShader = 'varying float vGlassDepth;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvGlassDepth = -mvPosition.z;');
    shader.fragmentShader = 'varying float vGlassDepth;\nuniform float uGlassFar;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
      float glassDepth = uGlassFar > 0.0 ? vGlassDepth / uGlassFar : gl_FragCoord.z;
      gl_FragColor = vec4(1.0 - diffuseColor.a + diffuseColor.a * diffuseColor.rgb, glassDepth);`);
  };
  material.customProgramCacheKey = () => 'shadow-glass';
  return material;
}

export function createShadowCasters({translucent = false} = {}) {
  const casters = [], materials = [];   // the meshes dressed for this pass, and the material each one had
  const depthMaterials = new Map();     // one depth material per side / cutout a caster needs
  const glassMaterials = new Map();     // one glass material per transparent material met
  const glassFar = {value: 0};          // far plane of the light camera being drawn, for every glass material
  let glass = 0;                        // transparent casters dressed for this pass
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
  // Follows its source each pass: a pane may change colour or fade.
  function glassMaterialOf(source) {
    let material = glassMaterials.get(source);
    if (!material) glassMaterials.set(source, material = createGlassMaterial(glassFar));
    if (source.color) material.color.copy(source.color);
    material.opacity = source.opacity; material.side = source.side; material.alphaTest = source.alphaTest;
    if (material.map !== (source.map ?? null)) { material.map = source.map ?? null; material.needsUpdate = true; }
    return material;
  }
  const casts = material => !material.transparent && material.depthWrite && material.visible;
  function dress(object, material, layer) {
    casters.push(object); materials.push(object.material);
    object.material = material; object.layers.enable(layer);
  }
  function collect(object) {
    if (!object.isMesh || !object.castShadow) return;
    const material = object.material;
    if (Array.isArray(material) ? material.some(casts) : casts(material)) dress(object, depthMaterialOf(object), SHADOW_LAYER);
    else if (translucent && !Array.isArray(material) && material.transparent && material.visible) { dress(object, glassMaterialOf(material), GLASS_LAYER); glass++; }
  }
  return {
    translucent,
    // Dresses the visible casters of a scene for the pass. Always followed by release().
    collect(scene) { scene.traverseVisible(collect); return casters.length; },
    release() {
      for (let index = 0; index < casters.length; index++) { casters[index].material = materials[index]; casters[index].layers.disable(SHADOW_LAYER); casters[index].layers.disable(GLASS_LAYER); }
      casters.length = materials.length = glass = 0;
    },
    // Draws one tile of an atlas from a light camera (on SHADOW_LAYER), between collect() and release(). size: texels
    // across the tile. far: far plane of a perspective light camera, 0 for an orthographic one.
    drawTile(renderer, scene, camera, target, x, y, size, far) {
      target.viewport.set(x, y, size, size); target.scissor.set(x, y, size, size);
      renderer.setRenderTarget(target);
      if (!translucent) { renderer.clear(); renderer.render(scene, camera); return; }
      renderer.setClearColor(NO_GLASS, 1); renderer.clear();
      // The opaque casters leave the colour alone, whatever their depth material writes.
      const color = renderer.state.buffers.color;
      color.setMask(false); color.setLocked(true);
      try { renderer.render(scene, camera); } finally { color.setLocked(false); color.setMask(true); }
      if (!glass) return;
      glassFar.value = far;
      camera.layers.set(GLASS_LAYER);
      try { renderer.render(scene, camera); } finally { camera.layers.set(SHADOW_LAYER); }
    },
    dispose() {
      for (const material of depthMaterials.values()) material.dispose();
      for (const material of glassMaterials.values()) material.dispose();
      depthMaterials.clear(); glassMaterials.clear();
    },
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

// The colour side of a shadow atlas: half floats when it holds the light let through by glass (rgb) and the depth
// of the nearest glass (a), else the smallest a render target can have.
export function shadowAtlasTarget(width, height, depthTexture, translucent) {
  const filter = translucent ? THREE.LinearFilter : THREE.NearestFilter;
  const target = new THREE.WebGLRenderTarget(width, height, {depthTexture, minFilter: filter, magFilter: filter, type: translucent ? THREE.HalfFloatType : THREE.UnsignedByteType});
  target.scissorTest = true;
  return target;
}
