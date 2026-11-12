import * as THREE from 'three';
import {SKY_GLSL} from '../core/sky.js';
import {createWeatherSurfaceMaterial} from '../surface/index.js';
import {TERRAIN_LAYERS} from './terrain-rules.js';
import {createRunoffLook} from './runoff.js';
export {createRunoffLook, createTerrainRunoff} from './runoff.js';
export {createTerrainField, SNOW_DEPTH_SCALE, SNOW_DEFAULTS, SNOW_FIELDS, validateSnow} from './field.js';
export {createTerrainDrainage} from './drainage.js';
export {TERRAIN_LAYERS, TERRAIN_PAINT_FIELDS, createTerrainRules, TERRAIN_PAINT_DEFAULTS, validateTerrainPaint, dominantTerrainLayer} from './terrain-rules.js';
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

export function createTerrainAppearance() {
 return {
  tiling: {value: .45}, rockScale: {value: .55}, sharpness: {value: 3.5}, antiTiling: {value: .85},
  detailStrength: {value: .6}, heightBlend: {value: .24},
  waterLevel: {value: 0}, shoreWidth: {value: .8}, shoreWetness: {value: 1},
 };
}

// Triplanar sampling adapted from Glider's stunt/cart/terrain-material.js.
const TERRAIN_GLSL = /* glsl */`
#ifdef TERRAIN_SNOW_DETAIL
uniform sampler2D terrainSnowNormal, terrainSnowRoughness;
uniform float terrainSnowNormalStrength, terrainSnowScatter, terrainSnowSparkle, terrainSnowEdgeBreakup, terrainSnowTrackRelief;
uniform vec3 terrainSnowTint, terrainSnowShadowTint;
#endif
uniform sampler2D terrainHeights, terrainLayers, terrainDetail;
#ifdef TERRAIN_LAYER_ARRAY
uniform highp sampler2DArray terrainLayerArray;
#else
uniform sampler2D terrainGrass, terrainRock, terrainSnow, terrainMud;
#ifdef TERRAIN_FOREST_FLOOR
uniform sampler2D terrainForest;
#endif
#endif
#ifdef TERRAIN_FOREST_FLOOR
uniform sampler2D terrainForestWeight;
#endif
${TERRAIN_LAYERS.map((name, index) => `const int TERRAIN_${name.toUpperCase()} = ${index};`).join('\n')}
const int TERRAIN_DETAIL = ${TERRAIN_LAYERS.length};
#ifdef TERRAIN_SNOW_DETAIL
const int TERRAIN_SNOW_NORMAL = TERRAIN_DETAIL + 1;
const int TERRAIN_SNOW_ROUGHNESS = TERRAIN_DETAIL + 2;
#endif
uniform vec4 terrainBounds;
uniform float terrainTiling, terrainSharpness, terrainAntiTiling, terrainDetailStrength, terrainHeightBlend;
uniform float terrainRockScale;
uniform float terrainWaterLevel, terrainShoreWidth, terrainShoreWetness, terrainContactBand;
uniform bool terrainProp;
uniform bool terrainSnowCover;
uniform sampler2D terrainSnowDepth;

#ifdef TERRAIN_DRAINAGE
uniform sampler2D terrainDrainage;
uniform float terrainPuddleFill;

float terrainPuddle(vec2 grid, vec2 size, float groundHeight) {
 const float edgeFadeMeters = .012;
 vec2 basin = texture2D(terrainDrainage, (grid + .5) / size).ba;
 float level = mix(basin.x, basin.y, terrainPuddleFill);
 float depth = level - groundHeight;
 return basin.y > basin.x ? smoothstep(0.0, edgeFadeMeters, depth) : 0.0;
}
#endif
#ifdef TERRAIN_RUNOFF_FLOW
// rg = downhill direction x slope along world X and Z, b = drained area (m2), a = area held back by hollows.
uniform sampler2D terrainFlow;
uniform float terrainRunoffCoverage, terrainRunoffSource, terrainRunoffFull, terrainRunoffRutSource;
uniform float terrainRunoffSpeed, terrainRunoffRippleSize, terrainRunoffRippleStrength;

// Height (0..1) of the water skin: noise carried downstream. Two copies half a cycle apart cross-fade, so the
// pattern restarts unseen instead of stretching (the flow-map technique of water/surface.js).
float terrainFlowSkin(vec2 world, vec2 velocity) {
 const float cycleSeconds = 2.4;
 float phase = fract(surfaceTime / cycleSeconds);
 vec2 p = world / terrainRunoffRippleSize;
 vec2 carried = velocity * cycleSeconds / terrainRunoffRippleSize;
 float first = valueNoise(vec3(p - carried * (phase - .5), 1.0));
 float second = valueNoise(vec3(p - carried * (fract(phase + .5) - .5) + 7.3, 9.0));
 return mix(first, second, abs(phase * 2.0 - 1.0));
}
#endif
#ifdef TERRAIN_PUDDLE_SKY
${SKY_GLSL}
#endif

#if defined(TERRAIN_SNOW_DETAIL) || defined(TERRAIN_SAND)
// Change of the track mask per metre along world X and Z: points toward the inside of a track.
vec2 terrainTrackSlope(vec3 world) {
 if (!surfaceHasTracks) return vec2(0.0);
 vec2 uv = (world.xz - surfaceTrackBounds.xy) / surfaceTrackBounds.zw;
 vec2 texel = 1.0 / vec2(textureSize(surfaceTracks, 0));
 float east = texture2D(surfaceTracks, uv + vec2(texel.x, 0.0)).r, west = texture2D(surfaceTracks, uv - vec2(texel.x, 0.0)).r;
 float south = texture2D(surfaceTracks, uv + vec2(0.0, texel.y)).r, north = texture2D(surfaceTracks, uv - vec2(0.0, texel.y)).r;
 return vec2(east - west, south - north) / (2.0 * texel * surfaceTrackBounds.zw);
}

// Ice crystals and mineral grains. Each cell holds one facet tilted at random around the surface normal; it flashes when it mirrors
// the sun toward the eye. Three cell sizes keep glints from the foreground to the distance; a glint stays about one
// pixel wide whatever its cell size, and a level fades out before its cells become subpixel.
float terrainCrystalGlints(vec3 world, vec3 surfaceNormal, vec3 halfway, float footprint) {
 const float finestCellsPerMeter = 240.0;
 const float coarserScale = .33;
 const float facetSpread = .75;
 const float flashStart = .975;
 const float glintPixels = .9;      // glint radius in pixels
 const float maxDotRadius = .42;    // share of a cell
 float glints = 0.0;
 float cells = finestCellsPerMeter;
 for (int level = 0; level < 3; level++) {
  vec2 p = world.xz * cells;
  vec2 cell = floor(p);
  vec3 tilt = vec3(hash12(cell), hash12(cell + 31.7), hash12(cell + 57.3)) * 2.0 - 1.0;
  vec3 facet = normalize(surfaceNormal + tilt * facetSpread);
  float flash = smoothstep(flashStart, 1.0, dot(facet, halfway));
  float dotRadius = min(maxDotRadius, footprint * cells * glintPixels);
  float crystal = 1.0 - smoothstep(dotRadius * .5, dotRadius, length(fract(p) - .5));
  float resolved = 1.0 - smoothstep(.25, .6, footprint * cells);
  glints += flash * crystal * resolved;
  cells *= coarserScale;
 }
 return glints;
}
#endif

#ifdef TERRAIN_SAND
uniform sampler2D terrainSandWeight;
uniform vec3 terrainSandColor;
uniform float terrainSandHeading;   // degrees the wind blows along: 0 = +X, 90 = +Z
uniform float terrainSandVariation, terrainSandGrain, terrainSandRippleSize, terrainSandRippleHeight, terrainSandSparkle, terrainSandRoughness;

// Height (0..1) of the wind ripples: crests run across the wind, gentle on the windward side and steep on the lee.
// Noise bends the crests and makes them fork, and lets them die out in patches.
float terrainSandRipples(vec2 p) {
 const float bend = .9;            // ripple spacings a crest wanders
 const float bendFrequency = .35;  // per metre
 const float lee = .35;            // how far the crest is pushed downwind: 0 symmetric
 float heading = radians(terrainSandHeading);
 float along = dot(p, vec2(cos(heading), sin(heading))) / terrainSandRippleSize;
 along += (valueNoise(vec3(p * bendFrequency, 31.0)) - .5) * 2.0 * bend + (valueNoise(vec3(p * bendFrequency * 3.1, 47.0)) - .5) * bend * .5;
 float phase = fract(along);
 float crest = phase < 1.0 - lee ? phase / (1.0 - lee) : (1.0 - phase) / lee;
 float patches = smoothstep(.25, .6, valueNoise(vec3(p * .21, 59.0)));
 return crest * crest * (3.0 - 2.0 * crest) * mix(.35, 1.0, patches);
}
#endif

float terrainHeightAt(vec2 grid, out vec3 groundNormal) {
 ivec2 size = textureSize(terrainHeights, 0);
 ivec2 i = min(ivec2(grid), size - 2);
 vec2 f = grid - vec2(i);
 float a = texelFetch(terrainHeights, i, 0).r;
 float b = texelFetch(terrainHeights, i + ivec2(1, 0), 0).r;
 float c = texelFetch(terrainHeights, i + ivec2(0, 1), 0).r;
 float d = texelFetch(terrainHeights, i + ivec2(1, 1), 0).r;
 vec2 gradient = vec2(mix(b - a, d - c, f.y), mix(c - a, d - b, f.x)) * vec2(size - 1) / terrainBounds.zw;
 groundNormal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
 return f.x + f.y <= 1.0 ? a + (b - a) * f.x + (c - a) * f.y : d + (c - d) * (1.0 - f.x) + (b - d) * (1.0 - f.y);
}

vec4 terrainSample(int layer, vec2 uv, vec2 dx, vec2 dy) {
 if (layer == TERRAIN_DETAIL) return textureGrad(terrainDetail, uv, dx, dy);
 #ifdef TERRAIN_SNOW_DETAIL
 if (layer == TERRAIN_SNOW_NORMAL) return textureGrad(terrainSnowNormal, uv, dx, dy);
 if (layer == TERRAIN_SNOW_ROUGHNESS) return textureGrad(terrainSnowRoughness, uv, dx, dy);
 #endif
 #ifdef TERRAIN_LAYER_ARRAY
 return textureGrad(terrainLayerArray, vec3(uv, float(layer)), dx, dy);
 #else
 if (layer == TERRAIN_GRASS) return textureGrad(terrainGrass, uv, dx, dy);
 if (layer == TERRAIN_ROCK) return textureGrad(terrainRock, uv, dx, dy);
 if (layer == TERRAIN_SNOW) return textureGrad(terrainSnow, uv, dx, dy);
 #ifdef TERRAIN_FOREST_FLOOR
 if (layer == TERRAIN_FOREST) return textureGrad(terrainForest, uv, dx, dy);
 #endif
 return textureGrad(terrainMud, uv, dx, dy);
 #endif
}

vec4 terrainTexture(int layer, vec2 uv, vec2 dx, vec2 dy) {
 vec4 primary = terrainSample(layer, uv, dx, dy);
 if (terrainAntiTiling <= 0.0) return primary;
 vec4 secondary = terrainSample(layer, uv * .731 + vec2(17.13, 23.71), dx * .731, dy * .731);
 float blend = (.25 + .5 * valueNoise(vec3(uv * .19, 5.7))) * terrainAntiTiling;
 return mix(primary, secondary, blend);
}

vec4 terrainProjection(int layer, vec2 uv, vec2 dx, vec2 dy, float handedness) {
 vec2 orientation = vec2(handedness, 1.0);
 return terrainTexture(layer, uv * orientation, dx * orientation, dy * orientation);
}

vec4 terrainTriplanar(int layer, vec3 p, vec3 dx, vec3 dy, vec3 signN, vec3 axes) {
 vec4 color = vec4(0.0);
 if (axes.x > 0.0) color += terrainProjection(layer, p.zy, dx.zy, dy.zy, -signN.x) * axes.x;
 if (axes.y > 0.0) color += terrainTexture(layer, p.xz * vec2(1.0, -signN.y), dx.xz * vec2(1.0, -signN.y), dy.xz * vec2(1.0, -signN.y)) * axes.y;
 if (axes.z > 0.0) color += terrainProjection(layer, p.xy, dx.xy, dy.xy, signN.z) * axes.z;
 return color;
}

vec3 terrainNormalDetail(vec3 p, vec3 dx, vec3 dy, vec3 signN, vec3 axes) {
 vec3 detail = vec3(0.0);
 if (axes.x > 0.0) {
  vec3 n = normalize(terrainProjection(TERRAIN_DETAIL, p.zy, dx.zy, dy.zy, -signN.x).xyz * 2.0 - 1.0);
  detail += vec3((n.z - 1.0) * signN.x, n.y, -n.x * signN.x) * axes.x;
 }
 if (axes.y > 0.0) {
  vec2 orientation = vec2(1.0, -signN.y);
  vec3 n = normalize(terrainTexture(TERRAIN_DETAIL, p.xz * orientation, dx.xz * orientation, dy.xz * orientation).xyz * 2.0 - 1.0);
  detail += vec3(n.x, (n.z - 1.0) * signN.y, -n.y * signN.y) * axes.y;
 }
 if (axes.z > 0.0) {
  vec3 n = normalize(terrainProjection(TERRAIN_DETAIL, p.xy, dx.xy, dy.xy, signN.z).xyz * 2.0 - 1.0);
  detail += vec3(n.x * signN.z, n.y, (n.z - 1.0) * signN.z) * axes.z;
 }
 return detail;
}
`;

const TERRAIN_FRAGMENT = /* glsl */`
 vec2 terrainUV = (vSurfaceWorld.xz - terrainBounds.xy) / terrainBounds.zw;
 bool terrainInside = all(greaterThanEqual(terrainUV, vec2(0.0))) && all(lessThanEqual(terrainUV, vec2(1.0)));
 vec2 terrainSize = vec2(textureSize(terrainHeights, 0));
 vec2 terrainGrid = clamp(terrainUV, 0.0, 1.0) * (terrainSize - 1.0);
 vec3 terrainNormal = inverseTransformDirection(surfaceGeometricNormal, viewMatrix);
 vec3 terrainGround = vSurfaceWorld;
 float terrainContact = 1.0;
 float terrainGroundRelief = .5;
 float sandCover = 0.0;
 if (terrainProp) {
  terrainGround.y = terrainHeightAt(terrainGrid, terrainNormal);
  terrainContact = 0.0;
 }
 vec3 terrainP = terrainGround * terrainTiling;
 vec3 terrainSnowAlbedo = surfaceSnowColor;
 // Compute gradients before branching so mip selection stays defined at seams.
 vec3 terrainDx = dFdx(terrainP), terrainDy = dFdy(terrainP);
 float aboveGround = vSurfaceWorld.y - terrainGround.y;
 if (!terrainProp || (terrainInside && terrainContactBand > 0.0 && aboveGround < terrainContactBand * 1.45)) {
 vec3 terrainAxes = pow(abs(terrainNormal), vec3(terrainSharpness));
 terrainAxes /= max(dot(terrainAxes, vec3(1.0)), .0001);
 terrainAxes *= smoothstep(vec3(.001), vec3(.008), terrainAxes);
 terrainAxes /= dot(terrainAxes, vec3(1.0));
 vec3 terrainSign = sign(terrainNormal + vec3(.00001));
 vec4 terrainWeights = textureLod(terrainLayers, (terrainGrid + .5) / terrainSize, 0.0);
 vec4 grass = vec4(0.0), rock = vec4(0.0), snow = vec4(0.0), mud = vec4(0.0);
 if (terrainWeights.x > 0.0) grass = terrainTriplanar(TERRAIN_GRASS, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
 if (terrainWeights.y > 0.0) rock = terrainTriplanar(TERRAIN_ROCK, terrainP * terrainRockScale, terrainDx * terrainRockScale, terrainDy * terrainRockScale, terrainSign, terrainAxes);
 if (terrainWeights.z > 0.0 || (terrainSnowCover && !terrainProp)) {
  snow = terrainTriplanar(TERRAIN_SNOW, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
  terrainSnowAlbedo = snow.rgb;
 }
 if (terrainWeights.w > 0.0) mud = terrainTriplanar(TERRAIN_MUD, terrainP * 1.4, terrainDx * 1.4, terrainDy * 1.4, terrainSign, terrainAxes);
 vec4 microHeight = vec4(grass.a, rock.a, snow.a, mud.a);
 terrainWeights *= exp2((microHeight - .5) * terrainHeightBlend * 8.0);
 vec4 forest = vec4(0.0);
 float forestWeight = 0.0;
 #ifdef TERRAIN_FOREST_FLOOR
 forestWeight = textureLod(terrainForestWeight, (terrainGrid + .5) / terrainSize, 0.0).r;
 if (forestWeight > 0.0) forest = terrainTriplanar(TERRAIN_FOREST, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
 forestWeight *= exp2((forest.a - .5) * terrainHeightBlend * 8.0);
 #endif
 float totalWeight = max(dot(terrainWeights, vec4(1.0)) + forestWeight, .0001);
 terrainWeights /= totalWeight;
 forestWeight /= totalWeight;
 terrainGroundRelief = dot(microHeight, terrainWeights) + forest.a * forestWeight;
 if (terrainProp) {
  float relief = dot(microHeight - .5, terrainWeights) + (forest.a - .5) * forestWeight;
  float seam = terrainContactBand * clamp(1.0 + relief * terrainHeightBlend, .55, 1.45);
  terrainContact = 1.0 - smoothstep(0.0, seam, aboveGround);
 }
 vec3 terrainColor = grass.rgb * terrainWeights.x + rock.rgb * terrainWeights.y + snow.rgb * terrainWeights.z + mud.rgb * terrainWeights.w + forest.rgb * forestWeight;
 diffuseColor.rgb = mix(diffuseColor.rgb, terrainColor, terrainContact);
 roughnessFactor = mix(roughnessFactor, dot(terrainWeights, vec4(.95, .85, .82, .75)) + .92 * forestWeight, terrainContact);
 metalnessFactor *= 1.0 - terrainContact;
 vec3 sandNormal = terrainNormal;
 #ifdef TERRAIN_SAND
 sandCover = terrainProp ? 0.0 : textureLod(terrainSandWeight, (terrainGrid + .5) / terrainSize, 0.0).r;
 if (sandCover > 0.0) {
  // Sand fills the hollows of the ground it meets first, so its edge follows the texture instead of fading evenly.
  const float sandEdgeWidth = .25;
  float sandEdge = terrainGroundRelief * (1.0 - sandEdgeWidth);
  sandCover = smoothstep(sandEdge, sandEdge + sandEdgeWidth, sandCover);
  vec2 sandPoint = vSurfaceWorld.xz;
  float sandFootprint = length(fwidth(sandPoint));
  const float patchFrequency = .17;        // large colour patches per metre
  const float patchShade = .16;            // albedo lost in the darkest patch at full variation
  const float grainsPerMeter = 420.0;
  const float grainShade = .2;             // albedo range of single grains at full grain
  float shadePatch = valueNoise(vec3(sandPoint * patchFrequency, 13.0)) * .65 + valueNoise(vec3(sandPoint * patchFrequency * 4.3, 17.0)) * .35;
  float grainsVisible = 1.0 - smoothstep(.3, .9, sandFootprint * grainsPerMeter);
  float grains = (hash12(floor(sandPoint * grainsPerMeter)) - .5) * grainsVisible;
  vec3 sandAlbedo = terrainSandColor * (1.0 - patchShade * terrainSandVariation * (1.0 - shadePatch)) * (1.0 + grains * grainShade * terrainSandGrain);
  // Ripples fade out before a pixel spans one, and on slopes too steep to hold them.
  const float rippleRelief = .02;          // m from trough to crest at ripple height 1
  // A track flattens the ripples it crosses.
  float ripplesVisible = (1.0 - smoothstep(.25, .6, sandFootprint / terrainSandRippleSize)) * smoothstep(.7, .92, terrainNormal.y) * (1.0 - surfaceTrack(vSurfaceWorld));
  if (ripplesVisible > 0.0 && terrainSandRippleHeight > 0.0) {
   float sampleStep = terrainSandRippleSize * .12;
   float here = terrainSandRipples(sandPoint);
   vec2 slope = vec2(terrainSandRipples(sandPoint + vec2(sampleStep, 0.0)) - here, terrainSandRipples(sandPoint + vec2(0.0, sampleStep)) - here)
     * (rippleRelief * terrainSandRippleHeight * ripplesVisible / sampleStep);
   sandNormal = normalize(terrainNormal - vec3(slope.x, 0.0, slope.y));
   // Troughs collect a little shade and darker, heavier grains.
   sandAlbedo *= 1.0 - .08 * terrainSandRippleHeight * ripplesVisible * (1.0 - here);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, sandAlbedo, sandCover * terrainContact);
  roughnessFactor = mix(roughnessFactor, terrainSandRoughness, sandCover * terrainContact);
 }
 #endif
 if (terrainDetailStrength > 0.0) {
  vec3 detail = terrainNormalDetail(terrainP * 3.4, terrainDx * 3.4, terrainDy * 3.4, terrainSign, terrainAxes);
  // The shared rock detail does not belong on sand.
  vec3 detailedNormal = normalize(terrainNormal + detail * terrainDetailStrength * (1.0 - sandCover));
  normal = normalize(mix(normal, transformDirection(detailedNormal, viewMatrix), terrainContact));
 }
 if (sandCover > 0.0) normal = normalize(mix(normal, transformDirection(sandNormal, viewMatrix), sandCover * terrainContact));
 }
 float shoreWet = 0.0;
 if (terrainInside && terrainShoreWidth > 0.0) {
  float aboveWater = max(vSurfaceWorld.y - terrainWaterLevel, 0.0);
  shoreWet = (1.0 - smoothstep(0.0, terrainShoreWidth, aboveWater)) * terrainShoreWetness;
 }
`;

// Repeat-wrapped color maps (separate or packed in TERRAIN_LAYERS order) carry material height in alpha.
export function createTerrainMaterial(parameters = {}, {
 field, layers, layerArray, detailNormal, appearance = createTerrainAppearance(), contactBand, snowMaterial, snowLook = createSnowLook(), sandLook = createSandLook(), drainage, runoffFlow, puddleSky, ...surface
} = {}) {
 const hasLayers = layerArray !== undefined ?
  layerArray?.isDataArrayTexture && layerArray.image.depth >= (field?.forestMap ? TERRAIN_LAYERS.length : 4) :
  TERRAIN_LAYERS.slice(0, 4).every(name => layers?.[name]?.isTexture);
 if (!field?.heightMap || !field?.weightMap || !hasLayers || !detailNormal?.isTexture) {
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
 if (field.forestMap) material.defines = {...material.defines, TERRAIN_FOREST_FLOOR: 1};
 if (field.sandMap) material.defines = {...material.defines, TERRAIN_SAND: 1};
 if (layerArray) material.defines = {...material.defines, TERRAIN_LAYER_ARRAY: 1};
 const compileSurface = material.onBeforeCompile;
 const uniforms = {
  ...(drainage && puddleSky),
  terrainDrainage: {value: drainage?.texture ?? null},
  terrainFlow: {value: runoffFlow?.texture ?? null},
  terrainRunoffCoverage: runoffFlow?.coverage ?? {value: 0},
  terrainRunoffSource: runoffLook.sourceArea, terrainRunoffFull: runoffLook.fullArea, terrainRunoffRutSource: runoffLook.rutSourceArea,
  terrainRunoffSpeed: runoffLook.speed, terrainRunoffRippleSize: runoffLook.rippleSize, terrainRunoffRippleStrength: runoffLook.rippleStrength,
  terrainPuddleFill: drainage?.fill ?? {value: 0},
  terrainHeights: {value: field.heightMap}, terrainLayers: {value: field.weightMap}, terrainBounds: {value: field.bounds},
  terrainLayerArray: {value: layerArray ?? null},
  terrainGrass: {value: layers?.grass}, terrainRock: {value: layers?.rock}, terrainSnow: {value: layers?.snow}, terrainMud: {value: layers?.mud},
  terrainForest: {value: layers?.forest}, terrainForestWeight: {value: field.forestMap ?? null},
  terrainSandWeight: {value: field.sandMap ?? null}, terrainSandColor: sandLook.color, terrainSandHeading: sandLook.rippleHeading,
  terrainSandVariation: sandLook.variation, terrainSandGrain: sandLook.grain, terrainSandRippleSize: sandLook.rippleSize,
  terrainSandRippleHeight: sandLook.rippleHeight, terrainSandSparkle: sandLook.sparkle, terrainSandRoughness: sandLook.roughness,
  terrainDetail: {value: detailNormal}, terrainProp: {value: contactBand !== undefined}, terrainContactBand: {value: contactBand ?? 0},
  terrainTiling: appearance.tiling, terrainSharpness: appearance.sharpness, terrainAntiTiling: appearance.antiTiling,
  terrainRockScale: appearance.rockScale ?? {value: .55},
  terrainDetailStrength: appearance.detailStrength, terrainHeightBlend: appearance.heightBlend, terrainWaterLevel: appearance.waterLevel,
  terrainShoreWidth: appearance.shoreWidth, terrainShoreWetness: appearance.shoreWetness,
  terrainSnowNormal: {value: snowMaterial?.normal ?? null},
  terrainSnowRoughness: {value: snowMaterial?.roughness ?? null},
  terrainSnowScatter: snowLook.scatter, terrainSnowSparkle: snowLook.sparkle, terrainSnowEdgeBreakup: snowLook.edgeBreakup,
  terrainSnowTrackRelief: snowLook.trackRelief, terrainSnowTint: snowLook.tint, terrainSnowShadowTint: snowLook.shadowTint,
  terrainSnowNormalStrength: {value: snowMaterial?.normalStrength ?? 1},
  terrainSnowCover: field.snowCover ?? {value: false}, terrainSnowDepth: {value: field.snowMap ?? null},
 };
 material.onBeforeCompile = shader => {
  compileSurface(shader);
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${TERRAIN_GLSL}\nvoid main() {`)
   .replace('float up = inverseTransformDirection', `${TERRAIN_FRAGMENT}\nfloat up = inverseTransformDirection`)
   .replace('snowCoverage *= 1.0 - track * .92;', `
    if (terrainSnowCover && !terrainProp) {
     snowCoverage = textureLod(terrainSnowDepth, (terrainGrid + .5) / terrainSize, 0.0).r;
     #ifdef TERRAIN_SNOW_DETAIL
     // Thin snow lies in the hollows of the ground texture and in patches before it covers the bumps.
     const float snowPatchFrequency = 2.3;
     const float snowCrumbFrequency = 11.0;
     const float snowEdgeWidth = .14;
     float patches = mix(valueNoise(vec3(vSurfaceWorld.xz * snowPatchFrequency, 3.0)), valueNoise(vec3(vSurfaceWorld.xz * snowCrumbFrequency, 7.0)), .4);
     float settleOrder = mix(terrainGroundRelief, patches, .6);
     float snowEdgeStart = terrainSnowEdgeBreakup * settleOrder * (1.0 - snowEdgeWidth);
     snowCoverage = smoothstep(snowEdgeStart, snowEdgeStart + mix(1.0, snowEdgeWidth, terrainSnowEdgeBreakup), snowCoverage);
     // A thin packed layer lets the wet soil show through the rut.
     const float thinSnowCoverage = .85;
     const float mudRevealStrength = .7;
     float mudReveal = track * (1.0 - smoothstep(0.0, thinSnowCoverage, snowCoverage));
     vec4 trackMud = terrainTexture(TERRAIN_MUD, terrainP.xz, terrainDx.xz, terrainDy.xz);
     diffuseColor.rgb = mix(diffuseColor.rgb, trackMud.rgb, mudReveal);
     snowCoverage *= 1.0 - mudReveal * mudRevealStrength;
     #endif
    } else snowCoverage *= 1.0 - track * .92;
   `)
   .replace('float runoffSlope = 1.0 - smoothstep(.35, .88, abs(up));', `
    float runoffFilmCoverage = 0.0;
    #ifdef TERRAIN_RUNOFF_FLOW
    float runoffDepth = 0.0;
    vec2 runoffVelocity = vec2(0.0);
    if (terrainRunoffCoverage > 0.0 && terrainInside) {
     // The bake holds one sample per height sample. Wander the lookup so streams lose the grid's straight segments.
     const float meanderFrequency = .55;
     const float meanderMeters = .3;
     vec2 meander = vec2(valueNoise(vec3(vSurfaceWorld.xz * meanderFrequency, 11.0)),
       valueNoise(vec3(vSurfaceWorld.xz * meanderFrequency, 23.0))) - .5;
     vec4 flow = textureLod(terrainFlow, (terrainGrid + .5) / terrainSize + meander * meanderMeters / terrainBounds.zw, 0.0);
     float spilling = 1.0;
     #ifdef TERRAIN_DRAINAGE
     // Hollows keep the water that reaches them until they are nearly full.
     spilling = smoothstep(.85, 1.0, terrainPuddleFill);
     #endif
     float discharge = (flow.b - flow.a * (1.0 - spilling)) * terrainRunoffCoverage;
     float source = mix(terrainRunoffSource, terrainRunoffRutSource, track);
     runoffDepth = saturate((discharge - source) / max(terrainRunoffFull - source, .001));
     const float speedPerGrade = 3.2;              // m/s per unit of slope
     const vec2 speedRange = vec2(.12, 2.1);       // m/s
     float grade = length(flow.rg);
     vec2 downhill = grade > 0.0 ? flow.rg / grade : vec2(0.0);
     runoffVelocity = downhill * clamp(grade * speedPerGrade, speedRange.x, speedRange.y) * terrainRunoffSpeed;
     // A thin sheet gathers into rivulets: threads of noise stretched along the slope, the lowest filling first.
     // More water fills more threads until they join into one film.
     const float rivuletsPerMeter = 4.5;
     const float rivuletStretch = 9.0;   // a thread is this many times longer than wide
     const float rivuletEdge = .08;
     vec2 threadCoordinates = vec2(dot(vSurfaceWorld.xz, vec2(-downhill.y, downhill.x)), dot(vSurfaceWorld.xz, downhill) / rivuletStretch);
     float thread = valueNoise(vec3(threadCoordinates * rivuletsPerMeter, 5.0));
     float threads = smoothstep(thread - rivuletEdge, thread + rivuletEdge, runoffDepth) * step(.0001, runoffDepth);
     runoffFilmCoverage = max(threads, smoothstep(1.0 - rivuletEdge, 1.0, runoffDepth));
    }
    const float wetSnowDarkening = .4;
    const float packedRutWetness = .85;
    float waterOverSnow = mix(wetSnowDarkening, packedRutWetness, track);
    snowCoverage *= 1.0 - runoffFilmCoverage * waterOverSnow;
    float runoffSlope = runoffFilmCoverage * (1.0 - snowCoverage);
    #else
    float runoffSlope = 1.0 - smoothstep(.35, .88, abs(up));
    #endif
   `)
   .replace('if (surfaceRunoff > 0.0 && wet > .1 && runoffSlope > 0.0) {', `
    #ifdef TERRAIN_RUNOFF_FLOW
    if (surfaceRunoff > 0.0 && runoffSlope > 0.0) {
    #else
    if (surfaceRunoff > 0.0 && wet > .1 && runoffSlope > 0.0) {
    #endif
   `)
   .replace('float streak = surfaceRainStreaks(vSurfaceWorld) * surfaceRunoff * runoffSlope * smoothstep(.1, .72, wet);', `
    #ifdef TERRAIN_RUNOFF_FLOW
    float streak = runoffSlope * surfaceRunoff;
    #else
    float streak = surfaceRainStreaks(vSurfaceWorld) * surfaceRunoff * runoffSlope * smoothstep(.1, .72, wet);
    #endif
   `)
   .replace('diffuseColor.rgb *= 1.0 - .42 * streak;', `
    #ifdef TERRAIN_RUNOFF_FLOW
    const float skinStep = .012;           // m between the samples that measure the skin's slope
    const float skinRelief = .018;         // m of ripple height in a full stream
    const float shallowRelief = .35;       // share of that relief where the stream starts
    // Ripples fade out well before a pixel spans one, or they would alias into bands.
    float skinVisible = 1.0 - smoothstep(.1, .35, length(fwidth(vSurfaceWorld.xz)) / terrainRunoffRippleSize);
    if (skinVisible > 0.0) {
     float skin = terrainFlowSkin(vSurfaceWorld.xz, runoffVelocity);
     vec2 skinSlope = vec2(
      terrainFlowSkin(vSurfaceWorld.xz + vec2(skinStep, 0.0), runoffVelocity) - skin,
      terrainFlowSkin(vSurfaceWorld.xz + vec2(0.0, skinStep), runoffVelocity) - skin
     ) * skinRelief * terrainRunoffRippleStrength * mix(shallowRelief, 1.0, runoffDepth) * skinVisible / skinStep;
     vec3 skinNormal = inverseTransformDirection(surfaceGeometricNormal, viewMatrix) - vec3(skinSlope.x, 0.0, skinSlope.y);
     normal = normalize(mix(normal, transformDirection(normalize(skinNormal), viewMatrix), streak));
    }
    #endif
    diffuseColor.rgb *= 1.0 - .42 * streak;
   `)
   .replace('if (wet > .45 && surfacePuddles > 0.0) {', `
    #ifdef TERRAIN_DRAINAGE
    if (terrainPuddleFill > 0.0) {
     puddle = terrainPuddle(terrainGrid, terrainSize, vSurfaceWorld.y);
     snowCoverage *= 1.0 - puddle;
    #else
    if (wet > .45 && surfacePuddles > 0.0) {
   `)
   .replace('diffuseColor.rgb *= 1.0 - surfacePuddleDarkening * puddle;', `
    #endif
    diffuseColor.rgb *= 1.0 - surfacePuddleDarkening * puddle;
   `)
   .replace('float standingWater = puddle;', 'float standingWater = max(puddle, runoffFilmCoverage * (1.0 - snowCoverage));')
   .replace('diffuseColor.rgb = mix(diffuseColor.rgb, surfaceSnowColor, snowCoverage);', '')
   .replace('roughnessFactor = mix(roughnessFactor, .83, snowCoverage);', `
    #ifdef TERRAIN_SNOW_DETAIL
    vec2 snowUv = terrainP.xz * vec2(1.0, -1.0);
    vec2 snowDx = dFdx(snowUv), snowDy = dFdy(snowUv);
    vec3 snowNormal = terrainTexture(TERRAIN_SNOW_NORMAL, snowUv, snowDx, snowDy).xyz * 2.0 - 1.0;
    vec3 snowDetail = vec3(snowNormal.x, snowNormal.z - 1.0, -snowNormal.y);
    float compacted = terrainSnowCover && !terrainProp ? track : 0.0;
    // The track mask is finer than the mesh: its slope shades the edge of each print.
    vec2 trackSlope = compacted > 0.0 ? terrainTrackSlope(vSurfaceWorld) * terrainSnowTrackRelief : vec2(0.0);
    vec3 snowSurfaceNormal = normalize(terrainNormal + terrainSnowNormalStrength * snowDetail + vec3(trackSlope.x, 0.0, trackSlope.y));
    normal = normalize(mix(normal, transformDirection(snowSurfaceNormal, viewMatrix), snowCoverage));
    const float compactSnowRoughness = .43;
    const vec3 compactSnowTint = vec3(.8, .9, 1.0);
    const float snowVariationFrequency = .22;
    const float snowVariationShade = .06;   // albedo lost in the dullest patches
    const float snowTextureShare = .3;      // how much of the snow photo's own colour remains under the tint
    float snowRoughness = terrainTexture(TERRAIN_SNOW_ROUGHNESS, snowUv, snowDx, snowDy).r;
    float driftVariation = valueNoise(vec3(vSurfaceWorld.xz * snowVariationFrequency, 0.0));
    terrainSnowAlbedo = mix(terrainSnowTint, terrainSnowAlbedo, snowTextureShare);
    terrainSnowAlbedo *= mix(1.0 - snowVariationShade, 1.0, driftVariation);
    terrainSnowAlbedo *= mix(vec3(1.0), compactSnowTint, compacted);
    snowRoughness = mix(snowRoughness, min(snowRoughness, compactSnowRoughness), compacted);
    roughnessFactor = mix(roughnessFactor, snowRoughness, snowCoverage);
    #else
    roughnessFactor = mix(roughnessFactor, .83, snowCoverage);
    #endif
    diffuseColor.rgb = mix(diffuseColor.rgb, terrainSnowAlbedo, snowCoverage);
   `)
   .replace('#include <opaque_fragment>', `
    #if defined(TERRAIN_SAND) && NUM_DIR_LIGHTS > 0
    {
     // Mineral grains flash in the sun where the sand is dry and bare.
     float bareSand = sandCover * (1.0 - snowCoverage) * (1.0 - wet);
     vec3 sandLight = directionalLights[0].direction;
     if (bareSand > 0.0 && terrainSandSparkle > 0.0 && dot(normal, sandLight) > 0.0) {
      const float sandGlintStrength = 1.1;
      vec3 sandHalfway = inverseTransformDirection(normalize(sandLight + geometryViewDir), viewMatrix);
      float sandGlints = terrainCrystalGlints(vSurfaceWorld, inverseTransformDirection(normal, viewMatrix), sandHalfway, length(fwidth(vSurfaceWorld.xz)));
      // The lit result already carries the shadow map: glints scale with it so none flash in cast shadow.
      float sandLit = saturate(luminance(reflectedLight.directDiffuse) * 4.0);
      outgoingLight += directionalLights[0].color * sandGlints * sandGlintStrength * terrainSandSparkle * bareSand * sandLit;
     }
    }
    #endif
    #ifdef TERRAIN_SNOW_DETAIL
    if (snowCoverage > 0.0) {
     // In shade snow is lit by the sky alone, which reads blue.
     outgoingLight += reflectedLight.indirectDiffuse * (terrainSnowShadowTint - 1.0) * snowCoverage;
     #if NUM_DIR_LIGHTS > 0
     const vec3 snowScatterTint = vec3(.67, .82, 1.0);
     const float maxWrap = .6;            // how far past the terminator full scatter carries sunlight
     const float backlightStrength = .5;
     const float glintStrength = 2.4;
     const float packedGlintLoss = .75;   // packed tracks have crushed crystals
     vec3 snowLight = directionalLights[0].direction;
     vec3 sunColor = directionalLights[0].color;
     float facing = dot(normal, snowLight);
     // Recover the shadow-map visibility from the lit result, so scatter and glints stay out of cast shadows.
     float unshadowed = luminance(sunColor * diffuseColor.rgb) * RECIPROCAL_PI * max(facing, 0.0);
     float visible = saturate(luminance(reflectedLight.directDiffuse) / max(unshadowed, .0001));
     float sunVisibility = mix(1.0, visible, smoothstep(0.0, .15, facing));
     vec3 sunOnSnow = sunColor * diffuseColor.rgb * RECIPROCAL_PI * sunVisibility * snowCoverage;
     float wrap = terrainSnowScatter * maxWrap;
     float wrapped = saturate((facing + wrap) / (1.0 + wrap)) - max(facing, 0.0);
     float backlight = max(dot(-geometryViewDir, snowLight), 0.0) * (1.0 - abs(dot(surfaceGeometricNormal, snowLight)));
     outgoingLight += sunOnSnow * snowScatterTint * (wrapped + backlight * backlightStrength * terrainSnowScatter);
     if (terrainSnowSparkle > 0.0 && facing > 0.0) {
      vec3 halfway = inverseTransformDirection(normalize(snowLight + geometryViewDir), viewMatrix);
      vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
      float glints = terrainCrystalGlints(vSurfaceWorld, worldNormal, halfway, length(fwidth(vSurfaceWorld.xz)));
      outgoingLight += sunColor * sunVisibility * snowCoverage * glints * glintStrength * terrainSnowSparkle
        * (1.0 - packedGlintLoss * compacted);
     }
     #endif
    }
    #endif
    #ifdef TERRAIN_PUDDLE_SKY
    float waterReflection = max(puddle, runoffFilmCoverage * (1.0 - snowCoverage));
    if (waterReflection > 0.0) {
     const float waterFresnel = .02;
     float fresnel = waterFresnel + (1.0 - waterFresnel) * pow(1.0 - saturate(dot(normal, geometryViewDir)), 5.0);
     vec3 reflected = inverseTransformDirection(reflect(-geometryViewDir, normal), viewMatrix);
     outgoingLight = mix(outgoingLight, sky(reflected, 0.0), waterReflection * fresnel);
    }
    #endif
    #include <opaque_fragment>
   `)
   .replace('float wet = surfaceWeather.x', 'float wet = max(surfaceWeather.x, shoreWet)');
 };
 return material;
}

export {createValley, VALLEY_DEFAULTS} from './valley.js';
