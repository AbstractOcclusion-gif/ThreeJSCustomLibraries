import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneBiome, createRelief, createTerrainField, createTerrainWorld, PAINT_REACH, TERRAIN_LAYERS, TERRAIN_PALETTE_ROLES, WORLD_MAP_AUTO, WORLD_MAX_BIOMES, WORLD_PALETTE_MAX} from '../../src/terrain/index.js';

const SEED = 5, SIZE = 100;
const biomes = () => [cloneBiome('plains'), cloneBiome('mountains'), cloneBiome('desert')];
// Region (column, row) of a 3 x 3 map centred on the origin; its centre is ((column + .5) x SIZE, (row + .5) x SIZE).
const map = cells => ({columns: 3, rows: 3, cells});

test('a world validates its settings, biomes and map', () => {
 assert.throws(() => createTerrainWorld({seed: 1.5, biomes: biomes()}), /integer seed/);
 assert.throws(() => createTerrainWorld({seed: 1, biomes: []}), RangeError);
 assert.throws(() => createTerrainWorld({seed: 1, biomes: Array.from({length: WORLD_MAX_BIOMES + 1}, () => cloneBiome('plains'))}), RangeError);
 assert.throws(() => createTerrainWorld({seed: 1, biomes: biomes(), regionSize: 0}), /regionSize/);
 assert.throws(() => createTerrainWorld({seed: 1, biomes: biomes(), map: map([0, 1])}), /columns x rows/);
 assert.throws(() => createTerrainWorld({seed: 1, biomes: biomes(), map: map(new Array(9).fill(3))}), /names no biome/);
});

test('a world of one biome is that biome and keeps its valley route', () => {
 const valley = cloneBiome('valley'), world = createTerrainWorld({seed: SEED, biomes: [valley]});
 const relief = createRelief(SEED, valley.relief);
 for (const [x, z] of [[0, 0], [37.5, -212], [-900, 444]]) assert.equal(world.heightAt(x, z), relief.heightAt(x, z));
 assert.equal(world.routeX(40), relief.routeX(40));
 assert.equal(createTerrainWorld({seed: SEED, biomes: biomes()}).routeX, undefined);
});

test('painted regions hold their biome at the centre and blend relief and paint across a border', () => {
 const list = biomes(), cells = [0, 0, 0, 0, 0, 1, 0, 0, 0];   // mountains east of the origin region
 const world = createTerrainWorld({seed: SEED, biomes: list, map: map(cells), regionSize: SIZE, wander: 0, blend: .4});
 assert.equal(world.regionBiome(0, 0), 0);
 assert.equal(world.regionBiome(1, 0), 1);
 assert.deepEqual([...world.weightsAt(50, 50)], [1, 0, 0]);
 assert.deepEqual([...world.weightsAt(150, 50)], [0, 1, 0]);
 const border = world.weightsAt(100, 50);
 assert.ok(Math.abs(border[0] - .5) < 1e-6 && Math.abs(border[1] - .5) < 1e-6);
 const plains = createRelief(SEED, list[0].relief), mountains = createRelief(SEED, list[1].relief);
 assert.equal(world.heightAt(50, 50), plains.heightAt(50, 50));
 assert.ok(Math.abs(world.heightAt(100, 50) - (plains.heightAt(100, 50) + mountains.heightAt(100, 50)) / 2) < 1e-4);
 // Heights are continuous across the border: no step between neighbouring samples.
 for (let x = 60; x < 140; x += .5) assert.ok(Math.abs(world.heightAt(x + .5, 50) - world.heightAt(x, 50)) < 3);
 for (let x = -150; x <= 250; x += 13) for (let z = -150; z <= 250; z += 17) {
  const sum = world.weightsAt(x, z).reduce((total, weight) => total + weight);
  assert.ok(Math.abs(sum - 1) < 1e-6);
  const paint = world.paintAt({x, z, height: world.heightAt(x, z), slope: .1, curvature: 0});
  assert.equal(paint.layers.length, TERRAIN_LAYERS.length);
  assert.ok(Math.abs(paint.layers.reduce((total, weight) => total + weight) - 1) < 1e-6);
  assert.ok(paint.sand >= 0 && paint.sand <= 1);
 }
});

test('unpainted regions are drawn from the seed, repeatably, and wander moves the borders', () => {
 const auto = map(new Array(9).fill(WORLD_MAP_AUTO));
 const a = createTerrainWorld({seed: SEED, biomes: biomes(), map: auto, regionSize: SIZE});
 const b = createTerrainWorld({seed: SEED, biomes: biomes(), regionSize: SIZE});
 const used = new Set();
 for (let column = -6; column <= 6; column++) for (let row = -6; row <= 6; row++) {
  assert.equal(a.regionBiome(column, row), b.regionBiome(column, row));
  used.add(a.regionBiome(column, row));
 }
 assert.equal(used.size, 3);
 const straight = createTerrainWorld({seed: SEED, biomes: biomes(), regionSize: SIZE, wander: 0});
 let moved = 0;
 for (let z = 0; z < 400; z += 10) moved += Math.abs(straight.weightsAt(100, z)[0] - b.weightsAt(100, z)[0]) > .05;
 assert.ok(moved > 5);
});

test('a terrain field paints the stitched layers of a world', () => {
 const list = [cloneBiome('plains'), cloneBiome('desert')], cells = [0, 0, 0, 0, 0, 1, 0, 0, 0];
 const world = createTerrainWorld({seed: SEED, biomes: list, map: map(cells), regionSize: SIZE, wander: 0});
 const n = 41, heights = Float32Array.from({length: n * n}, (_, i) => world.heightAt(i % n * 5, Math.floor(i / n) * 5));
 const field = createTerrainField({origin: [0, 0], size: [200, 200], resolution: [n, n], heights, seed: SEED, paintAt: world.paintAt, rules: list[0].paint});
 assert.ok(field.sandWeightAt(50, 50) < .05);
 assert.ok(field.sandWeightAt(150, 50) > .9);
 field.dispose();
});

test('the world palette lists each texture set once per role and paints one weight per set', () => {
 const plains = cloneBiome('plains'), desert = cloneBiome('desert');
 const world = createTerrainWorld({seed: SEED, biomes: [plains, desert], map: map([0, 0, 0, 0, 0, 1, 0, 0, 0]), regionSize: SIZE, wander: 0});
 const {sets, roles, size} = world.palette;
 // Seven roles for plains; desert changes grass and rock and shares the rest.
 assert.equal(sets.length, 9);
 assert.equal(size, 12);
 assert.deepEqual(roles.slice(0, 7), TERRAIN_PALETTE_ROLES);
 assert.deepEqual(roles.slice(0, 5), TERRAIN_LAYERS);
 assert.equal(sets[roles.lastIndexOf('grass')], desert.textures.grass);
 const at = x => [...world.paintAt({x, z: 50, height: 0, slope: 0, curvature: 0}).palette];
 const plainsGrass = sets.indexOf(plains.textures.grass), desertGrass = sets.indexOf(desert.textures.grass);
 assert.ok(at(50)[desertGrass] === 0 && at(150)[plainsGrass] === 0);
 for (const x of [50, 100, 150]) {
  const paint = world.paintAt({x, z: 50, height: 0, slope: 0, curvature: 0});
  assert.ok(Math.abs(paint.palette.reduce((sum, weight) => sum + weight) - 1) < 1e-6);
  assert.ok(Math.abs(paint.layers.reduce((sum, weight) => sum + weight) - 1) < 1e-6);
  assert.ok(paint.moisture >= 0 && paint.moisture <= 1);
 }
 const border = at(100);
 assert.ok(border[plainsGrass] > 0 || border[desertGrass] > 0 || border.some(weight => weight > 0));
 // Too many different sets for one world is refused by name.
 const ids = ['sparse_grass', 'rock_wall_02', 'snow_02', 'brown_mud', 'mud_forest', 'grass_ground', 'aerial_grass_rock', 'aerial_rocks_02', 'mossy_rock', 'dry_ground_rocks', 'gravelly_sand', 'brown_mud_03', 'forest_leaves_03'];
 const many = Array.from({length: 4}, (_, index) => {
  const biome = cloneBiome('plains');
  TERRAIN_LAYERS.forEach((layer, slot) => { biome.textures[layer] = ids[(index * 5 + slot) % ids.length]; });
  return biome;
 });
 assert.throws(() => createTerrainWorld({seed: SEED, biomes: many}), new RegExp(`at most ${WORLD_PALETTE_MAX} texture sets`));
});

test('a world measures the terrain signals its rules paint from', () => {
 const world = createTerrainWorld({seed: SEED, biomes: [cloneBiome('hills')]});
 assert.deepEqual(world.paintReach, PAINT_REACH);
 const sample = world.sampleAt(12, -30);
 assert.equal(sample.height, world.heightAt(12, -30));
 assert.ok(Math.abs(sample.slope - Math.hypot(sample.dx, sample.dz)) < 1e-12);
 assert.equal(sample.hollow, world.hollowAt(12, -30));
 // A point in a pit lies below its surroundings, a point on a bump above.
 const flat = cloneBiome('plains');
 flat.relief = [{shape: 'base', height: 10}, {shape: 'island', inner: 5, outer: 20, sink: 0}];
 const bump = createTerrainWorld({seed: SEED, biomes: [flat]});
 assert.ok(bump.hollowAt(0, 0) < -5);
 assert.ok(bump.paintAt(bump.sampleAt(0, 0)).moisture < bump.paintAt(bump.sampleAt(200, 200)).moisture);
});
