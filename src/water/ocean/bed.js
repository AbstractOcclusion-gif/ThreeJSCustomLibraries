// ocean/bed.js -- the SHORE SUBSTRATE (port of WaterShoreDepthField.cs + WaterShore.hlsl + WaterShoreMath.hlsl, "Layer A/B" of the
// package's coastline plan). One bake from the terrain gives every surface consumer (clipmap, probes, caustics, trail, sprites) ONE
// RGBA float texture (the surface material sits at the GPU's 16-sampler limit, so the package's two maps are packed into one here):
//   R = still-water column depth (m, + water / - dry land) at mean level y = 0, G = signed distance to the waterline (m, + in water),
//   B = toward-shore direction as an angle (0..1 = 0..2pi; < 0 = degenerate, no direction), A = beach slope tan(beta),
// over [center +- half] with an 8% feathered border (`influence`), deep sentinel off-field. The shoal transform (ShoalWeight,
// Green's-law gain, phase compression; refraction is applied by the analytic bands) reads them through ShoreData. Constants keep
// the package names (SHORE_*) so the two implementations diff cleanly. CPU buoyancy mirror NOT ported: our probes sample the GPU.
import * as THREE from 'three';

// Unity BedDepthSettings defaults: shoreShoalDepth 4, shoreRefraction .7, shoreCompression .6, shoreGreens 1.35. The compression
// reach is 2 x the surf front wavelength (SURF_WARP_REACH_SPACINGS, published by applySurf) -- one curve for swell and fronts.
let lastBake = null;   // last shore bake stats {size, sdf, ms}
export const SHORE_DEFAULTS = Object.freeze({ on: true, resolution: 512, shoalDepth: 4, refraction: 0.7, compression: 0.6, greens: 1.35, debug: 'off' });
export const SHORE_DEBUG_MODES = Object.freeze(['off', 'depth', 'sdf']);
const SHOAL_BAND_SIGNIFICANT_HEIGHT_MULTIPLE = 2;        // WaterVolume.ShoreShoalDepthEffective: a big sea starts flattening further out
const DIRECTION_SMOOTH_PASSES = 2;                       // WaterShoreDepthField.DirectionSmoothPasses (3x3 box, direction + slope)
const SDF_DIR_EPSILON = 1e-4;

const createShoreUniforms = () => ({ tShore: { value: null }, uShoreCenter: { value: new THREE.Vector2() }, uShoreHalf: { value: 1 },
  uShoreOn: { value: 0 }, uShoreSdfOn: { value: 0 }, uShoreOffFieldDepth: { value: 100 }, uShoreDebug: { value: 0 },
  uShoreShoalDepth: { value: 4 }, uShoreGreenBandDepth: { value: 4 }, uShoreCompression: { value: 0.6 }, uShoreGreens: { value: 1.35 }, uShoreWarpReach: { value: 52 }, uShoreRefraction: { value: 0.7 } });

// Include-guarded: the FFT sampling and the analytic bands both carry it, and the surface stages include both.
export const SHORE_GLSL = /* glsl */`
#ifndef SHORE_GLSL_INCLUDED
#define SHORE_GLSL_INCLUDED
#define SHORE_DEEP_SENTINEL 1e9
#define SHORE_BORDER_FEATHER 0.08
#define SHORE_SDF_DIR_EPSILON 1e-4
#define SHORE_SHOAL_WAVELENGTH_FACTOR 2.0
#define SHORE_WAVELENGTH_EPSILON 1e-3
#define SHORE_BAND_EPSILON 1e-3
#define SHORE_BAND_INNER_FRACTION 0.35
#define SHORE_GREEN_MIN_DEPTH 0.05
#define SHORE_GREEN_EXPONENT 0.25
#define SHORE_WARP_REACH_MIN 1.0
#define SHORE_MIN_GREENS 1.0
uniform highp sampler2D tShore; uniform vec2 uShoreCenter; uniform float uShoreHalf, uShoreOn, uShoreSdfOn, uShoreOffFieldDepth, uShoreDebug;
uniform float uShoreShoalDepth, uShoreGreenBandDepth, uShoreCompression, uShoreGreens, uShoreWarpReach, uShoreRefraction;
struct ShoreData { float depth; float sdfDist; vec2 toShore; float slopeTan; float influence; };
ShoreData shoreDataInert(){ ShoreData s; s.depth = SHORE_DEEP_SENTINEL; s.sdfDist = 0.0; s.toShore = vec2(0.0); s.slopeTan = 0.0; s.influence = 0.0; return s; }
vec2 shoreFieldUv(vec2 xz){ return (xz - uShoreCenter) / (2.0 * uShoreHalf) + 0.5; }
float shoreFieldInfluence(vec2 uv){ vec2 edge = min(uv, 1.0 - uv); vec2 ramp = clamp(edge / SHORE_BORDER_FEATHER, 0.0, 1.0); return ramp.x * ramp.y; }
vec2 shoreDirFromAngle(float angle01){ float a = angle01 * 6.28318530718; return angle01 >= 0.0 ? vec2(cos(a), sin(a)) : vec2(0.0); }   // < 0 = no direction
// Manual bilinear fetch of the packed texel: the direction is an ANGLE, which hardware filtering would wrap through the seam
// (0.99 .. 0.01 -> 0.5 = the opposite way), so the four texels are blended as unit vectors instead; depth / distance / slope
// blend normally. texelFetch also sidesteps the float-linear extension entirely (phones).
void shoreFetch(vec2 uv, out vec3 depthDistSlope, out vec2 toShore){ ivec2 size = textureSize(tShore, 0);
  vec2 fuv = uv * vec2(size) - 0.5; ivec2 i0 = ivec2(floor(fuv)); vec2 f = fract(fuv); ivec2 maxI = size - 1;
  vec4 t00 = texelFetch(tShore, clamp(i0, ivec2(0), maxI), 0), t10 = texelFetch(tShore, clamp(i0 + ivec2(1, 0), ivec2(0), maxI), 0);
  vec4 t01 = texelFetch(tShore, clamp(i0 + ivec2(0, 1), ivec2(0), maxI), 0), t11 = texelFetch(tShore, clamp(i0 + ivec2(1, 1), ivec2(0), maxI), 0);
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 lin = t00 * w.x + t10 * w.y + t01 * w.z + t11 * w.w; depthDistSlope = vec3(lin.r, lin.g, lin.a);
  vec2 d = shoreDirFromAngle(t00.b) * w.x + shoreDirFromAngle(t10.b) * w.y + shoreDirFromAngle(t01.b) * w.z + shoreDirFromAngle(t11.b) * w.w;
  float len = length(d); toShore = len > SHORE_SDF_DIR_EPSILON ? d / len : vec2(0.0); }
// One-stop fetch (ShoreSample): off-field / unbaked -> inert, so every consumer collapses to open water with no branches.
ShoreData shoreSample(vec2 xz){ ShoreData s = shoreDataInert(); if (uShoreOn < 0.5) return s;
  vec2 uv = shoreFieldUv(xz); float influence = shoreFieldInfluence(uv); if (influence <= 0.0) return s;
  s.influence = influence; vec3 dds; vec2 toShore; shoreFetch(clamp(uv, 0.0, 1.0), dds, toShore); s.depth = dds.x;
  if (uShoreSdfOn > 0.5) { s.toShore = toShore; s.sdfDist = dds.y; s.slopeTan = dds.z; }
  return s; }
// Column depth below mean level for consumers that only need the floor (under-surface mirror): abyss depth off-field, 0 on land.
float bedDepthAt(vec2 xz){ if (uShoreOn < 0.5) return uShoreOffFieldDepth; vec2 uv = shoreFieldUv(xz);
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return uShoreOffFieldDepth; return max(textureLod(tShore, uv, 0.0).r, 0.0); }
// Depth-based shoaling weight of ONE wave component (ShoalWeight): 0 at the waterline, short waves recover shallower than long ones
// (Crest's saturate(2*depth/L)), full strength past the shoal band over a smoothstep (no wall at the band depth).
float shoalWeight(float depth, float wavelength){ float clamped = max(depth, 0.0);
  float raw = clamp(SHORE_SHOAL_WAVELENGTH_FACTOR * clamped / max(wavelength, SHORE_WAVELENGTH_EPSILON), 0.0, 1.0);
  float band = max(uShoreShoalDepth, SHORE_BAND_EPSILON); float deep = smoothstep(SHORE_BAND_INNER_FRACTION * band, band, clamped);
  return mix(raw, 1.0, deep); }
// Green's law: waves GROW as the column shrinks (a ~ depth^-1/4), capped by the art knob, faded out in the last stretch to the waterline.
float shoreGreenGain(ShoreData shore){ float band = max(uShoreGreenBandDepth, SHORE_BAND_EPSILON);
  if (shore.influence <= 0.0 || shore.depth >= band) return 1.0;
  float d = max(shore.depth, SHORE_GREEN_MIN_DEPTH); float green = min(pow(band / d, SHORE_GREEN_EXPONENT), max(uShoreGreens, SHORE_MIN_GREENS));
  green = mix(green, 1.0, clamp(1.0 - shore.depth / (SHORE_BAND_INNER_FRACTION * band), 0.0, 1.0));
  return mix(1.0, green, shore.influence); }
// Phase compression: crests bunch as waves slow near the beach -- a monotonic warp of the shore distance added to a component's phase.
float shoreWarpExtra(ShoreData shore){ if (shore.influence <= 0.0 || uShoreCompression <= 0.0) return 0.0;
  float s = max(shore.sdfDist, 0.0); float reach = max(uShoreWarpReach, SHORE_WARP_REACH_MIN); return uShoreCompression * s * exp(-s / reach) * shore.influence; }
// Debug views (surface): 1 = depth (sand above the level, blue by depth), 2 = SDF (direction as colour, 5 m distance rings).
vec3 shoreDebugColor(vec2 xz){ ShoreData s = shoreSample(xz);
  if (uShoreDebug < 1.5) { if (s.influence <= 0.0) return vec3(0.0, 0.08, 0.2); return s.depth < 0.0 ? vec3(0.9, 0.8, 0.5) : mix(vec3(0.2, 0.9, 1.0), vec3(0.0, 0.1, 0.5), clamp(s.depth / 30.0, 0.0, 1.0)); }
  float ring = abs(fract(s.sdfDist / 5.0) - 0.5) * 2.0; return mix(vec3(s.toShore * 0.5 + 0.5, s.sdfDist < 0.0 ? 1.0 : 0.0), vec3(1.0), smoothstep(0.85, 1.0, ring) * s.influence); }
#endif`;

// Bake: heightAt(x, z) -> depth, SDF and slope over [center +- half]. heightAt should be the RENDERED/collision surface so the
// damping and the ground agree. offFieldDepth: what bedDepthAt reports outside the field (the abyss).
export function createOceanShore(renderer) {
 const SHORE_U = createShoreUniforms();
 const floatFilter = renderer.extensions.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter;
 function bakeShore(heightAt, centerX, centerZ, half, settings = {}, offFieldDepth = 100) {
  const s = { ...SHORE_DEFAULTS, ...settings }, n = s.resolution, started = performance.now();
  if (!Number.isInteger(n) || n < 2) throw new RangeError('Ocean shore resolution must be an integer of at least 2');
  const depth = new Float32Array(n * n), worldX = new Float32Array(n), worldZ = new Float32Array(n);
  for (let i = 0; i < n; i++) { worldX[i] = centerX + ((i + 0.5) / n - 0.5) * 2 * half; worldZ[i] = centerZ + ((i + 0.5) / n - 0.5) * 2 * half; }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) depth[j * n + i] = -heightAt(worldX[i], worldZ[j]);
  const packed = new Float32Array(n * n * 4), hasSdf = buildSdf(depth, n, worldX, worldZ, 2 * half / n, packed);
  for (let i = 0; i < n * n; i++) packed[i * 4] = depth[i];
  if (SHORE_U.tShore.value) SHORE_U.tShore.value.dispose();
  const t = new THREE.DataTexture(packed, n, n, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = floatFilter;
  t.needsUpdate = true;
  SHORE_U.tShore.value = t; SHORE_U.uShoreCenter.value.set(centerX, centerZ); SHORE_U.uShoreHalf.value = half; SHORE_U.uShoreOffFieldDepth.value = offFieldDepth;
  shoreSdfBaked = hasSdf; applyShore(s);
  lastBake = {size: n, sdf: hasSdf, ms: performance.now() - started};
}
// warpReach: compression e-folding reach (m), 2 x the surf front wavelength. The attenuation band is floored at 2 x the live Hs
// (setShoreSeaState, per frame); the Green band stays on the authored coastal profile, as in the package.
let authoredShoalDepth = SHORE_DEFAULTS.shoalDepth, shoreSdfBaked = false;
function applyShore(s, warpReach = SHORE_U.uShoreWarpReach.value) {
  const u = SHORE_U, baked = !!u.tShore.value; authoredShoalDepth = s.shoalDepth;
  u.uShoreOn.value = s.on && baked ? 1 : 0; u.uShoreSdfOn.value = s.on && shoreSdfBaked ? 1 : 0;
  u.uShoreGreenBandDepth.value = s.shoalDepth; u.uShoreCompression.value = s.compression; u.uShoreGreens.value = s.greens; u.uShoreWarpReach.value = warpReach; u.uShoreRefraction.value = s.refraction;
  u.uShoreDebug.value = SHORE_DEBUG_MODES.indexOf(s.debug);
}
function setShoreSeaState(significantHeight) { SHORE_U.uShoreShoalDepth.value = Math.max(authoredShoalDepth, SHOAL_BAND_SIGNIFICANT_HEIGHT_MULTIPLE * significantHeight); }
 return {uniforms: SHORE_U, bake: bakeShore, apply: applyShore, setSeaState: setShoreSeaState, get lastBake() { return lastBake; },
  dispose() {
   SHORE_U.tShore.value?.dispose();
   SHORE_U.tShore.value = null;
   SHORE_U.uShoreOn.value = 0;
   SHORE_U.uShoreSdfOn.value = 0;
  }};
}

// CPU jump-flood signed distance + direction to the waterline, and the beach slope (WaterShoreDepthField.BuildSdf / BuildSlope),
// written into the GBA channels of `out` (G = distance, B = direction angle, A = slope). Seeds are the texels whose submerged state
// differs from a 4-neighbour (a crisp 1-texel waterline). Returns false with no waterline (channels left at 0 / no direction).
function buildSdf(depth, n, worldX, worldZ, texel, out) {
  const count = n * n; let src = new Int32Array(count), dst = new Int32Array(count), seeds = 0;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const i = z * n + x, wet = depth[i] > 0;
    const boundary = (x > 0 && (depth[i - 1] > 0) !== wet) || (x < n - 1 && (depth[i + 1] > 0) !== wet) || (z > 0 && (depth[i - n] > 0) !== wet) || (z < n - 1 && (depth[i + n] > 0) !== wet);
    src[i] = boundary ? i : -1; if (boundary) seeds++; }
  if (!seeds) { for (let i = 0; i < count; i++) out[i * 4 + 2] = -1; return false; }
  const distSq = (seed, x, z) => { const dx = worldX[seed % n] - worldX[x], dz = worldZ[(seed / n) | 0] - worldZ[z]; return dx * dx + dz * dz; };
  for (let step = n >> 1; step >= 1; step >>= 1) {
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const i = z * n + x; let best = src[i], bestSq = best < 0 ? Infinity : distSq(best, x, z);
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) { if (!ox && !oz) continue; const nx = x + ox * step, nz = z + oz * step;
        if (nx < 0 || nx >= n || nz < 0 || nz >= n) continue; const cand = src[nz * n + nx]; if (cand < 0) continue;
        const sq = distSq(cand, x, z); if (sq < bestSq) { bestSq = sq; best = cand; } }
      dst[i] = best; }
    [src, dst] = [dst, src];
  }
  const dirX = new Float32Array(count), dirZ = new Float32Array(count), dist = new Float32Array(count), slope = new Float32Array(count);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const i = z * n + x, seed = src[i]; if (seed < 0) continue;
    const dx = worldX[seed % n] - worldX[x], dz = worldZ[(seed / n) | 0] - worldZ[z], d = Math.hypot(dx, dz);
    dist[i] = (depth[i] > 0 ? 1 : -1) * d; const inv = d > SDF_DIR_EPSILON ? 1 / d : 0; dirX[i] = dx * inv; dirZ[i] = dz * inv; }
  // local beach slope tan(beta) = |grad depth|, central differences
  for (let z = 0; z < n; z++) { const zm = Math.max(z - 1, 0), zp = Math.min(z + 1, n - 1);
    for (let x = 0; x < n; x++) { const xm = Math.max(x - 1, 0), xp = Math.min(x + 1, n - 1);
      const ddx = (depth[z * n + xp] - depth[z * n + xm]) / ((xp - xm) * texel), ddz = (depth[zp * n + x] - depth[zm * n + x]) / ((zp - zm) * texel);
      slope[z * n + x] = Math.hypot(ddx, ddz); } }
  // the raw jump-flood direction is piecewise-constant per nearest seed: smooth it (and the slope) like the package
  const scratch = new Float32Array(count);
  boxBlur3x3(dirX, scratch, n, DIRECTION_SMOOTH_PASSES); boxBlur3x3(dirZ, scratch, n, DIRECTION_SMOOTH_PASSES); boxBlur3x3(slope, scratch, n, DIRECTION_SMOOTH_PASSES);
  for (let i = 0; i < count; i++) { const len = Math.hypot(dirX[i], dirZ[i]);
    out[i * 4 + 1] = dist[i]; out[i * 4 + 2] = len > SDF_DIR_EPSILON ? (Math.atan2(dirZ[i], dirX[i]) / (2 * Math.PI) + 1) % 1 : -1; out[i * 4 + 3] = slope[i]; }
  return true;
}
function boxBlur3x3(data, scratch, n, passes) {
  for (let p = 0; p < passes; p++) {
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { let sum = 0, cnt = 0;
      for (let oz = -1; oz <= 1; oz++) { const zz = z + oz; if (zz < 0 || zz >= n) continue;
        for (let ox = -1; ox <= 1; ox++) { const xx = x + ox; if (xx < 0 || xx >= n) continue; sum += data[zz * n + xx]; cnt++; } }
      scratch[z * n + x] = sum / cnt; }
    data.set(scratch);
  }
}
