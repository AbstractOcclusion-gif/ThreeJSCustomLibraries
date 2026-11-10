import * as THREE from 'three';
import {proceduralSky} from './sky-binding.js';
import {createLaceTexture} from './foam-texture.js';
import {OceanFft, FFT_SAMPLE_GLSL} from './ocean/fft.js';
import {OceanClipmap} from './ocean/clipmap.js';
import {SHORE_DEFAULTS} from './ocean/bed.js';
import {applySurf, setSurfTime, SURF_DEFAULTS, SURF_WARP_REACH_SPACINGS} from './ocean/surf-waves.js';
import {JERLOV} from './jerlov.js';
import {createOceanCaustics, OCEAN_CAUSTIC_GLSL} from './ocean/caustics.js';
import {SimWindow, SIM_SAMPLE_GLSL} from './ocean/sim-window.js';
import {ObstacleFootprint} from './ocean/obstacle.js';
import {FOAM_GLSL} from './ocean/foam-glsl.js';
import {SCATTER_GLSL} from './ocean/scatter-glsl.js';
import {REFLECTION_GLSL} from './ocean/reflection-glsl.js';
import {createPlanarCapture} from './planar-capture.js';
import {createWaveBank, WIND_WAVE_GLSL} from './waves.js';
import {ExclusionVolumes} from './ocean/exclusion.js';
import {createRenderScope} from '../core/render-state.js';

export const OCEAN_REFLECTION_MODES = Object.freeze(['sky capture', 'planar', 'screen space']);

// Deep-water analytic ocean: two Gerstner bands (chop + swell) in the vertex shader, crest compression -> whitecaps, lace
// foam, Fresnel sky reflection through the `sky` hook (see sky-binding.js), sun glint, horizon blend. Reduced from
// WebAquarium's large-waves / surface pair. laceTexture (pattern in r, tiling) is optional; a generated one is the default.
export const OCEAN_DEFAULTS = Object.freeze({
  swell: .65, swellLength: 65, chop: .8, choppiness: .65, whitecaps: .75, waveSpeed: 1, heading: 0,
  waterTint: '#ffffff', foamTint: '#ffffff', reflection: 1, fresnelPower: 5, glint: 1, fineRipples: 1,
  foamOpacity: .82, foamFeather: .25, foamScale: 1,
  refractionStrength: .6, clarity: 1, tirStrength: .4, crestGlow: 3,
  reflectionSource: 'sky capture', reflectionMix: .65, planarResolution: 256, planarHz: 15, reflectionSteps: 16,
});
export const OCEAN_PRESETS = Object.freeze({
  calm: {swell: .18, swellLength: 46, chop: .28, choppiness: .35, whitecaps: .25},
  rolling: {swell: .65, swellLength: 65, chop: .8, choppiness: .65, whitecaps: .75},
  rough: {swell: 1.4, swellLength: 82, chop: 2, choppiness: .85, whitecaps: 1},
});

// Look and behaviour constants outside OCEAN_DEFAULTS (not in the panels or presets).
const DEFAULT_WATER_TYPE = 'Open ocean II';   // Jerlov type when captureScene is not told one
const WAKE_RESOLUTION = 256;                  // texels across the moving ripple window, unless wake.resolution says
const FOAM_TILES = Object.freeze({foam: 8, wake: 4, streakStretch: 2});   // m per foam tile at foamScale 1; streak length x width
// Subsurface scatter through the crests (uScatter*, uSss*): colour before captureScene sets it from the Jerlov body colour.
const SCATTER = Object.freeze({color: '#0d3852', ambient: [.3, .3, .3], intensity: 2, anisotropy: .5,
  crestFalloff: 2, pinch: [.1, .6], pinchFalloff: 1.5});
const PLANAR_MIN_EYE_HEIGHT = .05;            // m: at or below the surface the mirror pass is skipped
const WIND_CHOP = Object.freeze({base: .75, perMetrePerSecond: .045});   // chop x (base + gain x wind speed) when a wind is given
const MIN_SEA_WIND = .1;                      // m/s: floor of the sea state's own wind when scaling by the weather wind
const GEOMETRY_FALLOFF = 6;                   // rim spacing grows with |x|^this

// Vertices concentrated near the origin, spacing widening offshore (extent ~ near + far metres at the rim).
export function createOceanGeometry({segments = 224, near = 150, far = 7100} = {}) {
  const geometry = new THREE.PlaneGeometry(2, 2, segments, segments).rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const spread = x => Math.sign(x) * (near * Math.abs(x) + far * Math.abs(x) ** GEOMETRY_FALLOFF);
  for (let i = 0; i < positions.count; i++) positions.setXYZ(i, spread(positions.getX(i)), 0, spread(positions.getZ(i)));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createOceanSurface({renderer, sky = proceduralSky(), geometry, laceTexture, settings = {}, fft: fftOptions = {},
  clipmap: clipmapSettings, caustics: causticSettings = false, wake: wakeSettings = false, exclusion: exclude = false} = {}) {
  const fft = renderer && fftOptions !== false ? new OceanFft(renderer, fftOptions) : null;
  const windDetail = fft ? createWaveBank() : null;
  const obstacles = fft && wakeSettings ? new ObstacleFootprint(renderer, wakeSettings.resolution ?? WAKE_RESOLUTION) : null;
  const wake = obstacles ? new SimWindow(renderer, wakeSettings, obstacles.uniforms) : null;
  const caustics = fft && causticSettings ? createOceanCaustics(fft, sky.uniforms.uSkySun, causticSettings, wake) : null;
  const capture = renderer ? new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  }) : null;
  const waterTarget = renderer ? new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  }) : null;
  const planar = renderer ? createPlanarCapture(renderer) : null;
  const exclusion = renderer && exclude ? new ExclusionVolumes(renderer) : null;
  let unmaskedWater;
  const eye = new THREE.Vector3();
  const captureSize = new THREE.Vector2();
  // Offscreen captures put the host's target, viewport and scissor back; the water layer also its clear colour.
  const sceneScope = renderer ? createRenderScope(renderer, {clearColor: false}) : null, waterScope = renderer ? createRenderScope(renderer) : null;
  const useClipmap = !geometry && (clipmapSettings ?? !!fft);
  const ownsGeometry = !geometry && !useClipmap, ownsLace = !laceTexture;
  if (ownsGeometry) geometry = createOceanGeometry();
  const lace = laceTexture ?? createLaceTexture();
  const D = OCEAN_DEFAULTS;
  lace.wrapS = lace.wrapT = THREE.RepeatWrapping;
  const uniforms = {
    ...sky.uniforms,
    ...fft?.uniforms,
    ...windDetail?.uniforms,
    ...wake?.uniforms,
    ...(useClipmap ? {uMorphStart: {value: 0}, uMorphScale: {value: 1}} : {}),
    // Starting values; apply() below sets every OCEAN_DEFAULTS-driven one from the settings.
    clock: {value: 0}, heading: {value: 0}, swell: {value: D.swell},
    swellLength: {value: D.swellLength}, chop: {value: D.chop}, choppiness: {value: D.choppiness},
    whitecaps: {value: D.whitecaps}, lace: {value: lace},
    waterTint: {value: new THREE.Color()}, foamTint: {value: new THREE.Color()},
    reflection: {value: D.reflection}, fresnelPower: {value: D.fresnelPower}, glint: {value: D.glint}, fineRipples: {value: D.fineRipples},
    foamOpacity: {value: D.foamOpacity}, foamFeather: {value: D.foamFeather}, foamScale: {value: D.foamScale},
    ...(fft ? {
      tWhitecap: {value: lace}, tWakeFoam: {value: lace},
      uWindDirXZ: {value: new THREE.Vector2(1, 0)}, uFoamTileSize: {value: FOAM_TILES.foam},
      uFoamFeather: {value: D.foamFeather}, uFoamStreakStretch: {value: FOAM_TILES.streakStretch}, uFoamTextureInfluence: {value: 1},
      uFoamTime: {value: 0}, uFoamPatternDrift: {value: 0}, uSurfaceDetailLod: {value: 1},
      uWakeFoamTileSize: {value: FOAM_TILES.wake}, uWakeFoamFeather: {value: D.foamFeather}, uWakeFoamTextureInfluence: {value: 1},
    } : {}),
    ...(capture ? {
      tOceanScene: {value: capture.texture}, tOceanSceneDepth: {value: capture.depthTexture},
      uOceanInvVP: {value: new THREE.Matrix4()}, uOceanVP: {value: new THREE.Matrix4()}, uOceanSceneReady: {value: false},
      uOceanWaterLayer: {value: false},
      uOceanExtinction: {value: new THREE.Vector3(...JERLOV[DEFAULT_WATER_TYPE].extinction)},
      uOceanRefraction: {value: D.refractionStrength}, uOceanClarity: {value: D.clarity}, uOceanTir: {value: D.tirStrength},
      uReflectionMode: {value: 0}, uReflectionMix: {value: D.reflectionMix}, uReflectionSteps: {value: D.reflectionSteps},
      tPlanarReflection: {value: null}, uPlanarMatrix: {value: planar.matrix},
      uScatterColor: {value: new THREE.Color(SCATTER.color)},
      uScatterAmbient: sky.uniforms.uAmb ?? {value: new THREE.Color(...SCATTER.ambient)},
      uScatterIntensity: {value: SCATTER.intensity}, uScatterAnisotropy: {value: SCATTER.anisotropy},
      uScatterAmbientTerm: {value: 1}, uScatterSunTerm: {value: 1},
      uSssIntensity: {value: D.crestGlow}, uSssSunFalloff: {value: SCATTER.crestFalloff}, uSssPinchMin: {value: SCATTER.pinch[0]},
      uSssPinchMax: {value: SCATTER.pinch[1]}, uSssPinchFalloff: {value: SCATTER.pinchFalloff},
    } : {}),
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: capture ? THREE.DoubleSide : THREE.FrontSide,
    defines: {...sky.defines, ...(fft ? {OCEAN_FFT: 1} : {}), ...(wake ? {OCEAN_WAKE: 1} : {}), ...(useClipmap ? {OCEAN_CLIPMAP: 1} : {}),
      ...(capture ? {OCEAN_SCENE_OPTICS: 1} : {})},
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
   const float eta = 1.333;
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
  const mesh = useClipmap ? new THREE.Group() : new THREE.Mesh(geometry, material);
  const clipmap = useClipmap ? new OceanClipmap(mesh, material, clipmapSettings === true ? {} : clipmapSettings) : null;
  if (!clipmap) mesh.frustumCulled = false;
  const state = {...OCEAN_DEFAULTS, ...settings};
  let shoreSettings, surfSettings, shoreHeading, fftTime = 0;
  let environment = null;   // optional core/environment.js contract: supplies the wind update() was not given
  function syncSurf(heading) {
    if (!surfSettings || heading === shoreHeading) return;
    const wavelength = applySurf(fft.surf, surfSettings, fft.sea.swellHeight, THREE.MathUtils.degToRad(heading), shoreSettings);
    fft.shore.apply(shoreSettings, SURF_WARP_REACH_SPACINGS * wavelength);
    shoreHeading = heading;
  }
  function apply(values = {}) {
    Object.assign(state, values);
    uniforms.heading.value = THREE.MathUtils.degToRad(state.heading);
    uniforms.swell.value = state.swell; uniforms.swellLength.value = state.swellLength;
    uniforms.chop.value = state.chop; uniforms.choppiness.value = state.choppiness; uniforms.whitecaps.value = state.whitecaps;
    uniforms.waterTint.value.set(state.waterTint); uniforms.foamTint.value.set(state.foamTint);
    uniforms.reflection.value = state.reflection; uniforms.fresnelPower.value = state.fresnelPower; uniforms.glint.value = state.glint;
    uniforms.fineRipples.value = state.fineRipples; uniforms.foamOpacity.value = state.foamOpacity;
    uniforms.foamFeather.value = state.foamFeather; uniforms.foamScale.value = state.foamScale;
    if (fft) {
      uniforms.uFoamFeather.value = state.foamFeather;
      uniforms.uFoamTileSize.value = FOAM_TILES.foam * state.foamScale;
      uniforms.uWakeFoamTileSize.value = FOAM_TILES.wake * state.foamScale;
    }
    if (capture) {
      uniforms.uOceanRefraction.value = state.refractionStrength;
      uniforms.uOceanClarity.value = state.clarity;
      uniforms.uOceanTir.value = state.tirStrength;
      uniforms.uSssIntensity.value = state.crestGlow;
      uniforms.uReflectionMix.value = state.reflectionMix;
      uniforms.uReflectionSteps.value = state.reflectionSteps;
      const ssr = state.reflectionSource === 'screen space';
      if (ssr !== Boolean(material.defines.OCEAN_REFLECTION_SSR)) {
        if (ssr) material.defines.OCEAN_REFLECTION_SSR = 1;
        else delete material.defines.OCEAN_REFLECTION_SSR;
        material.needsUpdate = true;
      }
    }
    return state;
  }
  apply();
  return {
    mesh, material, uniforms, settings: state, apply, fft, clipmap, caustics, wake, obstacles, exclusion,
    get depthTexture() { return capture?.depthTexture; },
    get waterDistanceTexture() { return waterTarget?.texture; },
    get viewport() { return captureSize; },
    shoreBinding: fft ? {
      uniforms: {...fft.uniforms, ...caustics?.uniforms, ...wake?.uniforms},
      glsl: `${FFT_SAMPLE_GLSL}
        ${caustics ? OCEAN_CAUSTIC_GLSL : ''}
        ${wake ? SIM_SAMPLE_GLSL : ''}
        float surfaceHeightAt(vec2 xz) {
          float height = uOceanFftActive > .5 ? oceanDisplacement(xz, 1.0).y : 0.0;
          ${wake ? 'float fade; height += sampleRipple(xz, fade).r;' : ''}
          return height;
        }`,
    } : null,
    captureScene(scene, camera, {waterType = DEFAULT_WATER_TYPE, bodyGain = .45, excludeHulls = true} = {}) {
      if (!capture) throw new Error('Ocean scene capture requires a renderer');
      const water = Object.hasOwn(JERLOV, waterType) ? JERLOV[waterType] : JERLOV[DEFAULT_WATER_TYPE];
      uniforms.uOceanExtinction.value.fromArray(water.extinction);
      uniforms.uScatterColor.value.setRGB(...water.body, THREE.SRGBColorSpace).multiplyScalar(bodyGain);
      const wasVisible = mesh.visible;
      renderer.getDrawingBufferSize(captureSize);
      capture.setSize(captureSize.x, captureSize.y);
      mesh.visible = false;
      sceneScope(() => { try {
        if (exclusion) exclusion.uniforms.uExclusionOn.value = 0;
        uniforms.uReflectionMode.value = 0;
        if (state.reflectionMix > 0 && state.reflectionSource === 'planar' && camera.getWorldPosition(eye).y > PLANAR_MIN_EYE_HEIGHT) {
          planar.render(scene, camera, {resolution: state.planarResolution, hz: state.planarHz});
          uniforms.tPlanarReflection.value = planar.texture;
          uniforms.uReflectionMode.value = 1;
        } else if (state.reflectionSource === 'screen space') uniforms.uReflectionMode.value = 2;
        exclusion?.update(camera, capture.width, capture.height, excludeHulls);
        renderer.setRenderTarget(capture);
        renderer.clear();
        renderer.render(scene, camera);
        uniforms.uOceanInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
        uniforms.uOceanVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        uniforms.uOceanSceneReady.value = true;
      } finally {
        mesh.visible = wasVisible;
      } });
      return capture;
    },
    captureWater(waterScene, camera) {
      if (!uniforms.uOceanSceneReady?.value) throw new Error('Capture the opaque scene before the water layer');
      waterTarget.setSize(capture.width, capture.height);
      const mask = exclusion?.uniforms.uExclusionOn.value > .5;
      if (mask) {
        unmaskedWater ??= new THREE.WebGLRenderTarget(1, 1, {type: THREE.FloatType,
          minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
          depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)});
        unmaskedWater.setSize(capture.width, capture.height);
      }
      uniforms.uOceanWaterLayer.value = true;
      waterScope(() => { try {
        renderer.setRenderTarget(mask ? unmaskedWater : waterTarget);
        renderer.setClearColor(0, 0);
        renderer.clear();
        renderer.render(waterScene, camera);
        // Keep the exclusion depth samplers outside the ocean material: its water,
        // shore and reflection samplers already fill the WebGL2 minimum budget.
        if (mask) exclusion.filter(unmaskedWater, waterTarget);
      } finally {
        uniforms.uOceanWaterLayer.value = false;
      } });
      return waterTarget;
    },
    setShore(heightAt, {centerX = 0, centerZ = 0, half, shore, surf, offFieldDepth} = {}) {
      if (!fft) throw new Error('Ocean shore needs the FFT surface');
      if (typeof heightAt !== 'function' || !(half > 0)) throw new TypeError('Ocean shore needs heightAt and a positive half extent');
      shoreSettings = {...SHORE_DEFAULTS, ...shore};
      surfSettings = {...SURF_DEFAULTS, ...surf};
      fft.shore.bake(heightAt, centerX, centerZ, half, shoreSettings, offFieldDepth);
      shoreHeading = undefined;
      syncSurf(state.heading);
    },
    // windSpeed (m/s) optionally sharpens chop like the weather-driven demo did.
    setEnvironment(next) { environment = next ?? null; },
    update(dt, windSpeed, cameraPosition, windHeading, wakeFocus = cameraPosition) {
      if (environment) {
        windSpeed ??= environment.wind.speed;
        if (windHeading === undefined && environment.wind.speed > 0) windHeading = THREE.MathUtils.radToDeg(Math.atan2(environment.wind.z, environment.wind.x));
      }
      windHeading ??= state.heading;
      uniforms.clock.value += dt * state.waveSpeed;
      if (capture) uniforms.uOceanSceneReady.value = false;
      uniforms.chop.value = state.chop * (windSpeed ? WIND_CHOP.base + WIND_CHOP.perMetrePerSecond * windSpeed : 1);
      uniforms.heading.value = THREE.MathUtils.degToRad(windHeading);
      if (cameraPosition) clipmap?.update(cameraPosition);
      if (fft) {
        const wind = windSpeed ?? fft.sea.windSpeed;
        windDetail.configure({windFromDegrees: windHeading});
        windDetail.uniforms.uWindTime.value = uniforms.clock.value;
        uniforms.uWindDirXZ.value.set(Math.cos(uniforms.heading.value), Math.sin(uniforms.heading.value));
        uniforms.uFoamPatternDrift.value = wind * fft.foam.drift;
        uniforms.uFoamTime.value = uniforms.clock.value;
        fft.setWeatherWind(wind, fft.sea.windDrivesSeaState ? wind / Math.max(MIN_SEA_WIND, fft.sea.windSpeed) : 1, windHeading);
        fftTime += dt * state.waveSpeed;
        syncSurf(windHeading);
        if (surfSettings) setSurfTime(fft.surf, fftTime, surfSettings.period);
        fft.update(fftTime, dt);
        if (wake && wakeFocus) {
          wake.track(wakeFocus.x, wakeFocus.z);
          if (obstacles.objects.length || obstacles.uniforms.uObstacleOn.value > 0) {
            obstacles.render(wake.center.x, wake.center.y, wake.halfSize);
          }
          wake.update(dt);
        }
        if (cameraPosition) caustics?.update(cameraPosition);
      }
    },
    dispose() {
      clipmap?.dispose();
      caustics?.dispose();
      wake?.dispose();
      obstacles?.dispose();
      fft?.dispose();
      capture?.dispose();
      waterTarget?.dispose();
      unmaskedWater?.dispose();
      planar?.dispose();
      exclusion?.dispose();
      if (ownsGeometry) geometry.dispose();
      if (ownsLace) lace.dispose();
      material.dispose();
    },
  };
}
