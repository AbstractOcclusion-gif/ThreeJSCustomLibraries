import * as THREE from 'three';
import {RAIN_IMPACT_GLSL} from '../core/rain-impact.js';
import {NOISE_GLSL} from '../core/lighting.js';
export {createTrackMask} from '../core/track-mask.js';

export function createSurfaceWeather() {
 const levels = {value: new THREE.Vector2()};
 const time = {value: 0};
 const unit = value => THREE.MathUtils.clamp(value, 0, 1);
 return {
  levels, time,
  set({wetness = levels.value.x, snow = levels.value.y} = {}) {
   if (![wetness, snow].every(Number.isFinite)) throw Error('Surface weather levels must be finite');
   levels.value.set(unit(wetness), unit(snow));
  },
  // Null advances animation while retaining manually set surface levels.
  update(dt, precipitation = {}) {
   let {rain = 0, snow = 0} = precipitation ?? {};
   if (!Number.isFinite(dt) || dt < 0 || ![rain, snow].every(Number.isFinite)) throw Error('Invalid surface weather update');
   time.value += dt;
   if (precipitation === null) return;
   rain = unit(rain);
   snow = unit(snow);
   levels.value.x = unit(levels.value.x + dt * (.23 * rain - .035 * (1 - rain)));
   levels.value.y = unit(levels.value.y + dt * (.17 * snow - (.018 + .09 * rain) * (1 - snow)));
  },
 };
}

const SURFACE_GLSL = /* glsl */`
uniform vec2 surfaceWeather;
#ifdef SURFACE_RAIN_IMPACTS
uniform float surfaceRainAmount;
#endif
uniform vec3 surfaceSnowColor;
uniform float surfacePuddles, surfaceAntiTile, surfaceRunoff, surfaceTime, surfaceTrackContrast;
uniform sampler2D surfaceTracks;
uniform vec4 surfaceTrackBounds;
uniform bool surfaceHasTracks;
varying vec3 vSurfaceWorld;
${NOISE_GLSL}
#ifdef SURFACE_RAIN_IMPACTS
${RAIN_IMPACT_GLSL}
#endif

float surfaceTrack(vec3 world) {
 if (!surfaceHasTracks) return 0.0;
 vec2 uv = (world.xz - surfaceTrackBounds.xy) / surfaceTrackBounds.zw;
 if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
 return texture2D(surfaceTracks, uv).r;
}

float surfaceRainStreaks(vec3 world) {
 // Keep the narrow paths stable while beads run down them along gravity.
 vec2 across = world.xz * 5.5;
 float path = valueNoise(vec3(across, world.y * .27));
 float channel = smoothstep(.56, .78, path);
 float seed = valueNoise(vec3(across * .39, 4.0));
 float bead = fract(world.y * .46 + surfaceTime * (.36 + .28 * seed) + seed * 4.0);
 float pulse = smoothstep(.05, .42, bead) * (1.0 - smoothstep(.48, .83, bead));
 return channel * (.32 + .68 * pulse);
}

#if defined(USE_MAP) && !defined(DECODE_VIDEO_TEXTURE)
vec3 surfaceTileSample(vec2 uv, vec2 dx, vec2 dy, vec2 cell) {
 vec2 offset = vec2(hash12(cell), hash12(cell + 17.2));
 return textureGrad(map, uv + offset, dx, dy).rgb;
}
vec3 surfaceUntile(vec2 uv) {
 vec2 p = uv * .7, cell = floor(p), f = smoothstep(.12, .88, fract(p));
 vec2 dx = dFdx(uv), dy = dFdy(uv);
 vec3 rowA = mix(surfaceTileSample(uv, dx, dy, cell), surfaceTileSample(uv, dx, dy, cell + vec2(1, 0)), f.x);
 vec3 rowB = mix(surfaceTileSample(uv, dx, dy, cell + vec2(0, 1)), surfaceTileSample(uv, dx, dy, cell + 1.0), f.x);
 return mix(rowA, rowB, f.y);
}
#endif
`;

// Standard PBR stays responsible for lights, shadows, fog and the host's environment map.
export function createWeatherSurfaceMaterial(parameters = {}, {
 weather = createSurfaceWeather(), rainAmount, tracks, snowColor = '#eaf3fa', puddles = 1, antiTiling = 0, runoff = 1, trackContrast = .08,
} = {}) {
 if (![puddles, antiTiling, runoff].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
  throw Error('Puddle, anti-tiling and runoff amounts must be between zero and one');
 }
 if (!Number.isFinite(trackContrast) || trackContrast < 0 || trackContrast > 1) throw Error('Track contrast must be between zero and one');
 const material = new THREE.MeshStandardMaterial(parameters);
 if (rainAmount) material.defines = {...material.defines, SURFACE_RAIN_IMPACTS: 1};
 const uniforms = {
  surfaceRainAmount: rainAmount ?? {value: 0},
  surfaceWeather: weather.levels, surfaceSnowColor: {value: new THREE.Color(snowColor)},
  surfacePuddles: {value: puddles}, surfaceAntiTile: {value: antiTiling},
  surfaceRunoff: {value: runoff}, surfaceTime: weather.time,
  surfaceTracks: {value: tracks?.texture ?? null}, surfaceHasTracks: {value: Boolean(tracks)},
  surfaceTrackContrast: {value: trackContrast},
  surfaceTrackBounds: {value: tracks?.bounds ?? new THREE.Vector4(0, 0, 1, 1)},
 };
 material.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = 'varying vec3 vSurfaceWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
   vec4 surfacePosition = vec4(transformed, 1.0);
   #ifdef USE_BATCHING
    surfacePosition = batchingMatrix * surfacePosition;
   #endif
   #ifdef USE_INSTANCING
    surfacePosition = instanceMatrix * surfacePosition;
   #endif
   vSurfaceWorld = (modelMatrix * surfacePosition).xyz;
  `);
  const map = THREE.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;', `
   #ifndef DECODE_VIDEO_TEXTURE
    if (surfaceAntiTile > 0.0) sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, surfaceUntile(vMapUv), surfaceAntiTile);
   #endif
   diffuseColor *= sampledDiffuseColor;
  `);
  shader.fragmentShader = shader.fragmentShader
   .replace('#include <map_fragment>', map)
   .replace('void main() {', `${SURFACE_GLSL}\nvoid main() {`)
   .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
    vec3 surfaceGeometricNormal = normal;
   `)
   .replace('#include <lights_physical_fragment>', `
    float up = inverseTransformDirection(surfaceGeometricNormal, viewMatrix).y;
    float snowCoverage = 0.0;
    if (surfaceWeather.y > 0.0) {
     float cover = valueNoise(vSurfaceWorld * .28) * .7 + valueNoise(vSurfaceWorld * 1.8) * .3;
     snowCoverage = smoothstep(.25, .78, up) * smoothstep(0.0, .18, surfaceWeather.y * 1.22 - cover);
    }
    float track = surfaceTrack(vSurfaceWorld) * smoothstep(.35, .8, up);
    snowCoverage *= 1.0 - track * .92;
    float wet = surfaceWeather.x * (1.0 - snowCoverage);
    diffuseColor.rgb *= (1.0 - .42 * wet) * (1.0 - track * min(1.0, surfaceTrackContrast + .18 * wet));
    roughnessFactor = mix(roughnessFactor, max(.12, roughnessFactor * .4), wet);
    float runoffSlope = 1.0 - smoothstep(.35, .88, abs(up));
    if (surfaceRunoff > 0.0 && wet > .1 && runoffSlope > 0.0) {
     float streak = surfaceRainStreaks(vSurfaceWorld) * surfaceRunoff * runoffSlope * smoothstep(.1, .72, wet);
     diffuseColor.rgb *= 1.0 - .42 * streak;
     roughnessFactor = mix(roughnessFactor, .085, streak);
    }
    float puddle = 0.0;
    if (wet > .45 && surfacePuddles > 0.0) {
     vec3 basinPosition = vec3(vSurfaceWorld.xz * .34, 0.0);
     float basin = valueNoise(basinPosition) * .85 + valueNoise(basinPosition * 3.2) * .15;
     puddle = surfacePuddles * smoothstep(.94, .995, up) * smoothstep(.45, .92, wet) * (1.0 - smoothstep(.24, .38, basin));
     diffuseColor.rgb *= 1.0 - .38 * puddle;
     roughnessFactor = mix(roughnessFactor, .055, puddle);
     normal = normalize(mix(normal, transformDirection(vec3(0, 1, 0), viewMatrix), puddle * .75));
    }
    #ifdef SURFACE_RAIN_IMPACTS
    float rainFootprint = length(fwidth(vSurfaceWorld.xz));
    if (surfaceRainAmount > 0.0) {
     const float filmImpactStrength = .3;
     float film = max(puddle, wet * smoothstep(.55, .95, up));
     vec2 rainGradient = rainImpactGradient(vSurfaceWorld.xz, surfaceTime, surfaceRainAmount, rainFootprint);
     vec3 filmNormal = transformDirection(vec3(rainGradient.x, 0.0, rainGradient.y), viewMatrix);
     normal = normalize(normal + filmNormal * film * filmImpactStrength);
    }
    #endif
    diffuseColor.rgb = mix(diffuseColor.rgb, surfaceSnowColor, snowCoverage);
    roughnessFactor = mix(roughnessFactor, .83, snowCoverage);
    metalnessFactor *= 1.0 - snowCoverage;
    #include <lights_physical_fragment>
   `);
 };
 return material;
}
