// The drive demo's valley: a bowl of low hills with a deep pond and a stream that pools and fords across it. Shape
// only, no rendering, so the page and the tests share one definition. Metres; water stands at WATER_LEVEL.
const TURN = Math.PI * 2;
export const VALLEY = Object.freeze({
 span: 260, resolution: 261,          // 1 m samples
 base: 1.6,                           // ground height before hills and water features
 hills: [1.2, 70, 85],                // height, wavelength along x and along z
 bumps: [.18, 11, 13],                // small relief the suspension works on
 rim: [28, 92, 124],                  // bowl wall, too steep to drive up: height, where it starts and tops out, from the centre
 pond: {x: -35, z: 30, depth: 6.5, radius: [26, 20]},
 stream: {z: -35, swing: 12, wavelength: 120, depth: 2.1, width: 5},   // bed line z(x) = z + swing sin(x), cut depth and half width
 spawn: {car: [30, 10], walker: [34, 13]},
});
export const WATER_LEVEL = 0;

const smoothstep = (value, from, to) => { const t = Math.min(1, Math.max(0, (value - from) / (to - from))); return t * t * (3 - 2 * t); };
const wave = ([height, alongX, alongZ], x, z) => height * Math.sin(x * TURN / alongX) * Math.cos(z * TURN / alongZ);

export function valleyHeight(x, z) {
 const {base, hills, bumps, rim, pond, stream} = VALLEY;
 const wall = rim[0] * smoothstep(Math.hypot(x, z), rim[1], rim[2]);
 const basin = pond.depth * Math.exp(-(((x - pond.x) / pond.radius[0]) ** 2 + ((z - pond.z) / pond.radius[1]) ** 2));
 const bed = stream.z + stream.swing * Math.sin(x * TURN / stream.wavelength);
 const channel = stream.depth * Math.exp(-(((z - bed) / stream.width) ** 2));
 return base + wave(hills, x, z) + wave(bumps, x + z, x - z) + wall - basin - channel;
}
export function valleyHeights() {
 const {span, resolution} = VALLEY, half = span / 2;
 return Float32Array.from({length: resolution ** 2}, (_, i) => valleyHeight(
  i % resolution / (resolution - 1) * span - half, Math.floor(i / resolution) / (resolution - 1) * span - half));
}
