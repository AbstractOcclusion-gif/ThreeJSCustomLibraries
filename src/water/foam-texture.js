// Generated foam tiles (no licensed textures in the lib). Both are tileable value-noise DataTextures.
import * as THREE from 'three';
import {hash2} from '../core/hash.js';
import {createDataTexture} from '../core/data-texture.js';

const OCTAVE_FALLOFF = .5;   // each octave's amplitude relative to the previous one
const BYTE = 255;            // 8-bit channel scale
// Inland foam film. cells: noise cells across the tile for the coverage and fleck layers. coverage: threshold =
// (noise - from) x gain. red / alpha: [base, gain per fleck]; green: fleck share.
const FOAM_FILM = Object.freeze({cells: [6, 11], fleckOctaves: 3, coverage: {from: .25, gain: 1.6}, fleckPower: 1.6,
  red: [.35, .9], green: .5, alpha: [.55, .45]});
// Whitecap lace: thin bright rims where the noise crosses its middle. contrast scales |noise - .5|; gamma thins the rims.
const LACE = Object.freeze({cells: 5, octaves: 5, contrast: 2.6, gamma: .7});
const FREEZE_CELLS = 5;

function noise2(size, scale, seed, octaves = 4) {
  const out = new Float32Array(size * size);
  const hash = (x, y) => hash2(x, y, seed);
  let amplitude = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = scale * 2 ** o;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * cells, v = y / size * cells, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
      const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv), w = (a, b) => hash(a % cells, b % cells);
      const n = (w(i, j) * (1 - su) + w(i + 1, j) * su) * (1 - sv) + (w(i, j + 1) * (1 - su) + w(i + 1, j + 1) * su) * sv;
      out[y * size + x] += n * amplitude;
    }
    total += amplitude; amplitude *= OCTAVE_FALLOFF;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
const toTexture = (data, size) => createDataTexture(data, size, size, {wrap: THREE.RepeatWrapping, filter: 'mipmap'});

// Inland foam film: r/g brightness detail, b density threshold (where the film appears as coverage rises), a coverage.
export function createFoamTexture(size = 256, seed = 3) {
  const F = FOAM_FILM, a = noise2(size, F.cells[0], seed), b = noise2(size, F.cells[1], seed + 1, F.fleckOctaves), data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const threshold = Math.min(1, Math.max(0, (a[i] - F.coverage.from) * F.coverage.gain)), fleck = Math.pow(b[i], F.fleckPower);
    data[i * 4] = Math.round(BYTE * Math.min(1, F.red[0] + fleck * F.red[1])); data[i * 4 + 1] = Math.round(BYTE * fleck * F.green);
    data[i * 4 + 2] = Math.round(BYTE * threshold); data[i * 4 + 3] = Math.round(BYTE * Math.min(1, F.alpha[0] + F.alpha[1] * fleck));
  }
  return toTexture(data, size);
}
// Ocean whitecap lace: a single pattern channel (r), thresholded against crest coverage in the ocean shader.
export function createLaceTexture(size = 256, seed = 7) {
  const n = noise2(size, LACE.cells, seed, LACE.octaves), data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { const v = Math.round(BYTE * Math.pow(Math.min(1, Math.abs(n[i] - .5) * LACE.contrast), LACE.gamma)); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = BYTE; }
  return toTexture(data, size);
}

// Red encodes the order in which patches freeze. A pond can combine it with local water depth.
export function createFreezeTexture(size = 128, seed = 31) {
 const noise = noise2(size, FREEZE_CELLS, seed);
 const data = Uint8Array.from(noise, value => Math.round(value * BYTE));
 return createDataTexture(data, size, size, {format: THREE.RedFormat, wrap: THREE.RepeatWrapping, filter: 'linear'});
}
