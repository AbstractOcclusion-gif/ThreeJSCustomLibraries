// Tileable gradient noise, shared with the offline weather texture generator.
const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i, period) => ((i % period) + period) % period;
const lerp = (a, b, t) => a + (b - a) * t;

export function hash3(x, y, z, seed) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1013904223) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function perlin3(x, y, z, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  function gradient(ix, iy, iz, dx, dy, dz) {
    const wx = wrap(ix, period), wy = wrap(iy, period), wz = wrap(iz, period);
    const angle = hash3(wx, wy, wz, seed) * 6.2831853;
    const up = hash3(wx + 7, wy, wz, seed) * 2 - 1;
    const r = Math.sqrt(1 - up * up);
    return dx * Math.cos(angle) * r + dy * Math.sin(angle) * r + dz * up;
  }
  const u = smooth(fx), v = smooth(fy), w = smooth(fz);
  const low = lerp(
    lerp(gradient(xi, yi, zi, fx, fy, fz), gradient(xi + 1, yi, zi, fx - 1, fy, fz), u),
    lerp(gradient(xi, yi + 1, zi, fx, fy - 1, fz), gradient(xi + 1, yi + 1, zi, fx - 1, fy - 1, fz), u), v);
  const high = lerp(
    lerp(gradient(xi, yi, zi + 1, fx, fy, fz - 1), gradient(xi + 1, yi, zi + 1, fx - 1, fy, fz - 1), u),
    lerp(gradient(xi, yi + 1, zi + 1, fx, fy - 1, fz - 1), gradient(xi + 1, yi + 1, zi + 1, fx - 1, fy - 1, fz - 1), u), v);
  return lerp(low, high, w);
}

export function fbmP(x, y, z, period, seed, octaves) {
  let sum = 0, weight = 1, total = 0, scale = period;
  for (let i = 0; i < octaves; i++) {
    sum += perlin3(x * scale / period, y * scale / period, z * scale / period, scale, seed + i) * weight;
    total += weight;
    weight *= .5;
    scale *= 2;
  }
  return sum / total * .5 + .5;
}
