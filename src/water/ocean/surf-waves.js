// ocean/surf-waves.js -- port of WaterSurfWaves.hlsl: the surf breaker wavefronts ("Layer C-analytic" of the package's coastline
// plan). Periodic fronts whose phase is a function of SHORE DISTANCE (from the substrate SDF, bed.js) + time, so crests run
// parallel to the beach: a set envelope (waves arrive in sets), alongshore crest segmentation, the Iribarren surf-similarity
// number from the beach slope -> spilling / plunging / surging weights, a slope-dependent breaker index, and the lifecycle
// clock overCap = H / (gamma d): cresting -> broken whitewash bore (Dally-Dean-Dalrymple decay). Pure closed-form math of
// (inputs, time): no textures, no sim, no readback -- so vertex, fragment, caustics and probes evaluate the same thing.
// Swash (P4, EvaluateSurfSwash): the thin film running up and back over the beach with each front -- Hunt run-up R = xi H0,
// uprush / backwash timing, a drying wet line; the surface vertex lifts a 3 cm film onto the sand up to that line (SmoothMin/Max).
// Not ported: the FoamParticles compute, the sim-window deposit hold, the artist crest-foam LUT, the CPU buoyancy mirror.
import * as THREE from 'three';

// Unity BedDepthSettings surf defaults. wavelength auto = SurfAutoWavelengthFraction * 1.56 * T^2 (deep-water dispersion), clamped.
export const SURF_DEFAULTS = Object.freeze({ on: true, amplitude: 0.8, wavelengthAuto: true, wavelength: 26, period: 9, bandDepth: 6, setStrength: 0.55,
  crestLength: 60, crestVariation: 0.6, crestPersistence: 0, directionality: 0.7, lean: 0.35, ambientFade: 0.8, waterlineFoam: 0.5, smallWaveFoam: 0,
  foamStrength: 1, foamFeather: 0.2, foamTileSize: 8, foamColor: '#ffffff', foamOpacity: 1, foamCrestCap: 0, foamBoreGain: 1, foamTrailGain: 1, foamTrailLength: 1,
  swashAmplitude: 1, swashMaxSlopeDeg: 35, dryTimeSeconds: 3, swashFoam: 0.8, swashFoamWidth: 0.25, swashFoamDissolve: 0.6 });   // surfSwash* + Foam.wetnessDryTime
export const SURF_WAVELENGTH_MIN = 4, SURF_WAVELENGTH_MAX = 120;   // BedDepthSettings.SurfWavelengthMin / Max
const SURF_AUTO_WAVELENGTH_FRACTION = 0.2, SURF_DEEPWATER_LENGTH_COEF = 1.56;
const SURF_MIN_PERIOD = 0.5, SURF_MIN_WAVELENGTH = 1.0, SURF_BEAT_WRAP_FRONTS = 1280;   // mirrored in the GLSL below
const SWASH_MAX_SLOPE_TAN_CEILING = 1000;                    // SurfSwashMaxSlopeTanCeiling (89 deg is a huge tangent)
export const SURF_WARP_REACH_SPACINGS = 2.0;                       // shore compression reach = this x the front wavelength (ONE curve with ShoreWarpExtra)

export const createSurfUniforms = () => ({ uSurfActive: { value: 0 }, uSurfBeatTime: { value: 0 }, uSurfAmplitude: { value: 0.8 }, uSurfWavelength: { value: 26 }, uSurfPeriod: { value: 9 },
  uSurfBandDepth: { value: 6 }, uSurfSetStrength: { value: 0.55 }, uSurfLean: { value: 0.35 }, uSurfCompression: { value: 0.6 }, uSurfGreens: { value: 1.35 },
  uSurfAmbientFade: { value: 0.8 }, uSurfWaterlineFoam: { value: 0.5 }, uSurfSmallWaveFoam: { value: 0 }, uSurfCrestLength: { value: 60 }, uSurfCrestVariation: { value: 0.6 },
  uSurfCrestPersistence: { value: 0 }, uSurfDirectionality: { value: 0.7 }, uSurfWindDirXZ: { value: new THREE.Vector2(1, 0) },
  uSurfFoamStrength: { value: 1 }, uSurfFoamFeather: { value: 0.2 }, uSurfFoamTileSize: { value: 8 }, uSurfFoamColor: { value: new THREE.Color(1, 1, 1) }, uSurfFoamOpacity: { value: 1 },
  uSurfFoamCrestCap: { value: 0 }, uSurfFoamBoreGain: { value: 1 }, uSurfFoamTrailGain: { value: 1 }, uSurfFoamTrailLength: { value: 1 },
  uSurfSwashAmplitude: { value: 1 }, uSurfSwashMaxSlopeTan: { value: Math.tan(35 * Math.PI / 180) }, uWetDryTimeSeconds: { value: 3 }, uSurfSwashFoam: { value: 0.8 }, uSurfSwashFoamWidth: { value: 0.25 }, uSurfSwashFoamDissolve: { value: 0.6 } });

// Include-guarded like SHORE_GLSL: carried by the FFT sampling chunk, which several stages include together.
export const SURF_GLSL = /* glsl */`
#ifndef SURF_GLSL_INCLUDED
#define SURF_GLSL_INCLUDED
#define SURF_TWO_PI 6.28318530718
#define SURF_MIN_DEPTH 0.05
#define SURF_MIN_PERIOD ${SURF_MIN_PERIOD.toFixed(1)}
#define SURF_MIN_WAVELENGTH ${SURF_MIN_WAVELENGTH.toFixed(1)}
#define SURF_MIN_GREENS 1.0
#define SURF_BEAT_WRAP_FRONTS ${SURF_BEAT_WRAP_FRONTS.toFixed(1)}
#define SURF_CREST_SEED_DRIFT_A 0.34852044
#define SURF_CREST_SEED_DRIFT_B 0.45160394
#define SURF_CREST_MIN_LENGTH 4.0
#define SURF_CREST_SEED_FRESH_SCALE 37.0
#define SURF_CREST_FRESH_OCTAVE_RATIO 1.3
#define SURF_CREST_DIR_A_Z 0.31
#define SURF_CREST_DIR_B_X -0.42
#define SURF_CREST_FREQ_RATIO 1.7
#define SURF_CREST_OCTAVE_B_WEIGHT 0.5
#define SURF_CREST_NOISE_NORM 1.5
#define SURF_FACE_FRACTION 0.10
#define SURF_BACK_FRACTION 0.24
#define SURF_SET_WAVES 5.0
#define SURF_SETAMP_HASH_PHASE 2.4
#define SURF_SETAMP_FLOOR 0.35
#define SURF_SETAMP_JITTER_MIN 0.9
#define SURF_SETAMP_JITTER_MAX 1.1
#define SURF_WARP_REACH_SPACINGS ${SURF_WARP_REACH_SPACINGS.toFixed(1)}
#define SURF_EDGE_BLEND_START 0.35
#define SURF_NEAR_FADE 0.55
#define SURF_SECH_ARG_MAX 20.0
#define SURF_SLOPE_EPSILON 0.5
#define SURF_MIN_INFLUENCE 0.001
#define SURF_MIN_BAND_DEPTH 0.25
#define SURF_WET_FADE_LO -0.05
#define SURF_WET_FADE_HI 0.1
#define SURF_EXPOSURE_FACING_LO -0.25
#define SURF_EXPOSURE_FACING_HI 0.5
#define SURF_TRAIL_BASE_WEIGHT 0.4
#define SURF_XI_SPILL_END_LO 0.45
#define SURF_XI_SPILL_END_HI 0.60
#define SURF_XI_SURGE_START_LO 2.8
#define SURF_XI_SURGE_START_HI 3.6
#define SURF_DEEPWATER_LENGTH_COEF ${SURF_DEEPWATER_LENGTH_COEF.toFixed(2)}
#define SURF_XI_HEIGHT_EPSILON 1e-3
#define SURF_XI_LENGTH_EPSILON 1e-3
#define SURF_GAMMA_BASE 0.6
#define SURF_GAMMA_SLOPE_GAIN 5.0
#define SURF_GAMMA_MAX 1.1
#define SURF_BORE_STABLE_GAMMA 0.40
#define SURF_GREEN_EXPONENT 0.25
#define SURF_CAP_EPSILON 1e-3
#define SURF_CRESTING_START 0.75
#define SURF_CRESTING_END 1.05
#define SURF_BROKEN_START 1.05
#define SURF_BROKEN_END 1.5
#define SURF_LEAN_REACH_FRACTION 0.25
#define SURF_BORE_WIDTH_FACTOR 1.4
#define SURF_PLUNGE_FACE_SHARPEN 0.6
#define SURF_PLUNGE_LANDING_AHEAD 1.0
#define SURF_PLUNGE_LANDING_WIDTH 0.5
#define SURF_PLUNGE_LANDING_FOAM 0.8
#define SURF_PLUNGE_TRAIL_NARROW 0.55
#define SURF_PLUNGE_WHITEWASH_GAIN 0.5
#define SURF_PLUNGE_BREAKER_GAIN 0.8
#define SURF_PLUNGE_BREAKER_WIDEN 0.6
#define SURF_SWASH_UPRUSH 0.30
#define SURF_SWASH_SLOPE_FEATHER 0.6
#define SURF_RUNUP_XI_CAP 2.3
#define SURF_SURGE_RUNUP_BOOST 1.35
#define SURF_DRY_TIME_CONSTANTS 3.0
#define SURF_DEFAULT_DRY_SECONDS 3.0
#define SURF_FILM_THICKNESS 0.03
#define SURF_FILM_BLEND 0.05
#define SURF_SWASH_DEPOSIT_PEAK 0.45
#define SURF_SWASH_ERODE_MAX 0.7
#define SURF_HASH_SINE_FREQ 12.9898
#define SURF_HASH_SINE_SCALE 43758.5453
uniform float uSurfActive, uSurfBeatTime, uSurfAmplitude, uSurfWavelength, uSurfPeriod, uSurfBandDepth, uSurfSetStrength, uSurfLean, uSurfCompression, uSurfGreens;
uniform float uSurfAmbientFade, uSurfWaterlineFoam, uSurfSmallWaveFoam, uSurfCrestLength, uSurfCrestVariation, uSurfCrestPersistence, uSurfDirectionality; uniform vec2 uSurfWindDirXZ;
uniform float uSurfFoamStrength, uSurfFoamFeather, uSurfFoamTileSize, uSurfFoamOpacity, uSurfFoamCrestCap, uSurfFoamBoreGain, uSurfFoamTrailGain, uSurfFoamTrailLength; uniform vec3 uSurfFoamColor;
uniform float uSurfSwashAmplitude, uSurfSwashMaxSlopeTan, uWetDryTimeSeconds, uSurfSwashFoam, uSurfSwashFoamWidth, uSurfSwashFoamDissolve;
// WaterShared.hlsl SmoothMin / SmoothMax: C1 joins for the film geometry (a hard min/max prints a crease along the wet line).
float smoothMin(float a, float b, float blend){ if (blend <= 0.0) return min(a, b); float h = clamp(0.5 + 0.5 * (b - a) / blend, 0.0, 1.0); return mix(b, a, h) - blend * h * (1.0 - h); }
float smoothMax(float a, float b, float blend){ if (blend <= 0.0) return max(a, b); float h = clamp(0.5 + 0.5 * (a - b) / blend, 0.0, 1.0); return mix(b, a, h) + blend * h * (1.0 - h); }
float surfHash(float n){ return fract(sin(n * SURF_HASH_SINE_FREQ) * SURF_HASH_SINE_SCALE); }
// Every per-front quantity reads a wrapped index, so the master beat (time mod period * WRAP) wraps seamlessly.
float surfWrapIndex(float frontIndex){ return frontIndex - SURF_BEAT_WRAP_FRONTS * floor(frontIndex / SURF_BEAT_WRAP_FRONTS); }
// Per-front set amplitude: a slow sine over SURF_SET_WAVES fronts (waves arrive in sets) plus a per-front jitter.
float surfSetAmp(float frontIndex){ float wrapped = surfWrapIndex(frontIndex), h = surfHash(wrapped);
  float setWave = 0.5 + 0.5 * sin((wrapped / SURF_SET_WAVES) * SURF_TWO_PI + h * SURF_SETAMP_HASH_PHASE);
  return mix(1.0, mix(SURF_SETAMP_FLOOR, 1.0, setWave), uSurfSetStrength) * mix(SURF_SETAMP_JITTER_MIN, SURF_SETAMP_JITTER_MAX, h); }
// Shore-distance warp: front spacing compresses toward the waterline (the SAME curve as ShoreWarpExtra's reach).
float surfWarpDistance(float s){ float reach = SURF_WARP_REACH_SPACINGS * max(uSurfWavelength, SURF_MIN_WAVELENGTH); return s * (1.0 + uSurfCompression * exp(-max(s, 0.0) / reach)); }
// Alongshore crest modulation: two rotated sine octaves seeded per front (fresh, or drifting with persistence) -> finite crest segments.
float surfCrestFactor(vec2 worldXZ, float frontIndex){ if (uSurfCrestVariation <= 0.0) return 1.0;
  float invLen = 1.0 / max(uSurfCrestLength, SURF_CREST_MIN_LENGTH), wrapped = surfWrapIndex(frontIndex), persistence = clamp(uSurfCrestPersistence, 0.0, 1.0);
  float seedFresh = surfHash(wrapped) * SURF_CREST_SEED_FRESH_SCALE;
  float seedA = mix(seedFresh, wrapped * SURF_CREST_SEED_DRIFT_A, persistence), seedB = mix(seedFresh * SURF_CREST_FRESH_OCTAVE_RATIO, wrapped * SURF_CREST_SEED_DRIFT_B, persistence);
  float n = sin(dot(worldXZ, vec2(1.0, SURF_CREST_DIR_A_Z)) * (SURF_TWO_PI * invLen) + seedA)
          + SURF_CREST_OCTAVE_B_WEIGHT * sin(dot(worldXZ, vec2(SURF_CREST_DIR_B_X, 1.0)) * (SURF_TWO_PI * invLen * SURF_CREST_FREQ_RATIO) + seedB);
  float n01 = clamp(n / SURF_CREST_NOISE_NORM * 0.5 + 0.5, 0.0, 1.0); return 1.0 - uSurfCrestVariation * (1.0 - n01); }
// Shore-exposure gate: surf only pounds coasts that face the swell (soft lower edge keeps slightly oblique coasts alive).
float surfExposure(vec2 toShore){ float facing = smoothstep(SURF_EXPOSURE_FACING_LO, SURF_EXPOSURE_FACING_HI, dot(uSurfWindDirXZ, toShore)); return mix(1.0, facing, clamp(uSurfDirectionality, 0.0, 1.0)); }
// Iribarren / surf-similarity number xi0 = tan(beta) / sqrt(H0 / L0) (Battjes 1974), L0 = 1.56 T^2.
float surfIribarren(float tanBeta, float deepHeight){ float T = max(uSurfPeriod, SURF_MIN_PERIOD), deepLength = SURF_DEEPWATER_LENGTH_COEF * T * T;
  return tanBeta / sqrt(max(deepHeight, SURF_XI_HEIGHT_EPSILON) / max(deepLength, SURF_XI_LENGTH_EPSILON)); }
// Breaker-type partition of unity: x = spilling, y = plunging, z = surging.
vec3 surfBreakerWeights(float xi){ float pastSpill = smoothstep(SURF_XI_SPILL_END_LO, SURF_XI_SPILL_END_HI, xi), surge = smoothstep(SURF_XI_SURGE_START_LO, SURF_XI_SURGE_START_HI, xi);
  return vec3(1.0 - pastSpill, pastSpill * (1.0 - surge), surge); }
// Slope-dependent breaker index gamma = Hb / db (Weggel-simplified).
float surfGamma(float tanBeta){ return clamp(SURF_GAMMA_BASE + SURF_GAMMA_SLOPE_GAIN * tanBeta, SURF_GAMMA_BASE, SURF_GAMMA_MAX); }
struct SurfFrontTerms { float dAcross; float height; float profile; float boreSech; float boreAmp; float overCap; float cresting; float broken; float setAmp; vec3 breakType; float faceLen; float backLen; };
// Everything the front lifecycle knows at one point (SurfComputeFrontTerms): height-affecting, so mirrored byte-for-byte.
SurfFrontTerms surfComputeFrontTerms(vec2 worldXZ, float sWarp, float depth, float tanBeta, float time){ SurfFrontTerms t;
  float L = max(uSurfWavelength, SURF_MIN_WAVELENGTH), T = max(uSurfPeriod, SURF_MIN_PERIOD);
  float phase = sWarp / L + time / T, frontIndex = floor(phase), f = phase - frontIndex;   // crest at f = 0.5
  float ampThis = surfSetAmp(frontIndex) * surfCrestFactor(worldXZ, frontIndex);
  float halfCell = f - 0.5, neighborIndex = frontIndex + ((halfCell > 0.0) ? 1.0 : -1.0);
  float ampNeighbor = surfSetAmp(neighborIndex) * surfCrestFactor(worldXZ, neighborIndex);
  float edgeBlend = 0.5 * smoothstep(SURF_EDGE_BLEND_START, 0.5, abs(halfCell));
  t.setAmp = mix(ampThis, ampNeighbor, edgeBlend);
  float d = max(depth, SURF_MIN_DEPTH), deepHeight = uSurfAmplitude * t.setAmp;
  t.breakType = surfBreakerWeights(surfIribarren(tanBeta, deepHeight));
  float green = min(pow(max(uSurfBandDepth, d) / d, SURF_GREEN_EXPONENT), max(uSurfGreens, SURF_MIN_GREENS));
  float H = uSurfAmplitude * t.setAmp * green, capH = surfGamma(tanBeta) * d;
  t.overCap = H / max(capH, SURF_CAP_EPSILON);
  t.cresting = smoothstep(SURF_CRESTING_START, SURF_CRESTING_END, t.overCap);
  t.broken = smoothstep(SURF_BROKEN_START, SURF_BROKEN_END, t.overCap) * (1.0 - t.breakType.z);
  t.height = min(H, capH);
  t.dAcross = (f - 0.5) * L;                                            // metres from the crest, + = offshore side
  float lean = uSurfLean * t.height * t.cresting;
  t.dAcross += lean * exp(-abs(t.dAcross) / (SURF_LEAN_REACH_FRACTION * L));
  t.faceLen = SURF_FACE_FRACTION * L; t.backLen = SURF_BACK_FRACTION * L;
  float faceSharpen = mix(1.0, SURF_PLUNGE_FACE_SHARPEN, t.breakType.y * t.cresting);
  float profLen = (t.dAcross < 0.0) ? t.faceLen * faceSharpen : t.backLen;
  float sechTerm = 1.0 / cosh(min(abs(t.dAcross) / profLen, SURF_SECH_ARG_MAX)); t.profile = sechTerm * sechTerm;
  t.boreSech = 1.0 / cosh(min(abs(t.dAcross) / (t.backLen * SURF_BORE_WIDTH_FACTOR), SURF_SECH_ARG_MAX));
  t.boreAmp = mix(t.height, SURF_BORE_STABLE_GAMMA * d, t.broken);
  return t; }
float surfFrontHeightFromTerms(SurfFrontTerms t){ return mix(t.height * t.profile, t.boreAmp * t.boreSech, t.broken); }
struct SurfFrontFoam { float whitewash; float breaker; float lipShape; float trailAge; };
// Foam-side signals of one front (render-only): broken bore + trailing deposit + plunge splash-down, the cresting lip, small-wave foam.
SurfFrontFoam surfFrontFoamFromTerms(SurfFrontTerms t){ SurfFrontFoam foam;
  float trailLen = t.backLen * mix(1.0, SURF_PLUNGE_TRAIL_NARROW, t.breakType.y) * max(uSurfFoamTrailLength, 0.05);
  float trail = (t.dAcross > 0.0) ? exp(-t.dAcross / trailLen) : 0.0;
  float whitewash = t.broken * max(t.boreSech * uSurfFoamBoreGain, SURF_TRAIL_BASE_WEIGHT * trail * uSurfFoamTrailGain) * clamp(t.setAmp, 0.0, 1.0) * (1.0 + SURF_PLUNGE_WHITEWASH_GAIN * t.breakType.y);
  float landing = t.breakType.y * t.cresting * (1.0 - t.broken) * clamp(t.setAmp, 0.0, 1.0) * exp(-abs(t.dAcross + SURF_PLUNGE_LANDING_AHEAD * t.faceLen) / max(SURF_PLUNGE_LANDING_WIDTH * t.faceLen, 1e-3));
  foam.whitewash = clamp(whitewash + landing * SURF_PLUNGE_LANDING_FOAM, 0.0, 1.0);
  float smallTail = (t.dAcross > 0.0) ? exp(-t.dAcross / max(t.backLen, 1e-3)) : 0.0;
  float smallWaveFoam = clamp(t.setAmp, 0.0, 1.0) * max(t.profile, smallTail) * (1.0 - t.broken) * uSurfSmallWaveFoam;
  foam.whitewash = clamp(foam.whitewash + smallWaveFoam, 0.0, 1.0);
  float lipProfile = pow(t.profile, mix(1.0, SURF_PLUNGE_BREAKER_WIDEN, t.breakType.y));
  foam.lipShape = lipProfile * (1.0 + SURF_PLUNGE_BREAKER_GAIN * t.breakType.y) * (1.0 - t.breakType.z);
  foam.breaker = t.cresting * (1.0 - t.broken) * foam.lipShape;
  foam.trailAge = t.broken * max(t.dAcross, 0.0) * (max(uSurfPeriod, SURF_MIN_PERIOD) / max(uSurfWavelength, SURF_MIN_WAVELENGTH));
  return foam; }
float surfFrontHeightAt(vec2 worldXZ, float sWarp, float depth, float tanBeta, float time){ return surfFrontHeightFromTerms(surfComputeFrontTerms(worldXZ, sWarp, depth, tanBeta, time)); }
struct SurfWaveSample { float height; vec2 slopeXZ; float whitewash; float breaker; float mask; float overCap; float lipShape; float trailAge; };
SurfWaveSample surfWaveSampleInert(){ SurfWaveSample o; o.height = 0.0; o.slopeXZ = vec2(0.0); o.whitewash = 0.0; o.breaker = 0.0; o.mask = 0.0; o.overCap = 0.0; o.lipShape = 0.0; o.trailAge = 0.0; return o; }
// Where the front layer owns the surface: fronts develop over the band depth, inside the field, on exposed coasts; the field
// mask adds the waterline wet fade so fronts run nearly onto the sand.
float surfFieldMask(float depth, vec2 toShore, float influence){ float band = max(uSurfBandDepth, SURF_MIN_BAND_DEPTH);
  float develop = 1.0 - smoothstep(SURF_NEAR_FADE * band, band, max(depth, 0.0)), wet = smoothstep(SURF_WET_FADE_LO, SURF_WET_FADE_HI, depth);
  return develop * wet * influence * surfExposure(toShore); }
// Evaluate the breaker-front layer at one world xz from the substrate samples (EvaluateSurfWaves).
SurfWaveSample evaluateSurfWaves(vec2 worldXZ, float depth, float sdfDist, vec2 toShore, float tanBeta, float influence, float time){
  SurfWaveSample o = surfWaveSampleInert(); if (uSurfActive < 0.5 || influence <= SURF_MIN_INFLUENCE) return o;
  float exposure = surfExposure(toShore), mask = surfFieldMask(depth, toShore, influence);
  // standing lace hugging the waterline, segmented like the crests, breathing with the fronts
  float lacePhase = time / max(uSurfPeriod, SURF_MIN_PERIOD) - 0.5, laceIndex = floor(lacePhase);
  float laceSeg = mix(surfCrestFactor(worldXZ, laceIndex), surfCrestFactor(worldXZ, laceIndex + 1.0), smoothstep(0.0, 1.0, lacePhase - laceIndex));
  float lace = (1.0 - smoothstep(0.2, 1.8, max(depth, 0.0))) * smoothstep(-0.35, -0.05, depth) * uSurfWaterlineFoam * influence * exposure * laceSeg;
  if (mask <= SURF_MIN_INFLUENCE && lace <= SURF_MIN_INFLUENCE) return o;
  float s = max(sdfDist, 0.0);
  SurfFrontTerms terms = surfComputeFrontTerms(worldXZ, surfWarpDistance(s), depth, tanBeta, time);
  SurfFrontFoam frontFoam = surfFrontFoamFromTerms(terms);
  float frontHeight = surfFrontHeightFromTerms(terms);
  float h1 = surfFrontHeightAt(worldXZ, surfWarpDistance(s + SURF_SLOPE_EPSILON), depth, tanBeta, time);
  float dhds = (h1 - frontHeight) / SURF_SLOPE_EPSILON;
  o.height = frontHeight * mask; o.slopeXZ = -toShore * (dhds * mask);
  o.whitewash = clamp(frontFoam.whitewash * mask + lace, 0.0, 1.0); o.breaker = clamp(frontFoam.breaker * mask, 0.0, 1.0);
  o.mask = mask; o.overCap = terms.overCap; o.lipShape = frontFoam.lipShape * mask; o.trailAge = frontFoam.trailAge;
  return o; }
// Ambient swell / FFT fade where the fronts own the surface (the anti-double-crest "replace" rule).
float surfAmbientWeight(float surfMask){ return 1.0 - surfMask * clamp(uSurfAmbientFade, 0.0, 1.0); }
// Swash is a BEACH process: a film only runs up a slope gentle enough to hold it (feathered cap, no contour line).
float surfSwashSlopeGate(float tanBeta){ float slopeFalloff = max(uSurfSwashMaxSlopeTan * (1.0 - SURF_SWASH_SLOPE_FEATHER), 1e-4);
  return smoothstep(0.0, 1.0, clamp((uSurfSwashMaxSlopeTan - tanBeta) / slopeFalloff, 0.0, 1.0)); }
// The front field evaluated at the waterline: x = the film's current reach above the still level (m), y = the drying wet level
// (this cycle's film or the previous one's, decaying with the dry time). Fully analytic, no state.
vec2 evaluateSurfSwash(vec2 worldXZ, vec2 toShore, float tanBeta, float influence, float time){
  influence *= surfSwashSlopeGate(tanBeta);
  if (uSurfActive < 0.5 || influence <= SURF_MIN_INFLUENCE || uSurfSwashAmplitude <= 0.0) return vec2(0.0);
  float T = max(uSurfPeriod, SURF_MIN_PERIOD), phase = time / T, arrivalIndex = floor(phase - 0.5), f = fract(phase - 0.5);   // f = 0: crest arrival
  float exposure = surfExposure(toShore);
  float deepHeight = uSurfAmplitude * surfSetAmp(arrivalIndex) * surfCrestFactor(worldXZ, arrivalIndex);
  float xi = surfIribarren(tanBeta, deepHeight), surge = surfBreakerWeights(xi).z;
  float run = min(xi, SURF_RUNUP_XI_CAP) * deepHeight * uSurfSwashAmplitude * mix(1.0, SURF_SURGE_RUNUP_BOOST, surge) * influence * exposure;   // Hunt (1959) run-up
  float upDown = (f < SURF_SWASH_UPRUSH) ? smoothstep(0.0, SURF_SWASH_UPRUSH, f) : 1.0 - smoothstep(SURF_SWASH_UPRUSH, 1.0, f);
  float swashLevel = run * upDown;
  float deepHeightPrev = uSurfAmplitude * surfSetAmp(arrivalIndex - 1.0) * surfCrestFactor(worldXZ, arrivalIndex - 1.0);
  float xiPrev = surfIribarren(tanBeta, deepHeightPrev);
  float runPrev = min(xiPrev, SURF_RUNUP_XI_CAP) * deepHeightPrev * uSurfSwashAmplitude * mix(1.0, SURF_SURGE_RUNUP_BOOST, surfBreakerWeights(xiPrev).z) * influence * exposure;
  float dryTime = (uWetDryTimeSeconds > 0.0) ? uWetDryTimeSeconds : SURF_DEFAULT_DRY_SECONDS, tau = dryTime / SURF_DRY_TIME_CONSTANTS;
  float thisCycleWet = (f < SURF_SWASH_UPRUSH) ? swashLevel : run * exp(-((f - SURF_SWASH_UPRUSH) * T) / tau);
  float prevCycleWet = runPrev * exp(-((f + 1.0 - SURF_SWASH_UPRUSH) * T) / tau);
  return vec2(swashLevel, max(thisCycleWet, prevCycleWet)); }
// Film top above the mean level for a beach point (WaterSurfaceVertStage): the surface hugs the sand (3 cm proud) wherever the
// swash has recently reached, flattening into the wet-line plateau; the caller SmoothMax-es its wave height onto it.
float surfFilmTop(float beachRise, float wetLevel){ return smoothMin(beachRise, wetLevel, SURF_FILM_BLEND) + SURF_FILM_THICKNESS; }
#endif`;

// Publish the knobs (WaterShoreDepthField.WriteUniforms): swellHeight = the analytic swell height knob (SurfAmplitudeEffective
// floors the front amplitude at it), windHeadingRad = the sea's travel heading, shore = the shore settings (compression / Green's
// cap are shared with the shoal transform). Returns the effective front wavelength (the shore compression reach is derived from it).
export function applySurf(u, s, swellHeight, windHeadingRad, shore) {
  const period = Math.max(s.period, SURF_MIN_PERIOD);
  const wavelength = s.wavelengthAuto ? THREE.MathUtils.clamp(SURF_AUTO_WAVELENGTH_FRACTION * SURF_DEEPWATER_LENGTH_COEF * period * period, SURF_WAVELENGTH_MIN, SURF_WAVELENGTH_MAX) : s.wavelength;
  u.uSurfActive.value = s.on && shore.on ? 1 : 0; u.uSurfAmplitude.value = Math.max(s.amplitude, swellHeight); u.uSurfWavelength.value = wavelength; u.uSurfPeriod.value = s.period;
  u.uSurfBandDepth.value = s.bandDepth; u.uSurfSetStrength.value = s.setStrength; u.uSurfLean.value = s.lean; u.uSurfCompression.value = shore.compression; u.uSurfGreens.value = shore.greens;
  u.uSurfAmbientFade.value = s.ambientFade; u.uSurfWaterlineFoam.value = s.waterlineFoam; u.uSurfSmallWaveFoam.value = s.smallWaveFoam;
  u.uSurfCrestLength.value = s.crestLength; u.uSurfCrestVariation.value = s.crestVariation; u.uSurfCrestPersistence.value = s.crestPersistence; u.uSurfDirectionality.value = s.directionality;
  u.uSurfWindDirXZ.value.set(Math.cos(windHeadingRad), Math.sin(windHeadingRad));
  u.uSurfFoamStrength.value = s.foamStrength; u.uSurfFoamFeather.value = s.foamFeather; u.uSurfFoamTileSize.value = s.foamTileSize; u.uSurfFoamColor.value.set(s.foamColor); u.uSurfFoamOpacity.value = s.foamOpacity;
  u.uSurfFoamCrestCap.value = s.foamCrestCap; u.uSurfFoamBoreGain.value = s.foamBoreGain; u.uSurfFoamTrailGain.value = s.foamTrailGain; u.uSurfFoamTrailLength.value = s.foamTrailLength;
  u.uSurfSwashAmplitude.value = s.swashAmplitude; u.uSurfSwashMaxSlopeTan.value = Math.min(Math.tan(THREE.MathUtils.degToRad(s.swashMaxSlopeDeg)), SWASH_MAX_SLOPE_TAN_CEILING); u.uWetDryTimeSeconds.value = s.dryTimeSeconds;
  u.uSurfSwashFoam.value = s.swashFoam; u.uSurfSwashFoamWidth.value = s.swashFoamWidth; u.uSurfSwashFoamDissolve.value = s.swashFoamDissolve;
  return wavelength;
}
// The master surf beat: the wave clock wrapped to SURF_BEAT_WRAP_FRONTS front periods (WaterVolume.SurfBeatTime), so the
// per-front hashes wrap seamlessly instead of the float phase losing precision over hours.
export function setSurfTime(uniforms, waveTime, period) { const wrap = Math.max(period, SURF_MIN_PERIOD) * SURF_BEAT_WRAP_FRONTS; uniforms.uSurfBeatTime.value = waveTime - wrap * Math.floor(waveTime / wrap); }
