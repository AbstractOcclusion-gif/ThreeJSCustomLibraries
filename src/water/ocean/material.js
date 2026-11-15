import * as THREE from 'three';
import {FFT_SAMPLE_GLSL} from './fft.js';
import {SIM_SAMPLE_GLSL} from './sim-window.js';
import {WIND_WAVE_GLSL} from '../waves.js';
import {FOAM_GLSL} from './foam-glsl.js';
import {SCATTER_GLSL} from './scatter-glsl.js';
import {REFLECTION_GLSL} from './reflection-glsl.js';
import {WATER_IOR} from '../water-optics.js';

export function createOceanMaterial({uniforms, sky, fft, wake, useClipmap, sceneOptics}) {
  return new THREE.ShaderMaterial({
    uniforms, side: sceneOptics ? THREE.DoubleSide : THREE.FrontSide,
    defines: {...sky.defines, ...(fft ? {OCEAN_FFT: 1} : {}), ...(wake ? {OCEAN_WAKE: 1} : {}), ...(useClipmap ? {OCEAN_CLIPMAP: 1} : {}),
      ...(sceneOptics ? {OCEAN_SCENE_OPTICS: 1} : {})},
 vertexShader: `
 uniform float clock, heading, swell, swellLength, chop, choppiness;
 #ifdef OCEAN_CLIPMAP
 uniform float uMorphStart, uMorphScale;
 #endif
 #ifdef OCEAN_FFT
 ${FFT_SAMPLE_GLSL}
 #endif
 #ifdef OCEAN_WAKE
 ${SIM_SAMPLE_GLSL}
 #endif
 varying vec3 vWorld, vNormal;
 varying vec4 vClip;
 varying float vCrest;
 varying vec2 vSource;
 struct WaveField { float height; vec2 slope; vec2 shift; vec3 derivative; };
 float waveHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
 // The deep-water branches of WebAquarium's analytic Gerstner bands.
 void band(inout WaveField field, vec2 xz, float limit, int count, float length0,
  float lengthDecay, float amplitude, float amplitudeDecay, float fan, float seed, float direction) {
  for (int i = 0; i < 12; i++) {
   if (i >= count) break;
   float wave = float(i) + seed;
   float angle = direction + (waveHash(wave) * 2.0 - 1.0) * fan;
   vec2 dir = vec2(cos(angle), sin(angle));
   float k = 6.2831853 / length0;
   float phase = k * dot(dir, xz) - sqrt(9.81 * k) * clock + waveHash(wave + 16.0) * 6.2831853;
   float a = amplitude * smoothstep(limit * .7, limit * 1.5, length0);
   float s = sin(phase), c = cos(phase);
   field.height += a * s;
   field.slope += a * k * c * dir;
   field.shift += a * c * dir;
   field.derivative -= a * k * s * vec3(dir.x * dir.x, dir.x * dir.y, dir.y * dir.y);
   length0 *= lengthDecay;
   amplitude *= amplitudeDecay;
  }
 }
 void main() {
  vec3 rest = position;
  #ifdef OCEAN_CLIPMAP
  vec2 cell = position.xz;
  float edge = max(abs(cell.x), abs(cell.y));
  float morph = clamp((edge - uMorphStart) * uMorphScale, 0.0, 1.0);
  vec2 evenCell = sign(cell) * floor(abs(cell) * 0.5 + 0.5) * 2.0;
  rest.xz = mix(cell, evenCell, morph);
  rest = (modelMatrix * vec4(rest, 1.0)).xyz;
  #endif
  vSource = rest.xz;
  #ifdef OCEAN_FFT
  if (uOceanFftActive > .5) {
   ShoreData shore = shoreSample(vSource);
   SurfWaveSample surf = surfSampleAt(vSource, shore);
   vWorld = rest + oceanDisplacementShore(vSource, cameraPosition.xz, 1.0, shore, surf);
   #ifdef OCEAN_WAKE
   float fade;
   vWorld.y += sampleRipple(vSource, fade).r;
   #endif
   if (uSurfActive > .5 && shore.influence > 0.0 && shore.depth < 0.0) {
    vec2 swash = evaluateSurfSwash(vSource, shore.toShore, shore.slopeTan, shore.influence, uSurfBeatTime);
    if (swash.y > .001) vWorld.y = smoothMax(vWorld.y, surfFilmTop(-shore.depth, swash.y), SURF_FILM_BLEND);
   }
   vNormal = vec3(0.0, 1.0, 0.0);
   vCrest = 0.0;
   vClip = gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
   return;
  }
  #endif
  float range = length(vSource);
  float limit = max(1.9, max(distance(vSource, cameraPosition.xz) * .032, range * .047));
  WaveField field = WaveField(0.0, vec2(0), vec2(0), vec3(0));
  band(field, vSource, limit, 12, 9.0, .82, chop * .14, .76, 1.05, 1.0, heading);
  band(field, vSource, limit, 4, swellLength, .68, swell, .85, .5, 101.0, heading + .35);
  vec3 d = choppiness * field.derivative;
  vec3 tx = vec3(1.0 + d.x, field.slope.x, d.y);
  vec3 tz = vec3(d.y, field.slope.y, 1.0 + d.z);
  vNormal = normalize(cross(tz, tx));
  float jacobian = (1.0 + d.x) * (1.0 + d.z) - d.y * d.y;
  vCrest = max(clamp((1.0 - jacobian) * 1.5, 0.0, 1.0), smoothstep(.28,.65,length(field.slope)));
  vWorld = rest + vec3(choppiness * field.shift.x, field.height, choppiness * field.shift.y);
  vClip = gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
 }`,
 fragmentShader: `
 ${sky.glsl}
 #ifdef OCEAN_FFT
 uniform float uSurfaceDetailLod;
 #define OCEAN_SCREEN_FILTER
 ${FFT_SAMPLE_GLSL}
 ${FOAM_GLSL}
 ${WIND_WAVE_GLSL}
 #endif
 #ifdef OCEAN_WAKE
 ${SIM_SAMPLE_GLSL}
 #endif
 uniform float clock, heading, chop, whitecaps;
 uniform float reflection, fresnelPower, glint, fineRipples, foamOpacity, foamFeather, foamScale;
 uniform vec3 waterTint, foamTint;
 uniform sampler2D lace;
 varying vec3 vWorld, vNormal;
 varying vec4 vClip;
 varying float vCrest;
 varying vec2 vSource;
 #ifdef OCEAN_SCENE_OPTICS
 uniform sampler2D tOceanScene;
 uniform highp sampler2D tOceanSceneDepth;
 uniform mat4 uOceanInvVP, uOceanVP;
 uniform vec3 uOceanExtinction;
 uniform bool uOceanSceneReady, uOceanWaterLayer;
 uniform float uOceanRefraction, uOceanClarity, uOceanTir;
 #define uSunDir uSkySun
 ${SCATTER_GLSL}
 #undef uSunDir
 float sceneDistance(vec2 uv) {
  float z = texture2D(tOceanSceneDepth, uv).r;
  vec4 point = uOceanInvVP * vec4(vec3(uv, z) * 2.0 - 1.0, 1.0);
  return distance(point.xyz / point.w, cameraPosition);
 }
 ${REFLECTION_GLSL}
 vec3 refractedScene(vec2 uv, vec3 normal, float fragDist, out float behind) {
  vec2 offsetUV = clamp(uv + normal.xz * (uOceanRefraction / max(fragDist, 1.0)), .001, .999);
  behind = sceneDistance(offsetUV);
  if (behind < fragDist) { offsetUV = uv; behind = sceneDistance(uv); }
  return texture2D(tOceanScene, offsetUV).rgb;
 }
 vec3 mirrorBelow(vec3 position, vec3 n, vec3 V, vec3 fallback) {
  vec3 ray = reflect(-V, n);
  if (ray.y > -.02) return fallback;
  float floorY = -100.0;
  #ifdef OCEAN_FFT
  floorY = -bedDepthAt(position.xz);
  #endif
  float t = (floorY - position.y) / ray.y;
  vec3 hit = position + ray * t;
  vec4 clip = uOceanVP * vec4(hit, 1.0);
  if (clip.w <= 0.0) return fallback;
  vec2 uv = clip.xy / clip.w * .5 + .5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return fallback;
  if (sceneDistance(uv) < distance(hit, cameraPosition) * .7) return fallback;
  vec3 c = texture2D(tOceanScene, uv).rgb * exp(-uOceanExtinction * (.6 * max(0.0, -hit.y)));
  vec2 edge = smoothstep(vec2(0.0), vec2(.1), uv) * (1.0 - smoothstep(vec2(.9), vec2(1.0), uv));
  return mix(fallback, mix(fallback, c, exp(-uOceanExtinction * max(0.0, t))), edge.x * edge.y);
 }
 #endif
 void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float range = distance(cameraPosition, vWorld);
  vec2 wind = vec2(cos(heading), sin(heading));
  vec2 crosswind = vec2(-wind.y, wind.x);
  vec3 n = normalize(vNormal);
  float crest = vCrest;
  float fold = 0.0, breaker = 0.0;
  float surfFoam = 0.0;
  vec3 surfFoamTint = vec3(1.0);
  #ifdef OCEAN_FFT
  ShoreData shore = shoreSample(vSource);
  if (uOceanFftActive > .5) {
   SurfWaveSample surf = surfSampleAt(vSource, shore);
   OceanFftSum fftSample = oceanFftNormalSumShore(vSource, shore);
   vec2 tilt = fftSample.tilt * surfAmbientWeight(surf.mask) - surf.slopeXZ;
   n = normalize(vec3(tilt.x, 1.0, tilt.y));
   crest = fftSample.foam;
   fold = clamp(fftSample.pinch * surfAmbientWeight(surf.mask), 0.0, 1.0);
   breaker = surf.breaker;
   float geometryFoam = clamp(max(fold * 2.0, smoothstep(.28, .65, length(tilt))), 0.0, 1.0) * surf.mask;
   float lip = surf.lipShape * smoothstep(SURF_CRESTING_START, SURF_CRESTING_END, surf.overCap) * uSurfFoamCrestCap;
   float surfCoverage = clamp((surf.whitewash + lip + geometryFoam) * uSurfFoamStrength, 0.0, 1.0);
   if (surfCoverage > FOAM_MASK_EPSILON) {
    vec2 foamPoint = vSource + V.xz * (OCEAN_FOAM_PARALLAX_HEIGHT / max(V.y, OCEAN_FOAM_PARALLAX_MIN_VIEW_Y));
    vec3 pattern = sampleFoamTiled(tWhitecap, foamPoint, max(uSurfFoamTileSize, .001));
    surfFoam = foamDissolve(pattern.r, surfCoverage, uSurfFoamFeather) * uSurfFoamOpacity;
    surfFoamTint = uSurfFoamColor * mix(pattern, vec3(1.0), surfFoam);
   }
  }
  #endif
  #ifdef OCEAN_FFT
  vec2 detailGrad;
  windWaveHeight(vSource, detailGrad);
  float shoal = mix(1.0, shoalWeight(shore.depth, 2.0), shore.influence);
  n = normalize(n - vec3(detailGrad.x, 0.0, detailGrad.y) * fineRipples * shoal);
  #else
  float fine = (1.0 - smoothstep(18.0,120.0,range)) * min(chop,.95) * .06;
  vec2 detail = wind * sin(dot(vSource, wind)*12.0 - clock*9.0) +
   crosswind * sin(dot(vSource, crosswind)*8.0 + dot(vSource,wind)*4.0 - clock*6.0);
  n = normalize(n + vec3(detail.x,0,detail.y)*fine*fineRipples);
  #endif
  float wakeFoam = 0.0;
  #ifdef OCEAN_WAKE
  float fade;
  vec4 ripple = sampleRipple(vSource, fade);
  n = normalize(n + vec3(ripple.b, 0.0, ripple.a));
  wakeFoam = sampleWakeFoam(vSource);
  #endif
  #ifdef OCEAN_FFT
  float foam = oceanWhitecapFoam(vSource, V, crest) * whitecaps * foamOpacity;
  foam = 1.0 - (1.0 - foam) * (1.0 - oceanWakeFoam(vSource, V, wakeFoam) * foamOpacity);
  #else
  float coverage = smoothstep(.18,.66,crest) * whitecaps;
  vec2 tex = vec2(dot(vSource,wind) * .18 - clock * .24, dot(vSource,crosswind) * .36) / foamScale;
  float pattern = texture2D(lace,tex).r;
  float threshold = 1.0 - sqrt(coverage);
  float foam = smoothstep(threshold,threshold + foamFeather,pow(pattern,1.35)) * (1.0 - smoothstep(90.0,360.0,range)) * foamOpacity;
  #endif
  vec3 reflected = reflect(-V,n);
  reflected.y = abs(reflected.y);
  float F = .02 + .98 * pow(1.0 - clamp(dot(n,V),0.0,1.0),fresnelPower);
  vec3 body = vec3(.009,.047,.055) * waterTint * (.17 + .83 * uDaylight);
  #ifdef OCEAN_SCENE_OPTICS
  body = waterInscatterColor(V) * waterTint;
  #endif
  vec3 behindColor = body;
  #ifdef OCEAN_SCENE_OPTICS
  vec2 screenUV = vClip.xy / vClip.w * .5 + .5;
  if (uOceanWaterLayer) {
   float separation = sceneDistance(screenUV) - range;
   if (separation < -max(.02, min(.15, fwidth(separation)))) discard;
  }
  float behind;
  if (!gl_FrontFacing) {
   n = -n;
   const float eta = ${WATER_IOR};
   vec3 ray = refract(-V, n, eta);
   bool tir = dot(ray, ray) < 1e-6;
   float f0 = pow((eta - 1.0) / (eta + 1.0), 2.0);
   float fUnder = tir ? 1.0 : f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
   vec3 through = uOceanSceneReady ? refractedScene(screenUV, n * (6.0 * (eta - 1.0)), range, behind)
    : sky(normalize(vec3(ray.x, max(ray.y, .02), ray.z + (tir ? 1.0 : 0.0))), 0.0);
   vec3 reflectedBody = waterInscatterColor(reflect(-V, n)) * waterTint;
   vec3 mirror = uOceanSceneReady ? mirrorBelow(vWorld, n, V, reflectedBody) : reflectedBody;
   vec3 under = mix(through * exp(-uOceanExtinction), mirror, clamp(fUnder * uOceanTir, 0.0, 1.0));
   under = mix(under, foamTint * (.13 + .87 * uDaylight), max(foam, surfFoam) * .8);
   gl_FragColor = vec4(under, uOceanWaterLayer ? range : 1.0);
   #include <tonemapping_fragment>
   #include <colorspace_fragment>
   return;
  }
  if (uOceanSceneReady) {
   behindColor = refractedScene(screenUV, n, range, behind);
   float thickness = max(0.0, behind - range);
   float sceneDepth = max(0.0, -(cameraPosition.y - V.y * behind));
   behindColor *= exp(-uOceanExtinction * (.6 * sceneDepth));
   body = mix(body, behindColor, exp(-uOceanExtinction * thickness / max(uOceanClarity, .001)));
  }
  #endif
  vec3 reflectionColor = sky(reflected,.18);
  #ifdef OCEAN_SCENE_OPTICS
  if (uOceanSceneReady) {
   float roughness = mix(0.0, .2, smoothstep(150.0, 1500.0, range));
   vec3 ray = normalize(vec3(reflected.x, max(reflected.y, .02), reflected.z));
   reflectionColor = reflectedScene(vWorld, n, ray, range, roughness, roughSky(ray, roughness));
  }
  #endif
  vec3 color = mix(body, reflectionColor, clamp(F * reflection,0.0,1.0));
  vec3 H = normalize(V + uSkySun + vec3(0,.001,0));
  color += uSunCol * pow(max(0.0,dot(n,H)), mix(180.0,50.0,clamp(chop,0.0,1.0))) * .64 * glint;
  vec3 foamLight = vec3(.13 + .87 * uDaylight);
  color = mix(color, vec3(.74,.83,.84) * foamTint * foamLight, foam);
  color = mix(color, surfFoamTint * foamLight, surfFoam);
  #ifdef OCEAN_SCENE_OPTICS
  float lipGlow = breaker * pow(clamp(dot(V, uSkySun), 0.0, 1.0), uSssSunFalloff) * uSssIntensity;
  color += uScatterColor * uSunCol * (crestGlow(fold, V) + lipGlow) * (1.0 - max(foam, surfFoam));
  #endif
  #if defined(OCEAN_FFT) && defined(OCEAN_SCENE_OPTICS)
  float beachRise = -shore.depth;
  if (uOceanSceneReady && uSurfActive > .5 && shore.influence > 0.0 && beachRise > -.15) {
   vec2 swash = evaluateSurfSwash(vSource, shore.toShore, shore.slopeTan, shore.influence, uSurfBeatTime);
   if (swash.y > 0.0) {
    float film = clamp(beachRise / max(swash.y, .001), 0.0, 1.0);
    color = mix(color, behindColor, (.6 + .3 * film) * smoothstep(-.15, .15, beachRise));
    if (beachRise > 0.0) {
     float aboveFilm = clamp((beachRise - swash.x) / max(swash.y - swash.x, .001), 0.0, 1.0);
     float glaze = aboveFilm * smoothstep(0.0, .25, (swash.y - beachRise) / max(swash.y, .001));
     color = mix(color, behindColor * .7 + reflectionColor * .12, glaze * .85);
    }
    float band = max(uSurfSwashFoamWidth, .01);
    if (uSurfSwashFoam > 0.0 && beachRise > -band) {
     float phase = fract(uSurfBeatTime / max(uSurfPeriod, SURF_MIN_PERIOD) - .5);
     float reflux = smoothstep(SURF_SWASH_UPRUSH, 1.0, phase);
     float edge = clamp(1.0 - abs(beachRise - swash.x) / band, 0.0, 1.0);
     float depositEnv = smoothstep(SURF_SWASH_UPRUSH, SURF_SWASH_DEPOSIT_PEAK, phase) *
      (1.0 - smoothstep(SURF_SWASH_DEPOSIT_PEAK, 1.0, phase));
     float deposit = clamp(1.0 - abs(beachRise - swash.y) / band, 0.0, 1.0) * depositEnv;
     float raw = max(edge, deposit), coverage = clamp(raw * uSurfSwashFoam, 0.0, 1.0);
     if (coverage > FOAM_MASK_EPSILON) {
      float erode = reflux * deposit / max(raw, FOAM_MASK_EPSILON) * uSurfSwashFoamDissolve * SURF_SWASH_ERODE_MAX;
      vec3 pattern = sampleFoamTiled(tWhitecap, vSource, max(uSurfFoamTileSize, .001));
      float foam = foamDissolveEroded(pattern.r, coverage, uSurfFoamFeather, erode) * uSurfFoamOpacity;
      color = mix(color, uSurfFoamColor * mix(pattern, vec3(1.0), foam) * foamLight, foam);
     }
    }
   }
  }
  #endif
  vec3 horizon = sky(normalize(vec3(-V.x,.016,-V.z)),0.0);
  color = mix(color, horizon, smoothstep(900.0,6800.0,range));
  #ifdef OCEAN_SCENE_OPTICS
  gl_FragColor = vec4(color, uOceanWaterLayer ? range : 1.0);
  #else
  gl_FragColor = vec4(color, 1.0);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`,
});
}
