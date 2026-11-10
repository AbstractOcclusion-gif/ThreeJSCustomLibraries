// ocean/obstacle.js -- port of WebGpuWater's WaterObstacle.cs + ObstacleDepth.shader: the submerged hull FOOTPRINT rendered
// top-down over the sim window (per column: max(0, waterline - worldY) x displaceScale, additive, both faces -> submerged
// thickness in metres), supersampled then box-filtered, temporally smoothed (ObstacleSmooth), kept as consecutive-frame
// prev / curr maps. The window injects the frame-to-frame delta (Obstacle kernel) and treats cells of the SOLID map above a
// threshold as reflectors (Update kernel) -- "FootprintDelta" interaction: shaped wakes, water held in the hull's shape.
// The maps are world-anchored to the window frame and are NOT scrolled with it (as Unity), so a hull that stays centred in a
// following window still shows its true motion as a delta. Map V is flipped relative to the sim (Unity obstacleFlipY = true).
import * as THREE from 'three';
import { QV, createPass, createTargetScope } from './passes.js';

const SUPERSAMPLE = 2;                                   // Unity renders 4x then box-filters twice; 2x + one 2x2 box keeps phones happy
const EYE_HEIGHT_IN_EXTENTS = 2, FAR_PLANE_IN_EXTENTS = 4, ORTHO_NEAR = 0.01, ORTHO_FAR_PAD = 0.02;
const VERTICAL_EXTENT_METERS = 10;                       // the frame's half height: hulls heave a few metres at most
// Unity defaults (Settings.Interaction.cs) with the "15. Boat demo" scene's strength; solid threshold / rest dip from WaterVolume.Solver.cs.
export const OBSTACLE_DEFAULTS = Object.freeze({ obstacleStrength: 0.05, obstacleDeadband: 0.0006, obstacleSmoothing: 0.65, solidThreshold: 0.02, restDip: 0, reflectsWaves: true });

export const createObstacleUniforms = () => ({tObstaclePrev: {value: null}, tObstacleCurr: {value: null},
 tObstacleSolid: {value: null}, uObstacleOn: {value: 0}, uSolidOn: {value: 0}});

const footprintMaterial = () => new THREE.ShaderMaterial({ uniforms: { uWaterline: { value: 0 }, uDisplaceScale: { value: 1 } },
  side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  vertexShader: `varying float vWorldY; void main(){ vWorldY = (modelMatrix * vec4(position, 1.0)).y; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uWaterline, uDisplaceScale; varying float vWorldY; void main(){ gl_FragColor = vec4(max(0.0, uWaterline - vWorldY) * uDisplaceScale, 0.0, 0.0, 0.0); }` });
const floatRT = (n) => new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });

export class ObstacleFootprint {
  constructor(renderer, resolution) {
    this.renderer = renderer;
    this.pass = createPass(renderer);
    this.scope = createTargetScope(renderer);
    this.uniforms = createObstacleUniforms();
    this.resolution = resolution; this.scene = new THREE.Scene(); this.objects = [];
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, ORTHO_NEAR, FAR_PLANE_IN_EXTENTS * VERTICAL_EXTENT_METERS + ORTHO_FAR_PAD);
    this.camera.up.set(0, 0, -1);                        // looking down -Y: screen x = +world x, screen y = -world z (Unity's flipped V)
    this.hi = floatRT(resolution * SUPERSAMPLE); this.raw = floatRT(resolution); this.prev = floatRT(resolution); this.curr = floatRT(resolution); this.solid = floatRT(resolution);
    const TEXEL = 1 / (resolution * SUPERSAMPLE);
    this.downMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2(TEXEL, TEXEL) } },
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv; void main(){ vec2 h = uTexel * 0.5;
        gl_FragColor = (texture2D(tSrc, vUv + vec2(-h.x, -h.y)) + texture2D(tSrc, vUv + vec2(h.x, -h.y)) + texture2D(tSrc, vUv + vec2(-h.x, h.y)) + texture2D(tSrc, vUv + vec2(h.x, h.y))) * 0.25; }` });
    this.smoothMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tPrev: { value: null }, tRaw: { value: null }, uBlend: { value: 0.35 } },
      fragmentShader: `uniform sampler2D tPrev, tRaw; uniform float uBlend; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(tPrev, vUv), texture2D(tRaw, vUv), uBlend); }` });
    this.s = { ...OBSTACLE_DEFAULTS }; this.primed = false;
  }
  applySettings(settings) { this.s = { ...this.s, ...settings }; }
  // geometry + the Object3D whose world matrix it follows; waterline(): the water height under it this frame (metres)
  add(geometry, follow, waterline, { displaceScale = 1 } = {}) {
    const mesh = new THREE.Mesh(geometry, footprintMaterial()); mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    const entry = {mesh, follow, waterline, displaceScale};
    this.scene.add(mesh); this.objects.push(entry);
    return () => {
      const index = this.objects.indexOf(entry);
      if (index < 0) return;
      this.objects.splice(index, 1);
      this.scene.remove(mesh);
      mesh.material.dispose();
    };
  }
  setFrame(centerX, centerZ, halfSize) {
    const c = this.camera; c.left = -halfSize; c.right = halfSize; c.top = halfSize; c.bottom = -halfSize; c.updateProjectionMatrix();
    c.position.set(centerX, EYE_HEIGHT_IN_EXTENTS * VERTICAL_EXTENT_METERS, centerZ); c.lookAt(centerX, 0, centerZ); c.updateMatrixWorld(true);
  }
  // Per frame, after the window tracked: render this frame's footprint (and the solid mask), then prev <- curr, curr <- smoothed.
  render(centerX, centerZ, halfSize) {
    this.scope(() => this.renderFootprints(centerX, centerZ, halfSize));
  }
  renderFootprints(centerX, centerZ, halfSize) {
    const renderer = this.renderer, pass = this.pass.render, OBSTACLE_U = this.uniforms;
    this.setFrame(centerX, centerZ, halfSize);
    let any = false;
    for (const o of this.objects) { const w = o.waterline(); o.mesh.visible = w !== undefined; if (!o.mesh.visible) continue; any = true;
      o.follow.updateWorldMatrix(true, false); o.mesh.matrix.copy(o.follow.matrixWorld); o.mesh.material.uniforms.uWaterline.value = w; o.mesh.material.uniforms.uDisplaceScale.value = o.displaceScale; }
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.hi); renderer.clear(); if (any) renderer.render(this.scene, this.camera);
    this.downMat.uniforms.tSrc.value = this.hi.texture; pass(this.downMat, this.raw);
    [this.prev, this.curr] = [this.curr, this.prev];
    if (!this.primed) { pass(this.downMat, this.prev); pass(this.downMat, this.curr); this.primed = true; }   // first frame: no delta
    else { this.smoothMat.uniforms.tPrev.value = this.prev.texture; this.smoothMat.uniforms.tRaw.value = this.raw.texture; this.smoothMat.uniforms.uBlend.value = 1 - this.s.obstacleSmoothing; pass(this.smoothMat, this.curr); }
    // solid mask: the same footprint, flagged objects only (here: all of them, gated by reflectsWaves)
    if (this.s.reflectsWaves) { renderer.setRenderTarget(this.solid); renderer.clear(); if (any) renderer.render(this.scene, this.camera); }
    OBSTACLE_U.tObstaclePrev.value = this.prev.texture; OBSTACLE_U.tObstacleCurr.value = this.curr.texture; OBSTACLE_U.tObstacleSolid.value = this.solid.texture;
    OBSTACLE_U.uObstacleOn.value = any ? 1 : 0; OBSTACLE_U.uSolidOn.value = any && this.s.reflectsWaves ? 1 : 0;
  }
  dispose() {
    this.uniforms.uObstacleOn.value = this.uniforms.uSolidOn.value = 0;
    for (const t of [this.hi, this.raw, this.prev, this.curr, this.solid]) t.dispose();
    this.downMat.dispose(); this.smoothMat.dispose(); this.pass.dispose();
    for (const o of this.objects) o.mesh.material.dispose();
    this.objects.length = 0;
    this.scene.clear();
  }
}
