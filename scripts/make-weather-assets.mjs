// Generates the free weather textures in assets/weather/ (no dependencies): tileable Perlin-Worley cloud volumes,
// cirrus, moon, stars and a galaxy panorama. Deterministic. Run: node scripts/make-weather-assets.mjs
import {writeFileSync, mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const OUT = new URL('../assets/weather/', import.meta.url); mkdirSync(OUT, {recursive: true});

// ---------- hashing / noise (tileable: coordinates wrap at `period`) ----------
const hash3 = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1013904223) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i, p) => ((i % p) + p) % p;
function perlin3(x, y, z, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const grad = (ix, iy, iz, dx, dy, dz) => { const h = hash3(wrap(ix, period), wrap(iy, period), wrap(iz, period), seed), a = h * 6.2831853, b = hash3(wrap(ix, period) + 7, wrap(iy, period), wrap(iz, period), seed) * 2 - 1, r = Math.sqrt(1 - b * b); return dx * Math.cos(a) * r + dy * Math.sin(a) * r + dz * b; };
  const u = smooth(fx), v = smooth(fy), w = smooth(fz), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(grad(xi, yi, zi, fx, fy, fz), grad(xi + 1, yi, zi, fx - 1, fy, fz), u), L(grad(xi, yi + 1, zi, fx, fy - 1, fz), grad(xi + 1, yi + 1, zi, fx - 1, fy - 1, fz), u), v),
    L(L(grad(xi, yi, zi + 1, fx, fy, fz - 1), grad(xi + 1, yi, zi + 1, fx - 1, fy, fz - 1), u), L(grad(xi, yi + 1, zi + 1, fx, fy - 1, fz - 1), grad(xi + 1, yi + 1, zi + 1, fx - 1, fy - 1, fz - 1), u), v), w);
}
function worley3(x, y, z, period, seed) {   // inverted: 1 at cell centres
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z); let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz, wx = wrap(cx, period), wy = wrap(cy, period), wz = wrap(cz, period);
    const px = cx + hash3(wx, wy, wz, seed), py = cy + hash3(wx, wy, wz, seed + 1), pz = cz + hash3(wx, wy, wz, seed + 2);
    best = Math.min(best, (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2);
  }
  return 1 - Math.min(1, Math.sqrt(best));
}
const fbmP = (x, y, z, period, seed, oct) => { let s = 0, a = 1, n = 0, p = period; for (let o = 0; o < oct; o++) { s += perlin3(x * p / period, y * p / period, z * p / period, p, seed + o) * a; n += a; a *= .5; p *= 2; } return s / n * .5 + .5; };
const remap = (v, a, b, c, d) => c + (v - a) * (d - c) / (b - a);
const clamp01 = v => Math.max(0, Math.min(1, v));

// ---------- cloud volumes ----------
function cloudBase(size) {
  const out = new Uint8Array(size ** 3 * 4); let i = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, w = z / size;
    const p = fbmP(u * 4, v * 4, w * 4, 4, 11, 4);
    const w0 = worley3(u * 4, v * 4, w * 4, 4, 31), w1 = worley3(u * 8, v * 8, w * 8, 8, 41), w2 = worley3(u * 16, v * 16, w * 16, 16, 51), w3 = worley3(u * 32, v * 32, w * 32, 32, 61);
    const pw = clamp01(remap(p, w0 - 1, 1, 0, 1));     // Perlin-Worley: Perlin billows carved by low-frequency Worley
    out[i++] = pw * 255; out[i++] = w1 * 255; out[i++] = w2 * 255; out[i++] = w3 * 255;
  }
  return out;
}
function cloudDetail(size) {
  const out = new Uint8Array(size ** 3 * 4); let i = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, w = z / size;
    out[i++] = worley3(u * 4, v * 4, w * 4, 4, 71) * 255; out[i++] = worley3(u * 8, v * 8, w * 8, 8, 81) * 255; out[i++] = worley3(u * 16, v * 16, w * 16, 16, 91) * 255; out[i++] = 255;
  }
  return out;
}

// ---------- PNG ----------
function png(width, height, rgba) {
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = buf => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
const image = (w, h, fn) => { const d = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a] = fn(x / w, y / h, x, y); const i = (y * w + x) * 4; d[i] = clamp01(r) * 255; d[i + 1] = clamp01(g) * 255; d[i + 2] = clamp01(b) * 255; d[i + 3] = clamp01(a ?? 1) * 255; } return png(w, h, d); };

// cirrus: two tileable channels of wind-streaked wisps (r, g), sampled by cloud-density.js
const cirrus = image(512, 512, (u, v) => {
  const streak = (su, sv, seed) => { const n = fbmP(su * 3, sv * 24, 0, 24, seed, 5), m = fbmP(su * 1.5, sv * 6, .3, 6, seed + 9, 3); return clamp01((n - .42) * 2.4) * clamp01((m - .3) * 1.8); };
  return [streak(u, v, 101), streak(u + .37, v + .61, 202), 0, 1];
});
// moon: shaded disc, maria + craters; alpha = disc
const moon = image(512, 512, (u, v) => {
  const dx = u * 2 - 1, dy = v * 2 - 1, rr = dx * dx + dy * dy; if (rr > 1) return [0, 0, 0, 0];
  const z = Math.sqrt(1 - rr), nx = dx, ny = dy;
  const maria = fbmP(nx * 2 + 3, ny * 2 + 3, z * 2, 8, 301, 4), crater = worley3(nx * 6 + 9, ny * 6 + 9, z * 6, 16, 311), fine = fbmP(nx * 12, ny * 12, z * 12, 32, 321, 3);
  let albedo = .62 - .28 * clamp01((maria - .48) * 4) + .12 * (fine - .5) - .18 * clamp01((crater - .82) * 6);
  albedo *= .82 + .18 * z;
  return [albedo * 1.02, albedo, albedo * .95, 1 - clamp01((rr - .96) * 25)];
});
// stars: sparse bright texels on black (the shader reads peaks with texelFetch), slight colour temperature spread
const STARS_W = 2048, STARS_H = 1024, starData = new Uint8Array(STARS_W * STARS_H * 4);
for (let k = 0; k < 9000; k++) {
  const u = hash3(k, 1, 0, 5), v = Math.acos(1 - 2 * hash3(k, 2, 0, 5)) / Math.PI, x = Math.floor(u * STARS_W), y = Math.floor(v * STARS_H);
  const m = hash3(k, 3, 0, 5), bright = Math.pow(m, 6) * .9 + .08, t = hash3(k, 4, 0, 5), col = t < .2 ? [.75, .85, 1] : t < .8 ? [1, 1, 1] : [1, .85, .7];
  const i = (y * STARS_W + x) * 4; starData[i] = Math.max(starData[i], col[0] * bright * 255); starData[i + 1] = Math.max(starData[i + 1], col[1] * bright * 255); starData[i + 2] = Math.max(starData[i + 2], col[2] * bright * 255); starData[i + 3] = 255;
}
for (let i = 3; i < starData.length; i += 4) starData[i] = 255;
const stars = png(STARS_W, STARS_H, starData);
// galaxy: equirect band around a tilted plane, cloud fbm with dust lanes
const tilt = 1.05, gn = [Math.sin(tilt), Math.cos(tilt), 0];
const galaxy = image(1024, 512, (u, v) => {
  const phi = (u - .5) * 2 * Math.PI, theta = (v - .5) * Math.PI, d = [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)];
  const dist = Math.abs(d[0] * gn[0] + d[1] * gn[1] + d[2] * gn[2]), along = Math.atan2(d[2], d[0] * gn[1] - d[1] * gn[0]);
  const core = Math.exp(-((along - .6) ** 2) * .9);
  const cloud = fbmP(d[0] * 5 + 7, d[1] * 5 + 7, d[2] * 5 + 7, 32, 401, 5), dust = fbmP(d[0] * 9 + 2, d[1] * 9 + 2, d[2] * 9 + 2, 32, 411, 4);
  const band = Math.exp(-(dist * dist) / (.012 + .02 * core)) * (.35 + .65 * cloud) * (1 - .8 * clamp01((dust - .5) * 3) * Math.exp(-(dist * dist) / .006));
  const haze = Math.exp(-(dist * dist) / .12) * .08 * cloud;
  const i = band * (.5 + .5 * core) + haze;
  return [i * 1.0, i * .92, i * .85, 1];
});

// weather map: r = coverage variation (0.5 neutral) with large fronts and mid-scale cells, g = cloud top (0 low .. 1 high),
// b = type, a = sqrt(top) — same channel meaning as cloud-weather-map.js, but with multi-scale structure instead of blobs.
const weatherMap = image(512, 512, (u, v) => {
  const front = fbmP(u * 2, v * 2, .5, 2, 501, 3), cells = fbmP(u * 7, v * 7, .2, 7, 511, 4), fine = fbmP(u * 20, v * 20, .7, 20, 521, 2);
  const coverage = clamp01(.5 + (front - .5) * 1.4 + (cells - .5) * .9 + (fine - .5) * .25);
  const top = clamp01(.25 + .75 * clamp01((fbmP(u * 4 + .3, v * 4 + .7, .1, 4, 531, 3) - .35) * 1.6) * (.5 + .5 * coverage));
  return [coverage, top, clamp01(Math.pow(cells, .6)), Math.sqrt(top)];
});
writeFileSync(new URL('weather-map.png', OUT), weatherMap);
writeFileSync(new URL('cloud-base-64.rgba', OUT), cloudBase(64));
writeFileSync(new URL('cloud-detail-32.rgba', OUT), cloudDetail(32));
writeFileSync(new URL('cirrus.png', OUT), cirrus);
writeFileSync(new URL('moon.png', OUT), moon);
writeFileSync(new URL('stars.png', OUT), stars);
writeFileSync(new URL('galaxy.png', OUT), galaxy);
console.log('weather assets written to', OUT.pathname);
