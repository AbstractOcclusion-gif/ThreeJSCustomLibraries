import * as THREE from 'three';
import {installTerrainShader} from './terrain-shader.js';
import {createWeatherSurfaceMaterial} from '../surface/index.js';
import {TERRAIN_LAYERS, TERRAIN_PALETTE_ROLES} from './terrain-rules.js';
import {createRunoffLook} from './runoff.js';
export {createRunoffLook, createTerrainRunoff} from './runoff.js';
export {createTerrainField, SNOW_DEPTH_SCALE, SNOW_DEFAULTS, SNOW_FIELDS, validateSnow} from './field.js';
export {CRATER_DEFAULTS, CRATER_FIELDS, CRATER_STRATA, CRATER_STRATA_FIELDS, CRATER_EJECTA, craterFootprint, craterStrataPaint, createCraterLayer, createCraterStamp, craterFromImpact, CRATER_IMPACT, CRATER_HARD, validateStrata, addStrataVolumes, craterEvent} from './craters.js';
export {createTerrainDrainage} from './drainage.js';
export {TERRAIN_LAYERS, TERRAIN_PALETTE_ROLES, TERRAIN_ROLE_LAYER, PAINT_REACH, TERRAIN_PAINT_FIELDS, createTerrainRules, TERRAIN_PAINT_DEFAULTS, validateTerrainPaint, dominantTerrainLayer} from './terrain-rules.js';
export {valueNoise} from '../core/value-noise.js';
export {OceanCoastTerrain, TERRAIN_DEFAULTS as OCEAN_COAST_DEFAULTS, WET_DEFAULTS as OCEAN_COAST_WET_DEFAULTS} from './coast.js';

// Snow shading, shared by every snow-covered terrain material that receives the same look.
export function createSnowLook() {
 return {
  tint: {value: new THREE.Color('#f2f6fa')},        // clean snow albedo
  shadowTint: {value: new THREE.Color('#c4d8ff')},  // multiplies sky light on snow: blue shade
  scatter: {value: .35},       // light carried through the snow: softens the terminator and glows against the sun
  sparkle: {value: .6},        // brightness of the ice-crystal glints
  edgeBreakup: {value: .6},    // thin snow settles in the ground's hollows first instead of fading evenly
  trackRelief: {value: .06},   // m, depth of the fine track edge shading from the track mask
 };
}

// Sand shading, shared by every terrain material that receives the same look. The sand itself is procedural.
export function createSandLook() {
 return {
  color: {value: new THREE.Color('#d6c096')},       // dry sand
  variation: {value: .5},      // large patches of lighter and darker sand
  grain: {value: .5},          // fine speckle of individual grains
  rippleSize: {value: .14},    // m between two wind ripple crests
  rippleHeight: {value: 1},    // relief of the wind ripples (0 = smooth sand)
  rippleHeading: {value: 35},  // degrees the wind blows along: 0 = +X, 90 = +Z; ripples run across it
  sparkle: {value: .5},        // brightness of the mineral glints
  roughness: {value: .93},     // dry sand; the surface wetness makes it glossier as on any ground
 };
}

// Roughness of each layer where it has no roughness map (TERRAIN_LAYERS order).
export {TERRAIN_LAYER_ROUGHNESS, TERRAIN_PALETTE_ROUGHNESS} from './terrain-shader.js';
export const TERRAIN_ROLE_TINTS = Object.freeze({grass: '#6f8f3a', rock: '#86817a', snow: '#eef1f3', mud: '#5f5238', forest: '#55682f', scree: '#8a8274', soil: '#7a6648'});

// Cracks of fractured ground (field.fractureMap): cell of the pattern (m), width of a crack (share of the cell),
// how dark it is (0..1).
export const TERRAIN_CRACK_DEFAULTS = Object.freeze([.7, .045, .7]);
export function createTerrainAppearance() {
 return {
  tiling: {value: .45}, rockScale: {value: .55}, sharpness: {value: 3.5}, antiTiling: {value: .85},
  detailStrength: {value: .6}, heightBlend: {value: .24},
  edgeSharpness: {value: .6},  // junctions between layers: 0 = even fade, 1 = the layer standing higher wins outright
  edgeBreakup: {value: .6},    // fine wander of the junctions that hides the steps of the weight grid (0 = off)
  layerDetail: {value: 1},     // share of each layer's own normal and roughness (needs layerDetailArray): 0 = shared rock detail
  // Palette mode with a climate map: grass and forest floor are tinted from dry to lush by the moisture of the place.
  dryTint: {value: new THREE.Color(1.12, 1, .68)}, lushTint: {value: new THREE.Color(.62, 1.08, .5)},
  climateTint: {value: .75},   // strength of that tint (0 = off)
  cracks: {value: new THREE.Vector3(...TERRAIN_CRACK_DEFAULTS)},   // cracks of fractured ground: TERRAIN_CRACK_DEFAULTS
  macroVariation: {value: .5}, // large-scale light and dark patches over every layer, so far ground is not one flat colour (0 = off)
  // Palette mode: every texture set is shifted toward the colour of its role, so the layers of a landscape belong
  // together instead of each keeping the average colour of its photograph. The detail of the texture is kept.
  harmony: {value: .7},        // share of that shift (0 = the textures as they are)
  roleTints: {value: TERRAIN_PALETTE_ROLES.map(role => new THREE.Color(TERRAIN_ROLE_TINTS[role]))},
  // Junction sharpness applies near the camera and fades out between these two distances (m): from afar a sharp
  // edge between two flat colours reads as a pattern.
  edgeFade: {value: new THREE.Vector2(25, 110)},
  // Palette mode: the layers' normal detail fades out between these two distances (m) and is not sampled beyond.
  detailFade: {value: new THREE.Vector2(70, 160)},
  // Palette mode: from afar the texture sets are drawn larger, so their repeat does not show as a grid on distant
  // slopes. x, y: the distances (m) between which the near size gives way to the far one; z: the far size as a share
  // of the near tiling (1 = off).
  farTiling: {value: new THREE.Vector3(60, 220, .23)},
  bakedNormals: {value: 1},    // share of the baked normals of the far rings (0 = the normals of the mesh)
  skyOcclusion: {value: 1},    // how much the ambient light dims where the relief hides the sky (0 = off)
  waterLevel: {value: 0}, shoreWidth: {value: .8}, shoreWetness: {value: 1},
 };
}

// Triplanar sampling adapted from Glider's stunt/cart/terrain-material.js.
const groundScratch = new THREE.Color();
export function terrainGroundColor(target, paint, palette, appearance, sandColor) {
 if (!paint?.palette || !Array.isArray(palette?.roles) || !appearance?.roleTints || !appearance.harmony) throw Error('Terrain ground colour needs a palette paint, its palette and a terrain appearance');
 target.setRGB(0, 0, 0);
 let total = 0;
 palette.roles.forEach((role, index) => {
  const weight = paint.palette[index];
  if (!(weight > 0)) return;
  const tint = appearance.roleTints.value[TERRAIN_PALETTE_ROLES.indexOf(role)];
  groundScratch.copy(palette.means?.[index] ?? tint).lerp(tint, appearance.harmony.value);
  target.r += groundScratch.r * weight; target.g += groundScratch.g * weight; target.b += groundScratch.b * weight;
  total += weight;
 });
 if (total > 0) target.multiplyScalar(1 / total);
 return sandColor && paint.sand > 0 ? target.lerp(sandColor, paint.sand) : target;
}

// A palette world as the ground of the light probes (lighting module: createLightProbes({ground})): its height and,
// by terrainGroundColor, its colour. palette: the world's, with the `means` of its texture sets when known.
export function terrainLightGround({world, palette = world?.palette, appearance, sandColor} = {}) {
 if (typeof world?.heightAt !== 'function' || typeof world.paintAt !== 'function' || typeof world.sampleAt !== 'function') throw new TypeError('Terrain light ground needs a terrain world');
 return {
  heightAt: world.heightAt,
  colorAt: (x, z, target) => terrainGroundColor(target, world.paintAt(world.sampleAt(x, z)), palette, appearance, sandColor),
 };
}

export function createTerrainMaterial(parameters = {}, {
 field, layers, layerArray, layerDetailArray, palette, cutout, detailNormal, appearance = createTerrainAppearance(), contactBand, snowMaterial, snowLook = createSnowLook(), sandLook = createSandLook(), drainage, runoffFlow, puddleSky, sky, fracture = true, ...surface
} = {}) {
 // fracture: false leaves the field's fracture mask (the cracks of hard ground) out of the shader. It is one texture,
 // and a material that already carries tracks, snow and the weather's shadows has none to spare of the 16 a GPU gives.
 // sky: {map, bounds} - a sky visibility map (bakeSkyMap) and the Vector4 world XZ origin and size it covers.
 // Default: the field's own skyMap (a clipmap ring), over the field.
 const skyMap = sky ?? (field?.skyMap ? {map: field.skyMap, bounds: field.bounds} : null);
 if (skyMap && (!skyMap.map?.isTexture || !skyMap.bounds?.isVector4)) throw Error('Terrain sky needs a map texture and its bounds');
 // palette: {size, roles, sets} of a terrain world. The field then brings paletteMap (size / 4 slices of four weights)
 // and the layer arrays hold one slice per palette set.
 if (palette !== undefined) {
  if (!Number.isInteger(palette?.size) || palette.size < 4 || palette.size % 4 || !Array.isArray(palette.roles) || !palette.roles.length) throw Error('Terrain palette needs a size in fours and the role of each set');
  if (palette.roles.some(role => !TERRAIN_PALETTE_ROLES.includes(role)) || palette.roles.length > palette.size) throw Error('Terrain palette roles must be palette roles, at most one per weight');
  if (palette.means !== undefined && (!Array.isArray(palette.means) || palette.means.length < palette.roles.length || palette.means.some(mean => !mean?.isColor))) throw Error('Terrain palette means must be one colour per set');
  for (const key of ['dryTint', 'lushTint', 'climateTint', 'macroVariation', 'harmony', 'roleTints', 'edgeFade', 'detailFade', 'farTiling']) if (!appearance[key]) throw Error(`Terrain appearance needs ${key}: build it with createTerrainAppearance()`);
  if (!field?.paletteMap?.isDataArrayTexture || field.paletteMap.image.depth !== palette.size / 4) throw Error('Terrain palette needs the field palette map: four weights per slice');
  if (!layerArray?.isDataArrayTexture || layerArray.image.depth < palette.roles.length) throw Error('Terrain palette needs one layer array slice per set');
  if (snowMaterial) throw Error('Terrain palette does not take snow detail');
 }
 const hasLayers = palette ? true : layerArray !== undefined ?
  layerArray?.isDataArrayTexture && layerArray.image.depth >= (field?.forestMap ? TERRAIN_LAYERS.length : 4) :
  TERRAIN_LAYERS.slice(0, 4).every(name => layers?.[name]?.isTexture);
 if (!appearance.edgeSharpness || !appearance.edgeBreakup) throw Error('Terrain appearance needs edgeSharpness and edgeBreakup: build it with createTerrainAppearance()');
 if (layerDetailArray !== undefined) {
  if (!layerArray) throw Error('Terrain layer detail needs the packed layer array');
  if (!layerDetailArray?.isDataArrayTexture || layerDetailArray.image.depth !== layerArray.image.depth) throw Error('Terrain layer detail needs one slice per layer of the layer array');
  if (!appearance.layerDetail) throw Error('Terrain appearance needs layerDetail: build it with createTerrainAppearance()');
 }
 if (!field?.heightMap || !(field?.weightMap || palette) || !hasLayers || !detailNormal?.isTexture) {
  throw Error('Terrain material needs a field, layer textures and a detail normal');
 }
 if (contactBand !== undefined && (!Number.isFinite(contactBand) || contactBand < 0)) throw Error('Contact band must be a non-negative distance');
 if (!layerArray && field.forestMap && !layers.forest?.isTexture) throw Error('Terrain forest cover needs a forest floor texture');
 const material = createWeatherSurfaceMaterial(parameters, surface);
 if (runoffFlow) material.defines = {...material.defines, TERRAIN_RUNOFF_FLOW: 1};
 const runoffLook = runoffFlow?.look ?? createRunoffLook();
 if (drainage) material.defines = {...material.defines, TERRAIN_DRAINAGE: 1};
 if (drainage && puddleSky) material.defines = {...material.defines, TERRAIN_PUDDLE_SKY: 1};
 if (snowMaterial) material.defines = {...material.defines, TERRAIN_SNOW_DETAIL: 1};
 if (field.forestMap && !palette) material.defines = {...material.defines, TERRAIN_FOREST_FLOOR: 1};
 if (palette) material.defines = {...material.defines, TERRAIN_PALETTE: 1, TERRAIN_PALETTE_SIZE: palette.size};
 if (palette && field.climateMap) material.defines = {...material.defines, TERRAIN_CLIMATE: 1};
 const paletteRoles = palette ? Array.from({length: palette.size}, (_, index) => Math.max(0, TERRAIN_PALETTE_ROLES.indexOf(palette.roles[index]))) : [];
 if (field.sandMap) material.defines = {...material.defines, TERRAIN_SAND: 1};
 if (fracture && field.fractureMap) material.defines = {...material.defines, TERRAIN_FRACTURE: 1};
 if (field.snowMap) material.defines = {...material.defines, TERRAIN_SNOW_MAP: 1};
 if (layerArray) material.defines = {...material.defines, TERRAIN_LAYER_ARRAY: 1};
 if (layerDetailArray) material.defines = {...material.defines, TERRAIN_LAYER_DETAIL: 1};
 const uniforms = {
  ...(drainage && puddleSky),
  terrainDrainage: {value: drainage?.texture ?? null},
  terrainFlow: {value: runoffFlow?.texture ?? null},
  terrainRunoffCoverage: runoffFlow?.coverage ?? {value: 0},
  terrainRunoffSource: runoffLook.sourceArea, terrainRunoffFull: runoffLook.fullArea, terrainRunoffRutSource: runoffLook.rutSourceArea,
  terrainRunoffSpeed: runoffLook.speed, terrainRunoffRippleSize: runoffLook.rippleSize, terrainRunoffRippleStrength: runoffLook.rippleStrength,
  terrainPuddleFill: drainage?.fill ?? {value: 0},
  terrainHeights: {value: field.heightMap}, terrainLayers: {value: field.weightMap ?? null}, terrainBounds: {value: field.bounds},
  // cutout: a shared {value: Vector4(x, z, sizeX, sizeZ)}: the square of ground another mesh draws in this one's place.
  terrainCutout: cutout ?? {value: new THREE.Vector4()},
  ...(field.morph && {terrainMorph: field.morph}),
  ...(field.normalMap && {terrainNormalMap: {value: field.normalMap}, terrainBakedNormals: appearance.bakedNormals ?? {value: 1}}),
  ...(skyMap && {terrainSkyMap: {value: skyMap.map}, terrainSkyBounds: {value: skyMap.bounds}, terrainSkyOcclusion: appearance.skyOcclusion ?? {value: 1}}),
  terrainLayerArray: {value: layerArray ?? null},
  ...(palette && {terrainPaletteWeights: {value: field.paletteMap}, terrainPaletteRole: {value: paletteRoles}, terrainPaletteSnow: {value: palette.roles.indexOf('snow')},
   terrainHarmony: appearance.harmony, terrainRoleTint: appearance.roleTints, terrainEdgeFade: appearance.edgeFade, terrainDetailFade: appearance.detailFade, terrainFarTiling: appearance.farTiling,
   // A set without a known average is left as it is: its average counts as the colour of its role.
   terrainPaletteMean: {value: Array.from({length: palette.size}, (_, index) => palette.means?.[index] ?? appearance.roleTints.value[paletteRoles[index]])},
   terrainMacroVariation: appearance.macroVariation, terrainClimate: {value: field.climateMap ?? null},
   terrainDryTint: appearance.dryTint, terrainLushTint: appearance.lushTint, terrainClimateTint: appearance.climateTint}),
  terrainLayerDetailArray: {value: layerDetailArray ?? null}, terrainLayerDetail: appearance.layerDetail ?? {value: 0},
  terrainGrass: {value: layers?.grass}, terrainRock: {value: layers?.rock}, terrainSnow: {value: layers?.snow}, terrainMud: {value: layers?.mud},
  terrainForest: {value: layers?.forest}, terrainForestWeight: {value: field.forestMap ?? null},
  terrainFractureMap: {value: field.fractureMap ?? null}, terrainCrack: appearance.cracks ?? {value: new THREE.Vector3(...TERRAIN_CRACK_DEFAULTS)},
  terrainSandWeight: {value: field.sandMap ?? null}, terrainSandColor: sandLook.color, terrainSandHeading: sandLook.rippleHeading,
  terrainSandVariation: sandLook.variation, terrainSandGrain: sandLook.grain, terrainSandRippleSize: sandLook.rippleSize,
  terrainSandRippleHeight: sandLook.rippleHeight, terrainSandSparkle: sandLook.sparkle, terrainSandRoughness: sandLook.roughness,
  terrainDetail: {value: detailNormal}, terrainProp: {value: contactBand !== undefined}, terrainContactBand: {value: contactBand ?? 0},
  terrainTiling: appearance.tiling, terrainSharpness: appearance.sharpness, terrainAntiTiling: appearance.antiTiling,
  terrainRockScale: appearance.rockScale ?? {value: .55},
  terrainDetailStrength: appearance.detailStrength, terrainHeightBlend: appearance.heightBlend,
  terrainEdgeSharpness: appearance.edgeSharpness, terrainEdgeBreakup: appearance.edgeBreakup, terrainWaterLevel: appearance.waterLevel,
  terrainShoreWidth: appearance.shoreWidth, terrainShoreWetness: appearance.shoreWetness,
  terrainSnowNormal: {value: snowMaterial?.normal ?? null},
  terrainSnowRoughness: {value: snowMaterial?.roughness ?? null},
  terrainSnowScatter: snowLook.scatter, terrainSnowSparkle: snowLook.sparkle, terrainSnowEdgeBreakup: snowLook.edgeBreakup,
  terrainSnowTrackRelief: snowLook.trackRelief, terrainSnowTint: snowLook.tint, terrainSnowShadowTint: snowLook.shadowTint,
  terrainSnowNormalStrength: {value: snowMaterial?.normalStrength ?? 1},
  terrainSnowCover: field.snowCover ?? {value: false}, terrainSnowDepth: {value: field.snowMap ?? null},
 };
 // Swaps the layer textures in place, e.g. after picking another texture set. Pass only what changes; the caller
 // disposes the textures it replaces. Per-layer detail and snow detail can be swapped, not added.
 material.setLayerTextures = ({layerArray: nextLayers, layerDetailArray: nextDetail, detailNormal: nextNormal, snowMaterial: nextSnow} = {}) => {
  if (nextLayers !== undefined) {
   if (!layerArray) throw Error('Terrain material was built without a packed layer array');
   if (!nextLayers?.isDataArrayTexture || nextLayers.image.depth !== layerArray.image.depth) throw Error('Terrain layer array needs the same number of layers');
   uniforms.terrainLayerArray.value = nextLayers;
  }
  if (nextDetail !== undefined) {
   if (!layerDetailArray) throw Error('Terrain material was built without per-layer detail');
   if (!nextDetail?.isDataArrayTexture || nextDetail.image.depth !== layerDetailArray.image.depth) throw Error('Terrain layer detail needs one slice per layer of the layer array');
   uniforms.terrainLayerDetailArray.value = nextDetail;
  }
  if (nextNormal !== undefined) {
   if (!nextNormal?.isTexture) throw Error('Terrain detail normal must be a texture');
   uniforms.terrainDetail.value = nextNormal;
  }
  if (nextSnow !== undefined) {
   if (!snowMaterial) throw Error('Terrain material was built without snow detail');
   if (!nextSnow?.normal?.isTexture || !nextSnow?.roughness?.isTexture) throw Error('Snow detail needs a normal and a roughness texture');
   uniforms.terrainSnowNormal.value = nextSnow.normal;
   uniforms.terrainSnowRoughness.value = nextSnow.roughness;
  }
 };
 // field.morph (a clipmap ring): toward the edge of the ring the ground eases into the coarser shape of the ring
 // outside it (the `terrainCoarse` height of each vertex), so detail grows in as the ring approaches and never pops.
 if (field.morph) material.defines = {...material.defines, TERRAIN_MORPH: 1};
 // field.normalMap (a far clipmap ring): the ground is lit from normals baked finer than its mesh.
 if (field.normalMap) material.defines = {...material.defines, TERRAIN_NORMAL_MAP: 1};
 // A sky map (core sky-visibility.js): ambient light, diffuse and reflected, dims where the relief hides the sky.
 if (skyMap) material.defines = {...material.defines, TERRAIN_SKY_MAP: 1};
 installTerrainShader(material, uniforms, {morph: Boolean(field.morph), skyOcclusion: Boolean(skyMap)});
 return material;
}

export {createProceduralTerrain, createValley, terrainWindowOrigin, TERRAIN_LANDFORMS, VALLEY_DEFAULTS} from './valley.js';
export {createRelief, reliefShape, validateRelief, RELIEF_SHAPES, RELIEF_MAX_SHAPES} from './relief.js';
export {TERRAIN_BIOMES, BIOME_TEXTURE_DEFAULTS, BIOME_WEIGHT_FIELD, BIOME_CLIMATE_AXES, DEFAULT_TERRAIN_BIOME, cloneBiome, validateBiome} from './biomes.js';
export {createCorridor, validateCorridor, CORRIDOR_DEFAULTS, CORRIDOR_FIELDS} from './corridor.js';
export {createTerrainWorld, validateWorld, WORLD_DEFAULTS, WORLD_FIELDS, WORLD_MAX_BIOMES, WORLD_MAP_AUTO, WORLD_PALETTE_MAX} from './world.js';
export {createTerrainClipmap, CLIPMAP_DEFAULTS, CLIPMAP_LIMITS} from './clipmap.js';
export {createSkyVisibility, bakeSkyMap, SKY_VISIBILITY_DEFAULTS, SKY_VISIBILITY_LIMITS} from '../core/sky-visibility.js';
