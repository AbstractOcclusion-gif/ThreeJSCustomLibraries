// What a fire looks like: flames, smoke, embers and light for one burning object.
// Flames are camera-facing sheets anchored on the fuel, one instanced draw call per fire. Their shape is a streaky
// noise field flowing upward through each sheet, so the fire stays put while its inside streams up, tears into
// tongues and sheds its tips; the whole fire sways and breathes together. Smoke and embers are particle puffs.
// The host owns the logic (createFireSystem): pass a fire object as `source`, or set `intensity` yourself.
import * as THREE from 'three';
import {NOISE_GLSL} from '../core/lighting.js';
import {createPuffs} from '../particles/puffs.js';
import {createFlameFluid} from './fluid.js';

const RENDER_ORDER = 8;   // after the scene's transparent surfaces
const MAX_CAPACITY = 1024;
const FLOATS = 4;

// Tweaks shared by every layer; 1 = as authored below. Pass one look to every fire that should match.
export function createFlameLook() {
  return {
    height: 1,        // scale on flame height
    density: 1,       // scale on how many flame sheets are alive
    brightness: 1,    // scale on the emitted light of the flames
    turbulence: 1,    // scale on how ragged the flames are and how far the fire sways
    windLean: 1,      // scale on how far the wind bends the flames
    planes: 3,        // fluid flames: 1 = one sheet facing the camera; 2 or 3 = upright sheets crossed through the fire
    smoke: 1,         // scale on how much smoke rises
    embers: 1,        // scale on how many embers fly
    light: 1,         // scale on the light the fire casts
  };
}

// Flame layers. Lengths are metres for a fire of size 1 at full intensity; pairs are [min, max].
//   perSecond  sheets started each second          life     seconds a sheet lasts (it fades in and out)
//   width      sheet width                         height   sheet height
//   rise       upward speed, m/s                   from     where in the footprint's height range it starts (0 bottom, 1 top)
//   lift       extra start height, in flame heights    heat  temperature scale: 1 burns pale at the core
//   detached   a tip torn off the fire: it flies up and shrinks instead of standing on the fuel
const LAYERS = Object.freeze([
  {name: 'bed', perSecond: 5, life: [1.3, 2.1], width: [.95, 1.35], height: [.75, 1.05], rise: [0, .04], from: [0, .7], lift: [0, 0], heat: 1, detached: false},
  {name: 'body', perSecond: 6, life: [1.0, 1.6], width: [.7, 1.05], height: [1.25, 1.75], rise: [.03, .12], from: [.35, 1], lift: [0, 0], heat: .9, detached: false},
  {name: 'lick', perSecond: 4, life: [.35, .6], width: [.3, .5], height: [.4, .65], rise: [1.5, 2.5], from: [.8, 1], lift: [.55, 1], heat: .7, detached: true},
]);
// Flames starting below this share of the height range start on the footprint's edge: the burning object fills the inside.
const SURFACE_FROM = .85;
// Intensity shapes the fire: a weak fire has fewer, shorter flames. Count follows intensity ^ count, height ^ height.
const INTENSITY = Object.freeze({count: .7, height: .6, minimum: .02});
const WIND = Object.freeze({lean: .22, full: 14});   // m of sideways travel per metre risen, reached at this wind speed (m/s)
// The whole fire moves together. Sway: metres of bend per metre of height, wandering at `rate` per second.
// Pulse: the height breathes by `depth` around `rate` times per second (larger fires puff slower in reality).
const SWAY = Object.freeze({amount: .1, rate: .9});
const PULSE = Object.freeze({depth: .13, rate: 2.3});

// Fluid flames: the heat of a small 2D fluid (fluid.js) shown on upright sheets: one that turns to face the camera,
// or up to MAX_PLANES crossed through the fire at even angles, alternate ones mirrored, so it has volume from every side.
//   widen    sheet width, in widths of the burning object: room for the flames to lean and curl
//   sink     how far below the top of the fuel the sheet starts, in metres at size 1 (the object hides that part)
//   linger   seconds the sheet stays drawn after the fire stops being fed, while the last heat rises away
//   lean     metres the wind pushes the top of a 1 m flame sideways, at full wind (WIND.full)
const FLUID = Object.freeze({widen: 2.3, sink: .08, linger: 2.5, lean: .55});
const MAX_PLANES = 3;

// Life of a fire fed by a source: it grows over the first `grow` share of its fuel, dies over the last `die` share,
// then smoulders (smoke and glow only) for `smoulder` seconds.
const CYCLE = Object.freeze({grow: .14, die: .4, smoulder: 8});

// Smoke and embers: particle puffs. Sizes in metres and speeds in m/s for a fire of size 1; pairs are [min, max].
const SMOKE = Object.freeze({
  perSecond: 5, smoulderShare: .8,             // puffs each second at full fire; share of that while smouldering
  above: [.55, 1.1],                           // start height, in flame heights above the fuel
  spread: .5, speed: [.55, 1.0], drift: .12, size: [.55, .9], life: [3.2, 5], grow: 2.6, rise: -.12,
  opacity: [.28, .2],                          // peak opacity: thick by the flames, thin once it only smoulders
  hot: 0x6e5f52, cold: 0x9a9690,               // lit from below by the flames; plain grey when they are gone
  fadeIn: .5,
});
const EMBERS = Object.freeze({
  perSecond: 5, burstEvery: [1.2, 3.5], burst: [4, 9],   // steady trickle; a crackle throws several at once
  spread: .7, speed: [1.6, 3.2], drift: .5, size: [.03, .06], life: [.7, 1.5], gravity: .5, color: 0xffa040, opacity: .9,
});
const PUFF_POOL = 64;
const PLUME_SHEET = {url: new URL('../../assets/particles/smoke-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true, billow: true};

// Light cast by the fire: a point light above the fuel. Flicker is two wandering noises (slow swell, fast shiver).
const LIGHT = Object.freeze({
  color: 0xff8a3c, intensity: 5.5, range: 6.5, decay: 2, above: .55,   // range in metres and height in flame heights, at size 1
  flicker: [[.22, 3.1], [.12, 11]],                                    // [depth, wanders per second]
  smoulder: .12,                                                       // share of the light left while only smouldering
});

function between([min, max]) { return min + Math.random() * (max - min); }
// Smooth noise in 0..1 that wanders once per unit of t.
function wander(t, seed) {
  const cell = Math.floor(t), f = t - cell, blend = f * f * (3 - 2 * f);
  const hash = n => { const s = Math.sin((n + seed) * 127.1) * 43758.5453; return s - Math.floor(s); };
  return hash(cell) * (1 - blend) + hash(cell + 1) * blend;
}

// scene: where the fire is added. position: the base of the burning object (held by reference, so it may move).
// footprint: [half width X, half depth Z] the flames start within; rise: [lowest, highest] start height above position.
// size scales the whole fire. environment: optional core/environment.js contract (wind bends flames, carries smoke).
// source: optional fire object from createFireSystem ({phase, fuel}); the visual then follows its life by itself.
export function createFireVisual(scene, {position, footprint = [.3, .3], rise = [0, .3], size = 1, capacity = 96, environment = null, look = createFlameLook(), source = null, renderer = null, loadTexture} = {}) {
  if (!scene?.isObject3D) throw Error('Fire visual needs a scene or group');
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) throw Error('Fire visual needs a finite position');
  if (![...footprint, ...rise, size].every(Number.isFinite) || footprint.some(value => value < 0) || rise[1] < rise[0] || size <= 0) {
    throw Error('Fire visual needs a non-negative footprint, an ordered rise range and a positive size');
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) throw Error(`Fire visual capacity must be 1..${MAX_CAPACITY}`);
  // fluid: draw the flames with the fluid sim instead of the sheets. Needs the `renderer` option.
  const show = {flames: true, fluid: Boolean(renderer), smoke: true, embers: true, light: true};
  const seed = Math.random() * 100;

  // Per sheet: where and when it starts, how it moves, how it is shaped. Written once at birth; the shader does the rest.
  const start = new Float32Array(capacity * FLOATS);    // x, y, z, birth time
  const motion = new Float32Array(capacity * FLOATS);   // rise speed, life, seed, heat
  const shape = new Float32Array(capacity * FLOATS);    // width, height, detached, unused
  start.fill(-Infinity);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0], 3));
  const attributes = {
    iStart: new THREE.InstancedBufferAttribute(start, FLOATS),
    iMotion: new THREE.InstancedBufferAttribute(motion, FLOATS),
    iShape: new THREE.InstancedBufferAttribute(shape, FLOATS),
  };
  for (const [name, attribute] of Object.entries(attributes)) {
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  const uniforms = {
    uTime: {value: 0}, uWind: {value: new THREE.Vector2()}, uSway: {value: new THREE.Vector2()}, uPulse: {value: 1},
    uBrightness: {value: look.brightness}, uTurbulence: {value: look.turbulence},
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    // Premultiplied: the glow adds to what is behind it, while the alpha still hides a little of it.
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      attribute vec4 iStart, iMotion, iShape;
      uniform float uTime, uPulse;
      uniform vec2 uWind, uSway;
      varying vec2 vUv;
      varying vec4 vFlame;   // age 0..1, seed, heat, detached
      void main() {
        float age = (uTime - iStart.w) / iMotion.y;
        if (age < 0.0 || age >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        float detached = iShape.z;
        const float tipShrink = .55;   // size a torn-off tip loses while it flies
        // A standing sheet breathes with the fire; a detached tip only shrinks.
        float scale = mix(uPulse, 1.0 - tipShrink * age, detached);
        float risen = iMotion.x * age * iMotion.y;
        float reach = risen + position.y * iShape.y * scale;
        // The fire bends from its base: more the higher it reaches, with the wind and with its own sway.
        vec2 bend = (uWind + uSway * sqrt(max(reach, 0.0))) * reach;
        vec3 world = iStart.xyz + vec3(bend.x, reach, bend.y);
        vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
        world += right * (position.x * iShape.x * mix(1.0, scale, detached));
        vUv = vec2(position.x + .5, position.y);
        vFlame = vec4(age, iMotion.z, iMotion.w, detached);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uBrightness, uTurbulence;
      varying vec2 vUv;
      varying vec4 vFlame;
      ${NOISE_GLSL}
      // Three octaves of noise, much finer across than along: streaks that run up the flame.
      float streaks(vec3 p) {
        return valueNoise(p) * .55 + valueNoise(p * vec3(2.1, 1.9, 1.7) + 7.3) * .3 + valueNoise(p * vec3(4.3, 3.6, 2.9) + 19.1) * .15;
      }
      // Black-body style ramp: dark red where it is coolest, orange, then a pale core.
      vec3 flameColor(float heat) {
        vec3 color = mix(vec3(.3, .01, 0.0), vec3(1.0, .24, .012), smoothstep(.03, .4, heat));
        color = mix(color, vec3(1.0, .58, .12), smoothstep(.34, .7, heat));
        return mix(color, vec3(1.0, .86, .5), smoothstep(.78, 1.0, heat));
      }
      void main() {
        float age = vFlame.x, seed = vFlame.y, detached = vFlame.w;
        vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
        const float flow = 2.1;          // sheet heights per second the streaks travel upward
        const vec2 grain = vec2(3.6, 1.5);    // streaks across the sheet, and along it
        float n = streaks(vec3(p.x * grain.x + seed * 13.0, p.y * grain.y - uTime * flow, seed * 5.0 + uTime * .22));
        // Fuel: plenty at the base and in the middle, running out toward the tip and the sides. The column is
        // narrower than the sheet and tapers, so the sheet's own edges never show.
        const vec2 column = vec2(.72, .3);   // half width of the column at the base and at the tip, in half sheets
        float side = abs(p.x) / mix(column.x, column.y, p.y);
        float fuel = (1.0 - p.y) * (1.0 - side * side);
        // A torn-off tip has no base: it is a ragged blob that burns out from its edge.
        vec2 blob = vec2(p.x, p.y * 2.0 - 1.0);
        fuel = mix(fuel, (1.0 - dot(blob, blob)) * (1.0 - .6 * age), detached);
        const float solid = .95;         // how firmly the base holds together
        const float ragged = 1.8;        // how far the noise eats into the flame
        // Noise matters little at the base and decides everything near the tip: tongues, holes, torn tips.
        float field = fuel * solid + (n - .5) * ragged * uTurbulence * mix(.55, 1.0, max(p.y, detached));
        float density = smoothstep(.36, .6, field) * smoothstep(0.0, .2, p.y + detached);
        float fade = smoothstep(0.0, .22, age) * (1.0 - smoothstep(.62, 1.0, age));
        float heat = smoothstep(.36, 1.35, field) * mix(1.0, .55, p.y) * vFlame.z;
        float alpha = density * fade;
        if (alpha <= .003) discard;
        const float glow = 1.3;          // light emitted at the core, before tone mapping
        const float cover = .5;          // share of the background a flame hides
        gl_FragColor = vec4(flameColor(heat) * (glow * uBrightness * alpha), alpha * cover);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = RENDER_ORDER;
  scene.add(mesh);

  const fluid = renderer ? createFlameFluid(renderer) : null;
  const half = Math.max(footprint[0], footprint[1], .05) * size;
  let fluidMesh = null, fluidUniforms = null, fluidMaterial = null, fluidGeometry = null, fed = 0;
  if (fluid) {
    fluid.setSource(Math.min(.5, 1 / FLUID.widen * .5));
    fluidUniforms = {
      tHeat: {value: null}, uBase: {value: new THREE.Vector3()}, uSize: {value: new THREE.Vector2()}, uBrightness: {value: look.brightness},
      uPlanes: {value: MAX_PLANES}, uLean: {value: new THREE.Vector2()},
    };
    // MAX_PLANES unit sheets; aPlane tells the shader which one a vertex belongs to.
    const corners = [], uvs = [], planeIndex = [], faces = [];
    for (let plane = 0; plane < MAX_PLANES; plane++) {
      corners.push(-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      planeIndex.push(plane, plane, plane, plane);
      const first = plane * 4;
      faces.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
    fluidGeometry = new THREE.BufferGeometry();
    fluidGeometry.setIndex(faces);
    fluidGeometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    fluidGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    fluidGeometry.setAttribute('aPlane', new THREE.Float32BufferAttribute(planeIndex, 1));
    fluidMaterial = new THREE.ShaderMaterial({
      uniforms: fluidUniforms, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */`
        attribute float aPlane;
        uniform vec3 uBase;
        uniform vec2 uSize, uLean;
        uniform float uPlanes;
        varying vec2 vUv;
        varying float vFacing;   // 1 seen face-on, 0 edge-on
        void main() {
          if (aPlane >= uPlanes) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          vec3 toEye = normalize(vec3(viewMatrix[0][2], 0.0, viewMatrix[2][2]));
          // One sheet turns about the vertical to face the camera; several stand crossed at even angles.
          vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          if (uPlanes > 1.5) {
            float angle = aPlane * 3.14159265 / uPlanes;
            right = vec3(cos(angle), 0.0, sin(angle));
          }
          vFacing = abs(dot(cross(right, vec3(0.0, 1.0, 0.0)), toEye));
          float height = position.y * uSize.y;
          vec3 world = uBase + right * (position.x * uSize.x) + vec3(0.0, height, 0.0);
          // The wind bends the whole fire from its base, more the higher it reaches.
          world.xz += uLean * height * height;
          // Alternate sheets are mirrored so the crossed flames do not line up.
          vUv = vec2(mod(aPlane, 2.0) > .5 ? 1.0 - uv.x : uv.x, uv.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tHeat;
        uniform float uBrightness, uPlanes;
        varying vec2 vUv;
        varying float vFacing;
        vec3 flameColor(float heat) {
          vec3 color = mix(vec3(.3, .01, 0.0), vec3(1.0, .24, .012), smoothstep(.03, .4, heat));
          color = mix(color, vec3(1.0, .58, .12), smoothstep(.34, .7, heat));
          return mix(color, vec3(1.0, .86, .5), smoothstep(.78, 1.0, heat));
        }
        void main() {
          float t = texture2D(tHeat, vUv).r;
          const vec2 visible = vec2(.1, .3);     // heat where a flame starts to show, and where it is solid
          float density = smoothstep(visible.x, visible.y, t);
          // The slice ends at its sides and top: fade there so its border never shows.
          float edge = smoothstep(0.0, .08, vUv.x) * smoothstep(0.0, .08, 1.0 - vUv.x) * smoothstep(0.0, .12, 1.0 - vUv.y);
          // A sheet seen edge-on is a line: fade it out there and let the others carry the fire. Crossed sheets
          // overlap, so each gives less light.
          const float overlapLight = .62;        // light of each sheet when several are crossed
          float crossed = step(1.5, uPlanes);
          float alpha = density * edge * mix(1.0, smoothstep(.08, .45, vFacing) * overlapLight, crossed);
          if (alpha <= .003) discard;
          const float glow = 1.3, cover = .5;    // as the sheet flames: light at the core, share of the background hidden
          gl_FragColor = vec4(flameColor(smoothstep(visible.x, 1.0, t)) * (glow * uBrightness * alpha), alpha * cover);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    fluidMesh = new THREE.Mesh(fluidGeometry, fluidMaterial);
    fluidMesh.frustumCulled = false; fluidMesh.visible = false; fluidMesh.renderOrder = RENDER_ORDER;
    scene.add(fluidMesh);
  }

  const light = new THREE.PointLight(LIGHT.color, 0, LIGHT.range * size, LIGHT.decay);
  scene.add(light);

  // Smoke and embers arrive once the smoke sheet has loaded; the flames do not wait for them.
  let puffs = null, disposed = false;
  const ready = createPuffs(scene, {pool: PUFF_POOL, sheets: {plume: PLUME_SHEET}, environment, loadTexture}).then(created => {
    if (disposed) created.dispose();
    else puffs = created;
  });

  const due = LAYERS.map(() => 0);   // fractional sheets each layer still owes
  const spawnPoint = new THREE.Vector3(), smokeColor = new THREE.Color(), hot = new THREE.Color(SMOKE.hot), cold = new THREE.Color(SMOKE.cold);
  let next = 0, intensity = 0, smoulder = 0, time = 0, alive = 0, wasBurning = false;
  let smokeDue = 0, emberDue = 0, untilBurst = between(EMBERS.burstEvery);

  function flameHeight() { return Math.pow(intensity, INTENSITY.height) * look.height * size; }

  function spawnSheet(layer) {
    const i = next * FLOATS;
    next = (next + 1) % capacity;
    const level = between(layer.from), tall = flameHeight();
    let x = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
    if (level < SURFACE_FROM) {
      // Push the point out to the nearest side of the footprint.
      if (Math.abs(x) > Math.abs(z)) x = Math.sign(x) || 1;
      else z = Math.sign(z) || 1;
    }
    start[i] = position.x + x * footprint[0] * size;
    start[i + 1] = position.y + THREE.MathUtils.lerp(rise[0], rise[1], level) * size + between(layer.lift) * tall;
    start[i + 2] = position.z + z * footprint[1] * size;
    start[i + 3] = time;
    motion[i] = between(layer.rise) * tall;
    motion[i + 1] = between(layer.life);
    motion[i + 2] = Math.random();
    motion[i + 3] = layer.heat;
    shape[i] = between(layer.width) * size;
    shape[i + 1] = between(layer.height) * tall;
    shape[i + 2] = Number(layer.detached);
  }

  // A point over the fuel, `above` flame heights up, within `spread` of the footprint.
  function pointAbove(above, spread) {
    return spawnPoint.set(
      position.x + (Math.random() * 2 - 1) * footprint[0] * size * spread,
      position.y + rise[1] * size + above * Math.max(flameHeight(), .25 * size),
      position.z + (Math.random() * 2 - 1) * footprint[1] * size * spread,
    );
  }

  function emitSmoke() {
    // Thick and lit from below while the flames are up; thin and grey once the fire only smoulders.
    const fed = Math.min(1, intensity / .5);
    smokeColor.copy(cold).lerp(hot, fed);
    puffs.emit('plume', pointAbove(between(SMOKE.above) * fed, SMOKE.spread),
      [(Math.random() * 2 - 1) * SMOKE.drift * size, between(SMOKE.speed) * size, (Math.random() * 2 - 1) * SMOKE.drift * size],
      between(SMOKE.size) * size, between(SMOKE.life), smokeColor.getHex(), 0,
      {gravity: SMOKE.rise * size, grow: SMOKE.grow, opacity: THREE.MathUtils.lerp(SMOKE.opacity[1], SMOKE.opacity[0], fed), fadeIn: SMOKE.fadeIn});
  }

  function emitEmber() {
    puffs.emit('dust-soft', pointAbove(Math.random() * .6, EMBERS.spread),
      [(Math.random() * 2 - 1) * EMBERS.drift * size, between(EMBERS.speed) * size, (Math.random() * 2 - 1) * EMBERS.drift * size],
      between(EMBERS.size) * size, between(EMBERS.life), EMBERS.color, 0,
      {gravity: EMBERS.gravity * size, grow: -.5, opacity: EMBERS.opacity, blending: THREE.AdditiveBlending});
  }

  // Follow the source through ignition, burn and burn-out.
  function followSource(dt) {
    const burning = source.phase === 'burning';
    if (burning) {
      const burned = 1 - source.fuel;
      intensity = THREE.MathUtils.smoothstep(burned, 0, CYCLE.grow) * THREE.MathUtils.smoothstep(source.fuel, 0, CYCLE.die);
      smoulder = 0;
    } else {
      intensity = 0;
      if (wasBurning) smoulder = 1;
      else smoulder = Math.max(0, smoulder - dt / CYCLE.smoulder);
      if (source.phase === 'unlit') smoulder = 0;
    }
    wasBurning = burning;
  }

  const api = {
    look, show, light, ready,
    // 0 = out, 1 = fully ablaze. With a source this follows the fire by itself; without one, set it.
    get intensity() { return intensity; },
    set intensity(value) {
      if (!Number.isFinite(value)) throw Error('Fire intensity must be finite');
      intensity = THREE.MathUtils.clamp(value, 0, 1);
    },
    // 1 just after the flames die, fading to 0: smoke and glow without flames.
    get smoulder() { return smoulder; },
    get active() { return alive + (puffs?.active ?? 0); },
    setEnvironment(next) { environment = next ?? null; puffs?.setEnvironment(environment); },
    update(dt) {
      if (disposed || !Number.isFinite(dt) || dt < 0) return;
      time += dt;
      if (source) followSource(dt);
      uniforms.uTime.value = time;
      uniforms.uBrightness.value = look.brightness;
      uniforms.uTurbulence.value = look.turbulence;
      const wind = environment?.wind;
      if (wind && wind.speed > 0) {
        const lean = WIND.lean * Math.min(1, wind.speed / WIND.full) * look.windLean / wind.speed;
        uniforms.uWind.value.set(wind.x * lean, wind.z * lean);
      } else uniforms.uWind.value.set(0, 0);
      const sway = SWAY.amount * look.turbulence;
      uniforms.uSway.value.set((wander(time * SWAY.rate, seed) - .5) * 2 * sway, (wander(time * SWAY.rate, seed + 37) - .5) * 2 * sway);
      uniforms.uPulse.value = 1 + PULSE.depth * look.turbulence * (wander(time * PULSE.rate, seed + 71) - .5) * 2;

      const useFluid = Boolean(fluid) && show.fluid;
      if (fluid) {
        const feeding = useFluid && show.flames && intensity > INTENSITY.minimum;
        fed = feeding ? FLUID.linger : Math.max(0, fed - dt);
        fluidMesh.visible = useFluid && fed > 0;
        if (fluidMesh.visible) {
          fluid.update(dt, {intensity: feeding ? Math.pow(intensity, INTENSITY.count) * look.density : 0});
          fluidUniforms.uPlanes.value = THREE.MathUtils.clamp(Math.round(look.planes), 1, MAX_PLANES);
          const lean = wind && wind.speed > 0 ? FLUID.lean * Math.min(1, wind.speed / WIND.full) * look.windLean / wind.speed : 0;
          fluidUniforms.uLean.value.set(wind ? wind.x * lean : 0, wind ? wind.z * lean : 0);
          const width = half * 2 * FLUID.widen;
          fluidUniforms.tHeat.value = fluid.temperature;
          fluidUniforms.uBase.value.set(position.x, position.y + (rise[1] - FLUID.sink) * size, position.z);
          fluidUniforms.uSize.value.set(width, width * fluid.aspect * look.height);
          fluidUniforms.uBrightness.value = look.brightness;
        }
      }
      let born = 0;
      if (show.flames && !useFluid && intensity > INTENSITY.minimum) {
        const rate = Math.pow(intensity, INTENSITY.count) * look.density * dt;
        for (const [index, layer] of LAYERS.entries()) {
          due[index] += layer.perSecond * rate;
          for (; due[index] >= 1; due[index]--) { spawnSheet(layer); born++; }
        }
      }
      if (born) for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
      alive = 0;
      for (let i = 0; i < capacity; i++) if (time - start[i * FLOATS + 3] < motion[i * FLOATS + 1]) alive++;
      mesh.visible = alive > 0;

      if (puffs) {
        if (show.smoke) {
          // Most smoke comes as the fire dies down and while it smoulders.
          smokeDue += SMOKE.perSecond * look.smoke * dt * Math.max(intensity * (1.4 - intensity), smoulder * SMOKE.smoulderShare);
          for (; smokeDue >= 1; smokeDue--) emitSmoke();
        }
        if (show.embers && intensity > INTENSITY.minimum) {
          emberDue += EMBERS.perSecond * look.embers * intensity * dt;
          untilBurst -= dt;
          if (untilBurst <= 0) {
            emberDue += between(EMBERS.burst) * look.embers * intensity;
            untilBurst = between(EMBERS.burstEvery);
          }
          for (; emberDue >= 1; emberDue--) emitEmber();
        }
        puffs.update(dt);
      }

      const glow = show.light ? Math.max(intensity, smoulder * LIGHT.smoulder) : 0;
      if (glow > 0) {
        let flicker = 1;
        for (const [index, [depth, rate]] of LIGHT.flicker.entries()) flicker += depth * (wander(time * rate, seed + 113 * (index + 1)) - .5) * 2;
        light.intensity = LIGHT.intensity * look.light * size * glow * flicker;
        light.position.set(position.x + uniforms.uSway.value.x, position.y + rise[1] * size + LIGHT.above * Math.max(flameHeight(), .2 * size), position.z + uniforms.uSway.value.y);
      } else light.intensity = 0;
    },
    clear() {
      start.fill(-Infinity);
      due.fill(0);
      smokeDue = emberDue = 0;
      alive = intensity = smoulder = 0;
      wasBurning = false;
      mesh.visible = false;
      light.intensity = 0;
      attributes.iStart.needsUpdate = true;
      puffs?.clear();
      fluid?.clear();
      fed = 0;
      if (fluidMesh) fluidMesh.visible = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(mesh, light); geometry.dispose(); material.dispose(); light.dispose();
      puffs?.dispose();
      if (fluid) { scene.remove(fluidMesh); fluidGeometry.dispose(); fluidMaterial.dispose(); fluid.dispose(); }
    },
  };
  return api;
}
