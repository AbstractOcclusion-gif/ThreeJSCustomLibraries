import * as THREE from 'three';
import {createWeatherSurfaceMaterial} from '../surface/index.js';
export {createTerrainField} from './field.js';
export {TERRAIN_LAYERS, TERRAIN_PAINT_FIELDS} from './terrain-rules.js';

export function createTerrainAppearance() {
 return {
  tiling: {value: .45}, sharpness: {value: 3.5}, antiTiling: {value: .85},
  detailStrength: {value: .6}, heightBlend: {value: .24},
  waterLevel: {value: 0}, shoreWidth: {value: .8}, shoreWetness: {value: 1},
 };
}

// Triplanar sampling adapted from Glider's stunt/cart/terrain-material.js.
const TERRAIN_GLSL = /* glsl */`
uniform sampler2D terrainHeights, terrainLayers, terrainGrass, terrainRock, terrainSnow, terrainMud, terrainDetail;
uniform vec4 terrainBounds;
uniform float terrainTiling, terrainSharpness, terrainAntiTiling, terrainDetailStrength, terrainHeightBlend;
uniform float terrainWaterLevel, terrainShoreWidth, terrainShoreWetness, terrainContactBand;
uniform bool terrainProp;

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

vec4 terrainTexture(sampler2D tex, vec2 uv) {
 vec2 dx = dFdx(uv), dy = dFdy(uv);
 vec4 primary = textureGrad(tex, uv, dx, dy);
 if (terrainAntiTiling <= 0.0) return primary;
 vec4 secondary = textureGrad(tex, uv * .731 + vec2(17.13, 23.71), dx * .731, dy * .731);
 float blend = (.25 + .5 * valueNoise(vec3(uv * .19, 5.7))) * terrainAntiTiling;
 return mix(primary, secondary, blend);
}

vec4 terrainTriplanar(sampler2D tex, vec3 p, vec3 signN, vec3 axes) {
 return terrainTexture(tex, vec2(-p.z * signN.x, p.y)) * axes.x
      + terrainTexture(tex, vec2(p.x, -p.z * signN.y)) * axes.y
      + terrainTexture(tex, vec2(p.x * signN.z, p.y)) * axes.z;
}

vec3 terrainNormalDetail(vec3 p, vec3 signN, vec3 axes) {
 vec3 x = normalize(terrainTexture(terrainDetail, vec2(-p.z * signN.x, p.y)).xyz * 2.0 - 1.0);
 vec3 y = normalize(terrainTexture(terrainDetail, vec2(p.x, -p.z * signN.y)).xyz * 2.0 - 1.0);
 vec3 z = normalize(terrainTexture(terrainDetail, vec2(p.x * signN.z, p.y)).xyz * 2.0 - 1.0);
 return vec3((x.z - 1.0) * signN.x, x.y, -x.x * signN.x) * axes.x
      + vec3(y.x, (y.z - 1.0) * signN.y, -y.y * signN.y) * axes.y
      + vec3(z.x * signN.z, z.y, (z.z - 1.0) * signN.z) * axes.z;
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
 vec3 terrainAxes = pow(abs(terrainNormal), vec3(terrainSharpness));
 terrainAxes /= max(dot(terrainAxes, vec3(1.0)), .0001);
 vec3 terrainSign = sign(terrainNormal + vec3(.00001));
 vec3 terrainP = terrainGround * terrainTiling;
 vec4 grass = terrainTriplanar(terrainGrass, terrainP, terrainSign, terrainAxes);
 vec4 rock = terrainTriplanar(terrainRock, terrainP * .55, terrainSign, terrainAxes);
 vec4 snow = terrainTriplanar(terrainSnow, terrainP, terrainSign, terrainAxes);
 vec4 mud = terrainTriplanar(terrainMud, terrainP * 1.4, terrainSign, terrainAxes);
 vec4 microHeight = vec4(grass.a, rock.a, snow.a, mud.a);
 vec4 terrainWeights = texture2D(terrainLayers, (terrainGrid + .5) / terrainSize);
 terrainWeights /= max(dot(terrainWeights, vec4(1.0)), .0001);
 terrainWeights *= exp2((microHeight - .5) * terrainHeightBlend * 8.0);
 terrainWeights /= max(dot(terrainWeights, vec4(1.0)), .0001);
 if (terrainProp && terrainInside && terrainContactBand > 0.0) {
  float relief = dot(microHeight - .5, terrainWeights);
  float seam = terrainContactBand * clamp(1.0 + relief * terrainHeightBlend, .55, 1.45);
  terrainContact = 1.0 - smoothstep(0.0, seam, vSurfaceWorld.y - terrainGround.y);
 }
 vec3 terrainColor = grass.rgb * terrainWeights.x + rock.rgb * terrainWeights.y + snow.rgb * terrainWeights.z + mud.rgb * terrainWeights.w;
 diffuseColor.rgb = mix(diffuseColor.rgb, terrainColor, terrainContact);
 roughnessFactor = mix(roughnessFactor, dot(terrainWeights, vec4(.95, .85, .82, .75)), terrainContact);
 metalnessFactor *= 1.0 - terrainContact;
 if (terrainDetailStrength > 0.0) {
  vec3 detail = terrainNormalDetail(terrainP * 3.4, terrainSign, terrainAxes);
  vec3 detailedNormal = normalize(terrainNormal + detail * terrainDetailStrength);
  normal = normalize(mix(normal, transformDirection(detailedNormal, viewMatrix), terrainContact));
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
 const material = createWeatherSurfaceMaterial(parameters, surface);
 const compileSurface = material.onBeforeCompile;
 const uniforms = {
  terrainHeights: {value: field.heightMap}, terrainLayers: {value: field.weightMap}, terrainBounds: {value: field.bounds},
  terrainGrass: {value: layers.grass}, terrainRock: {value: layers.rock}, terrainSnow: {value: layers.snow}, terrainMud: {value: layers.mud},
  terrainDetail: {value: detailNormal}, terrainProp: {value: contactBand !== undefined}, terrainContactBand: {value: contactBand ?? 0},
  terrainTiling: appearance.tiling, terrainSharpness: appearance.sharpness, terrainAntiTiling: appearance.antiTiling,
  terrainDetailStrength: appearance.detailStrength, terrainHeightBlend: appearance.heightBlend, terrainWaterLevel: appearance.waterLevel,
  terrainShoreWidth: appearance.shoreWidth, terrainShoreWetness: appearance.shoreWetness,
 };
 material.onBeforeCompile = shader => {
  compileSurface(shader);
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${TERRAIN_GLSL}\nvoid main() {`)
   .replace('float up = inverseTransformDirection', `${TERRAIN_FRAGMENT}\nfloat up = inverseTransformDirection`)
   .replace('float wet = surfaceWeather.x', 'float wet = max(surfaceWeather.x, shoreWet)');
 };
 return material;
}
