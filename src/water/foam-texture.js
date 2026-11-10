// Generated foam tiles (no licensed textures in the lib). Both are tileable value-noise DataTextures.
import * as THREE from 'three';

function noise2(size, scale, seed, octaves = 4) {
  const out = new Float32Array(size * size);
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  let amplitude = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = scale * 2 ** o;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * cells, v = y / size * cells, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv), w = (a, b) => hash(a % cells, b % cells);
      const n = (w(i, j) * (1 - su) + w(i + 1, j) * su) * (1 - sv) + (w(i, j + 1) * (1 - su) + w(i + 1, j + 1) * su) * sv;
      out[y * size + x] += n * amplitude;
    }
    total += amplitude; amplitude *= .5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
const toTexture = (data, size) => { const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t; };

// Inland foam film: r/g brightness detail, b density threshold (where the film appears as coverage rises), a coverage.
export function createFoamTexture(size = 256, seed = 3) {
  const a = noise2(size, 6, seed), b = noise2(size, 11, seed + 1, 3), data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const threshold = Math.min(1, Math.max(0, (a[i] - .25) * 1.6)), fleck = Math.pow(b[i], 1.6);
    data[i * 4] = Math.round(255 * Math.min(1, .35 + fleck * .9)); data[i * 4 + 1] = Math.round(255 * fleck * .5);
    data[i * 4 + 2] = Math.round(255 * threshold); data[i * 4 + 3] = Math.round(255 * Math.min(1, .55 + .45 * fleck));
  }
  return toTexture(data, size);
}
// Ocean whitecap lace: a single pattern channel (r), thresholded against crest coverage in the ocean shader.
export function createLaceTexture(size = 256, seed = 7) {
  const n = noise2(size, 5, seed, 5), data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { const v = Math.round(255 * Math.pow(Math.min(1, Math.abs(n[i] - .5) * 2.6), .7)); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return toTexture(data, size);
}

// Red encodes the order in which patches freeze. A pond can combine it with local water depth.
export function createFreezeTexture(size = 128, seed = 31) {
 const noise = noise2(size, 5, seed);
 const data = Uint8Array.from(noise, value => Math.round(value * 255));
 const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 texture.minFilter = texture.magFilter = THREE.LinearFilter;
 texture.needsUpdate = true;
 return texture;
}
