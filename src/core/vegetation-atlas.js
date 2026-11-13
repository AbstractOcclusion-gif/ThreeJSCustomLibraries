// Generated plant atlas (grass card, bark, leaf cluster): the free default texture of the vegetation and trees modules.
// A DataTexture built in code, so both run with no files at all.
import * as THREE from 'three';
import {hash2} from './hash.js';
import {createDataTexture} from './data-texture.js';

const TILE = 128, TILES = 3;   // px per tile, tiles across
const ANISOTROPY = 4;
// Tile looks, in shares of the tile (u, v in 0..1) unless noted; colours are sRGB bytes scaled by the shade.
const GRASS_CARD = Object.freeze({blades: 5, start: .12, spacing: .19, swayFrequency: 3, sway: .035, baseHalfWidth: .045, tipHalfWidth: .006,
  shade: [.55, .45], color: [120, 165, 70]});   // shade: [at the root, gain to the tip]
const BARK = Object.freeze({cell: [3, 9], seed: 2, shade: [.65, .35], color: [92, 70, 50]});   // cell: px across, px along the trunk
const LEAF = Object.freeze({discs: 9, turn: 2.4, radius: [.17, .08], spread: [.22, .2], seed: 5, shade: [.6, .4], color: [70, 130, 55]});
const OPAQUE = 255;
export const FREE_ATLAS_RECTS = Object.freeze({grass: [0, 0, 1 / 3, 1], bark: [1 / 3, 0, 1 / 3, 1], leaf: [2 / 3, 0, 1 / 3, 1]});

const TWIG = {pairs: 4, start: .21, spacing: .17, reach: .27, rise: .16, width: .061, stem: .014};

function twigLeaf(u, v) {
  const {pairs, start, spacing, reach, rise, width, stem} = TWIG;
  if (Math.abs(u) < stem && v > .08 && v < .91) return .65;
  for (let pair = 0; pair < pairs; pair++) {
    const root = start + pair * spacing;
    const x = Math.abs(u);
    const y = v - root - (u < 0 ? spacing * .35 : 0);
    const along = (x * reach + y * rise) / (reach * reach + rise * rise);
    const across = (y * reach - x * rise) / Math.hypot(reach, rise);
    if (along > 0 && along < 1 && Math.abs(across) < width * Math.sin(Math.PI * along)) {
      return .75 + .25 * (1 - Math.abs(across) / width);
    }
  }
  return 0;
}

export function createVegetationAtlas({twigCards = false} = {}) {
  const w = TILE * TILES, h = TILE, data = new Uint8Array(w * h * 4);
  const put = (x, y, r, g, b, a) => { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; };
  // grass card: 5 tapered blades, alpha cutout
  for (let y = 0; y < h; y++) for (let x = 0; x < TILE; x++) {
    const u = x / TILE, v = y / h; let a = 0;
    const G = GRASS_CARD;
    for (let k = 0; k < G.blades; k++) { const cx = G.start + k * G.spacing + Math.sin(v * G.swayFrequency + k) * G.sway * v, half = (1 - v) * G.baseHalfWidth + G.tipHalfWidth; if (Math.abs(u - cx) < half) a = 1; }
    const shade = G.shade[0] + G.shade[1] * v; put(x, y, Math.round(G.color[0] * shade), Math.round(G.color[1] * shade), Math.round(G.color[2] * shade), a ? OPAQUE : 0);
  }
  // bark: brown vertical noise
  for (let y = 0; y < h; y++) for (let x = 0; x < TILE; x++) { const n = hash2(Math.floor(x / BARK.cell[0]), Math.floor(y / BARK.cell[1]), BARK.seed) * BARK.shade[1] + BARK.shade[0]; put(TILE + x, y, Math.round(BARK.color[0] * n), Math.round(BARK.color[1] * n), Math.round(BARK.color[2] * n), OPAQUE); }
  // leaf cluster: overlapping discs with a lit top, alpha outside
  for (let y = 0; y < h; y++) for (let x = 0; x < TILE; x++) {
    const u = x / TILE - .5, v = y / h - .5; let inside = 0, light = 0;
    for (let k = 0; k < LEAF.discs; k++) { const a = k * LEAF.turn, r = LEAF.radius[0] + hash2(k, 1, LEAF.seed) * LEAF.radius[1], cx = Math.cos(a) * LEAF.spread[0] * hash2(k, 2, LEAF.seed), cy = Math.sin(a) * LEAF.spread[1] * hash2(k, 3, LEAF.seed); const d = Math.hypot(u - cx, v - cy); if (d < r) { inside = 1; light = Math.max(light, 1 - d / r); } }
    const shade = twigCards ? twigLeaf(u, v + .5) : LEAF.shade[0] + LEAF.shade[1] * light;
    put(2 * TILE + x, y, Math.round(LEAF.color[0] * shade), Math.round(LEAF.color[1] * shade), Math.round(LEAF.color[2] * shade),
      (twigCards ? shade > 0 : inside) ? OPAQUE : 0);
  }
  return createDataTexture(data, w, h, {colorSpace: THREE.SRGBColorSpace, anisotropy: ANISOTROPY, filter: 'mipmap'});
}
