// Generated stand-ins for the licensed vegetation pack: a small atlas (grass card, bark, leaf cluster), grass clump LOD
// geometries, and a reference for createProceduralMeadowTree. Everything is a DataTexture / BufferGeometry built in code,
// so the bench and tests run with no files at all. A project drops in real assets through the synty/ loaders instead.
import * as THREE from 'three';
import {hash2} from '../core/hash.js';
import {createVegetationAtlas, FREE_ATLAS_RECTS} from '../core/vegetation-atlas.js';

export {createVegetationAtlas, FREE_ATLAS_RECTS};

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

// Meadow blade clump: blades around the root on the golden angle. Ranges are [min, span] in metres; halfWidth is
// [taper share at the root, tip]; the atlas u wanders around centre by sway[1] at sway[0] rad per unit height.
const MEADOW_BLADES = Object.freeze({count: 9, rows: 3, seed: 19, root: [.035, .13], height: [.24, .34], lean: [.06, .17],
  halfWidth: [.025, .001], atlas: {centre: .12, sway: [3, .035], maxV: .98}});
const GOLDEN_ANGLE = 2.39996;   // rad

// Near meadow LOD: individual tapered blades. Sample the opaque center of a
// blade in the existing atlas so geometry owns the silhouette.
function createMeadowBladeGeometry() {
  const position = [], uv = [], bend = [], indices = [];
  const [ru, rv, rw, rh] = FREE_ATLAS_RECTS.grass;
  const B = MEADOW_BLADES;
  for (let blade = 0; blade < B.count; blade++) {
    const angle = blade * GOLDEN_ANGLE, dx = Math.cos(angle), dz = Math.sin(angle);
    const root = B.root[0] + hash2(blade, 1, B.seed) * B.root[1];
    const height = B.height[0] + hash2(blade, 2, B.seed) * B.height[1];
    const lean = B.lean[0] + hash2(blade, 3, B.seed) * B.lean[1];
    const base = position.length / 3;
    for (let row = 0; row <= B.rows; row++) {
      const t = row / B.rows, distance = root + lean * t * t, halfWidth = B.halfWidth[0] * (1 - t) + B.halfWidth[1];
      for (const side of [-1, 1]) {
        position.push(dx * distance - dz * side * halfWidth, height * t, dz * distance + dx * side * halfWidth);
        uv.push(ru + rw * (B.atlas.centre + Math.sin(t * B.atlas.sway[0]) * B.atlas.sway[1] * t), rv + rh * Math.min(B.atlas.maxV, t));
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
