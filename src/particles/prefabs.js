import {AdditiveBlending, Vector3} from 'three';
import {createPuffs} from './puffs.js';

const sheets = {
  flame: {url: new URL('../../assets/particles/flame-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true, heat: true},
  plume: {url: new URL('../../assets/particles/smoke-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true, billow: true},
  impact: {url: new URL('../../assets/particles/dust-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true},
};
export {sheets as PREFAB_SHEETS};   // the flipbooks the prefabs use (also the measured load of bench/particles-webgpu)
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
// A wisp: the thread of smoke of a small ember (a cigarette, incense, a snuffed candle). A buoyant plume this thin
// leaves smooth and straight, speeds up as it rises, then sways and spreads into curls. Here it is a close chain of
// small soft puffs: each keeps the sideways speed the thread had when it left the ember, so the waves widen with
// height, while it grows and fades. Metres and seconds at size 1 (a cigarette).
// sway: sideways speed of the thread, m/s: two slow swings (periods, s, along x and z) and two quick ones (their share
// of the slow ones), out of step so the thread never repeats; jitter: random share added per puff (it frays the end).
// curl: a sideways speed that turns round the thread (m/s, one turn per `period` s), so the thread winds into a
// widening corkscrew: the swirls of its end. It comes and goes (`breath`, s), so the swirls differ from one to the next.
// swirl: the air the thread rises into (swirl.js): it carries each puff at `speed` m/s through eddies `eddy` m wide
// that ride up at `rise` m/s, once the puff is `ramp` s old, so the smooth thread rolls up into curls and folds higher
// up. The host's `swirl` option overrides any of it (metres and seconds as given, not scaled by size).
// life is uneven on purpose: the end thins out puff by puff instead of stopping at one height.
const WISP = Object.freeze({mask: 'dust-soft', height: 0.002, speed: [0.1, 0.12], scale: [0.009, 0.012], life: [2.4, 4.8], colors: [0xc9d0d8, 0xb8c0ca],
  gravity: -0.05, grow: 7, opacity: 0.1, fadeIn: 0.12,
  sway: {speed: 0.009, slow: [2.6, 4.1], quick: [0.9, 1.5], quickShare: 0.5, jitter: 0.3},
  curl: {speed: 0.016, period: 0.62, breath: 2.3},
  swirl: {speed: 0.05, eddy: 0.05, rise: 0.14, ramp: 1.2}});
// Seconds between bursts, and how often a fire burst also throws an ember or a smoke puff.
const RHYTHM = Object.freeze({fire: 0.105, smoke: 0.15, wisp: 1 / 90, emberEvery: 2, fireSmokeEvery: 3});
const TURN = Math.PI * 2;
const MAX_WISP_BACKLOG = 12;   // puffs of a wisp made in one frame at most
// Impact dust: a ring of stretched streaks thrown outward, then a few slow clouds. jitter: radians; speed / rise: m/s; lift: m.
const DUST_RING = Object.freeze({streaks: 10, jitter: 0.24, speed: [0.85, 2.25], lift: [0.12, 0.21], rise: [0.14, 0.32], scale: [0.25, 0.5],
  life: [0.55, 0.95], colors: [0x8f7862, 0xb49b7b], grow: 1.7, opacity: 0.49, fadeIn: 0.05, aspect: 2, tilt: 0.2, clouds: 4});
const random = (min, max) => min + Math.random() * (max - min);

// makePuffs: the puff pool factory (hook). Default: the WebGL sprites; the WebGPU entry passes its compute version.
// opacity: share of the prefab's own opacity its puffs are drawn at (1: as designed; lower: fainter).
export async function createParticlePrefab(scene, type, {position, size = 1, opacity = 1, makePuffs = createPuffs, ...options} = {}) {
  if (!['fire', 'smoke', 'wisp', 'dust'].includes(type)) throw new RangeError('Unknown particle prefab');
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('Prefab size must be positive');
  if (!Number.isFinite(opacity) || opacity < 0) throw new RangeError('Prefab opacity must be 0 or more');
  const dustMask = options.sheets?.plume && !options.sheets?.impact ? 'plume' : 'impact';
  const prefabSheets = type === 'fire' ? {flame: sheets.flame, plume: sheets.plume}
    : type === 'smoke' ? {plume: sheets.plume} : type === 'wisp' ? {} : {[dustMask]: sheets[dustMask]};   // a wisp: the bundled soft mask
  // A wisp's swirling air, at the prefab's size; `speed` is the puffs' own (given at each emission), the rest the pool's.
  const wispSwirl = {speed: WISP.swirl.speed * size, eddy: WISP.swirl.eddy * size, rise: WISP.swirl.rise * size, ramp: WISP.swirl.ramp, ...options.swirl};
  const {speed: swirlSpeed, ...swirlField} = wispSwirl;
  const puffs = await makePuffs(scene, {...options, sheets: {...prefabSheets, ...options.sheets}, ...(type === 'wisp' && {swirl: swirlField})});
  const origin = new Vector3();
  if (position) origin.copy(position);
  const spawn = new Vector3();
  let running = type !== 'dust';
  let countdown = 0;
  let burst = 0;
  let clock = 0;   // s the prefab has run: the phase of a wisp's sway
  const fire = type === 'fire', wisp = type === 'wisp';

  function emit(look, pick = 0, mask = look.mask) {
    spawn.copy(origin);
    spawn.x += random(-look.spread, look.spread) * size;
    spawn.y += look.height * size;
    spawn.z += random(-look.spread, look.spread) * size;
    puffs.emit(mask, spawn, [random(-look.spread, look.spread) * size, random(...look.speed) * size, 0],
      random(...look.scale) * size, random(...look.life), look.colors[pick % look.colors.length], 0,
      {gravity: look.gravity * size, grow: look.grow, opacity: look.opacity * opacity, fadeIn: look.fadeIn, aspect: look.aspect, wind: look.wind,
        rotation: look.tilt === undefined ? undefined : random(-look.tilt, look.tilt), blending: look.additive ? AdditiveBlending : undefined});
  }

  // One puff of the wisp's chain, leaving with the sideways speed the thread had `ago` s ago, when it was due (several
  // are due in one frame: each starts where it would be by now, so the chain stays even at any frame rate).
  function emitWisp(pick, ago) {
    const {sway, curl} = WISP, due = clock - ago;
    const swing = (slow, quick, phase) => Math.sin(due * TURN / slow + phase) + sway.quickShare * Math.sin(due * TURN / quick + 2 * phase);
    // The curl: along x and z a quarter turn apart (a circle), its strength breathing between 0 and 1.
    const turning = axis => curl.speed * (0.5 + 0.5 * Math.sin(due * TURN / curl.breath)) * Math.sin(due * TURN / curl.period + axis * TURN / 4);
    const sideways = axis => size * (sway.speed * (swing(sway.slow[axis], sway.quick[axis], axis + 1) + random(-sway.jitter, sway.jitter)) + turning(axis));
    const velocity = [sideways(0), random(...WISP.speed) * size, sideways(1)];
    spawn.copy(origin);
    spawn.x += velocity[0] * ago; spawn.y += WISP.height * size + velocity[1] * ago; spawn.z += velocity[2] * ago;
    puffs.emit(WISP.mask, spawn, velocity, random(...WISP.scale) * size, random(...WISP.life),
      WISP.colors[pick % WISP.colors.length], 0, {gravity: WISP.gravity * size, grow: WISP.grow, opacity: WISP.opacity * opacity, fadeIn: WISP.fadeIn, swirl: swirlSpeed});
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
        {gravity: 0, grow: ring.grow, opacity: ring.opacity * opacity, fadeIn: ring.fadeIn, aspect: ring.aspect, rotation: random(-ring.tilt, ring.tilt)});
    }
    for (let i = 0; i < ring.clouds; i++) emit(LOOKS.dustCloud, 0, dustMask);
  }

  const api = {
    position: origin,
    setEnvironment(environment) { puffs.setEnvironment(environment); },
    // A local stir of the prefab's puffs (puffs.js disturb): those within `radius` of `center` take `velocity`.
    disturb(center, radius, velocity) {
      if (!puffs.disturb) throw Error('This puff pool cannot be disturbed (the WebGPU pool has no disturb yet)');
      puffs.disturb(center, radius, velocity);
    },
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
      clock += dt;
      countdown -= dt;
      if (wisp) {
        // Every puff due since the last frame (at most a stalled frame's worth: MAX_WISP_BACKLOG).
        for (let made = 0; countdown <= 0 && made < MAX_WISP_BACKLOG; made++, countdown += RHYTHM.wisp) emitWisp(++burst, -countdown);
        countdown = Math.max(countdown, 0);
        return;
      }
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
