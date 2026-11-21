// Puff settings shared by both puff entries: the WebGL sprites (puffs.js) and the WebGPU compute version (webgpu/puffs.js).
// One source of truth: every default, preset and shading constant lives here, and both entries plan emissions with the
// same helpers, so the two draw the same effect from the same calls.

// Sprite sheets are white channel masks tinted per particle. With `assets` (a base URL) the named files below are
// loaded from it; without it every preset uses the bundled soft mask. `sheets: {name: {url, cols, rows}}` adds or overrides.
export const SHEETS = {
  dust: {file: 'fx-dust.png', cols: 2, rows: 2},
  'dust-soft': {file: 'fx/hcfx-dust-soft.png', cols: 1, rows: 1},
  smoke: {file: 'fx/hcfx-smoke.png', cols: 2, rows: 2},
};
// windResponse: share of the environment wind speed a puff drifts at (scaled per emission by opts.wind).
export const DEFAULTS = {pool: 192, windResponse: 0.3};
export const WIND_RAMP = 0.5; // seconds before a new puff is carried at full drift, so it does not pop off its emitter
export const LIMITS = Object.freeze({pool: 2048, sheetFrames: 256});
// What emit() uses when a call leaves an option out. The 'dust' mask falls and is fainter; the others hang in the air.
export const EMIT_DEFAULTS = Object.freeze({gravity: 0, dustGravity: 1, grow: 0.8, opacity: 0.8, dustOpacity: 0.45});
export const RING_FRAMES = 4; // the ring puffs cycle through the first frames of their sheet
// Presets: `ring` throws `count` puffs outward (outward: m/s per metre of size; up: m/s; jitter: random angle, radians;
// scale: share of size; life: seconds), then `cloud` leaves one soft puff. A pair is a [min, max] range. Options left out
// fall back to EMIT_DEFAULTS.
const MORTAR_RING = Object.freeze({
  count: 5,
  jitter: 0.4,
  outward: 0.65,
  up: 0.55,
  scale: [0.65, 1],
  life: 1,
  gravity: 0.35,
  grow: 1,
  opacity: 0.25,
});
const MORTAR_CLOUD = Object.freeze({up: 0.12, scale: 1.15, life: 2.6, gravity: 0, grow: 1.1, opacity: 0.16});
export const PRESETS = Object.freeze({
  mortar: {color: 0xc7bba2, ring: MORTAR_RING, cloud: MORTAR_CLOUD},
  mortarLanding: {
    color: 0xc7bba2,
    ring: {...MORTAR_RING, count: 2, up: 0.25, life: 0.65, opacity: 0.18},
    cloud: {...MORTAR_CLOUD, life: 1.1, opacity: 0.12},
  },
  dust: {
    color: 0xbfb6a8,
    ring: {count: 6, jitter: 0, outward: 0.8, up: 1.2, scale: [0.7, 1.3], life: 0.9},
    cloud: {up: 0.6, scale: 1.6, life: 1.2, gravity: -0.2, grow: 1.2, opacity: 0.5},
  },
  smoke: {
    color: 0xd8d2c8,
    ring: {
      mask: 'smoke',
      count: 4,
      jitter: 1,
      outward: 0.4,
      up: [0.6, 1.4],
      scale: [0.7, 1.1],
      life: [1.4, 2],
      gravity: -0.4,
      grow: 0.8,
      opacity: 0.35,
    },
  },
});
export const pick = value => (Array.isArray(value) ? value[0] + Math.random() * (value[1] - value[0]) : value);
const BUILTIN_MASK = new URL('../../assets/particles/soft-mask.svg', import.meta.url).href;
export const BUILTIN_SHEETS = Object.fromEntries(
  Object.keys(SHEETS).map(name => [name, {url: BUILTIN_MASK, cols: 1, rows: 1}]),
);

// Shading of animated sheets (puff-material.js GLSL and webgpu/puff-nodes.js TSL read the same numbers).
// heat: a flame sheet's red channel is a temperature, cooled by `cool` over the flipbook, mapped ember -> flame -> core.
// billow: a smoke sheet gets a rounded body added and is greyed towards `grey`, keeping `keep` of its own colour.
export const PUFF_SHADING = Object.freeze({
  heat: {
    cool: 0.78,
    ember: [0.28, 0.015, 0.002],
    flame: [1.25, 0.26, 0.018],
    core: [2.2, 1.22, 0.43],
    flameRamp: [0.05, 0.66],
    coreRamp: [0.54, 0.94],
    alphaRamp: [0.035, 0.8],
  },
  billow: {phasePerFrame: 0.09, body: [0.18, 0.98], bodyAlpha: 0.18, grey: 0.52, keep: 0.65},
  minAlpha: 0.0001,
});

// The options emit() resolves for one puff, from the mask name and the call's opts. Shared so both entries agree.
export function emitSettings(name, opts = {}) {
  const dust = name === 'dust';
  return {
    gravity: opts.gravity ?? (dust ? EMIT_DEFAULTS.dustGravity : EMIT_DEFAULTS.gravity),
    grow: opts.grow ?? EMIT_DEFAULTS.grow,
    peak: opts.opacity ?? (dust ? EMIT_DEFAULTS.dustOpacity : EMIT_DEFAULTS.opacity),
    aspect: opts.aspect ?? 1,
    fadeIn: opts.fadeIn ?? 0,
    wind: opts.wind ?? 1,
  };
}

// A preset burst as emit calls: emit(mask, velocity[3], size, life, frameIndex, opts) for each ring puff, then the cloud.
// Random numbers are drawn in the same order as before the split.
export function planBurst(size, {ring, cloud}, emit) {
  for (let i = 0; i < ring.count; i++) {
    const angle = (i / ring.count) * Math.PI * 2 + Math.random() * ring.jitter,
      outward = size * ring.outward;
    emit(
      ring.mask ?? 'dust',
      [Math.cos(angle) * outward, pick(ring.up), Math.sin(angle) * outward],
      size * pick(ring.scale),
      pick(ring.life),
      i % RING_FRAMES,
      {gravity: ring.gravity, grow: ring.grow, opacity: ring.opacity},
    );
  }
  if (cloud)
    emit('dust-soft', [0, cloud.up, 0], size * cloud.scale, cloud.life, 0, {
      gravity: cloud.gravity,
      grow: cloud.grow,
      opacity: cloud.opacity,
    });
}

// Validates a sheet grid the way createPuffs always has.
export function assertSheetGrid(name, cols, rows) {
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1 || cols * rows > LIMITS.sheetFrames) {
    throw new Error(`Invalid sprite sheet grid: ${name}`);
  }
}
