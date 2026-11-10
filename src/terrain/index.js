import * as THREE from 'three';
import {createWeatherSurfaceMaterial} from '../surface/index.js';
export {createTerrainField} from './field.js';
export {TERRAIN_LAYERS, TERRAIN_PAINT_FIELDS, createTerrainRules, TERRAIN_PAINT_DEFAULTS, validateTerrainPaint, dominantTerrainLayer} from './terrain-rules.js';
export {valueNoise} from './terrain-noise.js';
export {OceanCoastTerrain, TERRAIN_DEFAULTS as OCEAN_COAST_DEFAULTS, WET_DEFAULTS as OCEAN_COAST_WET_DEFAULTS} from './coast.js';

export function createTerrainAppearance() {
 return {
  tiling: {value: .45}, rockScale: {value: .55}, sharpness: {value: 3.5}, antiTiling: {value: .85},
  detailStrength: {value: .6}, heightBlend: {value: .24},
  waterLevel: {value: 0}, shoreWidth: {value: .8}, shoreWetness: {value: 1},
 };
}

// Triplanar sampling adapted from Glider's stunt/cart/terrain-material.js.
const TERRAIN_GLSL = /* glsl */`
uniform sampler2D terrainHeights, terrainLayers, terrainGrass, terrainRock, terrainSnow, terrainMud, terrainDetail;
#ifdef TERRAIN_FOREST_FLOOR
uniform sampler2D terrainForestWeight, terrainForest;
#endif
uniform vec4 terrainBounds;
uniform float terrainTiling, terrainSharpness, terrainAntiTiling, terrainDetailStrength, terrainHeightBlend;
uniform float terrainRockScale;
uniform float terrainWaterLevel, terrainShoreWidth, terrainShoreWetness, terrainContactBand;
uniform bool terrainProp;
uniform bool terrainSnowCover;
uniform sampler2D terrainSnowDepth;

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

vec4 terrainTexture(sampler2D tex, vec2 uv, vec2 dx, vec2 dy) {
 vec4 primary = textureGrad(tex, uv, dx, dy);
 if (terrainAntiTiling <= 0.0) return primary;
 vec4 secondary = textureGrad(tex, uv * .731 + vec2(17.13, 23.71), dx * .731, dy * .731);
 float blend = (.25 + .5 * valueNoise(vec3(uv * .19, 5.7))) * terrainAntiTiling;
 return mix(primary, secondary, blend);
}

vec4 terrainProjection(sampler2D tex, vec2 uv, vec2 dx, vec2 dy, float handedness) {
 vec2 orientation = vec2(handedness, 1.0);
 return terrainTexture(tex, uv * orientation, dx * orientation, dy * orientation);
}

vec4 terrainTriplanar(sampler2D tex, vec3 p, vec3 dx, vec3 dy, vec3 signN, vec3 axes) {
 vec4 color = vec4(0.0);
 if (axes.x > 0.0) color += terrainProjection(tex, p.zy, dx.zy, dy.zy, -signN.x) * axes.x;
 if (axes.y > 0.0) color += terrainTexture(tex, p.xz * vec2(1.0, -signN.y), dx.xz * vec2(1.0, -signN.y), dy.xz * vec2(1.0, -signN.y)) * axes.y;
 if (axes.z > 0.0) color += terrainProjection(tex, p.xy, dx.xy, dy.xy, signN.z) * axes.z;
 return color;
}

vec3 terrainNormalDetail(vec3 p, vec3 dx, vec3 dy, vec3 signN, vec3 axes) {
 vec3 detail = vec3(0.0);
 if (axes.x > 0.0) {
  vec3 n = normalize(terrainProjection(terrainDetail, p.zy, dx.zy, dy.zy, -signN.x).xyz * 2.0 - 1.0);
  detail += vec3((n.z - 1.0) * signN.x, n.y, -n.x * signN.x) * axes.x;
 }
 if (axes.y > 0.0) {
  vec2 orientation = vec2(1.0, -signN.y);
  vec3 n = normalize(terrainTexture(terrainDetail, p.xz * orientation, dx.xz * orientation, dy.xz * orientation).xyz * 2.0 - 1.0);
  detail += vec3(n.x, (n.z - 1.0) * signN.y, -n.y * signN.y) * axes.y;
 }
 if (axes.z > 0.0) {
  vec3 n = normalize(terrainProjection(terrainDetail, p.xy, dx.xy, dy.xy, signN.z).xyz * 2.0 - 1.0);
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
 if (terrainWeights.x > 0.0) grass = terrainTriplanar(terrainGrass, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
 if (terrainWeights.y > 0.0) rock = terrainTriplanar(terrainRock, terrainP * terrainRockScale, terrainDx * terrainRockScale, terrainDy * terrainRockScale, terrainSign, terrainAxes);
 if (terrainWeights.z > 0.0 || (terrainSnowCover && !terrainProp)) {
  snow = terrainTriplanar(terrainSnow, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
  terrainSnowAlbedo = snow.rgb;
 }
 if (terrainWeights.w > 0.0) mud = terrainTriplanar(terrainMud, terrainP * 1.4, terrainDx * 1.4, terrainDy * 1.4, terrainSign, terrainAxes);
 vec4 microHeight = vec4(grass.a, rock.a, snow.a, mud.a);
 terrainWeights *= exp2((microHeight - .5) * terrainHeightBlend * 8.0);
 vec4 forest = vec4(0.0);
 float forestWeight = 0.0;
 #ifdef TERRAIN_FOREST_FLOOR
 forestWeight = textureLod(terrainForestWeight, (terrainGrid + .5) / terrainSize, 0.0).r;
 if (forestWeight > 0.0) forest = terrainTriplanar(terrainForest, terrainP, terrainDx, terrainDy, terrainSign, terrainAxes);
 forestWeight *= exp2((forest.a - .5) * terrainHeightBlend * 8.0);
 #endif
 float totalWeight = max(dot(terrainWeights, vec4(1.0)) + forestWeight, .0001);
 terrainWeights /= totalWeight;
 forestWeight /= totalWeight;
 if (terrainProp) {
  float relief = dot(microHeight - .5, terrainWeights) + (forest.a - .5) * forestWeight;
  float seam = terrainContactBand * clamp(1.0 + relief * terrainHeightBlend, .55, 1.45);
  terrainContact = 1.0 - smoothstep(0.0, seam, aboveGround);
 }
 vec3 terrainColor = grass.rgb * terrainWeights.x + rock.rgb * terrainWeights.y + snow.rgb * terrainWeights.z + mud.rgb * terrainWeights.w + forest.rgb * forestWeight;
 diffuseColor.rgb = mix(diffuseColor.rgb, terrainColor, terrainContact);
 roughnessFactor = mix(roughnessFactor, dot(terrainWeights, vec4(.95, .85, .82, .75)) + .92 * forestWeight, terrainContact);
 metalnessFactor *= 1.0 - terrainContact;
 if (terrainDetailStrength > 0.0) {
  vec3 detail = terrainNormalDetail(terrainP * 3.4, terrainDx * 3.4, terrainDy * 3.4, terrainSign, terrainAxes);
  vec3 detailedNormal = normalize(terrainNormal + detail * terrainDetailStrength);
  normal = normalize(mix(normal, transformDirection(detailedNormal, viewMatrix), terrainContact));
 }
 }
 float shoreWet = 0.0;
 if (terrainInside && terrainShoreWidth > 0.0) {
  float aboveWater = max(vSurfaceWorld.y - terrainWaterLevel, 0.0);
  shoreWet = (1.0 - smoothstep(0.0, terrainShoreWidth, aboveWater)) * terrainShoreWetness;
 }
`;

// Layer textures are repeat-wrapped color maps. Their optional alpha carries material height.
export function createTerrainMaterial(parameters = {}, {
 field, layers, detailNormal, appearance = createTerrainAppearance(), contactBand, ...surface
} = {}) {
 if (!field?.heightMap || !field?.weightMap || !['grass', 'rock', 'snow', 'mud'].every(name => layers?.[name]?.isTexture) || !detailNormal?.isTexture) {
  throw Error('Terrain material needs a field, four layer textures and a detail normal');
 }
 if (contactBand !== undefined && (!Number.isFinite(contactBand) || contactBand < 0)) throw Error('Contact band must be a non-negative distance');
 if (field.forestMap && !layers.forest?.isTexture) throw Error('Terrain forest cover needs a forest floor texture');
 const material = createWeatherSurfaceMaterial(parameters, surface);
 if (field.forestMap) material.defines = {...material.defines, TERRAIN_FOREST_FLOOR: 1};
 const compileSurface = material.onBeforeCompile;
 const uniforms = {
  terrainHeights: {value: field.heightMap}, terrainLayers: {value: field.weightMap}, terrainBounds: {value: field.bounds},
  terrainGrass: {value: layers.grass}, terrainRock: {value: layers.rock}, terrainSnow: {value: layers.snow}, terrainMud: {value: layers.mud},
  terrainForest: {value: layers.forest ?? null}, terrainForestWeight: {value: field.forestMap ?? null},
  terrainDetail: {value: detailNormal}, terrainProp: {value: contactBand !== undefined}, terrainContactBand: {value: contactBand ?? 0},
  terrainTiling: appearance.tiling, terrainSharpness: appearance.sharpness, terrainAntiTiling: appearance.antiTiling,
  terrainRockScale: appearance.rockScale ?? {value: .55},
  terrainDetailStrength: appearance.detailStrength, terrainHeightBlend: appearance.heightBlend, terrainWaterLevel: appearance.waterLevel,
  terrainShoreWidth: appearance.shoreWidth, terrainShoreWetness: appearance.shoreWetness,
  terrainSnowCover: field.snowCover ?? {value: false}, terrainSnowDepth: {value: field.snowMap ?? null},
 };
 material.onBeforeCompile = shader => {
  compileSurface(shader);
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${TERRAIN_GLSL}\nvoid main() {`)
   .replace('float up = inverseTransformDirection', `${TERRAIN_FRAGMENT}\nfloat up = inverseTransformDirection`)
   .replace('snowCoverage *= 1.0 - track * .92;', `
    if (terrainSnowCover && !terrainProp) snowCoverage = textureLod(terrainSnowDepth, (terrainGrid + .5) / terrainSize, 0.0).r;
    else snowCoverage *= 1.0 - track * .92;
   `)
   .replace('mix(diffuseColor.rgb, surfaceSnowColor, snowCoverage)', 'mix(diffuseColor.rgb, terrainSnowAlbedo, snowCoverage)')
   .replace('float wet = surfaceWeather.x', 'float wet = max(surfaceWeather.x, shoreWet)');
 };
 return material;
}
