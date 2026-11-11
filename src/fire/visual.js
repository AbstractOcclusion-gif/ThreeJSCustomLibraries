// What a fire looks like: flames drawn over a burning object's footprint. One instanced draw call per fire.
// Each flame is a camera-facing sheet whose shape is made in the shader from rising noise, so it licks and tears on
// its own; three layers of them (a wide bright base, the body, fast thin tongues) build the fire.
// The host owns the logic (createFireSystem) and sets `intensity`; nothing here decides what burns.
import * as THREE from 'three';
import {NOISE_GLSL} from '../core/lighting.js';

const RENDER_ORDER = 8;   // after the scene's transparent surfaces
const MAX_CAPACITY = 1024;

// Tweaks shared by every layer; 1 = as authored below. Pass one look to every fire that should match.
export function createFlameLook() {
  return {
    height: 1,        // scale on flame height
    density: 1,       // scale on how many flames are alive
    brightness: 1,    // scale on the emitted light
    turbulence: 1,    // scale on how much the flames tear and sway
    windLean: 1,      // scale on how far the wind bends them
  };
}

// One layer. All lengths are metres for a fire of size 1 at full intensity; pairs are [min, max].
//   perSecond  flames started each second          life     seconds a flame lasts
//   width      sheet width                         height   sheet height
//   rise       upward speed, m/s                   from     where in the footprint's height range it starts (0 bottom, 1 top)
//   spread     share of the footprint it starts in heat     temperature scale: 1 burns pale at the core
//   slim       how fast the sheet narrows toward its tip (higher = thinner tongue)
const LAYERS = Object.freeze([
  {name: 'base', perSecond: 16, life: [.7, 1.1], width: [.75, 1.1], height: [.55, .8], rise: [.1, .28], from: [0, .7], spread: 1, heat: .95, slim: .8},
  {name: 'body', perSecond: 16, life: [.5, .8], width: [.55, .85], height: [.9, 1.3], rise: [.45, .9], from: [.3, 1], spread: 1, heat: .85, slim: 1.2},
  {name: 'tongue', perSecond: 8, life: [.3, .5], width: [.32, .5], height: [.8, 1.25], rise: [1.2, 2.0], from: [.8, 1], spread: .7, heat: .72, slim: 1.5},
]);
// Intensity shapes the fire: a weak fire has fewer, shorter flames. Count follows intensity ^ count, height ^ height.
const INTENSITY = Object.freeze({count: .7, height: .6, minimum: .02});
const WIND = Object.freeze({lean: .22, full: 14});   // m of sideways travel per metre risen, reached at this wind speed (m/s)
// Flames starting below this share of the height range start on the footprint's edge: the burning object fills the inside.
const SURFACE_FROM = .85;
const FLOATS = 4;

function between([min, max]) { return min + Math.random() * (max - min); }

// scene: where the flames are added. position: the base of the burning object (held by reference, so it may move).
// footprint: [half width X, half depth Z] the flames start within; rise: [lowest, highest] start height above position.
// size scales every flame; environment is the optional core/environment.js contract (wind leans the flames).
export function createFireVisual(scene, {position, footprint = [.3, .3], rise = [0, .3], size = 1, capacity = 128, environment = null, look = createFlameLook()} = {}) {
  if (!scene?.isObject3D) throw Error('Fire visual needs a scene or group');
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) throw Error('Fire visual needs a finite position');
  if (![...footprint, ...rise, size].every(Number.isFinite) || footprint.some(value => value < 0) || rise[1] < rise[0] || size <= 0) {
    throw Error('Fire visual needs a non-negative footprint, an ordered rise range and a positive size');
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) throw Error(`Fire visual capacity must be 1..${MAX_CAPACITY}`);
  const show = {flames: true};

  // Per flame: where and when it starts, how it moves, how it is shaped. Written once at birth; the shader does the rest.
  const start = new Float32Array(capacity * FLOATS);    // x, y, z, birth time
  const motion = new Float32Array(capacity * FLOATS);   // rise speed, life, seed, heat
  const shape = new Float32Array(capacity * FLOATS);    // width, height, slim, unused
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
    uTime: {value: 0}, uWind: {value: new THREE.Vector2()},
    uBrightness: {value: look.brightness}, uTurbulence: {value: look.turbulence},
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    // Premultiplied: the glow adds to what is behind it, while the alpha still hides a little of it.
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      attribute vec4 iStart, iMotion, iShape;
      uniform float uTime;
      uniform vec2 uWind;
      varying vec2 vUv;
      varying vec3 vFlame;   // age 0..1, seed, heat
      varying float vSlim;   // how fast the sheet narrows toward its tip
      void main() {
        float age = (uTime - iStart.w) / iMotion.y;
        if (age < 0.0 || age >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        const float grownAt = .18;      // share of its life a flame takes to reach full size
        const float shrink = .35;       // size lost by the end of its life
        float grown = smoothstep(0.0, grownAt, age) * (1.0 - shrink * age);
        float risen = iMotion.x * age * iMotion.y;
        vec3 base = iStart.xyz + vec3(0.0, risen, 0.0);
        // The wind bends a flame more the higher it reaches: it leans from its base, it is not carried away.
        float reach = risen + position.y * iShape.y * grown;
        vec3 world = base + vec3(uWind.x, 0.0, uWind.y) * reach;
        vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
        world += right * (position.x * iShape.x * grown);
        world.y += position.y * iShape.y * grown;
        vUv = vec2(position.x + .5, position.y);
        vFlame = vec3(age, iMotion.z, iMotion.w);
        vSlim = iShape.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uBrightness, uTurbulence;
      varying vec2 vUv;
      varying vec3 vFlame;
      varying float vSlim;
      ${NOISE_GLSL}
      // Black-body style ramp: dark red where it is coolest, orange, then a pale core.
      vec3 flameColor(float heat) {
        vec3 color = mix(vec3(.32, .012, 0.0), vec3(1.0, .26, .015), smoothstep(.04, .42, heat));
        color = mix(color, vec3(1.0, .62, .14), smoothstep(.36, .7, heat));
        return mix(color, vec3(1.0, .88, .55), smoothstep(.8, 1.0, heat));
      }
      void main() {
        float age = vFlame.x, seed = vFlame.y;
        vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
        float time = uTime + seed * 31.0;
        const float climb = 2.1;         // noise scrolls up this many sheet heights per second: the licking speed
        const float sway = 1.0;          // sideways wander of the tip, in half widths
        const float tear = 1.15;         // how much the upper flame is eaten into separate licks
        float broad = valueNoise(vec3(p.x * 1.5 + seed * 9.0, p.y * 2.1 - time * climb, time * .4));
        float fine = valueNoise(vec3(p.x * 3.9 - seed * 5.0, p.y * 4.7 - time * climb * 1.7, time * .7));
        float x = p.x + ((broad - .5) * sway + (fine - .5) * sway * .45) * (.25 + .75 * p.y) * uTurbulence;
        // Flame outline: pinched where it leaves the fuel, widest a little above, closing to a point at the tip.
        const float pinch = .45;         // width left at the very bottom, as a share of the widest part
        const float belly = .3;          // height of the widest part, as a share of the sheet
        float halfWidth = .82 * (1.0 - pow(p.y, 1.0 / max(vSlim, .2))) * mix(pinch, 1.0, smoothstep(0.0, belly, p.y));
        float body = 1.0 - smoothstep(halfWidth * .15, max(halfWidth, .001), abs(x));
        float ragged = valueNoise(vec3(p.x * 7.5 + seed * 3.0, p.y * 8.0 - time * climb * 2.6, time));
        float eaten = (fine * tear + ragged * .45) * uTurbulence * smoothstep(.1, 1.0, p.y);
        float density = clamp(body - eaten, 0.0, 1.0) * smoothstep(0.0, belly, p.y);
        float fade = smoothstep(0.0, .12, age) * (1.0 - smoothstep(.55, 1.0, age));
        // Hottest low in the flame and early in its life.
        float heat = density * mix(1.0, .5, p.y) * mix(1.0, .7, age) * vFlame.z;
        float alpha = smoothstep(.02, .4, density) * fade;
        if (alpha <= .003) discard;
        const float glow = 1.35;         // light emitted at the core, before tone mapping
        const float cover = .55;         // share of the background a flame hides
        gl_FragColor = vec4(flameColor(heat) * (glow * uBrightness * alpha), alpha * cover);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = RENDER_ORDER;
  scene.add(mesh);

  const due = LAYERS.map(() => 0);   // fractional flames each layer still owes
  let next = 0, intensity = 0, time = 0, alive = 0, disposed = false;

  function spawn(layer) {
    const i = next * FLOATS;
    next = (next + 1) % capacity;
    const reach = layer.spread * size, level = between(layer.from);
    let x = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
    if (level < SURFACE_FROM) {
      // Push the point out to the nearest side of the footprint.
      if (Math.abs(x) > Math.abs(z)) x = Math.sign(x) || 1;
      else z = Math.sign(z) || 1;
    }
    start[i] = position.x + x * footprint[0] * reach;
    start[i + 1] = position.y + THREE.MathUtils.lerp(rise[0], rise[1], level) * size;
    start[i + 2] = position.z + z * footprint[1] * reach;
    start[i + 3] = time;
    const tall = Math.pow(intensity, INTENSITY.height) * look.height * size;
    motion[i] = between(layer.rise) * tall;
    motion[i + 1] = between(layer.life);
    motion[i + 2] = Math.random();
    motion[i + 3] = layer.heat;
    shape[i] = between(layer.width) * size;
    shape[i + 1] = between(layer.height) * tall;
    shape[i + 2] = layer.slim;
  }

  const api = {
    look, show,
    // 0 = out, 1 = fully ablaze. Flames already burning finish their short life when this drops.
    get intensity() { return intensity; },
    set intensity(value) {
      if (!Number.isFinite(value)) throw Error('Fire intensity must be finite');
      intensity = THREE.MathUtils.clamp(value, 0, 1);
    },
    get active() { return alive; },
    setEnvironment(next) { environment = next ?? null; },
    update(dt) {
      if (disposed || !Number.isFinite(dt) || dt < 0) return;
      time += dt;
      uniforms.uTime.value = time;
      uniforms.uBrightness.value = look.brightness;
      uniforms.uTurbulence.value = look.turbulence;
      const wind = environment?.wind;
      if (wind && wind.speed > 0) {
        const lean = WIND.lean * Math.min(1, wind.speed / WIND.full) * look.windLean / wind.speed;
        uniforms.uWind.value.set(wind.x * lean, wind.z * lean);
      } else uniforms.uWind.value.set(0, 0);
      let born = 0;
      if (show.flames && intensity > INTENSITY.minimum) {
        const rate = Math.pow(intensity, INTENSITY.count) * look.density * dt;
        for (const [index, layer] of LAYERS.entries()) {
          due[index] += layer.perSecond * rate;
          for (; due[index] >= 1; due[index]--) { spawn(layer); born++; }
        }
      }
      if (born) for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
      alive = 0;
      for (let i = 0; i < capacity; i++) if (time - start[i * FLOATS + 3] < motion[i * FLOATS + 1]) alive++;
      mesh.visible = alive > 0;
    },
    clear() {
      start.fill(-Infinity);
      due.fill(0);
      alive = 0;
      mesh.visible = false;
      attributes.iStart.needsUpdate = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(mesh); geometry.dispose(); material.dispose();
    },
  };
  return api;
}
