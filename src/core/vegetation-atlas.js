// Generated plant atlas (grass card, bark, leaf cluster): the free default texture of the vegetation and trees modules.
// A DataTexture built in code, so both run with no files at all.
import * as THREE from 'three';
import {hash2} from './hash.js';

const TILE = 128, TILES = 3;
export const FREE_ATLAS_RECTS = Object.freeze({grass: [0, 0, 1 / 3, 1], bark: [1 / 3, 0, 1 / 3, 1], leaf: [2 / 3, 0, 1 / 3, 1]});

export function createVegetationAtlas() {
  const w = TILE * TILES, h = TILE, data = new Uint8Array(w * h * 4);
  const put = (x, y, r, g, b, a) => { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; };
  // grass card: 5 tapered blades, alpha cutout
  for (let y = 0; y < h; y++) for (let x = 0; x < TILE; x++) {
    const u = x / TILE, v = y / h; let a = 0;
    for (let k = 0; k < 5; k++) { const cx = .12 + k * .19 + Math.sin(v * 3 + k) * .035 * v, half = (1 - v) * .045 + .006; if (Math.abs(u - cx) < half) a = 1; }
    const shade = .55 + .45 * v; put(x, y, Math.round(120 * shade), Math.round(165 * shade), Math.round(70 * shade), a ? 255 : 0);
  }
  // bark: brown vertical noise
  for (let y = 0; y < h; y++) for (let x = 0; x < TILE; x++) { const n = hash2(Math.floor(x / 3), Math.floor(y / 9), 2) * .35 + .65; put(TILE + x, y, Math.round(92 * n), Math.round(70 * n), Math.round(50 * n), 255); }
  // leaf cluster: overlapping discs with a lit top, alpha outside
  for (let y = 0; y < h; y++) for (let x = 0; x < TILE; x++) {
    const u = x / TILE - .5, v = y / h - .5; let inside = 0, light = 0;
    for (let k = 0; k < 9; k++) { const a = k * 2.4, r = .17 + hash2(k, 1, 5) * .08, cx = Math.cos(a) * .22 * hash2(k, 2, 5), cy = Math.sin(a) * .2 * hash2(k, 3, 5); const d = Math.hypot(u - cx, v - cy); if (d < r) { inside = 1; light = Math.max(light, 1 - d / r); } }
    const shade = .6 + .4 * light; put(2 * TILE + x, y, Math.round(70 * shade), Math.round(130 * shade), Math.round(55 * shade), inside ? 255 : 0);
  }
  const atlas = new THREE.DataTexture(data, w, h, THREE.RGBAFormat); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter; atlas.generateMipmaps = true; atlas.needsUpdate = true;
  return atlas;
}
