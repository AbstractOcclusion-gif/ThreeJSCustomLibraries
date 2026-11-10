// ocean/wind-waves.js -- copied from WebAquarium src/water/wind-waves.js (port of WebGpuWater's WaterWaveBank + WaterWaves.hlsl).
// Bank generation (JONSWAP-weighted components, stratified headings, Rayleigh group envelope, Stokes crest) is verbatim.
// Divergence from the aquarium copy: the ocean has no ripple sim texture to compose with, so the compose pass is gone and the
// shader side is exposed as WIND_WAVE_GLSL -- windWaveHeight(worldXZ, outGrad) -- which the surface fragment evaluates directly
// as the "Small Wind Waves" detail layer (fine ambient waves that tilt the normal).
import * as THREE from 'three';

const MAX_WAVES = 16;                                   // = WaterWaveBank.MaxWaves
const GRAVITY = 9.81, TWO_PI = Math.PI * 2;
const JONSWAP_GAMMA = 3.3, JONSWAP_SIGMA_LOW = 0.07, JONSWAP_SIGMA_HIGH = 0.09;
const HS_TO_RMS = Math.sqrt(8);                         // Hs = 4 sqrt(sum A^2 / 2)
const SIGNIFICANT_HEIGHT_TO_RMS = 4;
const BAND_LOW = 0.5, BAND_HIGH = 2.5;                  // sampled wavelengths = authored x [low, high]
const DOWNWIND_FAN = 1.45, UPWIND_FAN = 1.2, UPWIND_EVERY_NTH = 3, UPWIND_AMPLITUDE = 0.7, GOLDEN_RATIO = 0.6180339887;
const GROUP_GROWTH = 1.6180339887, GROUP_LENGTH_WAVES = 4.4, GROUP_ANGLES = [0.20, -0.31, 0.44, -0.12];
const GROUP_CARRIERS = 4, GROUP_MEAN_MAGNITUDE = 1.79930, GROUP_VELOCITY_FRACTION = 0.5;
const STOKES_FACTOR = 0.5, STOKES_VARIANCE_GROWTH = 2;
const GENERATION_SEED = 9173, MIN_WAVELENGTH = 1e-3, MIN_RMS = 1e-9;

// Open-water detail defaults (the aquarium pond used 1.2 m / 0.05 m).
export const WIND_WAVE_DEFAULTS = Object.freeze({ windFromDegrees: 0, waveLengthMeters: 2.0, waveHeightMeters: 0.06, waveCount: 12,
  directionSpread: 2, grouping: 0.4, crestSharpness: 0.6, animationSpeed: 1 });

const mulberry32 = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
function jonswap(omega, omegaPeak) {                    // relative weight only (the level comes from the authored height)
  if (omega <= 0) return 0;
  const pm = Math.pow(omega, -5) * Math.exp(-1.25 * Math.pow(omegaPeak / omega, 4));
  const sigma = omega <= omegaPeak ? JONSWAP_SIGMA_LOW : JONSWAP_SIGMA_HIGH;
  return pm * Math.pow(JONSWAP_GAMMA, Math.exp(-((omega - omegaPeak) ** 2) / (2 * sigma * sigma * omegaPeak * omegaPeak)));
}

const createUniforms = () => ({ uWindTime: { value: 0 }, uWindCount: { value: 0 }, uWindOn: { value: 0 },
  uWaveA: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },   // dir.x, dir.z, k, omega
  uWaveB: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },   // amp, phase
  uGroup: { value: Array.from({ length: GROUP_CARRIERS }, () => new THREE.Vector4()) }, // dir.x, dir.z, k, k * group speed
  uGroupPhase: { value: new THREE.Vector4() }, uShape: { value: new THREE.Vector4(1, 0, 0, 0) }, uStokesNorm: { value: 1 } });

function validate(s) {
  const bad = (k, ok) => { if (!ok) throw new Error(`setWindWaves: invalid ${k} = ${s[k]}`); };
  bad('waveLengthMeters', s.waveLengthMeters > 0); bad('waveHeightMeters', s.waveHeightMeters >= 0);
  bad('waveCount', Number.isInteger(s.waveCount) && s.waveCount >= 1 && s.waveCount <= MAX_WAVES);
  bad('directionSpread', s.directionSpread >= 1); bad('grouping', s.grouping >= 0 && s.grouping <= 1);
  bad('crestSharpness', s.crestSharpness >= 0 && s.crestSharpness <= 1); bad('animationSpeed', s.animationSpeed >= 0);
  bad('windFromDegrees', Number.isFinite(s.windFromDegrees));
}

// WaterWaveBank.Generate, world units = metres.
function generate(s, WIND_U) {
  const count = s.waveCount, peak = Math.max(s.waveLengthMeters, MIN_WAVELENGTH), omegaPeak = Math.sqrt(GRAVITY * TWO_PI / peak);
  const wind = s.windFromDegrees * Math.PI / 180, wx = Math.cos(wind), wz = Math.sin(wind);
  const logLow = Math.log(peak * BAND_LOW), logHigh = Math.log(peak * BAND_HIGH), rng = mulberry32(GENERATION_SEED);
  let sumAmp2 = 0;
  for (let i = 0; i < count; i++) {
    const bandT = count === 1 ? 0.5 : (i + 0.5) / count, k = TWO_PI / Math.exp(logLow + (logHigh - logLow) * bandT);
    const omegaPhysical = Math.sqrt(GRAVITY * k);       // JONSWAP weights the physical frequency; the speed cheat is on the clock only
    const upwind = count > 2 && i % UPWIND_EVERY_NTH === 0;
    const offset = ((((i + 1) * GOLDEN_RATIO) % 1) * 2 - 1) * (upwind ? UPWIND_FAN : DOWNWIND_FAN);
    const heading = (upwind ? Math.PI : 0) + offset, c = Math.cos(heading), sn = Math.sin(heading);
    const amp = Math.sqrt(Math.max(0, jonswap(omegaPhysical, omegaPeak))) * Math.pow(Math.max(0, Math.cos(offset)), 2 * s.directionSpread)
      * (upwind ? UPWIND_AMPLITUDE : 1);
    WIND_U.uWaveA.value[i].set(c * wx - sn * wz, sn * wx + c * wz, k, omegaPhysical * s.animationSpeed);
    WIND_U.uWaveB.value[i].set(amp, rng() * TWO_PI, 0, 0); sumAmp2 += amp * amp;
  }
  // NormalizeAmplitudes: authored significant height (metres)
  let variance = 0;
  if (sumAmp2 > 0 && s.waveHeightMeters > 0) {
    const scale = (s.waveHeightMeters / HS_TO_RMS) / Math.max(Math.sqrt(sumAmp2), MIN_RMS);
    for (let i = 0; i < count; i++) WIND_U.uWaveB.value[i].x *= scale;
    variance = (s.waveHeightMeters / SIGNIFICANT_HEIGHT_TO_RMS) ** 2;
  } else for (let i = 0; i < count; i++) WIND_U.uWaveB.value[i].x = 0;
  for (let i = count; i < MAX_WAVES; i++) WIND_U.uWaveB.value[i].x = 0;
  WIND_U.uGroupPhase.value.set(rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI);
  // BuildShaping: group envelope at the carrier's group velocity, Stokes crest
  const depth = THREE.MathUtils.clamp(s.grouping, 0, 1), carrierK = TWO_PI / peak;
  const groupSpeed = GROUP_VELOCITY_FRACTION * Math.sqrt(GRAVITY / carrierK) * s.animationSpeed;
  let length = peak * GROUP_LENGTH_WAVES;
  for (let g = 0; g < GROUP_CARRIERS; g++, length *= GROUP_GROWTH) {
    const a = GROUP_ANGLES[g], c = Math.cos(a), sn = Math.sin(a), k = TWO_PI / Math.max(length, MIN_WAVELENGTH);
    WIND_U.uGroup.value[g].set(c * wx - sn * wz, sn * wx + c * wz, k, k * groupSpeed);
  }
  const meanSquareU = GROUP_CARRIERS / (GROUP_MEAN_MAGNITUDE * GROUP_MEAN_MAGNITUDE);
  const envelopeNorm = 1 / Math.sqrt(1 + depth * depth * (meanSquareU - 1));
  const stokes = s.crestSharpness * STOKES_FACTOR * carrierK;
  WIND_U.uShape.value.set(envelopeNorm * (1 - depth), envelopeNorm * depth / GROUP_MEAN_MAGNITUDE, stokes, stokes * variance);
  WIND_U.uStokesNorm.value = 1 / Math.sqrt(1 + STOKES_VARIANCE_GROWTH * stokes * stokes * variance);
  WIND_U.uWindCount.value = count;
}

// The compose shader's wind term, as a function of world xz (metres): returns the height, writes d(height)/d(world xz).
export const WIND_WAVE_GLSL = /* glsl */`
uniform float uWindTime, uStokesNorm, uWindOn; uniform int uWindCount;
uniform vec4 uWaveA[${MAX_WAVES}], uWaveB[${MAX_WAVES}], uGroup[${GROUP_CARRIERS}], uGroupPhase, uShape;
float wwEnvelope(vec2 m, out vec2 grad){ vec2 z = vec2(0.0), dRe = vec2(0.0), dIm = vec2(0.0);
  for (int g = 0; g < ${GROUP_CARRIERS}; g++) { vec4 c = uGroup[g]; float a = dot(c.xy, m) * c.z - c.w * uWindTime + uGroupPhase[g];
    float s = sin(a), co = cos(a); z += vec2(co, s); dRe -= c.xy * (c.z * s); dIm += c.xy * (c.z * co); }
  float mag = length(z); grad = uShape.y * (z.x * dRe + z.y * dIm) / max(mag, 1e-4); return uShape.x + uShape.y * mag; }
float windWaveHeight(vec2 m, out vec2 grad){
#ifdef OCEAN_SCREEN_FILTER
  vec2 pixelDx=dFdx(m),pixelDy=dFdy(m);
#endif
  if (uWindOn < 0.5) { grad = vec2(0.0); return 0.0; }
  float lin = 0.0; vec2 g = vec2(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) { if (i >= uWindCount) break; vec4 a = uWaveA[i]; vec2 b = uWaveB[i].xy;
    float weight=1.0;
#ifdef OCEAN_SCREEN_FILTER
    if(uSurfaceDetailLod>.5){
      vec2 phasePixel=vec2(dot(a.xy,pixelDx),dot(a.xy,pixelDy))*a.z;
      weight=exp(-.5*dot(phasePixel,phasePixel));
    }
#endif
    float ph = dot(a.xy, m) * a.z - a.w * uWindTime + b.y; lin += weight*b.x * sin(ph); g += a.xy * (weight*b.x * cos(ph) * a.z); }
  vec2 eg; float env = wwEnvelope(m, eg); float h = lin * env;
  grad = uStokesNorm * (1.0 + 2.0 * uShape.z * h) * (g * env + eg * lin);
  return uStokesNorm * (h + uShape.z * h * h - uShape.w); }`;

// settings: null = off, or a partial override of WIND_WAVE_DEFAULTS. Regenerates the bank; call on change, not per frame.
export const waveCount = MAX_WAVES;
export function createWaveBank() {
  const uniforms = createUniforms();
  const carriers = uniforms.uWaveA.value, amplitudes = uniforms.uWaveB.value;
  let last;
  function configure(settings) {
    if (!settings) { uniforms.uWindOn.value = 0; return; }
    const s = {...WIND_WAVE_DEFAULTS, ...settings};
    if (!last || Object.keys(WIND_WAVE_DEFAULTS).some(key => s[key] !== last[key])) {
      validate(s);
      generate(s, uniforms);
      last = s;
    }
    uniforms.uWindOn.value = s.waveHeightMeters > 0 ? 1 : 0;
  }
  return {
    uniforms, carriers, amplitudes, configure,
    update(height, wavelength, direction, spread) {
      configure({waveHeightMeters: height, waveLengthMeters: wavelength, windFromDegrees: THREE.MathUtils.radToDeg(direction),
        directionSpread: Math.max(1, 2 * (Math.PI / 4 / Math.max(.1, spread)) ** 2)});
    },
    sampleHeight(x, z, time = uniforms.uWindTime.value) {
      if (!uniforms.uWindOn.value) return 0;
      let linear = 0, re = 0, im = 0;
      for (let i = 0; i < uniforms.uWindCount.value; i++) {
        const a = carriers[i];
        linear += amplitudes[i].x * Math.sin((a.x * x + a.y * z) * a.z - a.w * time + amplitudes[i].y);
      }
      const groups = uniforms.uGroup.value, phases = uniforms.uGroupPhase.value;
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i], phase = (g.x * x + g.y * z) * g.z - g.w * time + phases.getComponent(i);
        re += Math.cos(phase); im += Math.sin(phase);
      }
      const shape = uniforms.uShape.value, height = linear * (shape.x + shape.y * Math.hypot(re, im));
      return uniforms.uStokesNorm.value * (height + shape.z * height ** 2 - shape.w);
    },
  };
}
