// ocean/foam-trail.js -- the stern foam trail as a textured ribbon: a node is laid every `spacing` metres the stern travels (world
// xz + the boat's right vector + time + speed intensity); the strip widens and fades with age and is textured with any flipbook
// sheet: 'along' maps the frame's u along the trail (propeller stripe), 'across' maps v along the trail with the frame top at
// the stern (wake back V). Two ways to show it: 'ribbon' draws the strip itself riding the drawn surface; 'ocean foam' injects
// its coverage into the sim window's foam field every frame (saturating, like the sphere / obstacle stamps), so the SURFACE
// shader renders it as real whitecap foam (dissolve pattern, lighting, kernel advection + spread on top) -- no extra geometry on
// screen, but only inside the window (64 m) at its texel size.
import * as THREE from 'three';
import {createTargetScope} from './passes.js';
const NO_SHEET = 'none (ocean foam)';

export const TRAIL_DEFAULTS = Object.freeze({ on: true, display: 'ocean foam', injectStrength: 1, sheet: NO_SHEET, foamTexGain: 0.6, foamTexTile: 6, blend: 'alpha', color: 'foam', orientation: 'along', fps: 24, spacing: 0.5, width: 0.9, spread: 0.35, life: 10,
  tileLength: 8, edgeSoftness: 0.35, maskLow: 0.15, maskHigh: 0.8, opacity: 0.9, speedForStart: 0.5, speedForFull: 4, lift: 0.015, sternOffset: 0.48 });
const MAX_NODES = 192;

const vertex = SURFACE_HEIGHT_GLSL => /* glsl */`attribute vec2 aCenter, aRight; attribute float aSide, aDist, aTime, aIntensity; uniform float uTime, uWidth, uSpread, uLife, uLift; varying vec2 vUv, vXZ; varying float vFade; varying vec3 vWorldFx;
  ${SURFACE_HEIGHT_GLSL}
  void main(){ float age = uTime - aTime; float width = aTime < -1e8 ? 0.0 : uWidth + uSpread * age;   // ghost node: collapsed
    vFade = aTime < -1e8 ? 0.0 : (1.0 - smoothstep(0.4 * uLife, uLife, age)) * aIntensity;
    vec2 xz = aCenter + aRight * (aSide * 0.5 * width); vUv = vec2(aDist, aSide * 0.5 + 0.5); vXZ = xz;
    vec3 w = vec3(xz.x, surfaceHeightAt(xz) + uLift, xz.y); vWorldFx = w; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`;
const fragment = (FLIPBOOK_GLSL, FX_DEPTH_GLSL) => /* glsl */`uniform float uFrame, uTileLength, uEdge, uOrientation; varying vec2 vUv, vXZ; varying float vFade; varying vec3 vWorldFx;
  ${FLIPBOOK_GLSL}
  ${FX_DEPTH_GLSL}
  uniform sampler2D tFoamTex; uniform float uFoamTexGain, uFoamTexTile;
  float foamTexMod(vec2 xz){ float t = texture2D(tFoamTex, xz / max(uFoamTexTile, 1e-3)).r; return mix(1.0, smoothstep(0.1, 0.7, t), uFoamTexGain); }   // the look's whitecap pattern, world-tiled
  void main(){ if (vFade <= 0.002 || fxHidden(vWorldFx)) discard;
    vec2 uv = uOrientation > 0.5 ? vec2(vUv.y, fract(vUv.x / uTileLength)) : vec2(fract(vUv.x / uTileLength), vUv.y);
    vec4 c = sampleFlipbook(uv, uFrame);
    float lateral = smoothstep(0.0, uEdge, vUv.y) * smoothstep(0.0, uEdge, 1.0 - vUv.y);
    float alpha = c.a * lateral * vFade * foamTexMod(vXZ); if (alpha < 0.004) discard;
    gl_FragColor = vec4(fxFog(c.rgb, vWorldFx), alpha);
    #include <colorspace_fragment>
  }`;

// Injection pass: the same ribbon drawn straight into the foam field's uv space (uv = (xz - centre) / (2 half) + 0.5), coverage
// out, blended as foam' = 1 - (1 - foam) (1 - coverage) via OneMinusDstColor / One.
const INJECT_VERT = /* glsl */`attribute vec2 aCenter, aRight; attribute float aSide, aDist, aTime, aIntensity; uniform float uTime, uWidth, uSpread, uLife; uniform vec2 uSimCenter; uniform float uSimHalf; varying vec2 vUv, vXZ; varying float vFade;
  void main(){ float age = uTime - aTime; float width = aTime < -1e8 ? 0.0 : uWidth + uSpread * age;
    vFade = aTime < -1e8 ? 0.0 : (1.0 - smoothstep(0.4 * uLife, uLife, age)) * aIntensity;
    vec2 xz = aCenter + aRight * (aSide * 0.5 * width); vUv = vec2(aDist, aSide * 0.5 + 0.5); vXZ = xz;
    gl_Position = vec4((xz - uSimCenter) / uSimHalf, 0.0, 1.0); }`;
const injectFragment = FLIPBOOK_GLSL => /* glsl */`uniform float uFrame, uTileLength, uEdge, uOrientation, uInject; varying vec2 vUv, vXZ; varying float vFade;
  ${FLIPBOOK_GLSL}
  uniform sampler2D tFoamTex; uniform float uFoamTexGain, uFoamTexTile;
  float foamTexMod(vec2 xz){ float t = texture2D(tFoamTex, xz / max(uFoamTexTile, 1e-3)).r; return mix(1.0, smoothstep(0.1, 0.7, t), uFoamTexGain); }   // the look's whitecap pattern, world-tiled
  void main(){ if (vFade <= 0.002) discard;
    vec2 uv = uOrientation > 0.5 ? vec2(vUv.y, fract(vUv.x / uTileLength)) : vec2(fract(vUv.x / uTileLength), vUv.y);
    float lateral = smoothstep(0.0, uEdge, vUv.y) * smoothstep(0.0, uEdge, 1.0 - vUv.y);
    float coverage = clamp(sampleFlipbook(uv, uFrame).a * lateral * vFade * uInject * foamTexMod(vXZ), 0.0, 1.0);
    gl_FragColor = vec4(coverage, 0.0, 0.0, 1.0); }`;

export class FoamTrail {
  constructor({renderer, scene, surface, depth, sheets, skyUniforms, sunDir, foamTexture, settings = {}}) {
    this.renderer = renderer; this.scope = createTargetScope(renderer); this.sheets = sheets;
    this.s = { ...TRAIL_DEFAULTS, ...settings }; this.count = 0; this.time = 0; this.dist = 0;
    const n = MAX_NODES * 2; this.center = new Float32Array(n * 2); this.right = new Float32Array(n * 2); this.side = new Float32Array(n); this.distA = new Float32Array(n); this.timeA = new Float32Array(n).fill(-1e9); this.intensity = new Float32Array(n);
    for (let i = 0; i < MAX_NODES; i++) { this.side[i * 2] = -1; this.side[i * 2 + 1] = 1; }
    const g = new THREE.BufferGeometry(), idx = [];
    for (let i = 0; i < MAX_NODES - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
    g.setIndex(idx); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));   // unused, three wants one
    g.setAttribute('aCenter', new THREE.BufferAttribute(this.center, 2)); g.setAttribute('aRight', new THREE.BufferAttribute(this.right, 2)); g.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1));
    g.setAttribute('aDist', new THREE.BufferAttribute(this.distA, 1)); g.setAttribute('aTime', new THREE.BufferAttribute(this.timeA, 1)); g.setAttribute('aIntensity', new THREE.BufferAttribute(this.intensity, 1));
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...surface.uniforms, ...sheets.sheetUniforms(skyUniforms, sunDir), ...depth.uniforms, uTime: { value: 0 }, uWidth: { value: 1 }, uSpread: { value: 0 }, uLife: { value: 10 }, uLift: { value: 0.01 }, uFrame: { value: 0 }, uTileLength: { value: 8 }, uEdge: { value: 0.35 }, uOrientation: { value: 0 }, tFoamTex: { value: null }, uFoamTexGain: { value: 0.6 }, uFoamTexTile: { value: 6 } },
      vertexShader: vertex(surface.glsl), fragmentShader: fragment(sheets.FLIPBOOK_GLSL, depth.glsl) }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; scene.add(this.mesh); this.last = null; this.frame = 0;
    const mu = this.mesh.material.uniforms;
    this.injectMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, side: THREE.DoubleSide, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneMinusDstColorFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      uniforms: { ...sheets.sheetUniforms(skyUniforms, sunDir), uTime: mu.uTime, uWidth: mu.uWidth, uSpread: mu.uSpread, uLife: mu.uLife, uFrame: mu.uFrame, uTileLength: mu.uTileLength, uEdge: mu.uEdge, uOrientation: mu.uOrientation,
        uSimCenter: { value: new THREE.Vector2() }, uSimHalf: { value: 32 }, uInject: { value: 1 }, tFoamTex: mu.tFoamTex, uFoamTexGain: mu.uFoamTexGain, uFoamTexTile: mu.uFoamTexTile }, vertexShader: INJECT_VERT, fragmentShader: injectFragment(sheets.FLIPBOOK_GLSL) });
    this.injectMesh = new THREE.Mesh(g, this.injectMat); this.injectMesh.frustumCulled = false; this.injectScene = new THREE.Scene(); this.injectScene.add(this.injectMesh); this.injectCamera = new THREE.Camera();
    this.setFoamTexture(foamTexture); this.applySettings();
  }
  applySettings(settings = {}) {
    const {applySheet, applyLook} = this.sheets;
    const s = Object.assign(this.s, settings), u = this.mesh.material.uniforms; applySheet(this.mesh.material, s.sheet); applyLook(this.mesh.material, s);
    applySheet(this.injectMat, s.sheet); applyLook(this.injectMat, { ...s, blend: 'alpha', opacity: 1 }); this.injectMat.blending = THREE.CustomBlending; this.injectMat.uniforms.uInject.value = s.injectStrength;
    u.uFoamTexGain.value = s.foamTexGain; u.uFoamTexTile.value = s.foamTexTile;
    u.uWidth.value = s.width; u.uSpread.value = s.spread; u.uLife.value = s.life; u.uLift.value = s.lift; u.uTileLength.value = s.tileLength; u.uEdge.value = s.edgeSoftness; u.uOrientation.value = s.orientation === 'across' ? 1 : 0;
  }
  setFoamTexture(t) { this.mesh.material.uniforms.tFoamTex.value = t; }   // the look's whitecap texture (main keeps it current)
  clear() { this.count = 0; this.dist = 0; this.timeA.fill(-1e9); this.geo.attributes.aTime.needsUpdate = true; this.last = null; }
  update(dt, boat) {
    const s = this.s; this.mesh.visible = s.on && s.display === 'ribbon'; if (!s.on) return;
    this.time += dt; this.mesh.material.uniforms.uTime.value = this.time; this.frame += dt * s.fps; this.mesh.material.uniforms.uFrame.value = this.frame;
    if (!boat?.ready) { this.last = null; return; }
    const fwd = boat.body.forward(tmpF); fwd.y = 0; fwd.normalize(); const p = boat.body.position;
    const sx = p.x - fwd.x * boat.length * s.sternOffset, sz = p.z - fwd.z * boat.length * s.sternOffset;
    if (this.last && Math.hypot(sx - this.last.x, sz - this.last.z) < s.spacing) return;
    const intensity = THREE.MathUtils.smoothstep(boat.speed, s.speedForStart, Math.max(s.speedForStart + .01, s.speedForFull));
    if (this.last) this.dist += Math.hypot(sx - this.last.x, sz - this.last.z); this.last = { x: sx, z: sz };
    if (this.count === MAX_NODES) { this.count--;   // drop the oldest: shift everything one node down
      for (const a of [this.center, this.right]) a.copyWithin(0, 4); for (const a of [this.distA, this.timeA, this.intensity]) a.copyWithin(0, 2); }
    const i = this.count++, rx = fwd.z, rz = -fwd.x;   // right = forward rotated -90 deg about Y
    for (const k of [i * 2, i * 2 + 1]) { this.center[k * 2] = sx; this.center[k * 2 + 1] = sz; this.right[k * 2] = rx; this.right[k * 2 + 1] = rz; this.distA[k] = this.dist; this.timeA[k] = this.time; this.intensity[k] = intensity; }
    if (i + 1 < MAX_NODES) for (const k of [(i + 1) * 2, (i + 1) * 2 + 1]) { this.center[k * 2] = sx; this.center[k * 2 + 1] = sz; this.timeA[k] = -1e9; }   // ghost next node on the stern: no sliver to stale data
    for (const nm of ['aCenter', 'aRight', 'aDist', 'aTime', 'aIntensity']) this.geo.attributes[nm].needsUpdate = true;
  }
  // After simWindow.update: paint this frame's ribbon coverage into the foam field (ocean foam display mode).
  inject(simWindow) {
    if (!this.s.on || this.s.display !== 'ocean foam' || !simWindow || this.count < 2) return;
    const u = this.injectMat.uniforms; u.uSimCenter.value.copy(simWindow.center); u.uSimHalf.value = simWindow.halfSize;
    const renderer = this.renderer, autoClear = renderer.autoClear;
    try { this.scope(() => { renderer.setRenderTarget(simWindow.foam.read); renderer.autoClear = false; renderer.render(this.injectScene, this.injectCamera); }); }
    finally { renderer.autoClear = autoClear; }
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mesh.material.dispose(); this.injectMat.dispose(); }
}
const tmpF = new THREE.Vector3();
