import {AdditiveBlending, Vector3} from 'three';
import {createPuffs} from './puffs.js';

const sheets = {
  flame: {url: new URL('../../assets/particles/flame-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true, heat: true},
  plume: {url: new URL('../../assets/particles/smoke-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true, billow: true},
  impact: {url: new URL('../../assets/particles/dust-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true},
};
const FLAME_WIND = 0.4;   // flames and embers lean with the wind; they are not carried like smoke
// One emission look. spread / height: where a puff starts around the emitter (metres at size 1); speed: upward, m/s;
// scale: puff size, m; life: seconds; gravity: m/s² down (negative rises); grow: size gain over life; tilt: random roll, radians.
// Pairs are [min, max]; colors are cycled.
const LOOKS = Object.freeze({
  flame: {mask: 'flame', spread: 0.11, height: 0.31, speed: [0.75, 1.3], scale: [0.82, 1.18], life: [0.31, 0.47], colors: [0xff9939],
    gravity: -0.3, grow: -0.4, opacity: 0.96, fadeIn: 0.045, aspect: 0.63, tilt: 0.16, wind: FLAME_WIND},
  ember: {mask: 'dust-soft', spread: 0.23, height: 0.53, speed: [1.9, 2.7], scale: [0.045, 0.075], life: [0.45, 0.85], colors: [0xffb240],
    gravity: 0.55, grow: -0.5, opacity: 0.8, additive: true, wind: FLAME_WIND},
  smoke: {mask: 'plume', spread: 0.23, height: 0.32, speed: [0.38, 0.66], scale: [0.72, 1.1], life: [2.8, 4.2], colors: [0x918c85, 0xbfb9b1],
    gravity: -0.1, grow: 2.1, opacity: 0.41, fadeIn: 0.45},
  fireSmoke: {mask: 'plume', spread: 0.12, height: 0.89, speed: [0.38, 0.66], scale: [0.72, 1.1], life: [2.8, 4.2], colors: [0x80756a],
    gravity: -0.1, grow: 2.1, opacity: 0.27, fadeIn: 0.45},
  dustCloud: {spread: 0.24, height: 0.28, speed: [0.28, 0.52], scale: [0.35, 0.56], life: [1.1, 1.8], colors: [0xc5ac8e],
    gravity: 0, grow: 1.9, opacity: 0.36, fadeIn: 0.16},
});
// Seconds between bursts, and how often a fire burst also throws an ember or a smoke puff.
const RHYTHM = Object.freeze({fire: 0.105, smoke: 0.15, emberEvery: 2, fireSmokeEvery: 3});
// Impact dust: a ring of stretched streaks thrown outward, then a few slow clouds. jitter: radians; speed / rise: m/s; lift: m.
const DUST_RING = Object.freeze({streaks: 10, jitter: 0.24, speed: [0.85, 2.25], lift: [0.12, 0.21], rise: [0.14, 0.32], scale: [0.25, 0.5],
  life: [0.55, 0.95], colors: [0x8f7862, 0xb49b7b], grow: 1.7, opacity: 0.49, fadeIn: 0.05, aspect: 2, tilt: 0.2, clouds: 4});
const random = (min, max) => min + Math.random() * (max - min);

export async function createParticlePrefab(scene, type, {position, size = 1, ...options} = {}) {
  if (!['fire', 'smoke', 'dust'].includes(type)) throw new RangeError('Unknown particle prefab');
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('Prefab size must be positive');
  const dustMask = options.sheets?.plume && !options.sheets?.impact ? 'plume' : 'impact';
  const prefabSheets = type === 'fire' ? {flame: sheets.flame, plume: sheets.plume}
    : type === 'smoke' ? {plume: sheets.plume} : {[dustMask]: sheets[dustMask]};
  const puffs = await createPuffs(scene, {...options, sheets: {...prefabSheets, ...options.sheets}});
  const origin = new Vector3();
  if (position) origin.copy(position);
  const spawn = new Vector3();
  let running = type !== 'dust';
  let countdown = 0;
  let burst = 0;
  const fire = type === 'fire';

  function emit(look, pick = 0, mask = look.mask) {
    spawn.copy(origin);
    spawn.x += random(-look.spread, look.spread) * size;
    spawn.y += look.height * size;
    spawn.z += random(-look.spread, look.spread) * size;
    puffs.emit(mask, spawn, [random(-look.spread, look.spread) * size, random(...look.speed) * size, 0],
      random(...look.scale) * size, random(...look.life), look.colors[pick % look.colors.length], 0,
      {gravity: look.gravity * size, grow: look.grow, opacity: look.opacity, fadeIn: look.fadeIn, aspect: look.aspect, wind: look.wind,
        rotation: look.tilt === undefined ? undefined : random(-look.tilt, look.tilt), blending: look.additive ? AdditiveBlending : undefined});
  }

  function impactDust() {
    const ring = DUST_RING;
    for (let i = 0; i < ring.streaks; i++) {
      const angle = i * Math.PI * 2 / ring.streaks + random(-ring.jitter, ring.jitter);
      const speed = random(...ring.speed) * size;
      spawn.copy(origin);
      spawn.y += random(...ring.lift) * size;
      puffs.emit(dustMask, spawn, [Math.cos(angle) * speed, random(...ring.rise) * size, Math.sin(angle) * speed],
        random(...ring.scale) * size, random(...ring.life), ring.colors[i % ring.colors.length], 0,
        {gravity: 0, grow: ring.grow, opacity: ring.opacity, fadeIn: ring.fadeIn, aspect: ring.aspect, rotation: random(-ring.tilt, ring.tilt)});
    }
    for (let i = 0; i < ring.clouds; i++) emit(LOOKS.dustCloud, 0, dustMask);
  }

  const api = {
    position: origin,
    setEnvironment(environment) { puffs.setEnvironment(environment); },
    get active() { return puffs.active; },
    start() {
      if (type === 'dust') impactDust();
      else { running = true; countdown = 0; }
    },
    stop() { running = false; },
    clear() { puffs.clear(); },
    dispose() { running = false; puffs.clear(); puffs.dispose(); },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) return;
      puffs.update(dt);
      if (!running) return;
      countdown -= dt;
      if (countdown > 0) return;
      countdown = Math.max(0, countdown + (fire ? RHYTHM.fire : RHYTHM.smoke));
      burst++;
      if (!fire) {
        emit(LOOKS.smoke, burst);
        return;
      }
      emit(LOOKS.flame);
      if (burst % RHYTHM.emberEvery === 0) emit(LOOKS.ember);
      if (burst % RHYTHM.fireSmokeEvery === 0) emit(LOOKS.fireSmoke);
    },
  };
  api.tick = api.update;   // former name, kept for existing callers
  return api;
}
