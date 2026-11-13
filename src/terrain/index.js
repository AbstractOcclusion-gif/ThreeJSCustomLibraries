import * as THREE from 'three';
import {SKY_GLSL} from '../core/sky.js';
import {createWeatherSurfaceMaterial} from '../surface/index.js';
import {TERRAIN_LAYERS, TERRAIN_PALETTE_ROLES} from './terrain-rules.js';
import {createRunoffLook} from './runoff.js';
export {createRunoffLook, createTerrainRunoff} from './runoff.js';
export {createTerrainField, SNOW_DEPTH_SCALE, SNOW_DEFAULTS, SNOW_FIELDS, validateSnow} from './field.js';
export {createTerrainDrainage} from './drainage.js';
export {TERRAIN_LAYERS, TERRAIN_PALETTE_ROLES, PAINT_REACH, TERRAIN_PAINT_FIELDS, createTerrainRules, TERRAIN_PAINT_DEFAULTS, validateTerrainPaint, dominantTerrainLayer} from './terrain-rules.js';
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
export const TERRAIN_LAYER_ROUGHNESS = Object.freeze({grass: .95, rock: .85, snow: .82, mud: .75, forest: .92});
// The same for every palette role (TERRAIN_PALETTE_ROLES order).
export const TERRAIN_PALETTE_ROUGHNESS = Object.freeze({...TERRAIN_LAYER_ROUGHNESS, scree: .9, soil: .93});

// The colour each palette role is drawn toward (appearance.harmony): one earthy family, so no layer stands out.
export const TERRAIN_ROLE_TINTS = Object.freeze({grass: '#6f8f3a', rock: '#86817a', snow: '#eef1f3', mud: '#5f5238', forest: '#55682f', scree: '#8a8274', soil: '#7a6648'});

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
  macroVariation: {value: .5}, // large-scale light and dark patches over every layer, so far ground is not one flat colour (0 = off)
  // Palette mode: every texture set is shifted toward the colour of its role, so the layers of a landscape belong
  // together instead of each keeping the average colour of its photograph. The detail of the texture is kept.
  harmony: {value: .7},        // share of that shift (0 = the textures as they are)
  roleTints: {value: TERRAIN_PALETTE_ROLES.map(role => new THREE.Color(TERRAIN_ROLE_TINTS[role]))},
  // Junction sharpness applies near the camera and fades out between these two distances (m): from afar a sharp
  // edge between two flat colours reads as a pattern.
  edgeFade: {value: new THREE.Vector2(25, 110)},
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
// Ids past the layer slices, for the samplers terrainSample also serves.
const int TERRAIN_DETAIL = 64;
#ifdef TERRAIN_LAYER_DETAIL
// rg = tangent normal xy (OpenGL), b = roughness, one slice per layer. Sampled as layer TERRAIN_LAYER_SURFACE + index.
uniform highp sampler2DArray terrainLayerDetailArray;
uniform float terrainLayerDetail;
const int TERRAIN_LAYER_SURFACE = 32;
#endif
#ifdef TERRAIN_SNOW_DETAIL
const int TERRAIN_SNOW_NORMAL = TERRAIN_DETAIL + 1;
const int TERRAIN_SNOW_ROUGHNESS = TERRAIN_DETAIL + 2;
#endif
uniform vec4 terrainBounds;
uniform float terrainTiling, terrainSharpness, terrainAntiTiling, terrainDetailStrength, terrainHeightBlend;
uniform float terrainEdgeSharpness, terrainEdgeBreakup;
uniform float terrainRockScale;
uniform float terrainWaterLevel, terrainShoreWidth, terrainShoreWetness, terrainContactBand;
uniform bool terrainProp;
uniform bool terrainSnowCover;
#ifdef TERRAIN_PALETTE
// Palette mode: TERRAIN_PALETTE_SIZE texture sets, each with its own weight (four per slice of the weight array)
// and the layer role that sets its tiling and default roughness. terrainPaletteSnow: the snow set, or -1.
uniform highp sampler2DArray terrainPaletteWeights;
uniform int terrainPaletteRole[TERRAIN_PALETTE_SIZE];
uniform int terrainPaletteSnow;
const float terrainRoleRoughness[${TERRAIN_PALETTE_ROLES.length}] = float[](${TERRAIN_PALETTE_ROLES.map(name => TERRAIN_PALETTE_ROUGHNESS[name].toFixed(3)).join(', ')});
uniform float terrainMacroVariation, terrainHarmony;
uniform vec3 terrainPaletteMean[TERRAIN_PALETTE_SIZE];   // average colour of each set, linear
uniform vec3 terrainRoleTint[${TERRAIN_PALETTE_ROLES.length}];
uniform vec2 terrainEdgeFade;
#ifdef TERRAIN_CLIMATE
uniform sampler2D terrainClimate;   // r = moisture, 0 dry .. 1 wet
uniform vec3 terrainDryTint, terrainLushTint;
uniform float terrainClimateTint;
#endif
#endif
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

// Offset, in weight texels, applied where the layer maps are read: the junctions wander at a scale finer than the
// grid, so its steps and straight diagonals do not show. Each octave fades before a pixel spans it.
vec2 terrainEdgeWarp(vec2 world) {
 const vec2 wavelength = vec2(.9, .22);   // m, the two scales of the wander
 const vec2 reach = vec2(1.1, .45);       // weight texels each scale moves a junction at full break-up
 float footprint = length(fwidth(world));
 vec2 warp = vec2(0.0);
 for (int i = 0; i < 2; i++) {
  float visible = 1.0 - smoothstep(.25, .6, footprint / wavelength[i]);
  if (visible <= 0.0) continue;
  vec2 p = world / wavelength[i];
  warp += (vec2(valueNoise(vec3(p, 71.0 + float(i))), valueNoise(vec3(p + 19.7, 83.0 + float(i)))) - .5) * 2.0 * reach[i] * visible;
 }
 return warp * terrainEdgeBreakup;
}

// Sharpens a junction: each weight relative to the strongest is raised to a power, so the fade narrows around the
// line where two layers are equal. That line already follows the texture relief (terrainHeightBlend).
float terrainEdge(float weight, float strongest) {
 const float fullPower = 7.0;   // exponent added at edge sharpness 1
 float sharpness = terrainEdgeSharpness;
 #ifdef TERRAIN_PALETTE
 sharpness *= 1.0 - smoothstep(terrainEdgeFade.x, terrainEdgeFade.y, length(vViewPosition));
 #endif
 return weight > 0.0 ? weight * pow(weight / strongest, sharpness * fullPower) : 0.0;
}

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
 #ifdef TERRAIN_LAYER_DETAIL
 if (layer >= TERRAIN_LAYER_SURFACE) return textureGrad(terrainLayerDetailArray, vec3(uv, float(layer - TERRAIN_LAYER_SURFACE)), dx, dy);
 #endif
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

// Tangent normal (xyz) and roughness (w) of a detail sample: the shared detail is an RGB normal map without
// roughness (w = 0), a layer surface sample packs normal xy and roughness.
vec4 terrainDetailTexel(int layer, vec4 texel) {
 #ifdef TERRAIN_LAYER_DETAIL
 if (layer >= TERRAIN_LAYER_SURFACE) {
  vec2 tilt = texel.xy * 2.0 - 1.0;
  return vec4(tilt, sqrt(max(1.0 - dot(tilt, tilt), 0.0)), texel.b);
 }
 #endif
 return vec4(normalize(texel.xyz * 2.0 - 1.0), 0.0);
}

// Triplanar detail of the shared normal map (TERRAIN_DETAIL) or of one layer (TERRAIN_LAYER_SURFACE + index):
// xyz = offset to add to the world normal, w = roughness.
vec4 terrainNormalDetail(int layer, vec3 p, vec3 dx, vec3 dy, vec3 signN, vec3 axes) {
 vec4 detail = vec4(0.0);
 if (axes.x > 0.0) {
  vec4 n = terrainDetailTexel(layer, terrainProjection(layer, p.zy, dx.zy, dy.zy, -signN.x));
  detail += vec4((n.z - 1.0) * signN.x, n.y, -n.x * signN.x, n.w) * axes.x;
 }
 if (axes.y > 0.0) {
  vec2 orientation = vec2(1.0, -signN.y);
  vec4 n = terrainDetailTexel(layer, terrainTexture(layer, p.xz * orientation, dx.xz * orientation, dy.xz * orientation));
  detail += vec4(n.x, (n.z - 1.0) * signN.y, -n.y * signN.y, n.w) * axes.y;
 }
 if (axes.z > 0.0) {
  vec4 n = terrainDetailTexel(layer, terrainProjection(layer, p.xy, dx.xy, dy.xy, signN.z));
  detail += vec4(n.x * signN.z, n.y, (n.z - 1.0) * signN.z, n.w) * axes.z;
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
 vec2 terrainWeightUV = (terrainGrid + .5 + (terrainEdgeBreakup > 0.0 ? terrainEdgeWarp(terrainGround.xz) : vec2(0.0))) / terrainSize;
 const float mudScale = 1.4;   // mud texture repeats per repeat of the other layers
 #ifdef TERRAIN_PALETTE
 float paletteWeight[TERRAIN_PALETTE_SIZE];
 vec4 paletteTexel[TERRAIN_PALETTE_SIZE];
 float paletteScale[TERRAIN_PALETTE_SIZE];
 for (int group = 0; group < TERRAIN_PALETTE_SIZE / 4; group++) {
  vec4 four = textureLod(terrainPaletteWeights, vec3(terrainWeightUV, float(group)), 0.0);
  paletteWeight[group * 4] = four.x; paletteWeight[group * 4 + 1] = four.y; paletteWeight[group * 4 + 2] = four.z; paletteWeight[group * 4 + 3] = four.w;
 }
 bool snowLies = terrainSnowCover && !terrainProp;
 float strongest = .0001;
 vec3 climateTint = vec3(1.0);
 #ifdef TERRAIN_CLIMATE
 climateTint = mix(vec3(1.0), mix(terrainDryTint, terrainLushTint, textureLod(terrainClimate, terrainWeightUV, 0.0).r), terrainClimateTint);
 #endif
 for (int i = 0; i < TERRAIN_PALETTE_SIZE; i++) {
  paletteTexel[i] = vec4(0.0);
  int role = terrainPaletteRole[i];
  paletteScale[i] = role == TERRAIN_ROCK ? terrainRockScale : role == TERRAIN_MUD ? mudScale : 1.0;
  if (paletteWeight[i] <= 0.0 && !(snowLies && i == terrainPaletteSnow)) continue;
  paletteTexel[i] = terrainTriplanar(i, terrainP * paletteScale[i], terrainDx * paletteScale[i], terrainDy * paletteScale[i], terrainSign, terrainAxes);
  paletteTexel[i].rgb *= mix(vec3(1.0), terrainRoleTint[role] / max(terrainPaletteMean[i], vec3(.02)), terrainHarmony);
  if (role == TERRAIN_GRASS || role == TERRAIN_FOREST) paletteTexel[i].rgb *= climateTint;
  if (i == terrainPaletteSnow) terrainSnowAlbedo = paletteTexel[i].rgb;
  paletteWeight[i] *= exp2((paletteTexel[i].a - .5) * terrainHeightBlend * 8.0);
  strongest = max(strongest, paletteWeight[i]);
 }
 float totalWeight = 0.0;
 bool sharpEdges = terrainEdgeSharpness > 0.0 && length(vViewPosition) < terrainEdgeFade.y;
 for (int i = 0; i < TERRAIN_PALETTE_SIZE; i++) {
  if (sharpEdges) paletteWeight[i] = terrainEdge(paletteWeight[i], strongest);
  totalWeight += paletteWeight[i];
 }
 totalWeight = max(totalWeight, .0001);
 vec3 terrainColor = vec3(0.0);
 float layerRoughness = 0.0;
 terrainGroundRelief = 0.0;
 for (int i = 0; i < TERRAIN_PALETTE_SIZE; i++) {
  paletteWeight[i] /= totalWeight;
  terrainColor += paletteTexel[i].rgb * paletteWeight[i];
  terrainGroundRelief += paletteTexel[i].a * paletteWeight[i];
  layerRoughness += terrainRoleRoughness[terrainPaletteRole[i]] * paletteWeight[i];
 }
 if (terrainMacroVariation > 0.0) {
  // Two sizes of light and dark, far larger than any texture repeat.
  const vec2 macroMeters = vec2(55.0, 340.0);
  const float macroShade = .22;   // albedo lost or gained at full variation
  float macro = valueNoise(vec3(terrainGround.xz / macroMeters.x, 91.0)) * .45 + valueNoise(vec3(terrainGround.xz / macroMeters.y, 97.0)) * .55;
  terrainColor *= 1.0 + (macro - .5) * 2.0 * macroShade * terrainMacroVariation;
 }
 if (terrainProp) {
  float seam = terrainContactBand * clamp(1.0 + (terrainGroundRelief - .5) * terrainHeightBlend, .55, 1.45);
  terrainContact = 1.0 - smoothstep(0.0, seam, aboveGround);
 }
 diffuseColor.rgb = mix(diffuseColor.rgb, terrainColor, terrainContact);
 vec3 layerNormalDetail = vec3(0.0);
 float layerDetailShare = 0.0;
 #ifdef TERRAIN_LAYER_DETAIL
 layerDetailShare = terrainLayerDetail;
 if (layerDetailShare > 0.0) {
  const float minShare = .02;   // a set under this share is not sampled: it would not show
  vec4 surface = vec4(0.0);
  float sampled = 0.0;
  for (int i = 0; i < TERRAIN_PALETTE_SIZE; i++) {
   if (paletteWeight[i] <= minShare) continue;
   surface += terrainNormalDetail(TERRAIN_LAYER_SURFACE + i, terrainP * paletteScale[i], terrainDx * paletteScale[i], terrainDy * paletteScale[i], terrainSign, terrainAxes) * paletteWeight[i];
   sampled += paletteWeight[i];
  }
  surface /= max(sampled, .0001);
  layerNormalDetail = surface.xyz;
  layerRoughness = mix(layerRoughness, surface.w, layerDetailShare);
 }
 #endif
 #else
 vec4 terrainWeights = textureLod(terrainLayers, terrainWeightUV, 0.0);
 vec4 grass = vec4(0.0), rock = vec4(0.0), snow = vec4(0.0), mud = vec4(0.0);
 if (terrainWeights.x > 0.0) grass = terrainTriplanar(TERRAIN_GRASS, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
 if (terrainWeights.y > 0.0) rock = terrainTriplanar(TERRAIN_ROCK, terrainP * terrainRockScale, terrainDx * terrainRockScale, terrainDy * terrainRockScale, terrainSign, terrainAxes);
 if (terrainWeights.z > 0.0 || (terrainSnowCover && !terrainProp)) {
  snow = terrainTriplanar(TERRAIN_SNOW, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
  terrainSnowAlbedo = snow.rgb;
 }
 if (terrainWeights.w > 0.0) mud = terrainTriplanar(TERRAIN_MUD, terrainP * mudScale, terrainDx * mudScale, terrainDy * mudScale, terrainSign, terrainAxes);
 vec4 microHeight = vec4(grass.a, rock.a, snow.a, mud.a);
 terrainWeights *= exp2((microHeight - .5) * terrainHeightBlend * 8.0);
 vec4 forest = vec4(0.0);
 float forestWeight = 0.0;
 #ifdef TERRAIN_FOREST_FLOOR
 forestWeight = textureLod(terrainForestWeight, terrainWeightUV, 0.0).r;
 if (forestWeight > 0.0) forest = terrainTriplanar(TERRAIN_FOREST, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
 forestWeight *= exp2((forest.a - .5) * terrainHeightBlend * 8.0);
 #endif
 if (terrainEdgeSharpness > 0.0) {
  float strongest = max(max(max(terrainWeights.x, terrainWeights.y), max(terrainWeights.z, terrainWeights.w)), max(forestWeight, .0001));
  terrainWeights = vec4(terrainEdge(terrainWeights.x, strongest), terrainEdge(terrainWeights.y, strongest), terrainEdge(terrainWeights.z, strongest), terrainEdge(terrainWeights.w, strongest));
  forestWeight = terrainEdge(forestWeight, strongest);
 }
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
 float layerRoughness = dot(terrainWeights, vec4(${['grass', 'rock', 'snow', 'mud'].map(name => TERRAIN_LAYER_ROUGHNESS[name]).join(', ')})) + ${TERRAIN_LAYER_ROUGHNESS.forest} * forestWeight;
 vec3 layerNormalDetail = vec3(0.0);
 float layerDetailShare = 0.0;
 #ifdef TERRAIN_LAYER_DETAIL
 layerDetailShare = terrainLayerDetail;
 if (layerDetailShare > 0.0) {
  // Each layer brings its own normal and roughness, blended with the weights of its colour. A layer under
  // minShare is not sampled: it would not show.
  const float minShare = .02;
  vec4 surface = vec4(0.0);
  float sampled = 0.0;
  if (terrainWeights.x > minShare) { surface += terrainNormalDetail(TERRAIN_LAYER_SURFACE + TERRAIN_GRASS, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes) * terrainWeights.x; sampled += terrainWeights.x; }
  if (terrainWeights.y > minShare) { surface += terrainNormalDetail(TERRAIN_LAYER_SURFACE + TERRAIN_ROCK, terrainP * terrainRockScale, terrainDx * terrainRockScale, terrainDy * terrainRockScale, terrainSign, terrainAxes) * terrainWeights.y; sampled += terrainWeights.y; }
  if (terrainWeights.z > minShare) { surface += terrainNormalDetail(TERRAIN_LAYER_SURFACE + TERRAIN_SNOW, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes) * terrainWeights.z; sampled += terrainWeights.z; }
  if (terrainWeights.w > minShare) { surface += terrainNormalDetail(TERRAIN_LAYER_SURFACE + TERRAIN_MUD, terrainP * mudScale, terrainDx * mudScale, terrainDy * mudScale, terrainSign, terrainAxes) * terrainWeights.w; sampled += terrainWeights.w; }
  #ifdef TERRAIN_FOREST_FLOOR
  if (forestWeight > minShare) { surface += terrainNormalDetail(TERRAIN_LAYER_SURFACE + TERRAIN_FOREST, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes) * forestWeight; sampled += forestWeight; }
  #endif
  surface /= max(sampled, .0001);
  layerNormalDetail = surface.xyz;
  layerRoughness = mix(layerRoughness, surface.w, layerDetailShare);
 }
 #endif
 #endif
 roughnessFactor = mix(roughnessFactor, layerRoughness, terrainContact);
 metalnessFactor *= 1.0 - terrainContact;
 vec3 sandNormal = terrainNormal;
 #ifdef TERRAIN_SAND
 sandCover = terrainProp ? 0.0 : textureLod(terrainSandWeight, terrainWeightUV, 0.0).r;
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
  const float sharedDetailScale = 3.4;   // repeats of the shared detail normal per layer repeat
  vec3 detail = layerDetailShare < 1.0 ? terrainNormalDetail(TERRAIN_DETAIL, terrainP * sharedDetailScale, terrainDx * sharedDetailScale, terrainDy * sharedDetailScale, terrainSign, terrainAxes).xyz : vec3(0.0);
  detail = mix(detail, layerNormalDetail, layerDetailShare);
  // Neither the shared rock detail nor the layer under the sand belongs on sand.
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
 field, layers, layerArray, layerDetailArray, palette, detailNormal, appearance = createTerrainAppearance(), contactBand, snowMaterial, snowLook = createSnowLook(), sandLook = createSandLook(), drainage, runoffFlow, puddleSky, ...surface
} = {}) {
 // palette: {size, roles, sets} of a terrain world. The field then brings paletteMap (size / 4 slices of four weights)
 // and the layer arrays hold one slice per palette set.
 if (palette !== undefined) {
  if (!Number.isInteger(palette?.size) || palette.size < 4 || palette.size % 4 || !Array.isArray(palette.roles) || !palette.roles.length) throw Error('Terrain palette needs a size in fours and the role of each set');
  if (palette.roles.some(role => !TERRAIN_PALETTE_ROLES.includes(role)) || palette.roles.length > palette.size) throw Error('Terrain palette roles must be palette roles, at most one per weight');
  if (palette.means !== undefined && (!Array.isArray(palette.means) || palette.means.length < palette.roles.length || palette.means.some(mean => !mean?.isColor))) throw Error('Terrain palette means must be one colour per set');
  for (const key of ['dryTint', 'lushTint', 'climateTint', 'macroVariation', 'harmony', 'roleTints', 'edgeFade']) if (!appearance[key]) throw Error(`Terrain appearance needs ${key}: build it with createTerrainAppearance()`);
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
 if (layerArray) material.defines = {...material.defines, TERRAIN_LAYER_ARRAY: 1};
 if (layerDetailArray) material.defines = {...material.defines, TERRAIN_LAYER_DETAIL: 1};
 const compileSurface = material.onBeforeCompile;
 const uniforms = {
  ...(drainage && puddleSky),
  terrainDrainage: {value: drainage?.texture ?? null},
  terrainFlow: {value: runoffFlow?.texture ?? null},
  terrainRunoffCoverage: runoffFlow?.coverage ?? {value: 0},
  terrainRunoffSource: runoffLook.sourceArea, terrainRunoffFull: runoffLook.fullArea, terrainRunoffRutSource: runoffLook.rutSourceArea,
  terrainRunoffSpeed: runoffLook.speed, terrainRunoffRippleSize: runoffLook.rippleSize, terrainRunoffRippleStrength: runoffLook.rippleStrength,
  terrainPuddleFill: drainage?.fill ?? {value: 0},
  terrainHeights: {value: field.heightMap}, terrainLayers: {value: field.weightMap ?? null}, terrainBounds: {value: field.bounds},
  terrainLayerArray: {value: layerArray ?? null},
  ...(palette && {terrainPaletteWeights: {value: field.paletteMap}, terrainPaletteRole: {value: paletteRoles}, terrainPaletteSnow: {value: palette.roles.indexOf('snow')},
   terrainHarmony: appearance.harmony, terrainRoleTint: appearance.roleTints, terrainEdgeFade: appearance.edgeFade,
   // A set without a known average is left as it is: its average counts as the colour of its role.
   terrainPaletteMean: {value: Array.from({length: palette.size}, (_, index) => palette.means?.[index] ?? appearance.roleTints.value[paletteRoles[index]])},
   terrainMacroVariation: appearance.macroVariation, terrainClimate: {value: field.climateMap ?? null},
   terrainDryTint: appearance.dryTint, terrainLushTint: appearance.lushTint, terrainClimateTint: appearance.climateTint}),
  terrainLayerDetailArray: {value: layerDetailArray ?? null}, terrainLayerDetail: appearance.layerDetail ?? {value: 0},
  terrainGrass: {value: layers?.grass}, terrainRock: {value: layers?.rock}, terrainSnow: {value: layers?.snow}, terrainMud: {value: layers?.mud},
  terrainForest: {value: layers?.forest}, terrainForestWeight: {value: field.forestMap ?? null},
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

export {createProceduralTerrain, createValley, terrainWindowOrigin, TERRAIN_LANDFORMS, VALLEY_DEFAULTS} from './valley.js';
export {createRelief, reliefShape, validateRelief, RELIEF_SHAPES, RELIEF_MAX_SHAPES} from './relief.js';
export {TERRAIN_BIOMES, BIOME_TEXTURE_DEFAULTS, DEFAULT_TERRAIN_BIOME, cloneBiome, validateBiome} from './biomes.js';
export {createTerrainWorld, validateWorld, WORLD_DEFAULTS, WORLD_FIELDS, WORLD_MAX_BIOMES, WORLD_MAP_AUTO, WORLD_PALETTE_MAX} from './world.js';
export {createTerrainClipmap, CLIPMAP_DEFAULTS, CLIPMAP_LIMITS} from './clipmap.js';
