import * as THREE from 'three';
import {SKY_GLSL} from '../core/sky.js';
import {createWeatherSurfaceMaterial} from '../surface/index.js';
import {TERRAIN_LAYERS} from './terrain-rules.js';
export {createTerrainField, SNOW_DEPTH_SCALE} from './field.js';
export {createTerrainDrainage} from './drainage.js';
export {TERRAIN_LAYERS, TERRAIN_PAINT_FIELDS, createTerrainRules, TERRAIN_PAINT_DEFAULTS, validateTerrainPaint, dominantTerrainLayer} from './terrain-rules.js';
export {valueNoise} from '../core/value-noise.js';
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
#ifdef TERRAIN_SNOW_DETAIL
uniform sampler2D terrainSnowNormal, terrainSnowRoughness;
uniform float terrainSnowNormalStrength, terrainSnowTransmission;
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
#ifdef TERRAIN_RUNOFF_MAP
uniform sampler2D terrainRunoff;
#ifdef TERRAIN_RUNOFF_FILM
uniform sampler2D terrainRunoffFilm;
uniform float terrainRunoffCoverage;
#endif
float terrainRunoffHeight(vec2 uv) {
 float pulse = textureLod(terrainRunoff, uv, 0.0).r;
 #ifdef TERRAIN_RUNOFF_FILM
 const float highlightRelief = .45;
 float film = textureLod(terrainRunoffFilm, uv, 0.0).r * terrainRunoffCoverage;
 return film * (1.0 + pulse * highlightRelief);
 #else
 return pulse;
 #endif
}
#endif
#ifdef TERRAIN_PUDDLE_SKY
${SKY_GLSL}
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

// Repeat-wrapped color maps (separate or packed in TERRAIN_LAYERS order) carry material height in alpha.
export function createTerrainMaterial(parameters = {}, {
 field, layers, layerArray, detailNormal, appearance = createTerrainAppearance(), contactBand, snowMaterial, drainage, runoffTexture, runoffFilm, puddleSky, ...surface
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
 if (runoffTexture && runoffFilm) material.defines = {...material.defines, TERRAIN_RUNOFF_FILM: 1};
 if (runoffTexture) material.defines = {...material.defines, TERRAIN_RUNOFF_MAP: 1};
 if (drainage) material.defines = {...material.defines, TERRAIN_DRAINAGE: 1};
 if (drainage && puddleSky) material.defines = {...material.defines, TERRAIN_PUDDLE_SKY: 1};
 if (snowMaterial) material.defines = {...material.defines, TERRAIN_SNOW_DETAIL: 1};
 if (field.forestMap) material.defines = {...material.defines, TERRAIN_FOREST_FLOOR: 1};
 if (layerArray) material.defines = {...material.defines, TERRAIN_LAYER_ARRAY: 1};
 const compileSurface = material.onBeforeCompile;
 const uniforms = {
  ...(drainage && puddleSky),
  terrainDrainage: {value: drainage?.texture ?? null},
  terrainRunoff: {value: runoffTexture ?? null},
  terrainRunoffFilm: {value: runoffFilm?.texture ?? null},
  terrainRunoffCoverage: runoffFilm?.coverage ?? {value: 0},
  terrainPuddleFill: drainage?.fill ?? {value: 0},
  terrainHeights: {value: field.heightMap}, terrainLayers: {value: field.weightMap}, terrainBounds: {value: field.bounds},
  terrainLayerArray: {value: layerArray ?? null},
  terrainGrass: {value: layers?.grass}, terrainRock: {value: layers?.rock}, terrainSnow: {value: layers?.snow}, terrainMud: {value: layers?.mud},
  terrainForest: {value: layers?.forest}, terrainForestWeight: {value: field.forestMap ?? null},
  terrainDetail: {value: detailNormal}, terrainProp: {value: contactBand !== undefined}, terrainContactBand: {value: contactBand ?? 0},
  terrainTiling: appearance.tiling, terrainSharpness: appearance.sharpness, terrainAntiTiling: appearance.antiTiling,
  terrainRockScale: appearance.rockScale ?? {value: .55},
  terrainDetailStrength: appearance.detailStrength, terrainHeightBlend: appearance.heightBlend, terrainWaterLevel: appearance.waterLevel,
  terrainShoreWidth: appearance.shoreWidth, terrainShoreWetness: appearance.shoreWetness,
  terrainSnowNormal: {value: snowMaterial?.normal ?? null},
  terrainSnowRoughness: {value: snowMaterial?.roughness ?? null},
  terrainSnowTransmission: snowMaterial?.transmission ?? {value: 0},
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
    #ifdef TERRAIN_RUNOFF_FILM
    runoffFilmCoverage = textureLod(terrainRunoffFilm, terrainUV, 0.0).r * terrainRunoffCoverage;
    const float wetSnowDarkening = .4;
    const float packedRutWetness = .85;
    float waterOverSnow = mix(wetSnowDarkening, packedRutWetness, track);
    snowCoverage *= 1.0 - runoffFilmCoverage * waterOverSnow;
    #endif
    #ifdef TERRAIN_RUNOFF_MAP
    float runoffSlope = min(1.0, terrainRunoffHeight(terrainUV)) * (1.0 - snowCoverage);
    #else
    float runoffSlope = 1.0 - smoothstep(.35, .88, abs(up));
    #endif
   `)
   .replace('if (surfaceRunoff > 0.0 && wet > .1 && runoffSlope > 0.0) {', `
    #ifdef TERRAIN_RUNOFF_MAP
    if (surfaceRunoff > 0.0 && runoffSlope > 0.0) {
    #else
    if (surfaceRunoff > 0.0 && wet > .1 && runoffSlope > 0.0) {
    #endif
   `)
   .replace('float streak = surfaceRainStreaks(vSurfaceWorld) * surfaceRunoff * runoffSlope * smoothstep(.1, .72, wet);', `
    #ifdef TERRAIN_RUNOFF_MAP
    float streak = runoffSlope * surfaceRunoff;
    #else
    float streak = surfaceRainStreaks(vSurfaceWorld) * surfaceRunoff * runoffSlope * smoothstep(.1, .72, wet);
    #endif
   `)
   .replace('diffuseColor.rgb *= 1.0 - .42 * streak;', `
    #ifdef TERRAIN_RUNOFF_MAP
    const float beadHeightMeters = .045;
    vec2 texel = 1.0 / vec2(textureSize(terrainRunoff, 0));
    vec2 grade = vec2(
     terrainRunoffHeight(terrainUV + vec2(texel.x, 0.0)) - terrainRunoffHeight(terrainUV - vec2(texel.x, 0.0)),
     terrainRunoffHeight(terrainUV + vec2(0.0, texel.y)) - terrainRunoffHeight(terrainUV - vec2(0.0, texel.y))
    ) * beadHeightMeters / (2.0 * texel * terrainBounds.zw);
    vec3 beadNormal = inverseTransformDirection(surfaceGeometricNormal, viewMatrix) - vec3(grade.x, 0.0, grade.y);
    normal = normalize(mix(normal, transformDirection(normalize(beadNormal), viewMatrix), streak));
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
   .replace('diffuseColor.rgb *= 1.0 - .38 * puddle;', `
    #endif
    diffuseColor.rgb *= 1.0 - .38 * puddle;
   `)
   .replace('vec3 filmNormal = transformDirection', `
    film = max(film, runoffFilmCoverage);
    #ifdef TERRAIN_DRAINAGE
    const float puddleRingScale = .48;
    const float puddleRingStrength = 1.2;
    vec2 puddleRings = rainImpactGradient(vSurfaceWorld.xz * puddleRingScale,
      surfaceTime, surfaceRainAmount, rainFootprint * puddleRingScale);
    rainGradient = mix(rainGradient, puddleRings * puddleRingStrength, puddle);
    #endif
    vec3 filmNormal = transformDirection
   `)
   .replace('diffuseColor.rgb = mix(diffuseColor.rgb, surfaceSnowColor, snowCoverage);', '')
   .replace('roughnessFactor = mix(roughnessFactor, .83, snowCoverage);', `
    #ifdef TERRAIN_SNOW_DETAIL
    vec2 snowUv = terrainP.xz * vec2(1.0, -1.0);
    vec2 snowDx = dFdx(snowUv), snowDy = dFdy(snowUv);
    vec3 snowNormal = terrainTexture(TERRAIN_SNOW_NORMAL, snowUv, snowDx, snowDy).xyz * 2.0 - 1.0;
    vec3 snowDetail = vec3(snowNormal.x, snowNormal.z - 1.0, -snowNormal.y);
    vec3 snowSurfaceNormal = normalize(terrainNormal + terrainSnowNormalStrength * snowDetail);
    normal = normalize(mix(normal, transformDirection(snowSurfaceNormal, viewMatrix), snowCoverage));
    // Sparse, fine grains sharpen reflected highlights. Fade them before
    // they become subpixel so distant snow does not shimmer as the camera moves.
    const float snowGrainFrequency = 95.0;
    const float snowGrainRoughness = .18;
    const float compactSnowRoughness = .43;
    const vec3 compactSnowTint = vec3(.75, .87, 1.0);
    const float snowVariationFrequency = .22;
    vec2 snowGrainUv = vSurfaceWorld.xz * snowGrainFrequency;
    float grainVisibility = 1.0 - smoothstep(.35, 1.0, length(fwidth(snowGrainUv)));
    float grain = smoothstep(.72, .9, valueNoise(vec3(snowGrainUv, 0.0))) * grainVisibility;
    float snowRoughness = terrainTexture(TERRAIN_SNOW_ROUGHNESS, snowUv, snowDx, snowDy).r;
    float compacted = terrainSnowCover && !terrainProp ? track : 0.0;
    float driftVariation = valueNoise(vec3(vSurfaceWorld.xz * snowVariationFrequency, 0.0));
    terrainSnowAlbedo *= mix(.84, 1.0, driftVariation);
    terrainSnowAlbedo *= mix(vec3(1.0), compactSnowTint, compacted);
    snowRoughness = mix(snowRoughness, min(snowRoughness, compactSnowRoughness), compacted);
    snowRoughness = mix(snowRoughness, min(snowRoughness, snowGrainRoughness), grain);
    roughnessFactor = mix(roughnessFactor, snowRoughness, snowCoverage);
    #else
    roughnessFactor = mix(roughnessFactor, .83, snowCoverage);
    #endif
    diffuseColor.rgb = mix(diffuseColor.rgb, terrainSnowAlbedo, snowCoverage);
   `)
   .replace('#include <opaque_fragment>', `
    #if defined(TERRAIN_SNOW_DETAIL) && NUM_DIR_LIGHTS > 0
    // Thin snow scatters some directional light toward the viewer.
    vec3 snowLight = directionalLights[0].direction;
    float backlight = max(dot(-geometryViewDir, snowLight), 0.0);
    float grazingLight = 1.0 - abs(dot(surfaceGeometricNormal, snowLight));
    float thinSnow = terrainSnowCover && !terrainProp ? 1.0 - snowCoverage : .5;
    const vec3 snowScatterTint = vec3(.67, .82, 1.0);
    outgoingLight += directionalLights[0].color * snowScatterTint * snowCoverage
      * thinSnow * backlight * grazingLight * terrainSnowTransmission;
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
