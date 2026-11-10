// WebAquarium ocean/surface.js foam shading, shared by whitecaps, wakes and swash.
export const FOAM_GLSL = /* glsl */`
#define OCEAN_WHITECAP_OCTAVE2_SCALE 2.37
#define OCEAN_WHITECAP_OCTAVE2_ROT_COS 0.8660254
#define OCEAN_WHITECAP_OCTAVE2_ROT_SIN 0.5
#define OCEAN_WHITECAP_OCTAVE_BLEND_DIST 60.0
#define OCEAN_WHITECAP_CONTRAST 1.6
#define OCEAN_WHITECAP_CONTRAST_DENSE 1.0
#define OCEAN_FOAM_PATTERN_MEAN 0.501
#define OCEAN_FOAM_PATTERN_STDDEV 0.189
#define OCEAN_FOAM_PATTERN_CDF_SPAN 2.45
#define OCEAN_FOAM_OCTAVE_BLEND_NORM 0.70710678
#define OCEAN_FOAM_PARALLAX_HEIGHT 0.04
#define OCEAN_FOAM_PARALLAX_MIN_VIEW_Y 0.25
#define OCEAN_FOAM_TEXTURE_FADE_START 120.0
#define OCEAN_FOAM_TEXTURE_FADE_RANGE 400.0
#define FOAM_MASK_EPSILON 1e-4
#define FOAM_FLOW_RATE 0.5   // phase cycles per second of the flow-phased pattern drift (EvaluateFoam)
uniform sampler2D tWhitecap; uniform vec2 uWindDirXZ; uniform float uFoamTileSize, uFoamFeather, uFoamStreakStretch, uFoamTextureInfluence;
uniform float uFoamTime, uFoamPatternDrift;   // pattern drift speed along the wind (m/s), 0 = world-locked pattern
vec2 whitecapStreakFrame(vec2 v){ return vec2(dot(v, uWindDirXZ) / max(uFoamStreakStretch, 1e-3), dot(v, vec2(-uWindDirXZ.y, uWindDirXZ.x))); }
// Cross-fade that keeps the pattern's variance: a plain mix dips contrast at the midpoint, which read as a periodic flicker.
vec3 whitecapSeesaw(vec3 a, vec3 b, float w){ vec3 m = mix(a, b, w); return clamp((m - OCEAN_FOAM_PATTERN_MEAN) / sqrt(w * w + (1.0 - w) * (1.0 - w)) + OCEAN_FOAM_PATTERN_MEAN, 0.0, 1.0); }
vec3 whitecapOctaveBlend(vec3 a, vec3 b){ return clamp((a + b - 2.0 * OCEAN_FOAM_PATTERN_MEAN) * OCEAN_FOAM_OCTAVE_BLEND_NORM + OCEAN_FOAM_PATTERN_MEAN, 0.0, 1.0); }
// Two octaves, the second rotated and scaled so the grids rarely realign, fading in with distance (near water keeps one crisp tile).
vec3 sampleFoamTiled(sampler2D tex, vec2 p, float tile0){
  vec3 octave0 = texture2D(tex, p / tile0).rgb;
  vec2 rotated = vec2(p.x * OCEAN_WHITECAP_OCTAVE2_ROT_COS - p.y * OCEAN_WHITECAP_OCTAVE2_ROT_SIN, p.x * OCEAN_WHITECAP_OCTAVE2_ROT_SIN + p.y * OCEAN_WHITECAP_OCTAVE2_ROT_COS);
  vec3 octave1 = texture2D(tex, rotated / max(tile0 * OCEAN_WHITECAP_OCTAVE2_SCALE, 1e-3)).rgb;
  return whitecapOctaveBlend(octave0, octave1); }
// The pattern is dragged downwind at uFoamPatternDrift: two half-offset phases cross-faded by a seesaw weight give endless
// drift with no visible reset (the flowmap trick EvaluateFoam uses for the pond foam). In the streak frame the wind axis is x.
vec3 sampleWhitecapPattern(vec2 worldXZ, float camDist){
  vec2 p = whitecapStreakFrame(worldXZ); float tile0 = max(uFoamTileSize, 1e-3);
  vec2 flow = vec2(uFoamPatternDrift / (max(uFoamStreakStretch, 1e-3) * FOAM_FLOW_RATE), 0.0);   // metres of frame travel per phase cycle
  float phaseA = fract(uFoamTime * FOAM_FLOW_RATE), phaseB = fract(phaseA + 0.5), seesaw = abs(phaseA * 2.0 - 1.0);
  vec3 near = whitecapSeesaw(texture2D(tWhitecap, (p - flow * phaseA) / tile0).rgb, texture2D(tWhitecap, (p - flow * phaseB) / tile0).rgb, seesaw);
  vec3 far = whitecapSeesaw(sampleFoamTiled(tWhitecap, p - flow * phaseA, tile0), sampleFoamTiled(tWhitecap, p - flow * phaseB, tile0), seesaw);
  return mix(near, far, clamp(camDist / OCEAN_WHITECAP_OCTAVE_BLEND_DIST, 0.0, 1.0)); }
void foamDissolveTerms(float coverage, out float threshold, out float contrast){ float c = clamp(coverage, 0.0, 1.0);
  contrast = mix(OCEAN_WHITECAP_CONTRAST, OCEAN_WHITECAP_CONTRAST_DENSE, c); threshold = 1.0 - sqrt(c); }
float foamDissolve(float patternValue, float coverage, float feather){ float threshold, contrast; foamDissolveTerms(coverage, threshold, contrast);
  return smoothstep(threshold, threshold + max(feather, 1e-3), pow(clamp(patternValue, 0.0, 1.0), contrast)); }
// FoamDissolve with the package's extraThreshold: lifts the black point so a layer erodes away (the swash deposit as it dries).
float foamDissolveEroded(float patternValue, float coverage, float feather, float extraThreshold){ float threshold, contrast; foamDissolveTerms(coverage, threshold, contrast);
  threshold += extraThreshold; return smoothstep(threshold, threshold + max(feather, 1e-3), pow(clamp(patternValue, 0.0, 1.0), contrast)); }
// Far field: the expected dissolve of the pattern's histogram (normal CDF), so foam coverage reads the same once the texture fades out.
float foamDissolveExpected(float coverage, float feather){ float threshold, contrast; foamDissolveTerms(coverage, threshold, contrast);
  float midBand = pow(clamp(threshold + 0.5 * max(feather, 1e-3), 0.0, 1.0), 1.0 / max(contrast, 1e-3));
  float z = (midBand - OCEAN_FOAM_PATTERN_MEAN) / OCEAN_FOAM_PATTERN_STDDEV;
  return smoothstep(-OCEAN_FOAM_PATTERN_CDF_SPAN, OCEAN_FOAM_PATTERN_CDF_SPAN, -z); }
float oceanWhitecapFoam(vec2 sourceXZ, vec3 V, float coverage){
  if (coverage <= FOAM_MASK_EPSILON) return 0.0;
  vec2 sampleXZ = sourceXZ + V.xz * (OCEAN_FOAM_PARALLAX_HEIGHT / max(V.y, OCEAN_FOAM_PARALLAX_MIN_VIEW_Y));
  float camDist = distance(sourceXZ, cameraPosition.xz);
  float pattern = sampleWhitecapPattern(sampleXZ, camDist).r;
  float texWeight = uFoamTextureInfluence * (1.0 - clamp((camDist - OCEAN_FOAM_TEXTURE_FADE_START) / OCEAN_FOAM_TEXTURE_FADE_RANGE, 0.0, 1.0));
  if(uSurfaceDetailLod>.5){
    float footprint=max(length(dFdx(sampleXZ)),length(dFdy(sampleXZ)))/max(uFoamTileSize,.01);
    texWeight*=1.0-smoothstep(.04,.25,footprint);
  }
  return mix(foamDissolveExpected(coverage, uFoamFeather), foamDissolve(pattern, coverage, uFoamFeather), texWeight); }
// Wake / trail / deposited foam (the sim window field): its own dissolve through an ISOTROPIC, world-locked pattern -- the wind
// streak stretch and the drift belong to the rolling whitecaps only; the Foam kernel already moves this layer.
uniform sampler2D tWakeFoam; uniform float uWakeFoamTileSize, uWakeFoamFeather, uWakeFoamTextureInfluence;
uniform float uWhitecapsOn, uWhitecapOpacity, uWakeFoamOn, uWakeFoamOpacity;
float oceanWakeFoam(vec2 sourceXZ, vec3 V, float coverage){
  if (coverage <= FOAM_MASK_EPSILON) return 0.0;
  vec2 sampleXZ = sourceXZ + V.xz * (OCEAN_FOAM_PARALLAX_HEIGHT / max(V.y, OCEAN_FOAM_PARALLAX_MIN_VIEW_Y));
  float pattern = sampleFoamTiled(tWakeFoam, sampleXZ, max(uWakeFoamTileSize, 1e-3)).r;
  return mix(coverage, foamDissolve(pattern, coverage, uWakeFoamFeather), uWakeFoamTextureInfluence); }`;
