import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {bakeSkyMap, cloneBiome, createSkyVisibility, createTerrainClipmap, createTerrainWorld, SKY_VISIBILITY_DEFAULTS} from '../../src/terrain/index.js';

test('sky visibility is 1 in the open, lower in a hollow, and matches the horizon of a known shape', () => {
 assert.throws(() => createSkyVisibility(), TypeError);
 assert.throws(() => createSkyVisibility(() => 0, {directions: 2}), /directions/);
 assert.throws(() => createSkyVisibility(() => 0, {reach: 0}), /reach/);
 assert.equal(createSkyVisibility(() => 0).at(5, -3), 1);
 // A peak sees the whole sky; ground lower than its surroundings does not.
 const cone = createSkyVisibility((x, z) => -Math.hypot(x, z));
 assert.equal(cone.at(0, 0), 1);
 // The bottom of a 45 degree pit: the horizon stands at 45 degrees all round, so half the sky's light is lost.
 const pit = createSkyVisibility((x, z) => Math.hypot(x, z));
 assert.ok(Math.abs(pit.at(0, 0) - .5) < 1e-9);
 // Nothing nearer than the spacing of the map is looked at, and the cost is known beforehand.
 let asked = 0;
 const counted = createSkyVisibility(() => { asked++; return 0; });
 counted.at(0, 0, 16);
 assert.equal(asked, counted.samples(16));
 assert.ok(counted.samples(16) < counted.samples(0));
 const map = bakeSkyMap(pit, [-8, -8], 16, 5);
 assert.equal(map.length, 25);
 assert.equal(map[12], 128);
 assert.throws(() => bakeSkyMap(pit, [0, 0], 16, 1), RangeError);
 assert.equal(SKY_VISIBILITY_DEFAULTS.directions, 8);
});

test('clipmap rings bake a sky map in the background and keep it through a move', () => {
 const world = () => createTerrainWorld({seed: 9, biomes: [cloneBiome('alpine')], regionSize: 40});
 const config = {levels: 3, cells: 16, cellSize: .5, skySamples: 600, sky: {reach: 40}};
 const build = (overrides = {}) => createTerrainClipmap({world: world(), createMaterial: () => new THREE.MeshBasicMaterial(), ...config, ...overrides});
 assert.throws(() => build({skySamples: -1}), /sky bake/);
 const settle = (clipmap, x, z) => { for (let guard = 0; clipmap.skyPending > 0; guard++) { assert.ok(guard < 400); clipmap.update(x, z); } };
 const baked = build();
 baked.update(0, 0);
 // One texel per snap step of the ring (2 cells here), open until baked.
 const side = 16 / baked.snapCells + 1;
 for (const ring of baked.rings) assert.equal(ring.field.skyMap.image.width, side);
 assert.ok(baked.skyPending > 0, 'the first update leaves most of it to later ones');
 settle(baked, 0, 0);
 const ring = baked.rings[2], data = ring.field.skyMap.image.data, [originX, originZ] = baked.originOf(2), spacing = ring.cell * baked.snapCells;
 const measure = createSkyVisibility(world().heightAt, config.sky), i = 3, j = 6;
 assert.equal(data[j * side + i], Math.round(measure.at(originX + i * spacing, originZ + j * spacing, spacing) * 255));
 assert.ok(data.some(value => value < 250), 'alpine relief hides some sky');
 baked.update(24, -16);
 assert.ok(baked.skyPending > 0);
 settle(baked, 24, -16);
 const fresh = build();
 fresh.update(24, -16); settle(fresh, 24, -16);
 for (const level of [0, 1, 2]) assert.deepEqual(baked.rings[level].field.skyMap.image.data, fresh.rings[level].field.skyMap.image.data);
 const off = build({skySamples: 0});
 off.update(0, 0);
 assert.equal(off.rings[0].field.skyMap, undefined);
 assert.equal(off.skyPending, 0);
 baked.dispose(); fresh.dispose(); off.dispose();
});
