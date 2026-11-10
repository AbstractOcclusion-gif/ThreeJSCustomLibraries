import {makePool, reuploadAll} from './pool.js';
import {CLEAR_NOON_SUN} from '../../core/lighting.js';
import {createSoftDiscTexture} from './soft-disc.js';
import {createRenderScope} from '../../core/render-state.js';
// The host supplies its renderer, surface, depth, lighting and impact bindings. dropletUrl is optional: without it the
// droplet sprite is a generated soft disc.
export function createOceanSplash({THREE, renderer, FX_DEPTH_GLSL, FX_DEPTH_U, fxScene, SURFACE_HEIGHT_GLSL, surfaceHeightUniforms, SHEETS, loadSheet, dropletUrl = null, loadTexture, onDeposit = null}) {
  // particles/splash.js -- port of WebGpuWater's spray droplet path: WaterSplashEmitter.EmitSplash (burst shaping) -> the
  // SpawnBurst / Update kernels of WaterFoamParticles.compute (KIND_SPRAY ballistic droplets; on landing DepositFrom turns them into
  // surface foam, which Unity also rasterises into the foam density the water shader draws -- here the landing is stamped straight
  // into the sim window's foam field, so deposited foam IS ocean foam and the sprite dies) -> FoamParticles.shader (camera-facing quad stretched along velocity, Droplet sprite, erosion dissolve, foam
  // lighting). The boat demo never shows the Shuriken crown / jets (continuousCrownTriggerStrength = 1), so only droplets are ported.
  // Divergence: CPU-integrated instanced quads (like the aquarium's pool), y stored as height ABOVE the local surface (as the
  // compute does) and re-based on the drawn surface in the vertex shader, no scene-depth soft fade, no exclusion attenuation.

  // WaterSplashEmitter (Water Splash FX prefab) + WaterFoamParticles ("15. Boat demo" scene) serialized values.
  // Unity's numbers are for a close camera (2 cm droplets); from the chase cam spray reads as BIG soft sprites that grow and fade
  // (Boat Attack-style), so the look knobs below default to that: 12 cm sprites growing x2.5 over life, mist frames, alpha blend.
  const SPLASH_DEFAULTS = Object.freeze({ maxParticlesPerBurst: 24, upwardBias: 1, outwardSpread: 1.3, dropletSize: 0.12, sizeGrowth: 1.5, lifetimeMin: 0.7, lifetimeMax: 1.4, dropletOpacity: 1,
    gravity: 3, drag: 2, depositRadius: 0.35, depositStrength: 0.5, velocityStretch: 1.5, opacity: 0.85, sprite: 'mist (8x8)', blend: 'alpha' });
  const SPRITE_CHOICES = ['droplet', 'mist (8x8)', 'splashes (8x8)', 'circle swell (6x6)'];
  const S = { ...SPLASH_DEFAULTS };
  function setSplashSettings(settings) { Object.assign(S, settings); const u = mesh.material.uniforms, m = mesh.material; u.uVelocityStretch.value = S.velocityStretch; u.uOpacity.value = S.opacity; u.uSizeGrowth.value = S.sizeGrowth;
    const sh = SHEETS[S.sprite]; u.uSpriteMode.value = sh ? 1 : 0; if (sh) { u.tSheet.value = loadSheet(S.sprite); u.uTiles.value.set(sh.cols, sh.rows); }
    m.blending = S.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending; u.uFxAdditive = { value: S.blend === 'additive' ? 1 : 0 }; m.needsUpdate = true; }

  const DROPLET_ANISOTROPY = 4, RENDER_ORDER = 10, DEFAULT_AMBIENT = [0.35, 0.45, 0.55];   // drawn after the scene's transparent surfaces
  // WaterSplashEmitter constants
  const MIN_BURST_COUNT = 3, OUT_JITTER = [0.4, 1], UP_JITTER = [0.5, 1.2], UP_STRENGTH_FLOOR = 0.4, UP_STRENGTH_GAIN = 0.6, SPAWN_RING_RADIUS_SCALE = 0.5, SPAWN_HEIGHT = 0.01,
    MIN_OUTWARD_STRENGTH = 0.4, SIZE_JITTER = [0.6, 1.3], ALPHA_STRENGTH_FLOOR = 0.45, ALPHA_STRENGTH_GAIN = 0.55, MAX_ELEVATION = Math.PI / 2;
  // WaterFoamParticles.compute constants
  const SPRAY_LANDING_EPSILON = 0.005, SPRAY_LANDING_KEEP = 0.4, KIND_SURFACE = 0, KIND_SPRAY = 1, CAPACITY = 4096;

  const tDrop = dropletUrl ? (loadTexture ?? (url => new THREE.TextureLoader().load(url)))(dropletUrl) : createSoftDiscTexture(THREE); tDrop.anisotropy = DROPLET_ANISOTROPY;
  const LIT_U = { uSunCol: { value: new THREE.Color(...CLEAR_NOON_SUN) }, uAmb: { value: new THREE.Color(...DEFAULT_AMBIENT) }, uLight: { value: new THREE.Vector3(0, 1, 0) } };

  // ---- pool: position (x, height above local surface, z), velocity, (age, life), (size, seed, kind, opacity)
  const pos = new Float32Array(CAPACITY * 3), vel = new Float32Array(CAPACITY * 3), life = new Float32Array(CAPACITY * 2), misc = new Float32Array(CAPACITY * 4);
  const geo = new THREE.InstancedBufferGeometry(); geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)); geo.instanceCount = CAPACITY;
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3)); geo.setAttribute('iVel', new THREE.InstancedBufferAttribute(vel, 3));
  geo.setAttribute('iLife', new THREE.InstancedBufferAttribute(life, 2)); geo.setAttribute('iMisc', new THREE.InstancedBufferAttribute(misc, 4));
  const pool = makePool(CAPACITY, geo, ['iPos', 'iVel', 'iLife', 'iMisc']);
  let alive = 0, aliveSpray = 0;

  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...LIT_U, ...surfaceHeightUniforms(), ...FX_DEPTH_U, tDrop: { value: tDrop }, tSheet: { value: null }, uTiles: { value: new THREE.Vector2(8, 8) }, uSpriteMode: { value: 0 }, uSizeGrowth: { value: S.sizeGrowth }, uVelocityStretch: { value: S.velocityStretch }, uOpacity: { value: S.opacity }, uTint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: /* glsl */`attribute vec3 iPos, iVel; attribute vec2 iLife; attribute vec4 iMisc; uniform float uVelocityStretch, uSizeGrowth; uniform vec3 uSunCol, uAmb, uLight, uTint;
      varying vec2 vUv; varying float vEnv, vOpacity, vSeed; varying vec3 vLit, vWorldFx;
      ${SURFACE_HEIGHT_GLSL}
      const float STRETCH_MIN_SPEED = 0.02, STRETCH_MAX = 4.0, SPRAY_IDLE_STRETCH = 1.3, SURFACE_LIFT = 0.004, TWO_PI = 6.2831853;
      float envelope(float age, float lifeS){ float fadeIn = clamp(age / max(min(0.25, lifeS * 0.15), 1e-4), 0.0, 1.0);   // FoamParticleEnvelope
        return fadeIn * (1.0 - smoothstep(lifeS * 0.55, lifeS, age)); }
      void main(){ vUv = position.xy + 0.5; float age = iLife.x, lifeS = iLife.y;
        if (lifeS <= 0.0 || age >= lifeS) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vEnv = 0.0; return; }
        vEnv = envelope(age, lifeS); vOpacity = iMisc.w; float seed = iMisc.y; vSeed = seed; bool spray = iMisc.z > 0.5;
        float size = iMisc.x * (spray ? 1.0 + uSizeGrowth * age / lifeS : 1.0);                                                   // soft sprites swell as they fly
        vec2 xz = iPos.xz; float h = surfaceHeightAt(xz);
        vec3 center = vec3(xz.x, h + iPos.y + (spray ? 0.0 : SURFACE_LIFT), xz.y);
        vec3 axisX, axisY; float stretch = 1.0;
        if (spray) { vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float speed = length(iVel); vec2 vS = vec2(dot(iVel, camRight), dot(iVel, camUp)); float vLen = length(vS); vec2 d;
          if (speed > STRETCH_MIN_SPEED && vLen > 1e-4) { d = vS / vLen; stretch = max(1.0 + min(STRETCH_MAX, speed * uVelocityStretch), SPRAY_IDLE_STRETCH); }
          else { float yaw = seed * TWO_PI; d = vec2(cos(yaw), sin(yaw)); stretch = SPRAY_IDLE_STRETCH; }
          axisX = camRight * d.x + camUp * d.y; axisY = camRight * (-d.y) + camUp * d.x; }
        else { float yaw = seed * TWO_PI; axisX = vec3(cos(yaw), 0.0, sin(yaw)); axisY = vec3(-sin(yaw), 0.0, cos(yaw)); }
        vec3 wp = center + axisX * (position.x * size * stretch) + axisY * (position.y * size);
        float wrapped = clamp(dot(vec3(0.0, 1.0, 0.0), normalize(uLight + 1e-5)) * 0.6 + 0.4, 0.0, 1.0);                      // FoamWrappedDiffuse, surface normal ~ up
        vLit = uTint * (uAmb + uSunCol * wrapped);   // shared ambient follows weather / daylight
        vWorldFx = wp; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
    fragmentShader: /* glsl */`uniform sampler2D tDrop, tSheet; uniform vec2 uTiles; uniform float uOpacity, uSpriteMode; varying vec2 vUv; varying float vEnv, vOpacity, vSeed; varying vec3 vLit, vWorldFx;
      ${FX_DEPTH_GLSL}
      const float EROSION_SOFTNESS = 0.35;
      void main(){ if (vEnv <= 0.0 || fxHidden(vWorldFx)) discard;
        vec4 sprite;
        if (uSpriteMode > 0.5) { float f = floor(vSeed * uTiles.x * uTiles.y); vec2 fuv = (vec2(mod(f, uTiles.x), floor(f / uTiles.x)) + clamp(vec2(vUv.x, 1.0 - vUv.y), 0.002, 0.998)) / uTiles;   // one random frame of the sheet
          vec3 c = texture2D(tSheet, fuv).rgb; sprite = vec4(1.0, 1.0, 1.0, pow(dot(c, vec3(0.3, 0.55, 0.15)), 0.4545)); }
        else sprite = texture2D(tDrop, vUv, -1.5);
        float alpha = sprite.a * clamp((sprite.a - (1.0 - vEnv)) / EROSION_SOFTNESS, 0.0, 1.0) * vEnv * vOpacity * uOpacity;   // FoamErosionLace * envelope * opacity
        alpha *= fxNearFade(vWorldFx);
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(fxFog(vLit * sprite.rgb, vWorldFx), alpha);
        #include <colorspace_fragment>
      }` }));
  mesh.frustumCulled = false; mesh.renderOrder = RENDER_ORDER; fxScene.add(mesh);

  const rnd = (a, b) => a + Math.random() * (b - a);
  // WaterFoamParticles.compute Elevate: lift the whole burst in its vertical plane.
  function elevate(dx, dz, outSpeed, upSpeed, elevation, out) {
    if (Math.abs(elevation) < 1e-5) return out.set(dx * outSpeed, upSpeed, dz * outSpeed);
    const speed = Math.hypot(outSpeed, upSpeed), e = THREE.MathUtils.clamp(Math.atan2(upSpeed, outSpeed) + elevation, 0, MAX_ELEVATION), hor = Math.cos(e) * speed;
    return out.set(dx * hor, Math.sin(e) * speed, dz * hor);
  }
  const tmpV = new THREE.Vector3();
  // WaterSplashEmitter.EmitSplash contract: strength 0..1, radius (m), amount scale, petal direction (null = full ring) / arc /
  // elevation; allowCrown is accepted and ignored (no crown layer in this port).
  function emitSplash(x, surfaceY, z, strength, radius, amountScale = 1, petal = null, arcDegrees = 360, elevationDegrees = 0, allowCrown = true, appearance = null) {
    strength = THREE.MathUtils.clamp(strength, 0, 1); if (amountScale <= 0) return;
    let count = THREE.MathUtils.clamp(Math.round(strength * S.maxParticlesPerBurst), MIN_BURST_COUNT, S.maxParticlesPerBurst); count = Math.max(1, Math.round(count * amountScale));
    const sizeScale = appearance?.size ?? 1, heightScale = appearance?.height ?? 1;
    const upSpeed = S.upwardBias * heightScale * (UP_STRENGTH_FLOOR + UP_STRENGTH_GAIN * strength), outSpeed = radius * S.outwardSpread * Math.max(MIN_OUTWARD_STRENGTH, strength);
    const petalAngle = petal && petal.x * petal.x + petal.z * petal.z >= 1e-8 ? Math.atan2(petal.z, petal.x) : null, arcHalf = 0.5 * THREE.MathUtils.degToRad(arcDegrees), elevation = THREE.MathUtils.degToRad(elevationDegrees);
    const opacity = THREE.MathUtils.clamp((ALPHA_STRENGTH_FLOOR + ALPHA_STRENGTH_GAIN * strength) * S.dropletOpacity, 0, 1);
    if (splashHook) splashHook(x, surfaceY, z, strength, radius, sizeScale);
    for (let i = 0; i < count; i++) {
      const r0 = Math.random(), r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
      const angle = petalAngle === null ? r0 * Math.PI * 2 : petalAngle + (r0 * 2 - 1) * arcHalf, dx = Math.cos(angle), dz = Math.sin(angle), ring = radius * SPAWN_RING_RADIUS_SCALE * r1;
      const k = pool.alloc(), k3 = k * 3, k4 = k * 4;
      pos[k3] = x + dx * ring; pos[k3 + 1] = SPAWN_HEIGHT; pos[k3 + 2] = z + dz * ring;
      elevate(dx, dz, outSpeed * THREE.MathUtils.lerp(OUT_JITTER[0], OUT_JITTER[1], r2), upSpeed * THREE.MathUtils.lerp(UP_JITTER[0], UP_JITTER[1], r3), elevation, tmpV);
      vel[k3] = tmpV.x; vel[k3 + 1] = tmpV.y; vel[k3 + 2] = tmpV.z;
      life[k * 2] = 0; life[k * 2 + 1] = THREE.MathUtils.lerp(S.lifetimeMin, S.lifetimeMax, r1);
      misc[k4] = S.dropletSize * sizeScale * THREE.MathUtils.lerp(SIZE_JITTER[0], SIZE_JITTER[1], r2); misc[k4 + 1] = r0; misc[k4 + 2] = KIND_SPRAY; misc[k4 + 3] = opacity;
    }
  }
  let splashHook = null;
  function setSplashHook(fn) { splashHook = fn; }   // (x, surfaceY, z, strength, radius) per burst: the sheet billboards listen here
  function initSplash(skyUniforms, ambientColor, sunDir) { LIT_U.uSunCol.value = skyUniforms.uSunCol.value; LIT_U.uAmb.value = skyUniforms.uFxAmbient.value; LIT_U.uLight.value = sunDir; }
  function setSplashAmplitude(a) { mesh.material.uniforms.uOceanAmplitude.value = a; }
  // Update kernel, KIND_SPRAY branch: gravity, integrate, land -> deposit stamp (see depositFoam) and die.
  function updateSplash(dt) {
    if (!pool.any) return; pool.begin(); alive = 0; aliveSpray = 0;
    for (let k = 0; k < CAPACITY; k++) {
      const k2 = k * 2; if (life[k2 + 1] <= 0) continue;
      life[k2] += dt; if (life[k2] >= life[k2 + 1]) { life[k2 + 1] = 0; pool.mark(k); continue; }
      const k3 = k * 3, k4 = k * 4;
      if (misc[k4 + 2] > 0.5) {
        vel[k3 + 1] -= S.gravity * dt; pos[k3] += vel[k3] * dt; pos[k3 + 1] += vel[k3 + 1] * dt; pos[k3 + 2] += vel[k3 + 2] * dt;
        if (pos[k3 + 1] <= SPRAY_LANDING_EPSILON && vel[k3 + 1] < 0) {   // landed: DepositFrom -> one foam stamp, sprite over
          if (landedCount < MAX_LANDED) { landed[landedCount * 3] = pos[k3]; landed[landedCount * 3 + 1] = pos[k3 + 2]; landed[landedCount * 3 + 2] = misc[k4 + 3]; landedCount++; }
          life[k2 + 1] = 0; pool.mark(k); continue; }
        aliveSpray++;
      }
      alive++; pool.mark(k);
    }
    pool.end();
  }
  function splashStats() { return { droplets: aliveSpray, landed: landedTotal }; }

  // ---- deposited foam: this frame's landings stamped into the sim window's foam field (uv = (xz - centre) / (2 half) + 0.5),
  // one Points draw, saturating blend foam' = 1 - (1 - foam)(1 - strength * disc). Call after simWindow.update.
  const MAX_LANDED = 1024; const landed = new Float32Array(MAX_LANDED * 3); let landedCount = 0, landedTotal = 0;   // x, z, opacity
  const landGeo = new THREE.BufferGeometry(); landGeo.setAttribute('position', new THREE.BufferAttribute(landed, 3)); landGeo.setDrawRange(0, 0);
  const landMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneMinusDstColorFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    uniforms: { uSimCenter: { value: new THREE.Vector2() }, uSimHalf: { value: 32 }, uRadiusPx: { value: 2 }, uStrength: { value: 0.5 } },
    vertexShader: /* glsl */`uniform vec2 uSimCenter; uniform float uSimHalf, uRadiusPx; varying float vOpacity;
      void main(){ vOpacity = position.z; gl_Position = vec4((position.xy - uSimCenter) / uSimHalf, 0.0, 1.0); gl_PointSize = 2.0 * uRadiusPx; }`,
    fragmentShader: /* glsl */`uniform float uStrength; varying float vOpacity;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float disc = 1.0 - smoothstep(0.3, 1.0, d); if (disc <= 0.0) discard;
        gl_FragColor = vec4(clamp(uStrength * vOpacity * disc, 0.0, 1.0), 0.0, 0.0, 1.0); }` });
  const landScene = new THREE.Scene(), landCam = new THREE.Camera(); const landPoints = new THREE.Points(landGeo, landMat); landPoints.frustumCulled = false; landScene.add(landPoints);
  const depositScope = createRenderScope(renderer, {clearColor: false, scissorOff: false});
  function depositFoam(simWindow) {
    if (!landedCount) return; landedTotal += landedCount;
    if (onDeposit) for (let i = 0; i < landedCount; i++) onDeposit(landed[i * 3], landed[i * 3 + 1], S.depositRadius, landed[i * 3 + 2] * S.depositStrength);
    if (simWindow) { const u = landMat.uniforms; u.uSimCenter.value.copy(simWindow.center); u.uSimHalf.value = simWindow.halfSize; u.uRadiusPx.value = Math.max(1, S.depositRadius / simWindow.texelMeters); u.uStrength.value = S.depositStrength;
      landGeo.attributes.position.needsUpdate = true; landGeo.setDrawRange(0, landedCount);
      const autoClear = renderer.autoClear;
      depositScope(() => { try {
        renderer.setRenderTarget(simWindow.foam.read);
        renderer.autoClear = false;
        renderer.render(landScene, landCam);
      } finally {
        renderer.autoClear = autoClear;
      } }); }
    landedCount = 0;
  }

  function clear() { life.fill(0); landedCount = 0; alive = 0; aliveSpray = 0; reuploadAll(geo); pool.any = false; }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    fxScene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
    tDrop.dispose(); landGeo.dispose(); landMat.dispose();
  }

  return {SPLASH_DEFAULTS, SPRITE_CHOICES, setSplashSettings, emitSplash, setSplashHook, initSplash, setSplashAmplitude, updateSplash, splashStats, depositFoam, mesh, clear, dispose};
}
