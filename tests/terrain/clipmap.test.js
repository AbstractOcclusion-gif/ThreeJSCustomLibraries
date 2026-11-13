import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cloneBiome, createTerrainClipmap, createTerrainWorld} from '../../src/terrain/index.js';

const CONFIG = {levels: 3, cells: 16, cellSize: .5};
const world = () => createTerrainWorld({seed: 9, biomes: [cloneBiome('hills'), cloneBiome('desert')], regionSize: 40});
const build = (overrides = {}) => createTerrainClipmap({world: world(), createMaterial: () => new THREE.MeshBasicMaterial(), ...CONFIG, ...overrides});
const maps = ring => ['heightMap', 'sandMap', 'paletteMap', 'climateMap'].map(name => ring.field[name].image.data);

test('a clipmap validates its settings and nests rings of doubling cell size around the focus', () => {
 assert.throws(() => build({cells: 18}), /multiple of 4/);
 assert.throws(() => build({levels: 0}), RangeError);
 assert.throws(() => build({cellSize: 0}), RangeError);
 assert.throws(() => build({snapCells: 3}), /even number of cells/);
 assert.throws(() => build({snapCells: 8}), /quarter of the ring/);
 assert.throws(() => createTerrainClipmap({world: world()}), TypeError);
 const clipmap = build();
 assert.throws(() => clipmap.update(NaN, 0), RangeError);
 assert.equal(clipmap.update(3, -2), true);
 assert.equal(clipmap.update(3, -2), false);
 assert.equal(clipmap.extent, 32);
 clipmap.rings.forEach((ring, level) => {
  assert.equal(ring.cell, .5 * 2 ** level);
  const [x, z] = clipmap.originOf(level);
  assert.ok(Math.abs(x + ring.size / 2 - 3) <= ring.cell && Math.abs(z + ring.size / 2 + 2) <= ring.cell);
  assert.deepEqual([...ring.field.bounds.toArray()], [x, z, ring.size, ring.size]);
  assert.equal(ring.field.paletteMap.image.depth, 3);   // hills and desert: 9 sets, in three groups of four
  // The inner ring starts on a cell corner of this ring, and this ring leaves that square out.
  if (level > 0) {
   const [innerX, innerZ] = clipmap.originOf(level - 1);
   assert.ok(Number.isInteger((innerX - x) / ring.cell) && Number.isInteger((innerZ - z) / ring.cell));
  }
  const quads = CONFIG.cells ** 2 - (level > 0 ? (CONFIG.cells / 2) ** 2 : 0);
  assert.equal(ring.field.weightMap, undefined);   // a world with a palette needs no layer map
  assert.equal(ring.meshes.reduce((total, mesh) => total + mesh.geometry.index.count, 0), quads * 6);
  for (const mesh of ring.meshes) assert.equal(mesh.visible, mesh.geometry.index.count > 0);
 });
 clipmap.dispose();
});

test('sliding the rings gives exactly what a fresh build at the same focus gives', () => {
 const moved = build(), n = CONFIG.cells + 1;
 moved.update(0, 0);
 for (const [x, z] of [[1.2, 0], [1.2, 2.6], [-3.1, 2.6], [-3.1, -4.4], [9, 7], [9.5, 7], [200, -90], [201, -91]]) moved.update(x, z);
 const fresh = build();
 fresh.update(201, -91);
 const source = world();
 moved.rings.forEach((ring, level) => {
  assert.deepEqual(moved.originOf(level), fresh.originOf(level));
  maps(ring).forEach((data, index) => assert.deepEqual(data, maps(fresh.rings[level])[index]));
  const [originX, originZ] = moved.originOf(level), heights = ring.field.heightMap.image.data;
  for (const [i, j] of [[0, 0], [5, 9], [n - 1, n - 1]]) assert.equal(heights[j * n + i], Math.fround(source.heightAt(originX + i * ring.cell, originZ + j * ring.cell, ring.cell)));
  assert.deepEqual(ring.meshes[0].geometry.attributes.normal.array, fresh.rings[level].meshes[0].geometry.attributes.normal.array);
 });
 assert.ok(moved.samplesGenerated > 0 && moved.samplesGenerated < CONFIG.levels * n * n);
 moved.dispose(); fresh.dispose();
});

test('a ring meets the ring outside it without a crack and tints on request', () => {
 const tinted = build({tint: (x, z, paint, color) => color.setRGB(paint.sand, 0, 1)}), n = CONFIG.cells + 1;
 tinted.update(4, 4);
 const inner = tinted.rings[0], position = inner.meshes[0].geometry.attributes.position;
 // Odd vertices of the outer edge sit midway between their even neighbours, where the coarser ring has an edge.
 for (let k = 1; k < CONFIG.cells; k += 2) assert.ok(Math.abs(position.getY(k) - (position.getY(k - 1) + position.getY(k + 1)) / 2) < 1e-6);
 const source = world(), [originX, originZ] = tinted.originOf(0);
 // A vertex shared with the ring outside has the height that ring has there: it shows less of the fine relief.
 assert.equal(position.getY(2), Math.fround(source.heightAt(originX + 2 * inner.cell, originZ, inner.cell * 2)));
 assert.equal(position.getY(n + 1), Math.fround(source.heightAt(originX + inner.cell, originZ + inner.cell, inner.cell)));
 const outer = tinted.rings[1], outerPosition = outer.meshes[0].geometry.attributes.position, [outerX, outerZ] = tinted.originOf(1);
 for (let k = 0; k <= CONFIG.cells; k += 2) {
  for (const [i, j] of [[k, 0], [k, CONFIG.cells], [0, k], [CONFIG.cells, k]]) {
   const column = (originX + i * inner.cell - outerX) / outer.cell, row = (originZ + j * inner.cell - outerZ) / outer.cell;
   assert.equal(position.getY(j * n + i), outerPosition.getY(row * n + column), `edge vertex ${i},${j}`);
  }
 }
 const colors = inner.meshes[0].geometry.attributes.color;
 assert.equal(colors.getZ(7), 1);
 tinted.reshade((x, z, paint, color) => color.setRGB(0, 1, 0));
 assert.equal(colors.getY(7), 1);
 tinted.dispose();
});

test('a clipmap moves its rings in steps, a few per update when asked, and bounds its chunks for culling', () => {
 const config = {levels: 3, cells: 32, cellSize: .5, snapCells: 4};
 const clipmap = createTerrainClipmap({world: world(), createMaterial: () => new THREE.MeshBasicMaterial(), ...config});
 clipmap.update(0, 0, 1);   // the first update places every ring
 assert.ok([0, 1, 2].every(level => clipmap.originOf(level)));
 assert.equal(clipmap.update(.9, 0), false, 'under half a step: nothing moves');
 assert.throws(() => clipmap.update(0, 0, 0), RangeError);
 // A long way off, one ring per update, the outer ring first; the inner ring stays inside the outer one meanwhile.
 const before = [0, 1, 2].map(level => [...clipmap.originOf(level)]);
 assert.equal(clipmap.update(200, 0, 1), true);
 assert.notDeepEqual(clipmap.originOf(2), before[2]);
 assert.deepEqual(clipmap.originOf(0), before[0]);
 clipmap.update(200, 0, 1); clipmap.update(200, 0, 1);
 assert.equal(clipmap.update(200, 0, 1), false);
 const fresh = createTerrainClipmap({world: world(), createMaterial: () => new THREE.MeshBasicMaterial(), ...config});
 fresh.update(200, 0);
 for (const level of [0, 1, 2]) assert.deepEqual(clipmap.originOf(level), fresh.originOf(level));
 // Every vertex of a chunk lies inside its bounding sphere.
 const ring = clipmap.rings[1], position = ring.meshes[0].geometry.attributes.position, point = new THREE.Vector3();
 assert.equal(ring.meshes.length, 16);
 for (const mesh of ring.meshes) {
  const {index, boundingSphere} = mesh.geometry;
  for (let i = 0; i < index.count; i += 7) assert.ok(boundingSphere.containsPoint(point.fromBufferAttribute(position, index.getX(i))));
 }
 clipmap.dispose(); fresh.dispose();
});
