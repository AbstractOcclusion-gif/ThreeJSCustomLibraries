// Generated stand-ins for the licensed vegetation pack: a small atlas (grass card, bark, leaf cluster), grass clump LOD
// geometries, and a reference for createProceduralMeadowTree. Everything is a DataTexture / BufferGeometry built in code,
// so the bench and tests run with no files at all. A project drops in real assets through the synty/ loaders instead.
import * as THREE from 'three';
import {hash2} from '../core/hash.js';

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

// Grass clump: `cards` crossed quads (near LOD) and a 2-card far LOD, uv mapped into rect, bendWeight = height.
export function createGrassClumpGeometries({rect = FREE_ATLAS_RECTS.grass, height = .5, width = .5, cards = 3} = {}) {
  const [ru, rv, rw, rh] = rect;
  const build = count => {
    const position = [], uv = [], bend = [];
    for (let k = 0; k < count; k++) {
      const a = k * Math.PI / count, dx = Math.cos(a) * width / 2, dz = Math.sin(a) * width / 2;
      const quad = [[-dx, 0, -dz, 0, 0], [dx, 0, dz, 1, 0], [dx, height, dz, 1, 1], [-dx, 0, -dz, 0, 0], [dx, height, dz, 1, 1], [-dx, height, -dz, 0, 1]];
      for (const [x, y, z, u, v] of quad) { position.push(x, y, z); uv.push(ru + rw * u, rv + rh * v); bend.push(y / height); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('bendWeight', new THREE.Float32BufferAttribute(bend, 1));
    g.computeVertexNormals();
    return g;
  };
  return [build(cards), build(2)];
}

// Near meadow LOD: individual tapered blades. Sample the opaque center of a
// blade in the existing atlas so geometry owns the silhouette.
function createMeadowBladeGeometry() {
  const position = [], uv = [], bend = [], indices = [];
  const [ru, rv, rw, rh] = FREE_ATLAS_RECTS.grass;
  for (let blade = 0; blade < 9; blade++) {
    const angle = blade * 2.39996, dx = Math.cos(angle), dz = Math.sin(angle);
    const root = .035 + hash2(blade, 1, 19) * .13;
    const height = .24 + hash2(blade, 2, 19) * .34;
    const lean = .06 + hash2(blade, 3, 19) * .17;
    const base = position.length / 3;
    for (let row = 0; row <= 3; row++) {
      const t = row / 3, distance = root + lean * t * t, halfWidth = .025 * (1 - t) + .001;
      for (const side of [-1, 1]) {
        position.push(dx * distance - dz * side * halfWidth, height * t, dz * distance + dx * side * halfWidth);
        uv.push(ru + rw * (.12 + Math.sin(t * 3) * .035 * t), rv + rh * Math.min(.98, t));
        bend.push(t);
      }
      if (row) {
        const a = base + (row - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('bendWeight', new THREE.Float32BufferAttribute(bend, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Reference parts for createProceduralMeadowTree. Part uvs are normalised inside their atlas rect (createSpecimens maps
// them through atlasRects[material]), so the bark swatch is the centre of the bark rect.
export function createProceduralReference() {
  return {parts: [
    {material: 'bark', foliage: false, uv: [.5, .5], position: []},
    {material: 'leaf', foliage: true, uv: [0, 0], position: []},
  ]};
}

// Atlas rects as {materialName: [u, v, w, h]} for createSpecimens; parts from createProceduralMeadowTree use 'bark' and 'leaf'
// with uv already in [0, 1] of their rect.
export function createFreeVegetation({meadowBlades = false} = {}) {
  const atlas = createVegetationAtlas();
  const grassGeometries = createGrassClumpGeometries();
  if (meadowBlades) {
    grassGeometries[0].dispose();
    grassGeometries[0] = createMeadowBladeGeometry();
  }
  return {atlas, atlasRects: FREE_ATLAS_RECTS, grassGeometries, reference: createProceduralReference(),
    dispose() { atlas.dispose(); }};
}
