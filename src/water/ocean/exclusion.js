// ocean/exclusion.js -- port of WebGpuWater's MESH exclusion volumes (WaterExclusionVolume + WaterExclusionDepthPass +
// WaterExclusionMesh.hlsl): dry interiors. Every registered volume mesh (the boat's UCX convex hull) is rasterised from the
// main camera into a FRONT-face depth texture and a BACK-face depth texture before the frame; the water fragment then discards
// where its own depth lies inside that span (front <= z <= back). "Front empty + back valid" = the camera is inside the volume,
// so the dry column starts at the eye. Both depths and the water's gl_FragCoord.z share the camera's projection, so they compare raw.
// A volume mesh can contribute to the FRONT pass, the BACK pass or both: an open hull needs a closed lid over its cockpit for the
// front (a convex collision hull gives that) but a tight shell for the back (a convex hull bulges past the flank below the waterline).
import * as THREE from 'three';
import {createPass, createTargetScope, QV} from './passes.js';

const DEPTH_CLEAR = 1.0;                                 // cleared depth = "nothing drawn here" (far plane)
export const EXCLUSION_GLSL = /* glsl */`
uniform highp sampler2D tExclusionFront, tExclusionBack; uniform float uExclusionOn; uniform vec2 uExclusionSize;
// True when this fragment (raw depth z) is inside a mesh exclusion volume -> the water is not drawn there.
bool insideExclusion(float z){
  if (uExclusionOn < 0.5) return false;
  vec2 uv = gl_FragCoord.xy / uExclusionSize;
  float front = texture2D(tExclusionFront, uv).r, back = texture2D(tExclusionBack, uv).r;
  bool backEmpty = back >= ${DEPTH_CLEAR.toFixed(1)}, frontEmpty = front >= ${DEPTH_CLEAR.toFixed(1)};
  return !backEmpty && (frontEmpty || front <= z) && z <= back; }`;

function depthTarget(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false });
  rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType); rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
  return rt;
}

export class ExclusionVolumes {
  constructor(renderer) {
    this.renderer = renderer;
    this.scope = createTargetScope(renderer);
    this.uniforms = { tExclusionFront: { value: null }, tExclusionBack: { value: null }, uExclusionOn: { value: 0 }, uExclusionSize: { value: new THREE.Vector2(1, 1) } };
    this.scene = new THREE.Scene(); this.volumes = [];
    this.frontMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.FrontSide });
    this.backMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.BackSide });
    this.front = null; this.back = null;
    this.filterPass = createPass(renderer);
    this.filterMaterial = new THREE.ShaderMaterial({
      uniforms: {...this.uniforms, tWaterLayer: {value: null}, tWaterDepth: {value: null}},
      vertexShader: QV, depthTest: false, depthWrite: false,
      fragmentShader: `varying vec2 vUv;
       uniform sampler2D tWaterLayer;
       uniform highp sampler2D tWaterDepth;
       ${EXCLUSION_GLSL}
       void main() {
        vec4 layer = texture2D(tWaterLayer, vUv);
        gl_FragColor = layer.a > 0.0 && insideExclusion(texture2D(tWaterDepth, vUv).r) ? vec4(0.0) : layer;
       }`,
    });
  }
  // Targets follow the drawing buffer; checked per frame because a render-scale change (auto quality) resizes it without a window resize event.
  resize(width, height) {
    if (!this.front) {
      this.front = depthTarget(width, height); this.back = depthTarget(width, height);
      this.uniforms.tExclusionFront.value = this.front.depthTexture;
      this.uniforms.tExclusionBack.value = this.back.depthTexture;
    } else {
      this.front.setSize(width, height); this.back.setSize(width, height);
    }
    this.uniforms.uExclusionSize.value.set(width, height);
  }
  // geometry: a closed mesh in the owner's local frame; `follow` supplies its world matrix each frame; front / back: which passes it joins.
  add(geometry, follow, { front = true, back = true } = {}) {
    const mesh = new THREE.Mesh(geometry, this.frontMat); mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    const entry = {mesh, follow, front, back};
    this.scene.add(mesh); this.volumes.push(entry);
    return () => {
      const index = this.volumes.indexOf(entry);
      if (index >= 0) this.volumes.splice(index, 1);
      mesh.removeFromParent();
    };
  }
  // Before the main render: the two depth prepasses (depth attachment only; colour writes are off). enabled = false skips
  // them and switches the water's test off.
  update(camera, width, height, enabled = true) {
    this.uniforms.uExclusionOn.value = enabled && this.volumes.length ? 1 : 0;
    if (!this.uniforms.uExclusionOn.value) return;
    this.resize(width, height);
    // The copy sits directly under this scene (identity), so its LOCAL matrix = the followed mesh's world matrix. (Writing
    // matrixWorld directly is overwritten by three's forced scene update every render.)
    for (const v of this.volumes) { v.follow.updateWorldMatrix(true, false); v.mesh.matrix.copy(v.follow.matrixWorld); }
    const renderer = this.renderer;
    this.scope(() => {
      for (const [target, mat, key] of [[this.front, this.frontMat, 'front'], [this.back, this.backMat, 'back']]) {
        for (const v of this.volumes) { v.mesh.material = mat; v.mesh.visible = v[key]; }
        renderer.setRenderTarget(target); renderer.clear(false, true, false); renderer.render(this.scene, camera);
      }
    });
  }
  filter(source, target) {
    const u = this.filterMaterial.uniforms;
    u.tWaterLayer.value = source.texture;
    u.tWaterDepth.value = source.depthTexture;
    this.scope(() => this.filterPass.render(this.filterMaterial, target));
  }
  dispose() {
    this.front?.dispose(); this.back?.dispose(); this.frontMat.dispose(); this.backMat.dispose();
    this.scene.clear(); this.volumes.length = 0;
    this.filterMaterial.dispose(); this.filterPass.dispose();
  }
}
