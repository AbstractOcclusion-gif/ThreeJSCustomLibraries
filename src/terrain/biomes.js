import {TERRAIN_PALETTE_ROLES, TERRAIN_PAINT_DEFAULTS, TERRAIN_PAINT_FIELDS, validateTerrainPaint} from './terrain-rules.js';
import {reliefShape as shape, validateRelief} from './relief.js';
import {DEFAULT_TERRAIN_TEXTURES, TERRAIN_TEXTURE_SETS} from './textures.js';

// A biome is plain data: how the ground rises (relief recipe, see relief.js), where each layer lies (paint rules,
// see terrain-rules.js) and which texture set each palette role shows (TERRAIN_PALETTE_ROLES; catalogue ids, see textures.js). Copy one, change
// it and validate it with validateBiome to make your own.
const PAINT_KEYS = Object.keys(TERRAIN_PAINT_FIELDS);
const paint = overrides => Object.freeze({...Object.fromEntries(PAINT_KEYS.map(key => [key, TERRAIN_PAINT_DEFAULTS[key]])), ...overrides});
// The texture set of each palette role when a biome names none: the layer defaults, stony ground for scree and bare
// earth for soil.
export const BIOME_TEXTURE_DEFAULTS = Object.freeze({...DEFAULT_TERRAIN_TEXTURES, scree: 'dry_ground_rocks', soil: 'brown_mud'});
const textures = overrides => Object.freeze({...BIOME_TEXTURE_DEFAULTS, ...overrides});
const biome = (id, label, relief, paintOverrides, textureOverrides) =>
  Object.freeze({id, label, relief: Object.freeze(relief.map(Object.freeze)), paint: paint(paintOverrides), textures: textures(textureOverrides)});

// Shared by the presets: fine ground texture, and the paint of a temperate climate at this scale. The presets stand
// against the world's default water level: their base height decides how much of them floods.
const detail = () => shape('rolling', {amplitude: 2.4, scale: 24});
const TEMPERATE = Object.freeze({rockSlope: .64, snowLine: 40, mudBelow: -.9, forestCover: .5});
const NO_SAND = TERRAIN_PAINT_FIELDS.sandBelow.min, ALL_SAND = TERRAIN_PAINT_FIELDS.sandBelow.max;
const NO_MUD = TERRAIN_PAINT_FIELDS.mudBelow.min, ALL_SNOW = TERRAIN_PAINT_FIELDS.snowLine.min;
const RIDGE_BASE = .85;   // height of a valley's sides before the rolling relief, as a share of that relief
const MEADOW = Object.freeze({grass: 'leafy_grass'});   // green grass, where the default set is dry and sparse
const valley = (relief, width) => [
  shape('base', {height: Math.round(relief * RIDGE_BASE)}), shape('rolling', {amplitude: relief, scale: 84}),
  shape('valley', {width, saddleDepth: .65}), detail(), shape('river'),
];

export const TERRAIN_BIOMES = Object.freeze(Object.fromEntries([
  biome('plains', 'Plains', [shape('base', {height: 3}), shape('rolling', {amplitude: 3.1, scale: 84}), detail()], {...TEMPERATE, forestCover: .4}, MEADOW),
  biome('hills', 'Hills', [shape('base', {height: 8}), shape('rolling', {amplitude: 12.5, scale: 84}), detail()], TEMPERATE, MEADOW),
  biome('valley', 'Temperate valley', valley(26, 35), TEMPERATE, MEADOW),
  biome('alpine', 'Alpine valley', valley(46, 24), {...TEMPERATE, snowLine: 22, forestCover: .35},
    {grass: 'rocky_terrain_02'}),
  biome('dry', 'Dry valley', valley(32, 48), {...TEMPERATE, rockSlope: .38, snowLine: 80, forestCover: .2},
    {grass: 'dry_ground_rocks', rock: 'aerial_rocks_02'}),
  biome('wetland', 'Wetland', valley(12, 54), {...TEMPERATE, mudBelow: 1.4, forestCover: .6},
    {grass: 'leafy_grass', mud: 'brown_mud_03', forest: 'forest_leaves_02'}),
  biome('island', 'Island', [
    shape('base', {height: 26}), shape('rolling', {amplitude: 26, scale: 84}), detail(), shape('island', {sink: 10}),
  ], {...TEMPERATE, sandBelow: 1.5, sandBlend: 1.2}, MEADOW),
  biome('cliffs', 'Cliffs', [shape('warp', {strength: 24, scale: 120}), shape('plateau', {amplitude: 36}), detail()], TEMPERATE, {rock: 'mossy_rock'}),
  biome('terraces', 'Terraced hills', [
    shape('base', {height: 12}), shape('rolling', {amplitude: 22, scale: 120}), shape('terraces', {step: 5}), detail(),
  ], {...TEMPERATE, rockSlope: .9, mudBelow: 0}, {grass: 'grass_path_2'}),
  biome('mountains', 'Mountains', [shape('warp', {strength: 60, scale: 300}), shape('eroded', {amplitude: 260, scale: 520}), detail()],
    {...TEMPERATE, rockSlope: .8, snowLine: 175, snowBlend: 20, snowJitter: 14, mudBelow: 30, forestCover: .3}, {grass: 'grass_ground', rock: 'aerial_rocks_02'}),
  biome('desert', 'Desert', [shape('base', {height: 5}), shape('rolling', {amplitude: 5, scale: 140}), shape('dunes', {amplitude: 5})],
    {rockSlope: .9, snowLine: TERRAIN_PAINT_FIELDS.snowLine.max, mudBelow: NO_MUD, forestCover: 0, sandBelow: ALL_SAND},
    {grass: 'gravelly_sand', rock: 'aerial_rocks_02'}),
  biome('ice', 'Ice', [shape('warp', {strength: 40, scale: 300}), shape('eroded', {amplitude: 160, scale: 480, ridges: .6, erosion: .8}), detail()],
    {rockSlope: .8, snowLine: ALL_SNOW, snowBlend: 1, snowJitter: 0, mudBelow: NO_MUD, forestCover: 0, sandBelow: NO_SAND}),
].map(entry => [entry.id, entry])));

export const DEFAULT_TERRAIN_BIOME = 'valley';

// An editable deep copy of a catalogue biome.
export function cloneBiome(id) {
  const source = Object.hasOwn(TERRAIN_BIOMES, id) && TERRAIN_BIOMES[id];
  if (!source) throw new RangeError(`Unknown terrain biome: ${id}`);
  return {id: source.id, label: source.label, relief: source.relief.map(entry => ({...entry})), paint: {...source.paint}, textures: {...source.textures}};
}

export function validateBiome(value) {
  if (typeof value?.id !== 'string' || !value.id || typeof value.label !== 'string' || !value.label) throw new RangeError('A biome needs an id and a label');
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
