import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {cloneBiome, createTerrainClipmap, createTerrainWorld} from '../../src/terrain/index.js';

const CONFIG = {levels: 3, cells: 16, cellSize: .5};
const world = () => createTerrainWorld({seed: 9, biomes: [cloneBiome('hills'), cloneBiome('desert')], regionSize: 40});
const build = (overrides = {}) => createTerrainClipmap({world: world(), createMaterial: () => new THREE.MeshBasicMaterial(), ...CONFIG, ...overrides});
const maps = ring => ['heightMap', 'weightMap', 'forestMap', 'sandMap'].map(name => ring.field[name].image.data);

test('a clipmap validates its settings and nests rings of doubling cell size around the focus', () => {
 assert.throws(() => build({cells: 18}), /multiple of 4/);
 assert.throws(() => build({levels: 0}), RangeError);
 assert.throws(() => build({cellSize: 0}), RangeError);
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
  // The inner ring starts on a cell corner of this ring, and this ring leaves that square out.
  if (level > 0) {
   const [innerX, innerZ] = clipmap.originOf(level - 1);
   assert.ok(Number.isInteger((innerX - x) / ring.cell) && Number.isInteger((innerZ - z) / ring.cell));
  }
  const quads = CONFIG.cells ** 2 - (level > 0 ? (CONFIG.cells / 2) ** 2 : 0);
  assert.equal(ring.mesh.geometry.index.count, quads * 6);
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
  for (const [i, j] of [[0, 0], [5, 9], [n - 1, n - 1]]) assert.equal(heights[j * n + i], Math.fround(source.heightAt(originX + i * ring.cell, originZ + j * ring.cell)));
  assert.deepEqual(ring.mesh.geometry.attributes.normal.array, fresh.rings[level].mesh.geometry.attributes.normal.array);
 });
 assert.ok(moved.samplesGenerated > 0 && moved.samplesGenerated < CONFIG.levels * n * n);
 moved.dispose(); fresh.dispose();
});

test('a ring meets the ring outside it without a crack and tints on request', () => {
 const tinted = build({tint: (x, z, paint, color) => color.setRGB(paint.sand, 0, 1)}), n = CONFIG.cells + 1;
 tinted.update(4, 4);
 const inner = tinted.rings[0], position = inner.mesh.geometry.attributes.position;
 // Odd vertices of the outer edge sit midway between their even neighbours, where the coarser ring has an edge.
 for (let k = 1; k < CONFIG.cells; k += 2) assert.ok(Math.abs(position.getY(k) - (position.getY(k - 1) + position.getY(k + 1)) / 2) < 1e-6);
 const source = world(), [originX, originZ] = tinted.originOf(0);
 assert.equal(position.getY(2), Math.fround(source.heightAt(originX + 2 * inner.cell, originZ)));
 assert.equal(position.getY(n + 1), Math.fround(source.heightAt(originX + inner.cell, originZ + inner.cell)));
 const colors = inner.mesh.geometry.attributes.color;
 assert.equal(colors.getZ(7), 1);
 tinted.reshade((x, z, paint, color) => color.setRGB(0, 1, 0));
 assert.equal(colors.getY(7), 1);
 tinted.dispose();
});
