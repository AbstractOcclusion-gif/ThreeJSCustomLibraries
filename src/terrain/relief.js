import {fbm, valueNoise} from '../core/value-noise.js';

// Relief as data: a recipe is a list of shapes applied in order to a height that starts at zero. Additive shapes
// (base, rolling, ridged, eroded, micro, plateau, dunes) raise the ground; modifiers (terraces, valley, river, island) reshape what
// the shapes before them built, and warp bends the ground plan for the shapes after it, so the place of a shape in
// the list matters. Distances and heights are metres.
const number = (label, min, max, step) => Object.freeze({label, min, max, step});
const smooth = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const RELIEF_MAX_SHAPES = 12;
const NOISE_STRIDE = 31;                 // seed offset between two shapes of a recipe, so each gets its own noise
const DUNE = Object.freeze({lee: .3, wanderScale: 3, patchScale: 5, patchFloor: .4});   // lee: share of a dune on its steep side
const DEGREES = Math.PI / 180;
// Eroded ground: octaves of noise, each `lacunarity` x finer and `gain` x weaker and turned by `turn` radians so no
// axis shows. slopeStep is the distance, in noise cells, over which the slope of an octave is measured; slopeGain
// scales how much the slope gathered so far flattens the finer octaves at erosion 1.
const ERODED = Object.freeze({octaves: 7, lacunarity: 2, gain: .5, turn: .6, slopeStep: .02, slopeGain: .35});
const WARP_OFFSET = 31.7;
// Fine relief: octaves of bumps, each `lacunarity` x smaller and `gain` x lower. A mesh of cells `cell` m wide keeps
// the octaves it can show: one fades out as its bumps shrink from `shown` cells across to `hidden`.
const MICRO = Object.freeze({octaves: 4, lacunarity: 2.1, gain: .55, shown: 5, hidden: 2.5});   // noise offset between the two axes of a warp, so they bend independently

function shape(label, fields, defaults, build) {
  return Object.freeze({label, fields: Object.freeze(fields), defaults: Object.freeze(defaults), build});
}

export const RELIEF_SHAPES = Object.freeze({
  base: shape('Base level', {height: number('Height · m', -60, 200, .5)}, {height: 0},
    ({height}) => ({apply: value => value + height})),
  rolling: shape('Rolling ground', {
    amplitude: number('Height · m', 0, 150, .1), scale: number('Feature size · m', 4, 800, 1),
  }, {amplitude: 6, scale: 84}, ({amplitude, scale}, noise) => ({
    apply: (value, x, z) => value + amplitude * fbm(noise, x / scale, z / scale),
  })),
  ridged: shape('Ridges and peaks', {
    amplitude: number('Height · m', 0, 300, .5), scale: number('Feature size · m', 10, 800, 1),
    floor: number('Valley floor share', 0, 1, .01),
  }, {amplitude: 60, scale: 84, floor: .15}, ({amplitude, scale, floor}, noise) => ({
    apply: (value, x, z) => value + amplitude * (floor + Math.abs(fbm(noise, x / scale, z / scale))),
  })),
  eroded: shape('Eroded mountains', {
    amplitude: number('Height · m', 0, 600, 1), scale: number('Feature size · m', 20, 3000, 5),
    ridges: number('Ridge sharpness', 0, 1, .01), erosion: number('Erosion', 0, 1, .01),
  }, {amplitude: 120, scale: 400, ridges: .85, erosion: .6}, ({amplitude, scale, ridges, erosion}, noise) => {
    const {octaves, lacunarity, gain, turn, slopeStep, slopeGain} = ERODED;
    const cos = Math.cos(turn), sin = Math.sin(turn);
    let total = 0;
    for (let octave = 0, weight = 1; octave < octaves; octave++, weight *= gain) total += weight;
    return {apply(value, x, z) {
      // Turned from the start, so the first octave does not follow the world axes either.
      let px = (x * cos - z * sin) / scale, pz = (x * sin + z * cos) / scale, weight = 1, sum = 0, slopeX = 0, slopeZ = 0;
      for (let octave = 0; octave < octaves; octave++) {
        const here = noise(px, pz);
        const dx = (noise(px + slopeStep, pz) - here) / slopeStep, dz = (noise(px, pz + slopeStep) - here) / slopeStep;
        // Rounded hills (0..1 from the noise) or ridges (1 - |noise|), and the slope of whichever shows.
        const fold = here < 0 ? 1 : -1;
        const height = (here * .5 + .5) * (1 - ridges) + (1 - Math.abs(here)) * ridges;
        // Steep ground sheds its fine detail, as water would carry it off: flanks turn into smooth runs and gullies.
        // The slope is that of the coarser octaves, so the main shape stands whole.
        sum += weight * height / (1 + erosion * slopeGain * (slopeX * slopeX + slopeZ * slopeZ));
        slopeX += dx * (.5 * (1 - ridges) + fold * ridges);
        slopeZ += dz * (.5 * (1 - ridges) + fold * ridges);
        weight *= gain;
        const turned = (px * cos - pz * sin) * lacunarity;
        pz = (px * sin + pz * cos) * lacunarity;
        px = turned;
      }
      return value + amplitude * sum / total;
    }};
  }),
  micro: shape('Fine ground relief', {
    amplitude: number('Height · m', 0, 2, .01), size: number('Largest bump · m', .3, 20, .1),
  }, {amplitude: .12, size: 3}, ({amplitude, size}, noise) => {
    const {octaves, lacunarity, gain, shown, hidden} = MICRO;
    let total = 0;
    for (let octave = 0, weight = 1; octave < octaves; octave++, weight *= gain) total += weight;
    return {apply(value, x, z, cell = 0) {
      let sum = 0, weight = 1, across = size;
      for (let octave = 0; octave < octaves; octave++) {
        // Bumps too small for the cells of the mesh that asks would only flicker: they are left out.
        const kept = cell > 0 ? smooth(hidden * cell, shown * cell, across) : 1;
        if (kept > 0) sum += weight * kept * noise(x / across + octave * WARP_OFFSET, z / across - octave * WARP_OFFSET);
        weight *= gain; across /= lacunarity;
      }
      return value + amplitude * sum / total;
    }};
  }),
  warp: shape('Warp what follows', {
    strength: number('Shift · m', 0, 400, 1), scale: number('Feature size · m', 10, 3000, 5),
  }, {strength: 30, scale: 180}, ({strength, scale}, noise) => ({
    // Moves the point the following shapes are read at: straight features bend and round ones stretch.
    moveX: (x, z) => x + strength * noise(x / scale, z / scale),
    moveZ: (x, z) => z + strength * noise(x / scale + WARP_OFFSET, z / scale - WARP_OFFSET),
    apply: value => value,
  })),
  plateau: shape('Plateaus and cliffs', {
    amplitude: number('Height · m', 0, 200, .5), scale: number('Feature size · m', 10, 800, 1),
    from: number('Cliff foot · noise', -1, 1, .01), to: number('Cliff top · noise', -1, 1, .01),
  }, {amplitude: 36, scale: 84, from: -.09, to: .39}, ({amplitude, scale, from, to}, noise) => {
    if (to <= from) throw new RangeError('Relief plateau needs its cliff top above its cliff foot');
    return {apply: (value, x, z) => value + amplitude * smooth(from, to, fbm(noise, x / scale, z / scale))};
  }),
  dunes: shape('Dunes', {
    amplitude: number('Height · m', 0, 40, .1), spacing: number('Crest spacing · m', 4, 300, 1),
    heading: number('Wind heading · °', 0, 360, 1), wander: number('Crest wander', 0, 2, .01),
  }, {amplitude: 4, spacing: 30, heading: 35, wander: .6}, ({amplitude, spacing, heading, wander}, noise) => {
    const windX = Math.cos(heading * DEGREES), windZ = Math.sin(heading * DEGREES);
    const wanderSize = spacing * DUNE.wanderScale, patchSize = spacing * DUNE.patchScale;
    return {apply(value, x, z) {
      const along = (x * windX + z * windZ) / spacing + wander * noise(x / wanderSize, z / wanderSize);
      const phase = along - Math.floor(along);
      // Gentle windward rise, steep lee side.
      const crest = phase < 1 - DUNE.lee ? phase / (1 - DUNE.lee) : (1 - phase) / DUNE.lee;
      const patches = lerp(DUNE.patchFloor, 1, noise(x / patchSize + 13, z / patchSize - 7) * .5 + .5);
      return value + amplitude * smooth(0, 1, crest) * patches;
    }};
  }),
  terraces: shape('Terraces', {
    step: number('Step height · m', .5, 60, .5), strength: number('Strength', 0, 1, .01),
    riser: number('Riser share of a step', .02, 1, .01),
  }, {step: 6, strength: .8, riser: .25}, ({step, strength, riser}) => ({
    apply(value) {
      const level = value / step, whole = Math.floor(level);
      const stepped = (whole + smooth(.5 - riser / 2, .5 + riser / 2, level - whole)) * step;
      return lerp(value, stepped, strength);
    },
  })),
  valley: shape('Valley carve', {
    width: number('Floor width · m', 2, 300, 1), shoulder: number('Side width · m', 4, 400, 1),
    bend: number('Bend · m', 0, 150, 1), bendScale: number('Bend length · m', 20, 800, 1),
    floor: number('Floor height · m', -60, 100, .5),
    saddleDepth: number('Side pass depth', 0, 1, .01), saddleWidth: number('Side pass width · m', 4, 200, 1),
  }, {width: 35, shoulder: 72, bend: 21, bendScale: 105, floor: 0, saddleDepth: 0, saddleWidth: 31},
  ({width, shoulder, bend, bendScale, floor, saddleDepth, saddleWidth}, noise, before) => {
    // The valley runs along +Z and wanders in X: along the route it is given (a world's corridor), else by its own
    // bends. The pass lowers the +X side around z = 0.
    const routeX = before.find(step => step.routeX)?.routeX ?? (z => bend * noise(0, z / bendScale));
    return {routeX, apply(value, x, z) {
      const cross = x - routeX(z);
      const side = smooth(width / 2, width / 2 + shoulder, Math.abs(cross));
      const pass = cross > 0 ? 1 - saddleDepth * (1 - smooth(0, saddleWidth, Math.abs(z))) : 1;
      return floor + (value - floor) * side * pass;
    }};
  }),
  river: shape('River channel', {
    width: number('Bed width · m', .5, 200, .5), bank: number('Bank width · m', .5, 100, .5),
    bed: number('Bed height · m', -60, 300, .1),
    bend: number('Bend · m', 0, 150, 1), bendScale: number('Bend length · m', 20, 800, 1),
  }, {width: 6, bank: 5, bed: -1.8, bend: 21, bendScale: 105}, ({width, bank, bed, bend, bendScale}, noise, before) => {
    // Runs along +Z. It follows the valley carved before it, when there is one, and its own bends otherwise.
    // The channel only cuts: ground already under the bed height is left alone.
    const routeX = before.find(step => step.routeX)?.routeX ?? (z => bend * noise(0, z / bendScale));
    return {routeX, apply(value, x, z) {
      const channel = 1 - smooth(width / 2, width / 2 + bank, Math.abs(x - routeX(z)));
      return value > bed ? value - (value - bed) * channel : value;
    }};
  }),
  island: shape('Island mask', {
    inner: number('Full land radius · m', 0, 2000, 1), outer: number('Shore radius · m', 1, 4000, 1),
    sink: number('Sea bed depth · m', 0, 100, .5),
  }, {inner: 46, outer: 112, sink: 10}, ({inner, outer, sink}) => {
    if (outer <= inner) throw new RangeError('Relief island needs its shore radius beyond its full land radius');
    return {apply: (value, x, z) => value * (1 - smooth(inner, outer, Math.hypot(x, z))) - sink};
  }),
});

// A recipe entry with every setting of its shape: {shape, ...settings}.
export function reliefShape(name, overrides = {}) {
  const spec = Object.hasOwn(RELIEF_SHAPES, name) && RELIEF_SHAPES[name];
  if (!spec) throw new RangeError(`Unknown relief shape: ${name}`);
  return {shape: name, ...spec.defaults, ...overrides};
}

export function validateRelief(recipe) {
  if (!Array.isArray(recipe) || !recipe.length || recipe.length > RELIEF_MAX_SHAPES) {
    throw new RangeError(`A relief recipe is a list of 1 to ${RELIEF_MAX_SHAPES} shapes`);
  }
  recipe.forEach((entry, index) => {
    const spec = Object.hasOwn(RELIEF_SHAPES, entry?.shape) && RELIEF_SHAPES[entry.shape];
    if (!spec) throw new RangeError(`Unknown relief shape at ${index + 1}: ${entry?.shape}`);
    for (const key of Object.keys(entry)) {
      if (key !== 'shape' && !Object.hasOwn(spec.fields, key)) throw new RangeError(`Unknown ${entry.shape} setting: ${key}`);
    }
    for (const [key, {min, max}] of Object.entries(spec.fields)) {
      const value = entry[key];
      if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${entry.shape} setting at ${index + 1}: ${key}`);
    }
  });
  return recipe;
}

// Builds the height sampler of a recipe. routeX(z) follows the first valley or river of the recipe (undefined without one).
// route: a routeX(z) given from outside (a world's corridor): the valleys and rivers of the recipe then follow it.
export function createRelief(seed, recipe, {route} = {}) {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Relief needs an integer seed');
  if (route !== undefined && typeof route !== 'function') throw new TypeError('A relief route is a function of z');
  validateRelief(recipe);
  const steps = [], given = route ? [{routeX: route}] : [];
  // A shape is built knowing the shapes before it: a river follows the valley it runs in.
  recipe.forEach(({shape: name, ...settings}, index) => steps.push(RELIEF_SHAPES[name].build(settings, valueNoise(seed + NOISE_STRIDE * (index + 1)), [...given, ...steps])));
  return {
    routeX: route ?? steps.find(step => step.routeX)?.routeX,
    // cell: the cell size, in metres, of the mesh that asks. Shapes finer than it can show leave their detail out,
    // so a coarse mesh gets smooth ground instead of noise. Without it the relief is given in full.
    heightAt(x, z, cell = 0) {
      let height = 0;
      for (const step of steps) {
        if (step.moveX) { const movedX = step.moveX(x, z); z = step.moveZ(x, z); x = movedX; }
        height = step.apply(height, x, z, cell);
      }
      return height;
    },
  };
}
