import {valueNoise} from '../core/value-noise.js';
import {hash2} from '../core/hash.js';

// A corridor is a way through a world: a floor that runs along +Z and wanders in X, with the ground rising on both
// sides. Along it the biomes follow one another in sections, each as wide as the world, instead of lying in regions.
// Endless (length 0) it runs both ways from z = 0; with a length it runs from z = 0 to z = length and, when it has
// walls, is closed at both ends. The relief of the biomes fills the sides; their valleys and rivers follow its route.
const number = (label, min, max, step) => Object.freeze({label, min, max, step});
export const CORRIDOR_DEFAULTS = Object.freeze({
  width: 40,          // m, the floor
  shoulder: 80,       // m, each side, from the floor to the full height of the ground beside it
  wall: 0,            // m the ground beside the corridor is raised by: 0 leaves a path through open country
  floor: 0,           // m, height of the floor
  floorRelief: .15,   // share of the biome's relief the floor keeps above that height (what lies below it is kept whole)
  bend: 30,           // m the route strays to each side
  bendScale: 160,     // m, length of a bend
  length: 0,          // m; 0: endless
  endRamp: 80,        // m over which a closed end rises
  sectionMin: 300,    // m, shortest and longest stretch of one biome
  sectionMax: 700,
  sectionBlend: 80,   // m over which a biome gives way to the next
});
export const CORRIDOR_FIELDS = Object.freeze({
  width: number('Floor width · m', 2, 600, 1), shoulder: number('Side width · m', 2, 800, 1),
  wall: number('Wall height · m', 0, 400, 1), floor: number('Floor height · m', -60, 300, .5),
  floorRelief: number('Relief kept on the floor', 0, 1, .01),
  bend: number('Bend · m', 0, 400, 1), bendScale: number('Bend length · m', 20, 2000, 5),
  length: number('Length · m (0 = endless)', 0, 100000, 10), endRamp: number('End rise · m', 1, 1000, 1),
  sectionMin: number('Shortest biome stretch · m', 20, 20000, 10), sectionMax: number('Longest biome stretch · m', 20, 20000, 10),
  sectionBlend: number('Biome blend · m', 0, 2000, 5),
});
const SEEDS = Object.freeze({route: 503, biome: 509, length: 521, back: 523});
const smooth = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// sections: a fixed order, [{biome: index, length?}], repeated along the route; a length left out is drawn.
export function validateCorridor(settings, biomes) {
  for (const [key, {min, max}] of Object.entries(CORRIDOR_FIELDS)) {
    const value = settings[key];
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid corridor setting: ${key}`);
  }
  if (settings.sectionMax < settings.sectionMin) throw new RangeError('Corridor sections need their longest stretch at least as long as their shortest');
  if (settings.sectionBlend > settings.sectionMin) throw new RangeError('Corridor biome blend cannot be longer than the shortest stretch');
  const {sections} = settings;
  if (sections !== undefined) {
    if (!Array.isArray(sections) || !sections.length) throw new RangeError('Corridor sections are a list of {biome, length}');
    for (const section of sections) {
      if (!Number.isInteger(section?.biome) || section.biome < 0 || section.biome >= biomes.length) throw new RangeError(`Corridor section names no biome: ${section?.biome}`);
      if (section.length !== undefined && !(section.length >= settings.sectionBlend && section.length > 0 && Number.isFinite(section.length))) throw new RangeError('A corridor section is at least as long as the biome blend');
    }
  }
  return settings;
}

// biomes: the world's; a biome's `weight` says how often it is drawn and its `next`, a list of biome ids, which
// biomes may follow it (any, when left out). Returns {settings, length (null: endless), routeX(z),
// sectionAt(z) -> {index, biome, start, end}, weightsAt(z, out), shape(height, x, z)}.
export function createCorridor(seed, biomes, overrides = {}) {
  const settings = validateCorridor({...CORRIDOR_DEFAULTS, ...overrides}, biomes);
  const {width, shoulder, wall, floor, floorRelief, bend, bendScale, length, endRamp, sectionMin, sectionMax, sectionBlend, sections} = settings;
  const count = biomes.length, weights = biomes.map(biome => biome.weight ?? 1);
  if (!sections && !weights.some(weight => weight > 0)) throw new RangeError('A corridor needs a biome with a weight, or its sections');
  // follows[a][b]: biome b may come after biome a.
  const follows = biomes.map(biome => biomes.map(other => {
    if (biome.next === undefined) return true;
    for (const id of biome.next) if (!biomes.some(known => known.id === id)) throw new RangeError(`Biome ${biome.id} is followed by an unknown biome: ${id}`);
    return biome.next.includes(other.id);
  }));
  biomes.forEach((biome, index) => {
    if (!sections && weights[index] > 0 && !follows[index].some((may, other) => may && weights[other] > 0)) throw new RangeError(`Biome ${biome.id} can be followed by no biome of the corridor`);
  });
  const routeNoise = valueNoise(seed + SEEDS.route);
  const routeX = z => bend * routeNoise(0, z / bendScale);

  // A biome drawn by weight among those `allowed`; among all when none is.
  function draw(chance, allowed) {
    const open = allowed && weights.some((weight, index) => weight > 0 && allowed(index)) ? allowed : () => true;
    let total = 0;
    for (let index = 0; index < count; index++) if (weights[index] > 0 && open(index)) total += weights[index];
    let left = chance * total, last = 0;
    for (let index = 0; index < count; index++) {
      if (!(weights[index] > 0) || !open(index)) continue;
      last = index;
      if ((left -= weights[index]) < 0) return index;
    }
    return last;
  }
  // The sections ahead of z = 0 (0, 1, 2...) and behind it (-1, -2...: `behind` 0, 1...), laid as they are asked
  // for. Each holds its biome and where it starts; `far` is the end of the last one laid.
  const ahead = {biomes: [], starts: [], far: 0}, behind = {biomes: [], starts: [], far: 0};
  const fixed = index => sections[((index % sections.length) + sections.length) % sections.length];
  function lay(side, upTo) {
    const back = side === behind;
    while (side.far <= upTo) {
      const k = side.biomes.length, index = back ? -k - 1 : k, given = sections && fixed(index);
      let biome;
      if (given) biome = given.biome;
      else if (!back) biome = draw(hash2(k, 0, seed + SEEDS.biome), k ? other => follows[ahead.biomes[k - 1]][other] : null);
      else {
        // Behind the start the rule runs the other way: a section may be followed by the one after it.
        const after = k ? behind.biomes[k - 1] : (lay(ahead, 0), ahead.biomes[0]);
        biome = draw(hash2(k, 0, seed + SEEDS.back), other => follows[other][after]);
      }
      const stretch = given?.length ?? sectionMin + hash2(index, 1, seed + SEEDS.length) * (sectionMax - sectionMin);
      side.biomes.push(biome);
      side.starts.push(side.far);
      side.far += stretch;
    }
  }
  // The section at z: its number, biome and ends. The last answer is tried first: samples come in runs.
  const found = {index: 0, biome: 0, start: 0, end: -1};
  function sectionAt(z) {
    if (z >= found.start && z < found.end) return found;
    const back = z < 0, side = back ? behind : ahead, distance = back ? -z : z;
    lay(side, distance);
    let low = 0, high = side.starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (side.starts[middle] <= distance) low = middle; else high = middle - 1;
    }
    const near = side.starts[low], far = low + 1 < side.starts.length ? side.starts[low + 1] : side.far;
    found.index = back ? -low - 1 : low; found.biome = side.biomes[low];
    found.start = back ? -far : near; found.end = back ? -near : far;
    return found;
  }
  const biomeOf = index => {
    const side = index < 0 ? behind : ahead, k = index < 0 ? -index - 1 : index;
    while (side.biomes.length <= k) lay(side, side.far);
    return side.biomes[k];
  };

  return {
    settings, routeX, sectionAt,
    length: length > 0 ? length : null,
    // Share of each biome at z, written into `out` (one entry per biome, summing to 1).
    weightsAt(z, out = new Float32Array(count)) {
      out.fill(0);
      const {index, biome, start, end} = sectionAt(z), half = sectionBlend / 2;
      if (half > 0 && z - start < half) {
        const share = smooth(-half, half, z - start);
        out[biome] += share; out[biomeOf(index - 1)] += 1 - share;
      } else if (half > 0 && end - z < half) {
        const share = smooth(-half, half, z - end);
        out[biome] += 1 - share; out[biomeOf(index + 1)] += share;
      } else out[biome] = 1;
      return out;
    },
    // The corridor cut into ground of `height` at (x, z).
    shape(height, x, z) {
      const side = smooth(width / 2, width / 2 + shoulder, Math.abs(x - routeX(z)));
      const raised = height + wall;
      const level = height > floor ? floor + (height - floor) * floorRelief : height;
      const cut = lerp(level, raised, side);
      if (!(length > 0) || !(wall > 0)) return cut;
      const closed = Math.max(1 - smooth(0, endRamp, z), smooth(length - endRamp, length, z));
      return lerp(cut, raised, closed);
    },
  };
}
