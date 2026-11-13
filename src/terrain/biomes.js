import {TERRAIN_PALETTE_ROLES, TERRAIN_PAINT_DEFAULTS, TERRAIN_PAINT_FIELDS, validateTerrainPaint} from './terrain-rules.js';
import {reliefShape as shape, validateRelief} from './relief.js';
import {DEFAULT_TERRAIN_TEXTURES, TERRAIN_TEXTURE_SETS} from './textures.js';

// A biome is plain data: how the ground rises (relief recipe, see relief.js), where each layer lies (paint rules,
// see terrain-rules.js) and which texture set each palette role shows (TERRAIN_PALETTE_ROLES; catalogue ids, see textures.js). Copy one, change
// it and validate it with validateBiome to make your own.
// Where a world lays it (world.js): `weight`, how common it is (1 when left out, 0: only where painted by hand), and
// `climate` {temperature: [min, max], moisture: [min, max]}, the climate it lives in, each from 0 (cold, dry) to 1
// (hot, wet). A biome without a climate lives anywhere. Along a corridor (corridor.js): `next`, the ids of the biomes
// that may follow it; any, when left out.
export const BIOME_WEIGHT_FIELD = Object.freeze({label: 'How common', min: 0, max: 10, step: .1});
export const BIOME_CLIMATE_AXES = Object.freeze(['temperature', 'moisture']);
const ANYWHERE = Object.freeze([0, 1]);
const PAINT_KEYS = Object.keys(TERRAIN_PAINT_FIELDS);
const paint = overrides => Object.freeze({...Object.fromEntries(PAINT_KEYS.map(key => [key, TERRAIN_PAINT_DEFAULTS[key]])), ...overrides});
// The texture set of each palette role when a biome names none: the layer defaults, stony ground for scree and bare
// earth for soil.
export const BIOME_TEXTURE_DEFAULTS = Object.freeze({...DEFAULT_TERRAIN_TEXTURES, scree: 'dry_ground_rocks', soil: 'brown_mud'});
const textures = overrides => Object.freeze({...BIOME_TEXTURE_DEFAULTS, ...overrides});
const biome = (id, label, [temperature, moisture], relief, paintOverrides, textureOverrides) => Object.freeze({
  id, label, weight: 1, climate: Object.freeze({temperature: Object.freeze(temperature), moisture: Object.freeze(moisture)}),
  relief: Object.freeze(relief.map(Object.freeze)), paint: paint(paintOverrides), textures: textures(textureOverrides),
});

// Shared by the presets: fine ground texture, and the paint of a temperate climate at this scale. The presets stand
// against the world's default water level: their base height decides how much of them floods.
const detail = () => shape('rolling', {amplitude: 2.4, scale: 24});
// The small bumps and hollows of the ground underfoot: gentle on soil, rougher on mountain ground, slight on sand.
const fine = (amplitude = .12, size = 3) => shape('micro', {amplitude, size});
const TEMPERATE = Object.freeze({rockSlope: .64, snowLine: 40, mudBelow: -.9, forestCover: .5});
const NO_SAND = TERRAIN_PAINT_FIELDS.sandBelow.min, ALL_SAND = TERRAIN_PAINT_FIELDS.sandBelow.max;
const NO_MUD = TERRAIN_PAINT_FIELDS.mudBelow.min, ALL_SNOW = TERRAIN_PAINT_FIELDS.snowLine.min;
const RIDGE_BASE = .85;   // height of a valley's sides before the rolling relief, as a share of that relief
const MEADOW = Object.freeze({grass: 'leafy_grass'});   // green grass, where the default set is dry and sparse
const valley = (relief, width) => [
  shape('base', {height: Math.round(relief * RIDGE_BASE)}), shape('rolling', {amplitude: relief, scale: 84}),
  shape('valley', {width, saddleDepth: .65}), detail(), fine(), shape('river'),
];

export const TERRAIN_BIOMES = Object.freeze(Object.fromEntries([
  biome('plains', 'Plains', [[.35, .75], [.3, .7]], [shape('base', {height: 3}), shape('rolling', {amplitude: 3.1, scale: 84}), detail(), fine(.08)], {...TEMPERATE, forestCover: .4}, MEADOW),
  biome('hills', 'Hills', [[.3, .7], [.35, .75]], [shape('base', {height: 8}), shape('rolling', {amplitude: 12.5, scale: 84}), detail(), fine()], TEMPERATE, MEADOW),
  biome('valley', 'Temperate valley', [[.3, .7], [.45, .85]], valley(26, 35), TEMPERATE, MEADOW),
  biome('alpine', 'Alpine valley', [[.1, .4], [.3, .8]], valley(46, 24), {...TEMPERATE, snowLine: 22, forestCover: .35},
    {grass: 'rocky_terrain_02'}),
  biome('dry', 'Dry valley', [[.6, .9], [.1, .4]], valley(32, 48), {...TEMPERATE, rockSlope: .38, snowLine: 80, forestCover: .2},
    {grass: 'dry_ground_rocks', rock: 'aerial_rocks_02'}),
  biome('wetland', 'Wetland', [[.4, .8], [.7, 1]], valley(12, 54), {...TEMPERATE, mudBelow: 1.4, forestCover: .6},
    {grass: 'leafy_grass', mud: 'brown_mud_03', forest: 'forest_leaves_02'}),
  biome('island', 'Island', [[.55, 1], [.5, 1]], [
    shape('base', {height: 26}), shape('rolling', {amplitude: 26, scale: 84}), detail(), fine(), shape('island', {sink: 10}),
  ], {...TEMPERATE, sandBelow: 1.5, sandBlend: 1.2}, MEADOW),
  biome('cliffs', 'Cliffs', [[.3, .7], [.2, .6]], [shape('warp', {strength: 24, scale: 120}), shape('plateau', {amplitude: 36}), detail(), fine(.18, 4)], TEMPERATE, {rock: 'mossy_rock'}),
  biome('terraces', 'Terraced hills', [[.5, .85], [.4, .8]], [
    shape('base', {height: 12}), shape('rolling', {amplitude: 22, scale: 120}), shape('terraces', {step: 5}), detail(), fine(),
  ], {...TEMPERATE, rockSlope: .9, mudBelow: 0}, {grass: 'grass_path_2'}),
  biome('mountains', 'Mountains', [[0, .45], [.2, .7]], [shape('warp', {strength: 60, scale: 300}), shape('eroded', {amplitude: 260, scale: 520}), detail(), fine(.25, 5)],
    {...TEMPERATE, rockSlope: .8, snowLine: 175, snowBlend: 20, snowJitter: 14, mudBelow: 30, forestCover: .3}, {grass: 'grass_ground', rock: 'aerial_rocks_02'}),
  biome('desert', 'Desert', [[.7, 1], [0, .25]], [shape('base', {height: 5}), shape('rolling', {amplitude: 5, scale: 140}), shape('dunes', {amplitude: 5}), fine(.04, 2)],
    {rockSlope: .9, snowLine: TERRAIN_PAINT_FIELDS.snowLine.max, mudBelow: NO_MUD, forestCover: 0, sandBelow: ALL_SAND},
    {grass: 'gravelly_sand', rock: 'aerial_rocks_02'}),
  biome('ice', 'Ice', [[0, .2], ANYWHERE], [shape('warp', {strength: 40, scale: 300}), shape('eroded', {amplitude: 160, scale: 480, ridges: .6, erosion: .8}), detail(), fine(.2, 5)],
    {rockSlope: .8, snowLine: ALL_SNOW, snowBlend: 1, snowJitter: 0, mudBelow: NO_MUD, forestCover: 0, sandBelow: NO_SAND}),
].map(entry => [entry.id, entry])));

export const DEFAULT_TERRAIN_BIOME = 'valley';

// An editable deep copy of a catalogue biome.
export function cloneBiome(id) {
  const source = Object.hasOwn(TERRAIN_BIOMES, id) && TERRAIN_BIOMES[id];
  if (!source) throw new RangeError(`Unknown terrain biome: ${id}`);
  return {id: source.id, label: source.label, weight: source.weight, climate: {temperature: [...source.climate.temperature], moisture: [...source.climate.moisture]}, relief: source.relief.map(entry => ({...entry})), paint: {...source.paint}, textures: {...source.textures}};
}

export function validateBiome(value) {
  if (typeof value?.id !== 'string' || !value.id || typeof value.label !== 'string' || !value.label) throw new RangeError('A biome needs an id and a label');
  const {min, max} = BIOME_WEIGHT_FIELD;
  if (value.weight !== undefined && (!Number.isFinite(value.weight) || value.weight < min || value.weight > max)) throw new RangeError(`Biome ${value.id} has an invalid weight`);
  if (value.climate !== undefined) {
    for (const axis of BIOME_CLIMATE_AXES) {
      const range = value.climate?.[axis];
      if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] < 0 || range[1] > 1 || range[0] > range[1]) throw new RangeError(`Biome ${value.id} needs a climate ${axis} range within 0..1`);
    }
  }
  if (value.next !== undefined && (!Array.isArray(value.next) || !value.next.length || value.next.some(id => typeof id !== 'string' || !id))) throw new RangeError(`Biome ${value.id} needs its next biomes as a list of ids`);
  validateRelief(value.relief);
  for (const key of PAINT_KEYS) if (!Object.hasOwn(value.paint ?? {}, key)) throw new RangeError(`Biome ${value.id} has no paint setting: ${key}`);
  validateTerrainPaint(value.paint);
  for (const layer of TERRAIN_PALETTE_ROLES) {
    const set = value.textures?.[layer];
    if (!Object.hasOwn(TERRAIN_TEXTURE_SETS, set ?? '')) throw new RangeError(`Biome ${value.id} has no catalogue texture set for ${layer}: ${set}`);
  }
  for (const layer of Object.keys(value.textures)) if (!TERRAIN_PALETTE_ROLES.includes(layer)) throw new RangeError(`Biome ${value.id} has an unknown layer: ${layer}`);
  return value;
}
