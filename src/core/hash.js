// Deterministic 2D hash in [0, 1): placement variants, yaw, jitter. Same formula across modules so a project's
// seeds stay stable when it moves between them.
export function hash2(x, z, seed = 0) {
  const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
export function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
