export const ICE_MAP_SCALE = .08;
const ICE_MIN = .12, ICE_MAX = .88, ICE_EDGE = .10, ICE_DEPTH_WEIGHT = .67;
const THAW_BLEND_SECONDS = 1.2;   // time the surface takes to turn from freezing to its wet, melting look and back

export const ICE_COVERAGE_GLSL = `
 float iceCoverageAt(float progress, float deep, float order) {
  float threshold = mix(${ICE_MIN}, ${ICE_MAX}, ${ICE_DEPTH_WEIGHT} * deep + ${1 - ICE_DEPTH_WEIGHT} * order);
  return smoothstep(threshold - ${ICE_EDGE}, threshold + ${ICE_EDGE}, progress);
 }
 // How far the freeze has passed this spot, in units of progress: negative ahead of the ice, positive behind it.
 float iceFrontLevel(float progress, float deep, float order) {
  return progress - mix(${ICE_MIN}, ${ICE_MAX}, ${ICE_DEPTH_WEIGHT} * deep + ${1 - ICE_DEPTH_WEIGHT} * order);
 }
`;

// How ice looks. Shared uniforms: pass one look to the water surface and to any ice mesh that should match it.
export function createIceLook() {
 return {
  frost: {value: .5},     // 0 = clear dark ice everywhere, 1 = white frosted ice everywhere
  cracks: {value: 1},     // strength of the crack network
  bubbles: {value: 1},    // trapped air bubbles in the clear ice
  sparkle: {value: 1},    // sun glints on frost crystals
  needles: {value: 1},    // freezing: how far crystal stars reach ahead of the ice (0 = a smooth front)
  slush: {value: 1},      // freezing: milky, calmed water just ahead of the ice (0 = none)
 };
}
export const iceLookUniforms = look => ({iceFrost: look.frost, iceCracks: look.cracks, iceBubbles: look.bubbles, iceSparkle: look.sparkle,
 iceNeedles: look.needles, iceSlush: look.slush});

// The ice pattern in world space (p = world xz, metres), shared by every ice shader so they agree texel for texel.
// noiseMap is the freeze texture (createFreezeTexture). All outputs are 0..1:
//   frost       white frosted ice (1) or clear ice (0): frost gathers toward the shore and in drifting patches
//   cracks      the crack network on the surface         deepCracks  the same cracks seen deeper inside clear ice
//   bubbles     trapped air bubbles
export const ICE_PATTERN_GLSL = /* glsl */`
 uniform float iceFrost, iceCracks, iceBubbles, iceSparkle, iceNeedles, iceSlush;
 const vec3 ICE_CLEAR = vec3(.045, .15, .2);      // body colour of clear ice over deep water
 const vec3 ICE_FROSTED = vec3(.74, .84, .89);    // frosted, snowy ice
 const vec3 ICE_WHITE = vec3(.86, .93, .96);      // cracks and bubbles
 float iceHash(vec2 p) { p = fract(p * vec2(.1031, .103)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.y); }
 // Gap between the nearest and second nearest cell centre: zero on the borders between cells, where ice cracks.
 float iceCellBorder(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  float nearest = 8.0, second = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
   vec2 neighbour = vec2(float(i), float(j));
   vec2 site = neighbour + vec2(iceHash(cell + neighbour), iceHash(cell + neighbour + 17.3)) - f;
   float d = dot(site, site);
   if (d < nearest) { second = nearest; nearest = d; } else if (d < second) second = d;
  }
  return sqrt(second) - sqrt(nearest);
 }
 // Crystal stars: six thin needles spread from scattered seeds, strongest at the seed. Each seed has its own size
 // and turn, and its needles bend a little, so no two stars match. 0..1.
 float iceCrystalStars(vec2 p) {
  const float seedsPerMeter = 1.1;
  const float needleSharpness = 16.0;
  const vec2 starSize = vec2(.45, 1.15);   // reach of the smallest and largest star, in seed spacings
  const float bend = 1.1;                   // radians a needle curves over its length
  vec2 q = p * seedsPerMeter, cell = floor(q), f = fract(q);
  float stars = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
   vec2 neighbour = vec2(float(i), float(j));
   vec2 toSeed = neighbour + vec2(iceHash(cell + neighbour + 41.0), iceHash(cell + neighbour + 59.0)) - f;
   float distance = length(toSeed);
   float turn = iceHash(cell + neighbour + 23.0) * 6.2831853;
   float size = mix(starSize.x, starSize.y, iceHash(cell + neighbour + 77.0));
   float curve = (iceHash(cell + neighbour + 91.0) - .5) * bend * distance / size;
   float needle = pow(abs(cos((atan(toSeed.y, toSeed.x) + curve) * 3.0 + turn)), needleSharpness);
   float reach = 1.0 - smoothstep(.08 * size, size, distance);
   stars = max(stars, reach * mix(.35, 1.0, needle));
  }
  return stars;
 }
 float iceCrackLines(vec2 p, sampler2D noiseMap, float footprint) {
  const float platesPerMeter = .55;     // large plates
  const float splintersPerMeter = 2.1;  // fine cracks between them
  const float width = .018;             // m
  // Bend the plates with the noise so no crack runs straight, and break the network into separate runs.
  vec2 warp = vec2(texture2D(noiseMap, p * .11).r, texture2D(noiseMap, p * .11 + .37).r) - .5;
  vec2 q = p + warp * 1.6;
  float runs = smoothstep(.34, .52, texture2D(noiseMap, p * .047 + .21).r);
  float line = max(width, footprint);
  float plates = 1.0 - smoothstep(0.0, line * platesPerMeter * 2.0, iceCellBorder(q * platesPerMeter));
  float splinters = 1.0 - smoothstep(0.0, line * splintersPerMeter * 1.4, iceCellBorder(q * splintersPerMeter + 5.0));
  // A crack thinner than a pixel fades instead of flickering.
  float resolved = width / line;
  return (plates * mix(.35, 1.0, runs) + splinters * .4 * runs) * resolved;
 }
 void icePattern(vec2 p, vec3 view, float deep, sampler2D noiseMap, out float frost, out float cracks, out float deepCracks, out float bubbles) {
  float footprint = length(fwidth(p));
  float patches = texture2D(noiseMap, p * .06).r * .6 + texture2D(noiseMap, p * .23 + .41).r * .4;
  float grain = texture2D(noiseMap, p * 1.9 + .13).r;
  // Frost settles on the shallows first; the slider moves how much of the open ice it also covers.
  float level = patches * .7 + (1.0 - deep) * .65 + (grain - .5) * .12;
  float start = mix(1.15, .05, iceFrost);
  frost = smoothstep(start - .1, start + .1, level);
  cracks = clamp(iceCrackLines(p, noiseMap, footprint), 0.0, 1.0);
  // The same network a little below the surface, shifted along the view ray: it gives clear ice its thickness.
  const float depthBelow = .12;   // m
  vec2 below = p - view.xz / max(view.y, .25) * depthBelow;
  deepCracks = clamp(iceCrackLines(below, noiseMap, footprint), 0.0, 1.0);
  // Bubbles: at most one per cell, in clusters, fading before they are subpixel.
  const float bubblesPerMeter = 14.0;
  vec2 cell = floor(below * bubblesPerMeter), f = fract(below * bubblesPerMeter);
  float radius = mix(.12, .34, iceHash(cell + 3.1));
  float present = step(.72, iceHash(cell + 9.7)) * smoothstep(.5, .62, texture2D(noiseMap, p * .19 + .63).r);
  float disc = 1.0 - smoothstep(radius * .6, radius, length(f - mix(vec2(.35), vec2(.65), vec2(iceHash(cell), iceHash(cell + 5.5)))));
  bubbles = disc * present * (1.0 - smoothstep(.25, .7, footprint * bubblesPerMeter));
 }
 // Colour of the ice body before lighting, and how much of what lies under it is hidden (opacity).
 vec3 iceBody(float frost, float cracks, float deepCracks, float bubbles, out float opacity) {
  const float clearOpacity = .42;   // clear ice still tints what is under it
  float clear = 1.0 - frost;
  float marks = cracks * iceCracks * mix(1.0, .45, frost) + deepCracks * iceCracks * .3 * clear + bubbles * iceBubbles * .55 * clear;
  opacity = clamp(mix(clearOpacity, 1.0, frost) + marks * .7, 0.0, 1.0);
  return mix(ICE_CLEAR, ICE_FROSTED, frost) + ICE_WHITE * marks;
 }
`;

// Sample the generated, repeat-wrapped freeze map like WebGL's linear filter.
export function hasIceSupport(progress, depth, x, z, map) {
 if (depth <= .002 || progress <= 0) return false;
 if (progress >= 1) return true;
 const {data, width, height} = map.image;
 const u = x * ICE_MAP_SCALE * width - .5, v = z * ICE_MAP_SCALE * height - .5;
 const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j;
 const texel = (a, b) => data[((b % height + height) % height) * width + (a % width + width) % width] / 255;
 const order = (texel(i, j) * (1 - fx) + texel(i + 1, j) * fx) * (1 - fz)
  + (texel(i, j + 1) * (1 - fx) + texel(i + 1, j + 1) * fx) * fz;
 const t = Math.max(0, Math.min(1, (depth - .05) / 1.95));
 const deep = t * t * (3 - 2 * t);
 return progress >= ICE_MIN + (ICE_MAX - ICE_MIN) * (ICE_DEPTH_WEIGHT * deep + (1 - ICE_DEPTH_WEIGHT) * order) + ICE_EDGE;
}

// Air temperature requests a phase. The water surface advances toward it over time.
export function createWaterFreeze() {
 const settings = {phase: 'Weather', freezeSeconds: 6, thawSeconds: 5};
 let progress = 0, freezing = false, thaw = 0;
 return {
  settings,
  get progress() { return progress; },
  // 0 while freezing or holding, 1 while the ice melts: pass it to the water surface as settings.freezeThaw.
  get thaw() { return thaw; },
  update(dt, temperature) {
   if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(temperature)) throw Error('Water freeze needs finite temperature and non-negative time');
   const {phase, freezeSeconds, thawSeconds} = settings;
   freezing = phase === 'Frozen' || (phase === 'Weather' && (temperature <= -1 || (freezing && temperature < 1)));
   const duration = freezing ? freezeSeconds : thawSeconds;
   if (!Number.isFinite(duration) || duration <= 0) throw Error('Water phase duration must be positive');
   progress = freezing ? Math.min(1, progress + dt / duration) : Math.max(0, progress - dt / duration);
   if (progress < 1e-9) progress = 0;
   if (progress > 1 - 1e-9) progress = 1;
   const melting = !freezing && progress > 0 ? 1 : 0;
   thaw += (melting - thaw) * Math.min(1, dt / THAW_BLEND_SECONDS);
   return progress;
  },
 };
}
