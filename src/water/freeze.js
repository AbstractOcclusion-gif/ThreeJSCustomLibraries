export const ICE_MAP_SCALE = .08;
const ICE_MIN = .12, ICE_MAX = .88, ICE_EDGE = .10, ICE_DEPTH_WEIGHT = .67;

export const ICE_COVERAGE_GLSL = `
 float iceCoverageAt(float progress, float deep, float order) {
  float threshold = mix(${ICE_MIN}, ${ICE_MAX}, ${ICE_DEPTH_WEIGHT} * deep + ${1 - ICE_DEPTH_WEIGHT} * order);
  return smoothstep(threshold - ${ICE_EDGE}, threshold + ${ICE_EDGE}, progress);
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
 let progress = 0, freezing = false;
 return {
  settings,
  get progress() { return progress; },
  update(dt, temperature) {
   if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(temperature)) throw Error('Water freeze needs finite temperature and non-negative time');
   const {phase, freezeSeconds, thawSeconds} = settings;
   freezing = phase === 'Frozen' || (phase === 'Weather' && (temperature <= -1 || (freezing && temperature < 1)));
   const duration = freezing ? freezeSeconds : thawSeconds;
   if (!Number.isFinite(duration) || duration <= 0) throw Error('Water phase duration must be positive');
   progress = freezing ? Math.min(1, progress + dt / duration) : Math.max(0, progress - dt / duration);
   if (progress < 1e-9) progress = 0;
   if (progress > 1 - 1e-9) progress = 1;
   return progress;
  },
 };
}
