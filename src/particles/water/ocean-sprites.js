import {makePool, reuploadAll} from './pool.js';
import {BILLOW_GLSL} from '../billow-glsl.js';
// The host supplies its renderer, surface, depth, lighting and impact bindings.
const RENDER_ORDER = 11;   // over the splash droplets (10)
export function createOceanSprites({THREE, FX_DEPTH_GLSL, FX_DEPTH_U, fxScene, SURFACE_HEIGHT_GLSL, surfaceHeightUniforms, FLIPBOOK_GLSL, applyLook, applySheet, sheetUniforms}) {
  // particles/sheet-sprites.js -- upright flipbook billboards standing on the drawn surface, facing the camera: splash / mist
  // frames fired where the spray pump sprays (emitSplash hook), later the blowhole jet. One-shot flipbook over the sprite's life
  // (or looping at fps), growth and fade with age. Free mode (settings.free): the sprite keeps the y it was spawned at, rises at
  // `rise` m/s facing the camera with a random spin, and fades out under the surface -- the cetacean's underwater bubbles; with
  // `upright` it stands on that point instead (no spin, no surface fade) -- the blow, moved along with the blowhole by move().

  const BILLBOARD_DEFAULTS = Object.freeze({ on: true, sheet: 'splashes (8x8)', blend: 'alpha', color: 'foam', oneShot: true, fps: 30, size: 1.4, sizeJitter: 0.4, growth: 0.5, life: 0.7, lift: 0,
    maskLow: 0.08, maskHigh: 0.6, opacity: 0.9, chance: 0.6, minStrength: 0.2, free: false, rise: 0, upright: false, billow: false });
  const MAX = 512;

  const instances = new Set();
  class SheetSprites {
    constructor(skyUniforms, sunDir, settings = {}) {
      instances.add(this);
      this.s = { ...BILLBOARD_DEFAULTS, ...settings }; this.time = 0; this.spawned = 0;
      this.pos = new Float32Array(MAX * 3); this.data = new Float32Array(MAX * 4).fill(-1e9); this.misc = new Float32Array(MAX * 2);   // data: birth, life, size, rotation; misc: intensity, seed
      const g = new THREE.InstancedBufferGeometry(); g.setIndex([0, 1, 2, 0, 2, 3]);
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)); g.instanceCount = MAX;
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3)); g.setAttribute('iData', new THREE.InstancedBufferAttribute(this.data, 4)); g.setAttribute('iMisc', new THREE.InstancedBufferAttribute(this.misc, 2));
      this.geo = g; this.pool = makePool(MAX, g, ['iPos', 'iData', 'iMisc']);
      this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { ...surfaceHeightUniforms(), ...sheetUniforms(skyUniforms, sunDir), ...FX_DEPTH_U, uTime: { value: 0 }, uGrowth: { value: 1 }, uLift: { value: 0 }, uFps: { value: 24 }, uOneShot: { value: 1 }, uFree: { value: 0 }, uRise: { value: 0 }, uUpright: { value: 0 }, uBillow: { value: 0 } },
        vertexShader: /* glsl */`attribute vec3 iPos; attribute vec4 iData; attribute vec2 iMisc; uniform float uTime, uGrowth, uLift, uFps, uOneShot, uFree, uRise, uUpright, uBillow; uniform vec2 uTiles; varying vec2 vUv; varying float vFrame, vFade, vBillowPhase; varying vec3 vWorldFx;
          ${SURFACE_HEIGHT_GLSL}
          void main(){ vUv = uv; float age = uTime - iData.x, lifeS = iData.y;
            if (iData.x < -1e8 || age >= lifeS) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vFade = 0.0; return; }
            float t = age / lifeS; vFade = iMisc.x * (uOneShot > 0.5 ? 1.0 : (1.0 - smoothstep(0.5, 1.0, t))) * smoothstep(0.0, 0.08, t);
            vFrame = uOneShot > 0.5 ? t * (uTiles.x * uTiles.y - uBillow) : age * uFps + iMisc.y * 37.0;
            vBillowPhase = iMisc.y * 24.0 + t * 1.5;
            if (uBillow > 0.5) vFade *= smoothstep(0.0, 0.22, t) * (1.0 - smoothstep(0.35, 1.0, t));
            float size = iData.z * (1.0 + uGrowth * t); float hs = surfaceHeightAt(iPos.xz); vec3 c = vec3(iPos.x, hs + uLift, iPos.z);
            vec3 ax = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0])), ay = vec3(0.0, 1.0, 0.0);
            if (uFree > 0.5 && uUpright > 0.5) { c.y = iPos.y + uRise * age + size * 0.45; }
            else if (uFree > 0.5) { c.y = iPos.y + uRise * age; c.x += sin(age * 2.5 + iMisc.y * 9.0) * size * 0.15; float sp = iMisc.y * 6.2831853 + age * 0.4;
              vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
              ax = cr * cos(sp) + cu * sin(sp); ay = cu * cos(sp) - cr * sin(sp); vFade *= 1.0 - smoothstep(hs - size, hs - size * 0.2, c.y); }
            else c.y += size * 0.45;
            vec3 w = c + ax * (position.x * size) + ay * (position.y * size); vWorldFx = w; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
        fragmentShader: /* glsl */`uniform float uBillow; varying vec2 vUv; varying float vFrame, vFade, vBillowPhase; varying vec3 vWorldFx;
          ${FLIPBOOK_GLSL}
          ${FX_DEPTH_GLSL}
          ${BILLOW_GLSL}
          void main(){ if (vFade <= 0.002 || fxHidden(vWorldFx)) discard;
            vec2 uv = vUv;
            float density = 1.0;
            if (uBillow > 0.5) density = particleBillow(uv, vBillowPhase);
            vec4 c = sampleFlipbook(uv, vFrame);
            float alpha = c.a * density * vFade * fxNearFade(vWorldFx); if (alpha < 0.004) discard;
            gl_FragColor = vec4(fxFog(c.rgb, vWorldFx), alpha);
            #include <colorspace_fragment>
          }` }));
      this.mesh.frustumCulled = false; this.mesh.renderOrder = RENDER_ORDER; fxScene.add(this.mesh);
      this.applySettings();
    }
    applySettings(settings = {}) { const s = Object.assign(this.s, settings), u = this.mesh.material.uniforms; applySheet(this.mesh.material, s.sheet); applyLook(this.mesh.material, s);
      u.uGrowth.value = s.growth; u.uLift.value = s.lift; u.uFps.value = s.fps; u.uOneShot.value = s.oneShot ? 1 : 0; u.uFree.value = s.free ? 1 : 0; u.uRise.value = s.rise; u.uUpright.value = s.upright ? 1 : 0; u.uBillow.value = s.billow ? 1 : 0; }
    setAmplitude(a) { this.mesh.material.uniforms.uOceanAmplitude.value = a; }
    spawn(x, z, intensity = 1, sizeScale = 1, y = 0) {   // y: free mode only (surface-based sprites ignore it)
      const s = this.s, k = this.pool.alloc(), size = s.size * sizeScale * (1 + (Math.random() * 2 - 1) * s.sizeJitter);
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
      this.data[k * 4] = this.time; this.data[k * 4 + 1] = s.life; this.data[k * 4 + 2] = size; this.data[k * 4 + 3] = Math.random() * Math.PI * 2;
      this.misc[k * 2] = intensity * s.opacity; this.misc[k * 2 + 1] = Math.random(); this.spawned++;
      this.pool.mark(k); this.pool.end(); this.pool.begin();   // upload just this slot
      return k;
    }
    // Re-anchor a live sprite (free mode): the blow follows the blowhole. Its rise keeps counting from the spawn.
    move(k, x, y, z) { this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z; this.pool.mark(k); this.pool.end(); this.pool.begin(); }
    update(dt) { this.mesh.visible = this.s.on; this.time += dt; this.mesh.material.uniforms.uTime.value = this.time; }
    get active() { let count = 0; for (let k = 0; k < MAX; k++) if (this.data[k * 4] > -1e8 && this.time - this.data[k * 4] < this.data[k * 4 + 1]) count++; return count; }
    clear() { this.data.fill(-1e9); reuploadAll(this.geo); this.pool.any = false; }
    dispose() { if (this.disposed) return; this.disposed = true; instances.delete(this); fxScene.remove(this.mesh); this.geo.dispose(); this.mesh.material.dispose(); }
  }

  function dispose() { for (const instance of [...instances]) instance.dispose(); }
  return {BILLBOARD_DEFAULTS, SheetSprites, dispose};
}
