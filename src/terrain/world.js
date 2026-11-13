import {valueNoise} from '../core/value-noise.js';
import {hash2} from '../core/hash.js';
import {validateBiome} from './biomes.js';
import {createRelief} from './relief.js';
import {createTerrainRules, TERRAIN_LAYERS} from './terrain-rules.js';

// A world lays biomes out in square regions and stitches them: across a border the relief and the layer paint of
// the two biomes blend, along a line that wanders so the grid of regions does not show. A region takes the biome
// painted in the map, or one drawn from the seed where the map has none.
const number = (label, min, max, step) => Object.freeze({label, min, max, step});
export const WORLD_DEFAULTS = Object.freeze({
  regionSize: 160,   // m, side of a region
  blend: .4,         // share of a region over which two neighbours blend: 0 = a hard line, 1 = always blending
  wander: .3,        // how far the borders stray from straight, as a share of the region size
});
export const WORLD_FIELDS = Object.freeze({
  regionSize: number('Region size · m', 20, 4000, 5),
  blend: number('Border blend', .02, 1, .01),
  wander: number('Border wander', 0, 1, .01),
});
export const WORLD_MAX_BIOMES = 16;
export const WORLD_MAP_AUTO = -1;       // map cell left to the seed
const WANDER = Object.freeze({scale: .6, seeds: [211, 223]});   // wander features, in regions; noise seed offsets
const REGION_SEED = 97;
const smooth = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export function validateWorld({regionSize, blend, wander}) {
  for (const [key, value] of Object.entries({regionSize, blend, wander})) {
    const {min, max} = WORLD_FIELDS[key];
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid world setting: ${key}`);
  }
}

// map: {columns, rows, cells}: biome indices, row-major along +X then +Z, centred on the world origin; a cell holds
// a biome index or WORLD_MAP_AUTO.
export function createTerrainWorld({seed, biomes, map, ...overrides} = {}) {
  const settings = {...WORLD_DEFAULTS, ...overrides};
  validateWorld(settings);
  if (!Number.isSafeInteger(seed)) throw new RangeError('A world needs an integer seed');
  if (!Array.isArray(biomes) || !biomes.length || biomes.length > WORLD_MAX_BIOMES) throw new RangeError(`A world needs 1 to ${WORLD_MAX_BIOMES} biomes`);
  biomes.forEach(validateBiome);
  if (map) {
    const {columns, rows, cells} = map;
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || cells?.length !== columns * rows) throw new RangeError('A world map needs columns x rows cells');
    for (const cell of cells) if (!Number.isInteger(cell) || cell < WORLD_MAP_AUTO || cell >= biomes.length) throw new RangeError(`World map cell names no biome: ${cell}`);
  }
  const {regionSize, blend, wander} = settings;
  const count = biomes.length;
  const reliefs = biomes.map(biome => createRelief(seed, biome.relief));
  const rules = biomes.map(biome => createTerrainRules(seed, {...biome.paint, mudFromRunout: false}));
  const wanderX = valueNoise(seed + WANDER.seeds[0]), wanderZ = valueNoise(seed + WANDER.seeds[1]);
  const wanderSize = regionSize * WANDER.scale;

  // Biome of region (column, row); region (0, 0) starts at the world origin.
  function regionBiome(column, row) {
    if (map) {
      const i = column + Math.floor(map.columns / 2), j = row + Math.floor(map.rows / 2);
      const painted = i >= 0 && j >= 0 && i < map.columns && j < map.rows ? map.cells[j * map.columns + i] : WORLD_MAP_AUTO;
      if (painted !== WORLD_MAP_AUTO) return painted;
    }
    return Math.min(count - 1, Math.floor(hash2(column, row, seed + REGION_SEED) * count));
  }

  // Share of each biome at a point, written into `out` (one entry per biome, summing to 1).
  function weightsAt(x, z, out = new Float32Array(count)) {
    out.fill(0);
    if (count === 1) { out[0] = 1; return out; }
    const strayX = wander * regionSize * wanderX(x / wanderSize, z / wanderSize);
    const strayZ = wander * regionSize * wanderZ(x / wanderSize, z / wanderSize);
    // Blend between the centres of the four nearest regions.
    const u = (x + strayX) / regionSize - .5, v = (z + strayZ) / regionSize - .5;
    const column = Math.floor(u), row = Math.floor(v);
    const tu = smooth(.5 - blend / 2, .5 + blend / 2, u - column), tv = smooth(.5 - blend / 2, .5 + blend / 2, v - row);
    out[regionBiome(column, row)] += (1 - tu) * (1 - tv);
    out[regionBiome(column + 1, row)] += tu * (1 - tv);
    out[regionBiome(column, row + 1)] += (1 - tu) * tv;
    out[regionBiome(column + 1, row + 1)] += tu * tv;
    return out;
  }

  const scratch = new Float32Array(count);
  function heightAt(x, z) {
    weightsAt(x, z, scratch);
    let height = 0;
    for (let i = 0; i < count; i++) if (scratch[i] > 0) height += scratch[i] * reliefs[i].heightAt(x, z);
    return height;
  }

  // Layer weights (TERRAIN_LAYERS order) and sand of the stitched biomes: the paintAt callback of createTerrainField.
  const paintScratch = new Float32Array(count);
  function paintAt(sample) {
    weightsAt(sample.x, sample.z, paintScratch);
    const layers = new Array(TERRAIN_LAYERS.length).fill(0);
    let sand = 0;
    for (let i = 0; i < count; i++) {
      const share = paintScratch[i];
      if (share <= 0) continue;
      rules[i].weights(sample).forEach((weight, layer) => { layers[layer] += weight * share; });
      sand += rules[i].sand(sample) * share;
    }
    return {layers, sand};
  }

  return {
    settings, biomes, heightAt, weightsAt, paintAt, regionBiome,
    // A valley route only makes sense in a world of one biome.
    routeX: count === 1 ? reliefs[0].routeX : undefined,
  };
}
