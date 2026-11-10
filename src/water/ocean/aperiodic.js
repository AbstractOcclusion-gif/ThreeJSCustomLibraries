// ocean/aperiodic.js -- port of WebGpuWater's WaterOceanAperiodic.hlsl: Lutz/Schoentgen/Gilet hex-tile blending that breaks
// the FFT tile repetition. The FFT output is a zero-mean Gaussian field, so Heitz-Neyret histogram preservation reduces to
// variance preservation: divide the barycentric blend by sqrt(sum(weights^2)).
// Divergence from Unity: the authored direction map (per-tile rotation) is not ported yet -- tiles are hashed-offset, never
// rotated (the same result Unity gives with no map / strength 0).
export const APERIODIC_GLSL = /* glsl */`
#define OCEAN_APERIODIC_GRID_SCALE 3.46410161514   // 2 * sqrt(3)
#define OCEAN_APERIODIC_SKEW_X -0.57735026919      // -1 / sqrt(3)
#define OCEAN_APERIODIC_SKEW_Y 1.15470053838       //  2 / sqrt(3)
#define OCEAN_APERIODIC_INV_SKEW_Y 0.86602540378   // sqrt(3) / 2
#define OCEAN_APERIODIC_HASH_SCALE 43758.5453
#define OCEAN_APERIODIC_WEIGHT_EPSILON 1e-6
const vec4 OCEAN_APERIODIC_HASH_MATRIX = vec4(127.1, 311.7, 269.5, 183.3);
struct OceanAperiodicTriangle { vec3 weights; ivec2 vertex0; ivec2 vertex1; ivec2 vertex2; };
vec2 oceanAperiodicSkew(vec2 g){ return vec2(g.x + OCEAN_APERIODIC_SKEW_X * g.y, OCEAN_APERIODIC_SKEW_Y * g.y); }
vec2 oceanAperiodicUnskew(vec2 s){ float y = s.y * OCEAN_APERIODIC_INV_SKEW_Y; return vec2(s.x - OCEAN_APERIODIC_SKEW_X * y, y); }
OceanAperiodicTriangle oceanAperiodicTriangleAt(vec2 exemplarUv, float tileScale){
  float safeTileScale = max(tileScale, OCEAN_APERIODIC_WEIGHT_EPSILON);
  vec2 skewed = oceanAperiodicSkew(exemplarUv * (OCEAN_APERIODIC_GRID_SCALE / safeTileScale));
  ivec2 baseVertex = ivec2(floor(skewed)); vec2 local = fract(skewed);
  float thirdWeight = 1.0 - local.x - local.y;
  OceanAperiodicTriangle t;
  if (thirdWeight > 0.0) { t.weights = vec3(thirdWeight, local.y, local.x); t.vertex0 = baseVertex; t.vertex1 = baseVertex + ivec2(0, 1); t.vertex2 = baseVertex + ivec2(1, 0); }
  else { t.weights = vec3(-thirdWeight, 1.0 - local.y, 1.0 - local.x); t.vertex0 = baseVertex + ivec2(1, 1); t.vertex1 = baseVertex + ivec2(1, 0); t.vertex2 = baseVertex + ivec2(0, 1); }
  return t; }
vec2 oceanAperiodicHash(ivec2 vertex){ vec2 p = vec2(vertex);
  return fract(sin(vec2(dot(p, OCEAN_APERIODIC_HASH_MATRIX.xy), dot(p, OCEAN_APERIODIC_HASH_MATRIX.zw))) * OCEAN_APERIODIC_HASH_SCALE); }
vec2 oceanAperiodicVertexUv(ivec2 vertex, float tileScale){ return oceanAperiodicUnskew(vec2(vertex)) * (tileScale / OCEAN_APERIODIC_GRID_SCALE); }
vec3 oceanAperiodicVarianceWeights(vec3 w){ return w * inversesqrt(max(dot(w, w), OCEAN_APERIODIC_WEIGHT_EPSILON)); }
// Exemplar uv of a tap for one tile vertex. Unity: (world - tileCentre) rotated / domain + tileCentreUv + hash; with no
// rotation (see the header) the tile centre cancels and only the per-vertex hash offset remains.
vec2 oceanAperiodicSampleUv(vec2 exemplarUv, ivec2 vertex){ return exemplarUv + oceanAperiodicHash(vertex); }`;
