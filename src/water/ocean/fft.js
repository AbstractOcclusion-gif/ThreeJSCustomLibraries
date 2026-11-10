// ocean/fft.js -- port of WebGpuWater's FFT-cascade ocean pass: WaterOceanFft.cs (pipeline, butterfly, layout) + OceanFft.compute
// (SpectrumInit, SpectrumUpdate, FftHorizontal/Vertical, ComputeNormal) as WebGL2 fragment passes on array render targets, one
// layer per cascade. The surface reads the results through FFT_U / FFT_SAMPLE_GLSL (the WaterLargeWaves.hlsl cascade sums).
//
// Divergence from Unity, forced by the API, not the maths: the compute runs three complex FFTs (X, height, Z spectra) in group
// shared memory with f16-packed uints; here each butterfly stage is one fragment pass and the three Hermitian spectra ride ONE
// RGBA16F texel as two complex channels -- P = H + i*Sx (its inverse transform's real part is the height, imaginary part the X
// displacement, both real-valued fields) and Q = Sz. Also: no readback bake (buoyancy is a later batch), no fetch field, no
// current drift, no direction map (see aperiodic.js), and the normal array has no mip chain (array render targets are not mipmapped),
// so far-field slope is tamed by the cascade distance fade + far slope floor only.
import * as THREE from 'three';
import { QV, createPass, createTargetScope, pingPong } from './passes.js';
import { APERIODIC_GLSL } from './aperiodic.js';
import { SHORE_GLSL, createOceanShore } from './bed.js';
import { SURF_GLSL, createSurfUniforms } from './surf-waves.js';
import { CASCADE_TILE_OVERSAMPLE, JONSWAP_PEAK_DECAY, JONSWAP_SIGMA_HIGH, JONSWAP_SIGMA_LOW, SWELL_DIR_POWER, SWELL_WIDTH, TMA_OFFSET, TMA_SLOPE,
  buildLayout, computeUnitVariances, gainForHeight, peakAngularFrequency, SHORT_WAVE_ROLLOFF_SPAN } from './fft-spectrum.js';

export const SUPPORTED_RESOLUTIONS = [64, 128, 256];
export const MAX_CASCADES = 4;                            // OCEAN_FFT_MAX_CASCADES
const SPECTRUM_SEED = 1337;
const MAX_FOAM_DELTA_TIME = 0.1;                          // clamp dt so a frame hitch can't over-accumulate foam
const FAR_SLOPE_FLOOR = [0.15, 0.20, 0.25, 0.25];         // OceanFftFarSlopeFloor: the far field never goes mirror-flat
const CASCADE_WAVELENGTH_FRACTION = 0.25 / CASCADE_TILE_OVERSAMPLE;   // OCEAN_FFT_CASCADE_WAVELENGTH_FRACTION
// "Wind Drives Ambient Sea State": the authored Hs / peak wavelength are exact at the reference wind; other winds scale them
// by (wind / reference) ^ exponent (Settings.Ocean.cs WindSeaGrowth). Swell stays independent.
export const WIND_SEA_HEIGHT_EXPONENT = 1, WIND_SEA_LENGTH_EXPONENT = 2 / 3;
const REFERENCE_WIND_MIN = 0.01;
export function windSeaGrowth(sea, exponent) {
  if (!sea.windDrivesSeaState) return 1;
  return Math.pow(Math.max(sea.windSpeed, 0) / Math.max(sea.referenceWindSpeed, REFERENCE_WIND_MIN), exponent);
}

// Unity defaults (WaterVolume.Settings.Ocean.cs).
export const SEA_STATE_DEFAULTS = Object.freeze({ significantWaveHeight: 1.5, peakWavelength: 60, peakSharpness: 3.3, seaDepth: 0,
  windSpeed: 8, windDrivesSeaState: true, referenceWindSpeed: 8, windHeadingDeg: 0, windTurbulence: 0.25, swellHeight: 0, swellWavelength: 140, swellHeadingDeg: 20,
  choppiness: 1, cascadeReach: 3, aperiodic: false, aperiodicTileScale: 1,
  shortestWavelength: 0, fineNormal: 1, waveSpeed: 1 });   // shortestWavelength m (0 = full JONSWAP tail), fineNormal = finest cascade tilt weight, waveSpeed = dispersion time scale   // Unity ships windDrivesAmbientSeaState off; on here so the wind slider means something
export const FOAM_DEFAULTS = Object.freeze({ windThreshold: 4, coverage: 0.75, strength: 1, fadeRate: 0.5, maxBuildup: 1, deposit: 0.85, drift: 0.08,
  crestAnisotropy: 1, crestGate: 0.8, faceBias: 0.6, cascadeMix: 1 });

// Shared by the surface material (written by OceanFft.update).
const createFftUniforms = () => ({ tOceanDisp: { value: null }, tOceanNormal: { value: null }, uOceanDomainSizes: { value: new THREE.Vector4() },
  uOceanVisibleAreas: { value: new THREE.Vector4() }, uOceanCascadeCount: { value: 0 }, uOceanFftActive: { value: 0 },
  uOceanAperiodic: { value: new THREE.Vector2(0, 1) }, uOceanFineNormal: { value: 1 } });   // x = enabled, y = tile scale

const glf = x => Number(x).toPrecision(9);
const COMMON_GLSL = /* glsl */`
#define OCEAN_TWO_PI 6.28318530718
#define OCEAN_GRAVITY 9.81
#define OCEAN_KMIN 1e-4
uniform int uResolution, uSlice; uniform vec4 uDomainSizes;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 oceanWaveVector(ivec2 xy, int slice){ vec2 centred = vec2(xy) - float(uResolution) * 0.5; return OCEAN_TWO_PI * centred / max(uDomainSizes[slice], 1e-3); }`;

// SpectrumInit: static random spectrum H0 (h0(k), conj(h0(-k))), rebuilt only when the sea state changes.
const SPECTRUM_INIT_GLSL = /* glsl */`
#define OCEAN_JONSWAP_PEAK_DECAY ${glf(JONSWAP_PEAK_DECAY)}
#define OCEAN_JONSWAP_SIGMA_LOW ${glf(JONSWAP_SIGMA_LOW)}
#define OCEAN_JONSWAP_SIGMA_HIGH ${glf(JONSWAP_SIGMA_HIGH)}
#define OCEAN_TMA_SLOPE ${glf(TMA_SLOPE)}
#define OCEAN_TMA_OFFSET ${glf(TMA_OFFSET)}
#define OCEAN_SPREAD_PEDESTAL 0.5287611
#define OCEAN_TURBULENCE_FLOOR_FINEST 0.5
#define OCEAN_TURBULENCE_FLOOR_FINE 0.25
#define OCEAN_SWELL_WIDTH ${glf(SWELL_WIDTH)}
#define OCEAN_SWELL_DIR_POWER ${glf(SWELL_DIR_POWER)}
uniform vec4 uBandMin, uBandMax; uniform vec2 uWindDir, uSwellDir; uniform int uSeed, uCascades; uniform float uShortestWavelength;
// CPU twin: shortWaveWeight in fft-spectrum.js (keeps the Hs calibration consistent with what is drawn).
float oceanShortWaveWeight(float wavelength){ if (uShortestWavelength <= 0.0) return 1.0;
  return smoothstep(uShortestWavelength, uShortestWavelength * ${SHORT_WAVE_ROLLOFF_SPAN}.0, wavelength); }
uniform float uWindTurbulence, uPeakAngularFreq, uPeakSharpness, uSeaDepth, uSpectrumGain, uSwellGain, uSwellWavelength, uSwellHeight;
uint wangHash(uint s){ s = (s ^ 61u) ^ (s >> 16); s *= 9u; s ^= s >> 4; s *= 0x27d4eb2du; s ^= s >> 15; return s; }
float oceanRandom(inout uint state){ state = wangHash(state); return float(state) * (1.0 / 4294967296.0); }
vec2 oceanGaussian(inout uint state){ float u1 = max(1e-6, oceanRandom(state)); float u2 = oceanRandom(state);
  float r = sqrt(-2.0 * log(u1)); float theta = OCEAN_TWO_PI * u2; return vec2(r * cos(theta), r * sin(theta)); }
float oceanJonswapOmni(float kMag){
  if (kMag < OCEAN_KMIN) return 0.0;
  float omega = sqrt(OCEAN_GRAVITY * kMag);
  float peakRatio = uPeakAngularFreq / omega; float peakRatio2 = peakRatio * peakRatio;
  float shape = exp(-OCEAN_JONSWAP_PEAK_DECAY * peakRatio2 * peakRatio2) / pow(omega, 5.0);
  float sigma = (omega <= uPeakAngularFreq) ? OCEAN_JONSWAP_SIGMA_LOW : OCEAN_JONSWAP_SIGMA_HIGH;
  float peakOffset = (omega - uPeakAngularFreq) / max(sigma * uPeakAngularFreq, 1e-6);
  shape *= pow(max(uPeakSharpness, 1.0), exp(-0.5 * peakOffset * peakOffset));
  if (uSeaDepth > 0.0) shape *= 0.5 + 0.5 * tanh(OCEAN_TMA_SLOPE * (omega * sqrt(uSeaDepth / OCEAN_GRAVITY) - OCEAN_TMA_OFFSET));
  float dOmegaDk = 0.5 * sqrt(OCEAN_GRAVITY / kMag);
  return shape * dOmegaDk / kMag; }
float oceanDirectionalSpreading(float cosTheta, float turbulence){ float pedestal = OCEAN_SPREAD_PEDESTAL * turbulence;
  return (cosTheta > 0.0) ? (cosTheta * cosTheta * (1.0 - turbulence) + pedestal) : pedestal; }
float oceanSpreadingNormalisation(float turbulence){ return 2.0 / max((1.0 - turbulence) + 4.0 * OCEAN_SPREAD_PEDESTAL * turbulence, 1e-4); }
float oceanCascadeMeasure(int slice){ float dk = OCEAN_TWO_PI / max(uDomainSizes[slice], 1e-3); return dk * dk; }
float oceanCascadeTurbulence(int slice){ float t = clamp(uWindTurbulence, 0.0, 1.0);
  if (slice == 0) return max(t, OCEAN_TURBULENCE_FLOOR_FINEST); if (slice == 1) return max(t, OCEAN_TURBULENCE_FLOOR_FINE); return t; }
float oceanSwellShape(vec2 k, float kMag){
  if (uSwellHeight <= 0.0 || kMag < OCEAN_KMIN) return 0.0;
  float kSwell = OCEAN_TWO_PI / max(uSwellWavelength, 1e-3); float width = kSwell * OCEAN_SWELL_WIDTH;
  float radial = exp(-((kMag - kSwell) * (kMag - kSwell)) / (2.0 * width * width));
  float directional = pow(clamp(dot(k / kMag, uSwellDir), 0.0, 1.0), OCEAN_SWELL_DIR_POWER);
  return radial * directional; }
void main(){
  ivec2 xy = ivec2(gl_FragCoord.xy);
  vec2 k = oceanWaveVector(xy, uSlice); float kMag = length(k);
  float turbulence = oceanCascadeTurbulence(uSlice);
  float windSea = oceanJonswapOmni(kMag) * oceanSpreadingNormalisation(turbulence) * uSpectrumGain;
  float cosTheta = (kMag > OCEAN_KMIN) ? dot(k / kMag, uWindDir) : 0.0;
  float measure = oceanCascadeMeasure(uSlice);
  float ampK  = sqrt((windSea * oceanDirectionalSpreading(cosTheta, turbulence) + oceanSwellShape(k, kMag) * uSwellGain) * measure * 0.5);
  float ampMK = sqrt((windSea * oceanDirectionalSpreading(-cosTheta, turbulence) + oceanSwellShape(-k, kMag) * uSwellGain) * measure * 0.5);
  float wavelength = (kMag > OCEAN_KMIN) ? (OCEAN_TWO_PI / kMag) : 1e9;
  if (wavelength <= uBandMin[uSlice] || wavelength > uBandMax[uSlice]) { ampK = 0.0; ampMK = 0.0; }
  float shortWave = oceanShortWaveWeight(wavelength); ampK *= shortWave; ampMK *= shortWave;   // trims the wind sea only; the swell ring is far longer
  uint state = (uint(xy.x) * 1973u + uint(xy.y) * 9277u + uint(uSlice) * 26699u + uint(uSeed)) | 1u;
  vec2 h0k = oceanGaussian(state) * ampK;
  vec2 h0mk = oceanGaussian(state) * ampMK;
  gl_FragColor = vec4(h0k, h0mk.x, -h0mk.y);   // (h0(k), conj(h0(-k)))
}`;

// SpectrumUpdate: evolve H0 to time t; pack P = H + i*Sx, Q = Sz (see the header).
const SPECTRUM_UPDATE_GLSL = /* glsl */`
uniform sampler2DArray tH0; uniform float uTime, uChoppiness;
void main(){
  ivec2 xy = ivec2(gl_FragCoord.xy);
  vec4 h0 = texelFetch(tH0, ivec3(xy, uSlice), 0);
  vec2 k = oceanWaveVector(xy, uSlice); float kMag = length(k);
  float omega = sqrt(OCEAN_GRAVITY * kMag);
  float s = sin(omega * uTime), c = cos(omega * uTime);
  vec2 h = cmul(h0.xy, vec2(c, s)) + cmul(h0.zw, vec2(c, -s));
  vec2 nk = (kMag > OCEAN_KMIN) ? k / kMag : vec2(0.0);
  vec2 iH = vec2(-h.y, h.x) * uChoppiness;
  vec2 sx = iH * nk.x, sz = iH * nk.y;
  gl_FragColor = vec4(h.x - sx.y, h.y + sx.x, sz.x, sz.y);
}`;

// One butterfly stage (horizontal or vertical). Stage 0 reads bit-reversed indices through the butterfly texture, as the compute.
// The last vertical stage resolves the packed pair into (dispX, height, dispZ, 0) with the (-1)^(x+y) centring sign.
const BUTTERFLY_GLSL = /* glsl */`
uniform sampler2DArray tSpec; uniform sampler2D tButterfly; uniform int uStage, uHorizontal, uResolve;
void main(){
  ivec2 xy = ivec2(gl_FragCoord.xy);
  int e = (uHorizontal == 1) ? xy.x : xy.y;
  vec4 bf = texelFetch(tButterfly, ivec2(uStage, e), 0);
  int a = int(bf.z + 0.5), b = int(bf.w + 0.5); vec2 w = bf.xy;
  ivec3 pa = (uHorizontal == 1) ? ivec3(a, xy.y, uSlice) : ivec3(xy.x, a, uSlice);
  ivec3 pb = (uHorizontal == 1) ? ivec3(b, xy.y, uSlice) : ivec3(xy.x, b, uSlice);
  vec4 A = texelFetch(tSpec, pa, 0), B = texelFetch(tSpec, pb, 0);
  vec4 r = vec4(A.xy + cmul(w, B.xy), A.zw + cmul(w, B.zw));
  if (uResolve == 1) { float sign = (((xy.x + xy.y) & 1) == 1) ? -1.0 : 1.0; r = vec4(r.y, r.x, r.z, 0.0) * sign; }
  gl_FragColor = r;
}`;

// ComputeNormal: finite-difference normal + Jacobian fold -> whitecap accumulation (history = last frame's normal.w).
const NORMAL_GLSL = /* glsl */`
#define OCEAN_FOAM_ACCUM_RATE 5.0
#define OCEAN_FOAM_CASCADE1_DAMP 0.25
#define OCEAN_FOAM_DENSE_REFERENCE 0.6
#define OCEAN_FOAM_FINEST_DAMP 0.5
#define OCEAN_FOAM_CREST_GATE_LOW 0.5
uniform sampler2DArray tDisp, tFoamPrev; uniform int uTileMask, uCascades; uniform vec2 uWindDir;
uniform float uWindSpeed, uFoamDeltaTime, uFoamHistoryValid, uFoamMinWind, uFoamAnisotropy, uFoamCrestGate, uFoamFaceBias, uFoamCascadeMix,
  uFoamCoverage, uFoamStrength, uFoamFadeRate, uFoamMax, uFoamSlowFadeFraction, uFoamDriftFraction;
vec3 dispAt(int x, int y){ return texelFetch(tDisp, ivec3(x & uTileMask, y & uTileMask, uSlice), 0).xyz; }
float foamPrev(int x, int y){ return texelFetch(tFoamPrev, ivec3(x & uTileMask, y & uTileMask, uSlice), 0).w; }
float foamHistoryBilinear(vec2 texelPos){ vec2 baseF = floor(texelPos); vec2 f = texelPos - baseF; int x0 = int(baseF.x), y0 = int(baseF.y);
  return mix(mix(foamPrev(x0, y0), foamPrev(x0 + 1, y0), f.x), mix(foamPrev(x0, y0 + 1), foamPrev(x0 + 1, y0 + 1), f.x), f.y); }
float foamDecayBlend(float amount, float referenceAmount, float valueAtZero, float valueAtReference){ return mix(valueAtZero, valueAtReference, clamp(amount / referenceAmount, 0.0, 1.0)); }
void main(){
  ivec2 id = ivec2(gl_FragCoord.xy);
  float step = max(uDomainSizes[uSlice], 1e-3) / float(uResolution);   // metres per texel
  vec3 dr = dispAt(id.x + 1, id.y), dl = dispAt(id.x - 1, id.y), du = dispAt(id.x, id.y + 1), dd = dispAt(id.x, id.y - 1);
  float centreHeight = dispAt(id.x, id.y).y;
  vec3 tangentX = vec3(2.0 * step + dr.x - dl.x, dr.y - dl.y, dr.z - dl.z);
  vec3 tangentZ = vec3(du.x - dd.x, du.y - dd.y, 2.0 * step + du.z - dd.z);
  vec3 n = normalize(cross(tangentZ, tangentX));
  float invTwoStep = 1.0 / (2.0 * step);
  float jxx = 1.0 + (dr.x - dl.x) * invTwoStep, jzz = 1.0 + (du.z - dd.z) * invTwoStep;
  float jxz = (dr.z - dl.z) * invTwoStep, jzx = (du.x - dd.x) * invTwoStep;
  float jacobian = jxx * jzz - jxz * jzx;
  float foldTrace = jxx + jzz;
  float foldDiscriminant = max(foldTrace * foldTrace - 4.0 * jacobian, 0.0);
  float foldMeasure = mix(jacobian, 0.5 * (foldTrace - sqrt(foldDiscriminant)), clamp(uFoamAnisotropy, 0.0, 1.0));
  float fresh = clamp(uFoamCoverage - foldMeasure, 0.0, 1.0);
  float cascadeDamp = (uSlice == 0) ? 0.0 : ((uSlice == 1) ? OCEAN_FOAM_CASCADE1_DAMP : 1.0);
  cascadeDamp *= (uSlice == uCascades - 1 && uCascades > 2) ? OCEAN_FOAM_FINEST_DAMP : 1.0;
  fresh *= mix(cascadeDamp, 1.0, clamp(uFoamCascadeMix, 0.0, 1.0));
  fresh *= (uWindSpeed > uFoamMinWind) ? 1.0 : 0.0;
  float neighbourMin = min(min(dr.y, dl.y), min(du.y, dd.y)), neighbourMax = max(max(dr.y, dl.y), max(du.y, dd.y));
  float crestRise = clamp((centreHeight - neighbourMin) / max(neighbourMax - neighbourMin, 1e-5), 0.0, 1.0);
  fresh *= mix(1.0, smoothstep(OCEAN_FOAM_CREST_GATE_LOW, 1.0, crestRise), clamp(uFoamCrestGate, 0.0, 1.0));
  float tiltLength = length(n.xz);
  float faceAlign = (tiltLength > 1e-5) ? dot(n.xz / tiltLength, uWindDir) : 0.0;
  fresh *= mix(1.0, clamp(faceAlign * 0.5 + 0.5, 0.0, 1.0), clamp(uFoamFaceBias, 0.0, 1.0));
  float driftSpeed = uWindSpeed * uFoamDriftFraction;
  vec2 driftTexels = uWindDir * (driftSpeed * uFoamDeltaTime / step);
  float advectedFoam = foamHistoryBilinear(vec2(id) - driftTexels) * uFoamHistoryValid;
  float foamDt = (uFoamHistoryValid < 0.5) ? (1.0 / max(uFoamFadeRate, 1e-3)) : uFoamDeltaTime;
  float slowFade = uFoamFadeRate * uFoamSlowFadeFraction;
  float fadeRate = foamDecayBlend(advectedFoam, OCEAN_FOAM_DENSE_REFERENCE, uFoamFadeRate, slowFade);
  float foam = advectedFoam * clamp(1.0 - fadeRate * uFoamDeltaTime, 0.0, 1.0) + OCEAN_FOAM_ACCUM_RATE * uFoamStrength * foamDt * fresh;
  foam = min(foam, uFoamMax);
  gl_FragColor = vec4(n.x, clamp(1.0 - foldMeasure, 0.0, 1.0), n.z, foam);
}`;

// Surface-side sampling (WaterLargeWaves.hlsl cascade sums), shared by the vertex (displacement) and fragment (normal/foam) stages.
export const FFT_SAMPLE_GLSL = /* glsl */`
${APERIODIC_GLSL}
${SHORE_GLSL}
${SURF_GLSL}
#define OCEAN_FFT_MAX_CASCADES ${MAX_CASCADES}
#define OCEAN_FFT_CASCADE_WAVELENGTH_FRACTION 0.0625   // WaterShared.hlsl: a cascade's representative wavelength as a fraction of its tile
uniform sampler2DArray tOceanDisp, tOceanNormal; uniform vec4 uOceanDomainSizes, uOceanVisibleAreas; uniform float uOceanCascadeCount, uOceanFftActive, uOceanFineNormal;
uniform vec2 uOceanAperiodic;
const vec4 OCEAN_FAR_SLOPE_FLOOR = vec4(${FAR_SLOPE_FLOOR.map(glf).join(', ')});
struct OceanFftSum { vec2 tilt; float pinch; float foam; };
// Shore depth attenuation of one cascade's representative wavelength (OceanCascadeShoalWeight): short cascades survive closer in.
float oceanCascadeShoalWeight(int c, ShoreData shore){ float wavelength = max(uOceanDomainSizes[c], 1e-3) * OCEAN_FFT_CASCADE_WAVELENGTH_FRACTION; return mix(1.0, shoalWeight(shore.depth, wavelength), shore.influence); }
// Full near the camera, 0 past the cascade's visible range, cubic taper. Shared by displacement AND shading: they must agree.
float oceanCascadeDistanceFade(float camDist, float visibleArea){ float f = clamp(camDist / max(visibleArea, 1e-3), 0.0, 1.0); return 1.0 - f * f * f; }
vec3 oceanTapDisp(vec2 uv, float slice){ return textureLod(tOceanDisp, vec3(uv, slice), 0.0).xyz; }
#ifdef OCEAN_SCREEN_FILTER
vec2 oceanPixelDx, oceanPixelDy;
#endif
vec4 oceanTapNormal(vec2 uv, float slice){
#ifdef OCEAN_SCREEN_FILTER
  if(uSurfaceDetailLod>.5){
    vec2 size=vec2(textureSize(tOceanNormal,0).xy);
    float pixels=max(length(oceanPixelDx*size),length(oceanPixelDy*size));
    if(pixels>1.0){
      float span=min(1.0,8.0/max(pixels,1.0));
      vec2 x=oceanPixelDx*.25*span,y=oceanPixelDy*.25*span;
      vec4 tap=(textureLod(tOceanNormal,vec3(uv+x+y,slice),0.0)
        +textureLod(tOceanNormal,vec3(uv+x-y,slice),0.0)
        +textureLod(tOceanNormal,vec3(uv-x+y,slice),0.0)
        +textureLod(tOceanNormal,vec3(uv-x-y,slice),0.0))*.25;
      // Once this cascade's texels are unresolved, retain the broader cascades instead.
      tap.xz*=1.0-smoothstep(2.0,12.0,pixels);
      return tap;
    }
  }
#endif
  return textureLod(tOceanNormal, vec3(uv, slice), 0.0);
}
vec3 oceanAperiodicDisplacement(vec2 exemplarUv, float slice){
  OceanAperiodicTriangle t = oceanAperiodicTriangleAt(exemplarUv, uOceanAperiodic.y); vec3 w = oceanAperiodicVarianceWeights(t.weights);
  return oceanTapDisp(oceanAperiodicSampleUv(exemplarUv, t.vertex0), slice) * w.x + oceanTapDisp(oceanAperiodicSampleUv(exemplarUv, t.vertex1), slice) * w.y
       + oceanTapDisp(oceanAperiodicSampleUv(exemplarUv, t.vertex2), slice) * w.z; }
vec4 oceanAperiodicNormal(vec2 exemplarUv, float slice){
  OceanAperiodicTriangle t = oceanAperiodicTriangleAt(exemplarUv, uOceanAperiodic.y); vec3 vw = oceanAperiodicVarianceWeights(t.weights);
  vec4 tap0 = oceanTapNormal(oceanAperiodicSampleUv(exemplarUv, t.vertex0), slice), tap1 = oceanTapNormal(oceanAperiodicSampleUv(exemplarUv, t.vertex1), slice),
       tap2 = oceanTapNormal(oceanAperiodicSampleUv(exemplarUv, t.vertex2), slice);
  vec2 tilt = tap0.xz * vw.x + tap1.xz * vw.y + tap2.xz * vw.z;                       // zero-mean field: variance-preserving blend
  vec2 coverage = vec2(tap0.y, tap0.w) * t.weights.x + vec2(tap1.y, tap1.w) * t.weights.y + vec2(tap2.y, tap2.w) * t.weights.z;   // coverage: plain barycentric
  return vec4(tilt.x, coverage.x, tilt.y, coverage.y); }
// Callers that already hold a ShoreData (the surface stages) use the *Shore variants; the plain ones fetch it (one depth + one sdf tap).
vec3 oceanFftDisplacementShore(vec2 worldXZ, vec2 fadeOriginXZ, ShoreData shore){
  float camDist = distance(worldXZ, fadeOriginXZ); vec3 sum = vec3(0.0);
  for (int c = 0; c < OCEAN_FFT_MAX_CASCADES; c++) { if (c >= int(uOceanCascadeCount)) break;
    float domain = max(uOceanDomainSizes[c], 1e-3); float fade = oceanCascadeDistanceFade(camDist, uOceanVisibleAreas[c]) * oceanCascadeShoalWeight(c, shore);
    vec2 uv = worldXZ / domain;
    sum += fade * ((uOceanAperiodic.x > 0.5) ? oceanAperiodicDisplacement(uv, float(c)) : oceanTapDisp(uv, float(c))); }
  return sum; }
// The surf fronts at a rest xz from its shore sample (master beat clock).
SurfWaveSample surfSampleAt(vec2 worldXZ, ShoreData shore){ return evaluateSurfWaves(worldXZ, shore.depth, shore.sdfDist, shore.toShore, shore.slopeTan, shore.influence, uSurfBeatTime); }
// THE drawn displacement (LargeBodyWaveHeightDispShore, FFT branch): shoaled cascades x the amplitude knob, faded where the surf
// owns the surface, plus the surf front height (physical metres, never amplitude-scaled). Every consumer composes through this.
vec3 oceanDisplacementShore(vec2 worldXZ, vec2 fadeOriginXZ, float amplitude, ShoreData shore, SurfWaveSample surf){
  vec3 d = oceanFftDisplacementShore(worldXZ, fadeOriginXZ, shore) * (amplitude * surfAmbientWeight(surf.mask)); d.y += surf.height; return d; }
vec3 oceanDisplacementFrom(vec2 worldXZ, vec2 fadeOriginXZ, float amplitude){ ShoreData shore = shoreSample(worldXZ); return oceanDisplacementShore(worldXZ, fadeOriginXZ, amplitude, shore, surfSampleAt(worldXZ, shore)); }
vec3 oceanDisplacement(vec2 worldXZ, float amplitude){ return oceanDisplacementFrom(worldXZ, cameraPosition.xz, amplitude); }
OceanFftSum oceanFftNormalSumShore(vec2 worldXZ, ShoreData shore){
  float camDist = distance(worldXZ, cameraPosition.xz); OceanFftSum sum; sum.tilt = vec2(0.0); sum.pinch = 0.0; sum.foam = 0.0;
#ifdef OCEAN_SCREEN_FILTER
  vec2 pixelDx=dFdx(worldXZ),pixelDy=dFdy(worldXZ);
#endif
  for (int c = 0; c < OCEAN_FFT_MAX_CASCADES; c++) { if (c >= int(uOceanCascadeCount)) break;
    float domain = max(uOceanDomainSizes[c], 1e-3); float fade = oceanCascadeDistanceFade(camDist, uOceanVisibleAreas[c]);
#ifdef OCEAN_SCREEN_FILTER
    oceanPixelDx=pixelDx/domain; oceanPixelDy=pixelDy/domain;
#endif
    vec2 uv = worldXZ / domain;
    vec4 tap = (uOceanAperiodic.x > 0.5) ? oceanAperiodicNormal(uv, float(c)) : oceanTapNormal(uv, float(c));
    float shoal = oceanCascadeShoalWeight(c, shore);
    float fineWeight = (c == int(uOceanCascadeCount) - 1 && c > 0) ? uOceanFineNormal : 1.0;   // shading-only weight of the finest cascade
    sum.tilt += shoal * max(fade, OCEAN_FAR_SLOPE_FLOOR[c]) * tap.xz * fineWeight; sum.pinch += shoal * fade * tap.y; sum.foam += shoal * fade * tap.w; }
  return sum; }
OceanFftSum oceanFftNormalSum(vec2 worldXZ){ return oceanFftNormalSumShore(worldXZ, shoreSample(worldXZ)); }`;

const DEG = Math.PI / 180;
const bitReverse = (x, bits) => { let r = 0; for (let i = 0; i < bits; i++) { r = (r << 1) | (x & 1); x >>= 1; } return r; };
// (twiddle.x, twiddle.y, indexA, indexB) per (stage, element) -- WaterOceanFft.BuildButterfly.
function buildButterfly(size, stages) {
  const px = new Float32Array(stages * size * 4);
  for (let stage = 0; stage < stages; stage++) {
    const span = 1 << stage, block = 1 << (stage + 1);
    for (let y = 0; y < size; y++) {
      const k = (y * (size >> (stage + 1))) % size, ang = 2 * Math.PI * k / size;
      const top = (y % block) < span;
      let a, b;
      if (stage === 0) { a = top ? bitReverse(y, stages) : bitReverse(y - span, stages); b = top ? bitReverse(y + span, stages) : bitReverse(y, stages); }
      else { a = top ? y : y - span; b = top ? y + span : y; }
      const i = (y * stages + stage) * 4; px[i] = Math.cos(ang); px[i + 1] = Math.sin(ang); px[i + 2] = a; px[i + 3] = b;
    }
  }
  const tex = new THREE.DataTexture(px, stages, size, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return tex;
}
function arrayTarget(size, layers, type, filter, wrap) {
  const rt = new THREE.WebGLArrayRenderTarget(size, size, layers);
  rt.texture.type = type; rt.texture.format = THREE.RGBAFormat; rt.texture.minFilter = rt.texture.magFilter = filter;
  rt.texture.wrapS = rt.texture.wrapT = wrap; rt.texture.generateMipmaps = false; rt.depthBuffer = false;
  return rt;
}
const passMaterial = (glsl, uniforms) => new THREE.ShaderMaterial({ vertexShader: QV, fragmentShader: COMMON_GLSL + glsl, uniforms, depthTest: false, depthWrite: false });

export class OceanFft {
  constructor(renderer, { resolution = 128, cascades = 4 } = {}) {
    if (!SUPPORTED_RESOLUTIONS.includes(resolution)) throw new RangeError(`OceanFft: resolution ${resolution} not in ${SUPPORTED_RESOLUTIONS}`);
    if (!Number.isInteger(cascades) || cascades < 1 || cascades > MAX_CASCADES) throw new RangeError(`OceanFft: cascades ${cascades} must be 1..${MAX_CASCADES}`);
    if (!renderer.capabilities.isWebGL2) throw new Error('OceanFft needs WebGL2 (array render targets)');
    this.renderer = renderer;
    this.pass = createPass(renderer);
    this.scope = createTargetScope(renderer);
    this.shore = createOceanShore(renderer);
    this.surf = createSurfUniforms();
    this.uniforms = { ...this.shore.uniforms, ...this.surf, ...createFftUniforms() };
    this.resolution = resolution; this.cascades = cascades; this.stages = Math.round(Math.log2(resolution));
    this.h0 = arrayTarget(resolution, cascades, THREE.FloatType, THREE.NearestFilter, THREE.RepeatWrapping);
    this.spec = pingPong(() => arrayTarget(resolution, cascades, THREE.HalfFloatType, THREE.NearestFilter, THREE.RepeatWrapping));
    this.disp = arrayTarget(resolution, cascades, THREE.HalfFloatType, THREE.LinearFilter, THREE.RepeatWrapping);
    this.normal = pingPong(() => arrayTarget(resolution, cascades, THREE.HalfFloatType, THREE.LinearFilter, THREE.RepeatWrapping));
    this.butterfly = buildButterfly(resolution, this.stages);
    const shared = { uResolution: { value: resolution }, uSlice: { value: 0 }, uDomainSizes: { value: new THREE.Vector4() } };
    this.shared = shared;
    this.initMat = passMaterial(SPECTRUM_INIT_GLSL, { ...shared, uBandMin: { value: new THREE.Vector4() }, uBandMax: { value: new THREE.Vector4() }, uShortestWavelength: { value: 0 },
      uWindDir: { value: new THREE.Vector2(1, 0) }, uSwellDir: { value: new THREE.Vector2(1, 0) }, uSeed: { value: SPECTRUM_SEED }, uCascades: { value: cascades },
      uWindTurbulence: { value: 0 }, uPeakAngularFreq: { value: 1 }, uPeakSharpness: { value: 1 }, uSeaDepth: { value: 0 }, uSpectrumGain: { value: 0 },
      uSwellGain: { value: 0 }, uSwellWavelength: { value: 1 }, uSwellHeight: { value: 0 } });
    this.updateMat = passMaterial(SPECTRUM_UPDATE_GLSL, { ...shared, tH0: { value: this.h0.texture }, uTime: { value: 0 }, uChoppiness: { value: 1 } });
    this.butterflyMat = passMaterial(BUTTERFLY_GLSL, { ...shared, tSpec: { value: null }, tButterfly: { value: this.butterfly }, uStage: { value: 0 },
      uHorizontal: { value: 1 }, uResolve: { value: 0 } });
    this.normalMat = passMaterial(NORMAL_GLSL, { ...shared, tDisp: { value: this.disp.texture }, tFoamPrev: { value: null }, uTileMask: { value: resolution - 1 },
      uCascades: { value: cascades }, uWindDir: { value: new THREE.Vector2(1, 0) }, uWindSpeed: { value: 0 }, uFoamDeltaTime: { value: 0 }, uFoamHistoryValid: { value: 0 },
      uFoamMinWind: { value: 0 }, uFoamAnisotropy: { value: 0 }, uFoamCrestGate: { value: 0 }, uFoamFaceBias: { value: 0 }, uFoamCascadeMix: { value: 0 },
      uFoamCoverage: { value: 0 }, uFoamStrength: { value: 0 }, uFoamFadeRate: { value: 0 }, uFoamMax: { value: 1 }, uFoamSlowFadeFraction: { value: 0 }, uFoamDriftFraction: { value: 0 } });
    this.sea = { ...SEA_STATE_DEFAULTS }; this.foam = { ...FOAM_DEFAULTS };
    this.layout = null; this.shapeKey = ''; this.unitVariances = null; this.h0Dirty = true; this.foamHistoryValid = false;
    this.setSeaState(this.sea); this.setFoam(this.foam);
  }
  // Any change rebuilds the layout + gains and marks H0 for re-init (one pass per cascade). Shape-only work is cached by key.
  setSeaState(settings) {
    const s = { ...SEA_STATE_DEFAULTS, ...settings };
    const bad = (k, ok) => { if (!ok) throw new RangeError(`OceanFft.setSeaState: invalid ${k} = ${s[k]}`); };
    bad('significantWaveHeight', s.significantWaveHeight >= 0); bad('peakWavelength', s.peakWavelength > 0); bad('peakSharpness', s.peakSharpness >= 1);
    bad('swellWavelength', s.swellWavelength > 0); bad('cascadeReach', s.cascadeReach > 0); bad('windSpeed', s.windSpeed >= 0); bad('referenceWindSpeed', s.referenceWindSpeed > 0);
    bad('shortestWavelength', s.shortestWavelength >= 0); bad('fineNormal', s.fineNormal >= 0); bad('waveSpeed', s.waveSpeed >= 0);
    this.sea = s;
    const significantHeight = s.significantWaveHeight * windSeaGrowth(s, WIND_SEA_HEIGHT_EXPONENT);
    const peakWavelength = Math.max(s.peakWavelength * windSeaGrowth(s, WIND_SEA_LENGTH_EXPONENT), 0.1);
    this.effective = { significantHeight, peakWavelength };
    this.layout = buildLayout(this.resolution, this.cascades, peakWavelength, s.cascadeReach);
    const peakAngularFreq = peakAngularFrequency(peakWavelength);
    const shapeKey = [peakWavelength, s.peakSharpness, s.seaDepth, s.swellWavelength, s.shortestWavelength].join('|');
    if (shapeKey !== this.shapeKey) { this.unitVariances = computeUnitVariances(this.layout, peakAngularFreq, s.peakSharpness, s.seaDepth, s.swellWavelength, s.shortestWavelength); this.shapeKey = shapeKey; }
    const u = this.initMat.uniforms, L = this.layout;
    this.shared.uDomainSizes.value.fromArray(L.domainSizes);
    u.uBandMin.value.fromArray(L.bandMin); u.uBandMax.value.fromArray(L.bandMax);
    u.uWindDir.value.set(Math.cos(s.windHeadingDeg * DEG), Math.sin(s.windHeadingDeg * DEG));
    u.uSwellDir.value.set(Math.cos(s.swellHeadingDeg * DEG), Math.sin(s.swellHeadingDeg * DEG));
    u.uWindTurbulence.value = s.windTurbulence; u.uPeakAngularFreq.value = peakAngularFreq; u.uPeakSharpness.value = s.peakSharpness; u.uSeaDepth.value = s.seaDepth;
    u.uSpectrumGain.value = gainForHeight(significantHeight, this.unitVariances.windSeaVariance);
    u.uSwellGain.value = gainForHeight(s.swellHeight, this.unitVariances.swellVariance);
    u.uSwellWavelength.value = s.swellWavelength; u.uSwellHeight.value = s.swellHeight; u.uShortestWavelength.value = s.shortestWavelength;
    this.updateMat.uniforms.uChoppiness.value = s.choppiness;
    const n = this.normalMat.uniforms; n.uWindDir.value.copy(u.uWindDir.value); n.uWindSpeed.value = s.windSpeed;
    const fft = this.uniforms;
    fft.uOceanDomainSizes.value.fromArray(L.domainSizes); fft.uOceanVisibleAreas.value.fromArray(L.visibleAreas);
    fft.uOceanCascadeCount.value = this.cascades; fft.uOceanAperiodic.value.set(s.aperiodic ? 1 : 0, Math.max(0.5, s.aperiodicTileScale)); fft.uOceanFineNormal.value = s.fineNormal;
    this.h0Dirty = true;
  }
  setFoam(settings) {
    const f = { ...FOAM_DEFAULTS, ...settings }; this.foam = f; const n = this.normalMat.uniforms;
    n.uFoamMinWind.value = f.windThreshold; n.uFoamCoverage.value = f.coverage; n.uFoamStrength.value = f.strength; n.uFoamFadeRate.value = f.fadeRate;
    n.uFoamMax.value = f.maxBuildup; n.uFoamSlowFadeFraction.value = 1 - f.deposit; n.uFoamDriftFraction.value = f.drift;
    n.uFoamAnisotropy.value = f.crestAnisotropy; n.uFoamCrestGate.value = f.crestGate; n.uFoamFaceBias.value = f.faceBias; n.uFoamCascadeMix.value = f.cascadeMix;
  }
  // Weather varies wind-sea energy while retaining the authored cascade layout,
  // wavelength, phases and swell. No wavelength reallocation during a transition.
  setWeatherWind(windSpeed, heightScale = 1, heading = this.sea.windHeadingDeg) {
    const height = this.sea.significantWaveHeight * windSeaGrowth(this.sea, WIND_SEA_HEIGHT_EXPONENT) * heightScale;
    if (Math.abs(height - this.effective.significantHeight) > 0.0001) {
      this.initMat.uniforms.uSpectrumGain.value = gainForHeight(height, this.unitVariances.windSeaVariance);
      this.effective.significantHeight = height; this.h0Dirty = true;
    }
    this.normalMat.uniforms.uWindSpeed.value = windSpeed;
    const angle = heading * DEG, direction = this.initMat.uniforms.uWindDir.value;
    if(Math.abs(direction.x-Math.cos(angle))+Math.abs(direction.y-Math.sin(angle)) > 0.0001) {
      direction.set(Math.cos(angle),Math.sin(angle)); this.normalMat.uniforms.uWindDir.value.copy(direction); this.h0Dirty = true;
    }
  }
  // Per frame: (init) -> update -> 2*log2(N) butterfly stages -> normal/foam, for every cascade layer.
  update(waveTime, dt) {
    this.scope(() => this.renderCascades(waveTime, dt));
    this.shore.setSeaState(this.effective.significantHeight);
  }
  renderCascades(waveTime, dt) {
    const pass = this.pass.render;
    for (let c = 0; c < this.cascades; c++) {
      this.shared.uSlice.value = c;
      if (this.h0Dirty) pass(this.initMat, this.h0, c);
      this.updateMat.uniforms.uTime.value = waveTime * this.sea.waveSpeed; pass(this.updateMat, this.spec.write, c); this.spec.swap();
      const b = this.butterflyMat.uniforms;
      for (let dir = 0; dir < 2; dir++) {
        b.uHorizontal.value = dir === 0 ? 1 : 0;
        for (let stage = 0; stage < this.stages; stage++) {
          const last = dir === 1 && stage === this.stages - 1;
          b.uStage.value = stage; b.uResolve.value = last ? 1 : 0; b.tSpec.value = this.spec.read.texture;
          pass(this.butterflyMat, last ? this.disp : this.spec.write, c);
          if (!last) this.spec.swap();
        }
      }
      const n = this.normalMat.uniforms;
      n.uFoamDeltaTime.value = THREE.MathUtils.clamp(dt, 0, MAX_FOAM_DELTA_TIME); n.uFoamHistoryValid.value = this.foamHistoryValid ? 1 : 0;
      n.tFoamPrev.value = this.normal.read.texture; pass(this.normalMat, this.normal.write, c);
    }
    this.normal.swap(); this.h0Dirty = false; this.foamHistoryValid = true;
    this.uniforms.tOceanDisp.value = this.disp.texture;
    this.uniforms.tOceanNormal.value = this.normal.read.texture;
    this.uniforms.uOceanFftActive.value = 1;
  }
  get passesPerFrame() { return this.cascades * (2 + 2 * this.stages); }
  dispose() {
    this.uniforms.uOceanFftActive.value = 0; this.uniforms.tOceanDisp.value = this.uniforms.tOceanNormal.value = null;
    this.pass.dispose();
    this.shore.dispose();
    this.h0.dispose(); this.spec.dispose(); this.disp.dispose(); this.normal.dispose(); this.butterfly.dispose();
    this.initMat.dispose(); this.updateMat.dispose(); this.butterflyMat.dispose(); this.normalMat.dispose();
  }
}
