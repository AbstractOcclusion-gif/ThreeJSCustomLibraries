import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneBiome, createCorridor, createRelief, createTerrainWorld, CORRIDOR_DEFAULTS, validateBiome} from '../../src/terrain/index.js';

const SEED = 11;
const biomes = () => [cloneBiome('plains'), cloneBiome('mountains'), cloneBiome('desert')];
const build = (corridor = {}, list = biomes()) => createTerrainWorld({seed: SEED, biomes: list, corridor});

test('a corridor validates its settings, its sections and the biomes that may follow one another', () => {
 assert.throws(() => build({width: 0}), /width/);
 assert.throws(() => build({sectionMin: 500, sectionMax: 300}), /longest stretch/);
 assert.throws(() => build({sectionBlend: 400}), /biome blend/);
 assert.throws(() => build({sections: []}), /sections/);
 assert.throws(() => build({sections: [{biome: 5}]}), /names no biome/);
 assert.throws(() => build({sections: [{biome: 0, length: 10}]}), /at least as long/);
 assert.throws(() => createTerrainWorld({seed: SEED, biomes: biomes(), corridor: true}), TypeError);
 assert.throws(() => createTerrainWorld({seed: SEED, biomes: biomes(), corridor: {}, map: {columns: 1, rows: 1, cells: [0]}}), /no map/);
 const list = biomes();
 list[0].next = ['moon'];
 assert.throws(() => build({}, list), /unknown biome: moon/);
 assert.throws(() => validateBiome({...list[0], next: []}), /next biomes/);
 list[0].next = ['plains']; list[0].weight = 0; list[1].next = ['plains'];
 assert.throws(() => build({}, list), /mountains can be followed by no biome/);
 assert.equal(build().corridor.length, null);
 assert.equal(build({length: 900}).corridor.length, 900);
 assert.equal(createTerrainWorld({seed: SEED, biomes: biomes()}).corridor, null);
 assert.equal(CORRIDOR_DEFAULTS.length, 0);
});

test('the floor follows the route, keeps little relief, and the sides rise by the wall', () => {
 const settings = {width: 30, shoulder: 40, wall: 50, floor: 2, floorRelief: 0, bend: 60, bendScale: 200}, world = build(settings);
 const open = createTerrainWorld({seed: SEED, biomes: biomes(), corridor: {...settings, wall: 0}});
 let strayed = 0;
 for (let z = -3000; z <= 3000; z += 37) {
  const x = world.routeX(z);
  strayed = Math.max(strayed, Math.abs(x));
  assert.ok(Math.abs(x) <= 60);
  // On the floor: flat at its height, where the ground was above it.
  for (const offset of [-14, 0, 14]) assert.ok(world.heightAt(x + offset, z) <= 2 + 1e-9);
  // Beyond the sides: the ground of the biomes, raised by the wall.
  assert.ok(Math.abs(world.heightAt(x + 200, z) - open.heightAt(x + 200, z) - 50) < 1e-6);
  assert.ok(world.heightAt(x + 60, z) > world.heightAt(x + 14, z));
 }
 assert.ok(strayed > 25, 'the route bends');
 // floorRelief 1 and no wall leave the ground as the biomes made it.
 const untouched = build({floorRelief: 1, wall: 0}), plain = createRelief(SEED, cloneBiome('plains').relief, {route: untouched.routeX});
 const only = createTerrainWorld({seed: SEED, biomes: [cloneBiome('plains')], corridor: {floorRelief: 1, wall: 0}});
 assert.equal(only.heightAt(12, 345), plain.heightAt(12, 345));
});

test('valleys and rivers of the biomes follow the corridor, and water carved below the floor is kept', () => {
 const world = createTerrainWorld({seed: SEED, biomes: [cloneBiome('valley')], corridor: {bend: 120, bendScale: 300, floor: 0}});
 let beside = 0;
 for (let z = -900; z <= 900; z += 90) {
  const x = world.routeX(z);
  assert.ok(world.heightAt(x, z) < -1, 'the river bed lies on the route');
  beside += world.heightAt(x + 15, z) / 21;
 }
 assert.ok(beside > -.6, 'and not beside it');
});

test('biomes follow one another in sections of drawn length, blended, the same every time and both ways', () => {
 const settings = {sectionMin: 200, sectionMax: 500, sectionBlend: 60}, a = build(settings).corridor, b = build(settings).corridor;
 const seen = new Set();
 let z = -20000, sectionsSeen = 0;
 while (z < 20000) {
  const {index, biome, start, end} = a.sectionAt(z);
  assert.ok(z >= start - 1e-6 && z <= end + 1e-6);
  assert.ok(end - start >= 200 - 1e-6 && end - start <= 500 + 1e-6);
  assert.equal(b.sectionAt(z).biome, biome);
  assert.equal(b.sectionAt(z).index, index);
  seen.add(biome); sectionsSeen++;
  // In the middle the biome is alone; at the join it shares half with its neighbour.
  assert.equal(a.weightsAt((start + end) / 2)[biome], 1);
  const join = a.weightsAt(end), after = a.sectionAt(end + 1).biome;
  assert.ok(Math.abs(join.reduce((sum, share) => sum + share) - 1) < 1e-6);
  if (after !== biome) assert.ok(Math.abs(join[biome] - .5) < 1e-3 && Math.abs(join[after] - .5) < 1e-3);
  z = end + 1;
 }
 assert.equal(seen.size, 3);
 assert.ok(sectionsSeen > 80);
 assert.equal(a.sectionAt(0).index, 0);
 assert.equal(a.sectionAt(-1).index, -1);
 // Far away first, then near: the answer does not depend on the order of the questions.
 const fresh = build(settings).corridor, far = fresh.sectionAt(15000).biome;
 assert.equal(far, a.sectionAt(15000).biome);
 assert.equal(fresh.sectionAt(-7000).biome, a.sectionAt(-7000).biome);
});

test('sections obey the rules: weights, what may follow what, or a fixed order', () => {
 const order = (corridor, from, to) => { const list = []; for (let z = from; z < to;) { const section = corridor.sectionAt(z); list.push(section.biome); z = section.end + 1; } return list; };
 const list = biomes();
 list[0].next = ['mountains']; list[1].next = ['desert', 'plains']; list[2].next = ['plains'];   // no mountains after desert, no desert after plains
 const ruled = order(build({}, list).corridor, -30000, 30000);
 for (let i = 1; i < ruled.length; i++) {
  const allowed = list[ruled[i - 1]].next.map(id => list.findIndex(biome => biome.id === id));
  assert.ok(allowed.includes(ruled[i]), `${ruled[i - 1]} then ${ruled[i]}`);
 }
 assert.equal(new Set(ruled).size, 3);
 const weighted = biomes();
 weighted[1].weight = 0; weighted[2].weight = 4;
 const drawn = order(build({}, weighted).corridor, 0, 200000), tally = [0, 1, 2].map(index => drawn.filter(biome => biome === index).length);
 assert.equal(tally[1], 0);
 assert.ok(tally[2] / tally[0] > 3 && tally[2] / tally[0] < 5.2, tally.join());
 // A fixed order repeats along the route; a length given is kept.
 const fixed = build({sections: [{biome: 2, length: 250}, {biome: 0}, {biome: 1, length: 400}]}).corridor;
 assert.deepEqual(order(fixed, 0, 3000).slice(0, 7), [2, 0, 1, 2, 0, 1, 2]);
 assert.deepEqual(order(fixed, -2000, -1).slice(-3), [2, 0, 1]);
 assert.equal(fixed.sectionAt(100).end, 250);
});

test('a corridor with a length and walls is closed at both ends; without walls it stays open', () => {
 const settings = {length: 1000, endRamp: 100, wall: 60, width: 30, shoulder: 40, floorRelief: 0, floor: 0, bend: 0};
 const world = createTerrainWorld({seed: SEED, biomes: [cloneBiome('plains')], corridor: settings});
 const side = z => world.heightAt(300, z);
 for (const z of [-50, 0, 1000, 1200]) assert.ok(Math.abs(world.heightAt(0, z) - (world.heightAt(300, z))) < 12, 'the end stands as high as the sides');
 assert.ok(world.heightAt(0, 500) <= 1e-9 && side(500) > 55);
 assert.ok(world.heightAt(0, 50) > world.heightAt(0, 120));
 const open = createTerrainWorld({seed: SEED, biomes: [cloneBiome('plains')], corridor: {...settings, wall: 0}});
 assert.ok(open.heightAt(0, -50) <= 1e-9);
});
