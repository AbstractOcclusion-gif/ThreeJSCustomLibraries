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
 const a = createTerrainWorld({seed: SEED, biomes: biomes(), map: auto, regionSize: SIZE, climate: false});
 const b = createTerrainWorld({seed: SEED, biomes: biomes(), regionSize: SIZE, climate: false});
 const used = new Set();
 for (let column = -6; column <= 6; column++) for (let row = -6; row <= 6; row++) {
  assert.equal(a.regionBiome(column, row), b.regionBiome(column, row));
  used.add(a.regionBiome(column, row));
 }
 assert.equal(used.size, 3);
 const straight = createTerrainWorld({seed: SEED, biomes: biomes(), regionSize: SIZE, wander: 0, climate: false});
 let moved = 0;
 for (let z = 0; z < 400; z += 10) moved += Math.abs(straight.weightsAt(100, z)[0] - b.weightsAt(100, z)[0]) > .05;
 assert.ok(moved > 5);
});

test('regions are drawn by weight, and by the climate the biomes live in', () => {
 const count = (world, reach = 20) => {
  const tally = new Array(world.biomes.length).fill(0);
  for (let column = -reach; column <= reach; column++) for (let row = -reach; row <= reach; row++) tally[world.regionBiome(column, row)]++;
  return tally;
 };
 // Weights: a biome three times as common takes about three times the regions; weight 0 only where painted.
 const weighted = biomes();
 weighted[0].weight = 3; weighted[2].weight = 0;
 const cells = new Array(9).fill(WORLD_MAP_AUTO); cells[4] = 2;
 const byWeight = createTerrainWorld({seed: SEED, biomes: weighted, regionSize: SIZE, climate: false, map: map(cells)});
 const [plains, mountains, desert] = count(byWeight);
 assert.ok(plains / mountains > 2.4 && plains / mountains < 3.6, `${plains} : ${mountains}`);
 assert.equal(desert, 1);
 assert.equal(byWeight.regionBiome(0, 0), 2);
 assert.throws(() => createTerrainWorld({seed: SEED, biomes: weighted.map(biome => ({...biome, weight: 0}))}), /weight/);
 // Climate: each region takes a biome that lives in its climate, or the nearest one.
 const hot = (x, z) => ({temperature: x > 0 ? .95 : .05, moisture: .1});
 const byClimate = createTerrainWorld({seed: SEED, biomes: biomes(), regionSize: SIZE, climateAt: hot});
 for (let row = -8; row <= 8; row++) {
  assert.equal(byClimate.regionBiome(3, row), 2, 'hot and dry: desert');
  assert.equal(byClimate.regionBiome(-3, row), 1, 'cold: mountains, the nearest');
 }
 assert.deepEqual(byClimate.climateAt(50, 0), {temperature: .95, moisture: .1});
 // A biome without a climate lives anywhere, and climate: false ignores them all.
 const anywhere = biomes(); delete anywhere[0].climate;
 const mixed = count(createTerrainWorld({seed: SEED, biomes: anywhere, regionSize: SIZE, climateAt: hot}));
 assert.ok(mixed[0] > mixed[2] && mixed[2] > 0, 'it takes the cold side alone and shares the hot side with the desert');
 assert.equal(mixed[1], 0, 'mountains fit nowhere better than it does');
 assert.ok(count(createTerrainWorld({seed: SEED, biomes: biomes(), regionSize: SIZE, climateAt: hot, climate: false})).every(regions => regions > 300));
 assert.throws(() => createTerrainWorld({seed: SEED, biomes: biomes(), climateAt: 3}), TypeError);
 assert.throws(() => createTerrainWorld({seed: SEED, biomes: biomes(), climateAt: () => ({temperature: 2, moisture: 0})}).regionBiome(9, 9), /temperature/);
 // The world's own climate reaches both ends and changes slowly: neighbouring regions mostly share a biome.
 const own = createTerrainWorld({seed: SEED, biomes: biomes(), regionSize: SIZE});
 let low = 1, high = 0, same = 0, pairs = 0;
 for (let x = -20000; x <= 20000; x += 500) for (let z = -20000; z <= 20000; z += 500) {
  const {temperature} = own.climateAt(x, z);
  low = Math.min(low, temperature); high = Math.max(high, temperature);
 }
 assert.ok(low < .05 && high > .95);
 for (let column = -20; column < 20; column++) for (let row = -20; row <= 20; row++) { pairs++; same += own.regionBiome(column, row) === own.regionBiome(column + 1, row); }
 assert.ok(same / pairs > .6, `${same} of ${pairs}`);
 assert.ok(count(own).every(regions => regions > 0));
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

test('a world with water paints banks and beds below its water level and none when dry', () => {
 const valley = cloneBiome('valley');
 const wet = createTerrainWorld({seed: SEED, biomes: [valley], water: true, waterLevel: -.5});
 const dry = createTerrainWorld({seed: SEED, biomes: [valley]});
 assert.equal(wet.waterLevel, -.5);
 assert.equal(dry.waterLevel, null);
 assert.throws(() => createTerrainWorld({seed: SEED, biomes: [valley], waterLevel: 999}), /waterLevel/);
 const x = wet.routeX(40), sample = wet.sampleAt(x, 40);
 assert.ok(sample.height < -.5, 'the river bed lies under the water');
 const scree = wet.palette.roles.indexOf('scree'), grass = wet.palette.roles.indexOf('grass');
 assert.ok(wet.paintAt(wet.sampleAt(x, 40)).palette[scree] > .3);
 assert.ok(dry.paintAt(dry.sampleAt(x, 40)).palette[scree] < .1);
 assert.equal(wet.paintAt(wet.sampleAt(x, 40)).palette[grass], 0);
});

test('a terrain field keeps the palette weights and moisture a world paints', () => {
 const world = createTerrainWorld({seed: SEED, biomes: [cloneBiome('plains'), cloneBiome('desert')], map: map([0, 0, 0, 0, 0, 1, 0, 0, 0]), regionSize: SIZE, wander: 0});
 const n = 21, heights = Float32Array.from({length: n * n}, (_, i) => world.heightAt(i % n * 10, Math.floor(i / n) * 10));
 const options = {origin: [0, 0], size: [200, 200], resolution: [n, n], heights, seed: SEED, rules: world.biomes[0].paint};
 assert.throws(() => createTerrainField({...options, paletteSize: world.palette.size}), /paintAt/);
 assert.throws(() => createTerrainField({...options, paintAt: world.paintAt, paletteSize: 6}), /fours/);
 assert.throws(() => createTerrainField({...options, paintAt: sample => ({layers: [1, 0, 0, 0, 0], sand: 0}), paletteSize: 4}), /palette weight/);
 const field = createTerrainField({...options, paintAt: sample => world.paintAt(world.sampleAt(sample.x, sample.z)), paletteSize: world.palette.size});
 assert.equal(field.paletteMap.image.depth, world.palette.size / 4);
 const count = n * n, data = field.paletteMap.image.data, index = 5 * n + 5;   // (50, 50): the plains region
 let total = 0;
 for (let slot = 0; slot < world.palette.size; slot++) total += data[(Math.floor(slot / 4) * count + index) * 4 + slot % 4];
 assert.ok(Math.abs(total - 255) <= world.palette.size);
 const expected = world.paintAt(world.sampleAt(50, 50));
 assert.equal(field.climateMap.image.data[index], Math.round(expected.moisture * 255));
 assert.equal(createTerrainField(options).paletteMap, null);
 field.dispose();
});
