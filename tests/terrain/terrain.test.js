import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTerrainDrainage, createTerrainField, createTerrainRunoff, valueNoise, OceanCoastTerrain} from '../../src/terrain/index.js';
import {createLighting} from '../../src/core/lighting.js';

test('terrain field validates its inputs, samples heights inside its bounds and disposes', () => {
 const nx = 9, nz = 9, heights = new Float32Array(nx * nz).map((_, i) => (i % nx) * .5);
 assert.throws(() => createTerrainField({size: [8, 8], resolution: [1, 9], heights}), /./);
 const field = createTerrainField({origin: [0, 0], size: [8, 8], resolution: [nx, nz], heights, seed: 3});
 assert.ok(field.geometry.attributes.position && field.heightMap && field.weightMap);
 assert.ok(Math.abs(field.heightAt(0, 0) - 0) < 1e-6);
 assert.ok(field.heightAt(8, 4) > field.heightAt(0, 4));
 field.dispose();
 const noise = valueNoise(7);
 assert.equal(noise(1.5, 2.5), valueNoise(7)(1.5, 2.5));
 assert.ok(Math.abs(noise(.3, .7)) <= 1);
});

test('sand lies below its altitude, is off unless enabled and cannot be configured on a field without it', () => {
 const nx = 9, nz = 9, heights = new Float32Array(nx * nz).map((_, i) => (i % nx) * .5);
 const plain = createTerrainField({origin: [0, 0], size: [8, 8], resolution: [nx, nz], heights, seed: 3});
 assert.equal(plain.sandMap, null);
 assert.equal(plain.sandWeightAt(0, 4), 0);
 assert.throws(() => plain.updateRules({sandBelow: 2}), /sand/);
 plain.dispose();
 const field = createTerrainField({origin: [0, 0], size: [8, 8], resolution: [nx, nz], heights, seed: 3, rules: {sandBelow: 2, sandBlend: .2, rockSlope: 1.8}});
 assert.ok(field.sandMap);
 assert.ok(field.sandWeightAt(0, 4) > .95);
 assert.equal(field.sandWeightAt(8, 4), 0);
 field.updateRules({sandBelow: -5, sandBlend: .2, rockSlope: 1.8});
 assert.equal(field.sandWeightAt(0, 4), 0);
 field.dispose();
});

test('digging bare soil pushes a share of it up into a rim and validates the share', () => {
 const nx = 33, nz = 33, heights = new Float32Array(nx * nz);
 const field = createTerrainField({origin: [0, 0], size: [8, 8], resolution: [nx, nz], heights, seed: 3});
 assert.throws(() => field.deform(4, 4, 1, .1, undefined, {rimShare: 2}), /rim share/);
 field.deform(2, 2, 1, .1);
 assert.ok(field.heightAt(2, 2) < -.09);
 assert.equal(field.heightAt(3, 2), 0);
 field.deform(6, 6, 1, .1, undefined, {rimShare: .6});
 assert.ok(field.heightAt(6, 6) < -.09);
 assert.ok(field.heightAt(7, 6) > 0 && field.heightAt(7, 6) <= .1);
 field.dispose();
});

test('a crater digs a bowl in the outline of the object, piles a rim, deepens up to its limit and blows snow out', () => {
 const nx = 81, nz = 81, heights = new Float32Array(nx * nz);
 const field = createTerrainField({origin: [0, 0], size: [40, 40], resolution: [nx, nz], heights, seed: 3, crater: {depthLimit: 3, ragged: 0}});
 assert.ok(field.geometry.boundingBox.min.y <= -3);
 assert.equal(field.crater(10, 10, 2, 0), null);
 assert.throws(() => field.crater(10, 10, {halfX: 0, halfZ: 1}, 1), /footprint/);
 const round = field.crater(10, 10, 3, 1.5);
 assert.ok(Math.abs(field.heightAt(10, 10) + 1.5) < 1e-4);
 assert.ok(field.heightAt(13.2, 10) > 0, 'rim stands above the ground');
 assert.ok(round.volume > 0 && Math.abs(round.rim + round.ejecta - round.volume) < 1e-6 && round.rim > 0);
 field.crater(10, 10, 3, 1.5); field.crater(10, 10, 3, 1.5);
 assert.ok(Math.abs(field.heightAt(10, 10) + 3) < 1e-4, 'stops at the depth limit');
 // A box long along its own X, turned 90 degrees: its long side lies along world Z; flat floor.
 field.crater(28, 28, {halfX: 4, halfZ: 1, yaw: Math.PI / 2, squareness: 1}, 1);
 assert.ok(field.heightAt(28, 31) < -.85 && field.heightAt(30.5, 28) >= 0, 'outline follows the yaw');
 assert.ok(Math.abs(field.heightAt(28, 29.5) - field.heightAt(28, 28)) < .05, 'square footprint has a flat floor');
 field.resetDeformation();
 field.setSnowCover(true);
 const before = field.heightAt(28, 10);
 field.crater(28, 10, 2, .5);
 assert.ok(field.heightAt(28, 10) < before - .5 - .05, 'snow blown out of the bowl as well as soil dug');
 field.dispose();
});

test('terrain material takes per-layer detail only with one slice per packed layer', async () => {
 const {createTerrainMaterial, TERRAIN_LAYERS, TERRAIN_LAYER_ROUGHNESS} = await import('../../src/terrain/index.js');
 assert.deepEqual(Object.keys(TERRAIN_LAYER_ROUGHNESS), TERRAIN_LAYERS);
 const nx = 5, nz = 5, field = createTerrainField({origin: [0, 0], size: [4, 4], resolution: [nx, nz], heights: new Float32Array(nx * nz), seed: 3});
 const array = depth => new THREE.DataArrayTexture(new Uint8Array(4 * depth), 1, 1, depth);
 const layerArray = array(TERRAIN_LAYERS.length), detailNormal = new THREE.DataTexture(new Uint8Array(4), 1, 1);
 const plain = createTerrainMaterial({}, {field, layerArray, detailNormal});
 assert.equal(plain.defines.TERRAIN_LAYER_DETAIL, undefined);
 const detailed = createTerrainMaterial({}, {field, layerArray, layerDetailArray: array(TERRAIN_LAYERS.length), detailNormal});
 assert.equal(detailed.defines.TERRAIN_LAYER_DETAIL, 1);
 assert.throws(() => createTerrainMaterial({}, {field, layerArray, layerDetailArray: array(2), detailNormal}), /one slice per layer/);
 plain.dispose(); detailed.dispose(); field.dispose();
});

test('the paint rules put rock on steep ground, snow above its line, mud in basins and forest by its coverage', async () => {
 const {createTerrainRules} = await import('../../src/terrain/index.js');
 const rules = createTerrainRules(1, {mudFromRunout: false, forestCover: .5});
 const mean = (rule, sample, count = 900) => {
  const total = [0, 0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
   const weights = rule.weights({x: (i % 30) * 5.3, z: Math.floor(i / 30) * 4.1, ...sample});
   assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight) - 1) < 1e-9);
   weights.forEach((weight, layer) => { total[layer] += weight / count; });
  }
  return total;
 };
 const [GRASS, ROCK, SNOW, MUD, FOREST] = [0, 1, 2, 3, 4];
 assert.ok(mean(rules, {height: 50, slope: 1.6})[ROCK] > .99);
 assert.ok(mean(rules, {height: 50, slope: 0})[ROCK] < .01);
 assert.ok(mean(rules, {height: 50, slope: 0, wall: 1.5})[ROCK] > .99);
 assert.ok(mean(rules, {height: 200, slope: 0})[SNOW] > .99);
 assert.ok(Math.abs(mean(rules, {height: 150, slope: 0})[SNOW] - .5) < .1);
 assert.ok(mean(rules, {height: -12, slope: 0})[MUD] > .99);
 const atMudLine = mean(createTerrainRules(1, {mudFromRunout: false, mudBelow: 0}), {height: 0, slope: 0}, 3600)[MUD];
 assert.ok(atMudLine > .25 && atMudLine < .75, 'moisture decides around the mud line');
 assert.ok(mean(rules, {height: 50, slope: 0})[MUD] < .01);
 assert.equal(mean(createTerrainRules(1, {}), {height: -3, slope: 0})[MUD], 0);
 // Forest floor grows with its coverage, lies in woodlands with clearings, and stops on steep ground and at the tree line.
 const shares = [.05, .3, .5, .7, .95].map(forestCover => mean(createTerrainRules(1, {forestCover}), {height: 50, slope: 0}, 3600)[FOREST]);
 assert.ok(shares[0] < .03 && shares.at(-1) > .6);
 for (let i = 1; i < shares.length; i++) assert.ok(shares[i] > shares[i - 1]);
 assert.ok(shares[2] > .2 && shares[2] < .6, 'half coverage gives woodland over a good part of the ground');
 const flat = mean(rules, {height: 50, slope: 0}, 3600);
 assert.ok(Math.abs(flat[FOREST] + flat[GRASS] - 1) < .01);
 assert.ok(mean(rules, {height: 50, slope: .95}, 3600)[FOREST] < .01);
 const treeLine = createTerrainRules(1, {mudFromRunout: false, forestCover: .9, treeLine: 60, treeBlend: 5, snowJitter: 0});
 assert.ok(mean(treeLine, {height: 40, slope: 0})[FOREST] > .4 && mean(treeLine, {height: 80, slope: 0})[FOREST] === 0);
 // Mud needs flat ground as well as low ground.
 assert.ok(mean(rules, {height: -30, slope: .6})[MUD] < .01);
});

test('terrain material in palette mode needs the palette map and one layer slice per set', async () => {
 const {createTerrainMaterial} = await import('../../src/terrain/index.js');
 const array = depth => new THREE.DataArrayTexture(new Uint8Array(4 * depth), 1, 1, depth);
 const detailNormal = new THREE.DataTexture(new Uint8Array(4), 1, 1), heightMap = new THREE.DataTexture(new Float32Array(1), 1, 1);
 const palette = {size: 8, roles: ['grass', 'rock', 'snow', 'mud', 'forest', 'grass'], sets: []};
 const field = {heightMap, bounds: new THREE.Vector4(0, 0, 1, 1), paletteMap: array(2)};
 const material = createTerrainMaterial({}, {field, palette, layerArray: array(6), detailNormal});
 assert.equal(material.defines.TERRAIN_PALETTE_SIZE, 8);
 assert.equal(material.defines.TERRAIN_FOREST_FLOOR, undefined);
 assert.throws(() => createTerrainMaterial({}, {field: {...field, paletteMap: array(1)}, palette, layerArray: array(6), detailNormal}), /palette map/);
 assert.throws(() => createTerrainMaterial({}, {field, palette, layerArray: array(5), detailNormal}), /one layer array slice per set/);
 assert.throws(() => createTerrainMaterial({}, {field, palette: {...palette, roles: ['lava']}, layerArray: array(6), detailNormal}), /roles/);
 assert.throws(() => createTerrainMaterial({}, {field, palette: {...palette, means: [new THREE.Color()]}, layerArray: array(6), detailNormal}), /one colour per set/);
 const harmonised = createTerrainMaterial({}, {field, palette: {...palette, means: palette.roles.map(() => new THREE.Color(.2, .15, .1))}, layerArray: array(6), detailNormal});
 harmonised.dispose();
 material.dispose();
});

test('the rules paint scree under rock, bare soil on dry ridges, mud in wet hollows and keep snow lower in shade', async () => {
 const {createTerrainRules, TERRAIN_PALETTE_ROLES} = await import('../../src/terrain/index.js');
 const rules = createTerrainRules(1, {mudFromRunout: false, forestCover: .5, mudBelow: 0});
 const role = name => TERRAIN_PALETTE_ROLES.indexOf(name);
 const mean = (sample, count = 1600) => {
  const total = new Array(TERRAIN_PALETTE_ROLES.length + 1).fill(0);
  for (let i = 0; i < count; i++) {
   const {roles, moisture} = rules.paint({x: (i % 40) * 7.1, z: Math.floor(i / 40) * 6.3, height: 20, slope: 0, ...sample});
   assert.ok(Math.abs(roles.reduce((sum, weight) => sum + weight) - 1) < 1e-9 && roles.every(weight => weight >= -1e-12));
   roles.forEach((weight, index) => { total[index] += weight / count; });
   total[roles.length] += moisture / count;
  }
  return total;
 };
 const MOISTURE = TERRAIN_PALETTE_ROLES.length;
 const even = mean({}), hollow = mean({hollow: 4}), ridge = mean({hollow: -4});
 assert.ok(ridge[MOISTURE] < even[MOISTURE] && even[MOISTURE] < hollow[MOISTURE]);
 assert.ok(ridge[role('soil')] > .2 && hollow[role('soil')] < .02);
 assert.ok(hollow[role('forest')] > ridge[role('forest')]);
 assert.ok(mean({slope: .75})[role('scree')] > .2 && even[role('scree')] === 0);
 assert.ok(mean({slope: .5, hollow: -4})[role('rock')] > mean({slope: .5})[role('rock')] - 1e-9);
 assert.ok(mean({height: -8, hollow: 4})[role('mud')] > .9 && mean({height: -8, hollow: -4})[role('mud')] < .1);
 const shaded = mean({height: 145, dx: Math.cos(150 * Math.PI / 180) * .4, dz: Math.sin(150 * Math.PI / 180) * .4});
 const sunny = mean({height: 145, dx: -Math.cos(150 * Math.PI / 180) * .4, dz: -Math.sin(150 * Math.PI / 180) * .4});
 assert.ok(shaded[role('snow')] > sunny[role('snow')] + .1);
 // Standing water: wet earth on the bank, gravel on the bed, lush ground just above, and none of it without water.
 const dry = mean({}), bank = mean({water: -.05}), bed = mean({water: 1}), above = mean({water: -2});
 assert.ok(bank[role('mud')] > .7 && bank[role('grass')] < .2);
 assert.ok(bed[role('scree')] > .5 && bed[role('mud')] > .3 && bed[role('grass')] === 0);
 assert.ok(above[MOISTURE] > dry[MOISTURE] && above[role('grass')] + above[role('forest')] > .9);
 assert.equal(mean({water: -30})[role('mud')], dry[role('mud')]);
 assert.ok(mean({water: 1, slope: 1.6})[role('rock')] > .99);
 // The layers alone leave scree and soil out.
 assert.equal(rules.weights({x: 3, z: 4, height: 20, slope: .75}).length, 5);
});

test('ocean coast terrain builds on the lighting hook and shares its uniforms', () => {
 const scene = new THREE.Scene(), lighting = createLighting();
 const coast = new OceanCoastTerrain({scene, settings: {centerZ: -220}, lighting});
 assert.equal(coast.material.uniforms.uSunDir, lighting.uniforms.uSunDir);
 assert.ok(coast.material.fragmentShader.includes('applyFog('));
 assert.ok(!('uSkyCol' in coast.material.uniforms));
 coast.update({sunDirection: new THREE.Vector3(0, 1, 0)});
 assert.equal(lighting.uniforms.uSunDir.value.y, 1);
 assert.ok(Number.isFinite(coast.heightAt(0, -220)));
 coast.dispose();
 assert.equal(scene.children.length, 0);
});

test('terrain drainage follows slope, fills a one-cell basin and drains open edges', () => {
 const resolution = 7, extent = resolution - 1;
 const heights = Float32Array.from({length: resolution ** 2}, (_, index) => index % resolution);
 const indexAt = (x, z) => z * resolution + x;
 const basin = indexAt(4, 3);
 heights[basin] = 2;
 const field = createTerrainField({size: [extent, extent], resolution: [resolution, resolution], heights});
 const drainage = createTerrainDrainage(field, {maxPuddleDepth: 2});
 try {
  const data = drainage.texture.image.data;
  const sample = (x, z) => Array.from(data.subarray(indexAt(x, z) * 4, (indexAt(x, z) + 1) * 4));
  assert.deepEqual(sample(2, 3), [-1, 0, 2, 2]);
  assert.deepEqual(sample(0, 3).slice(2), [0, 0]);
  assert.deepEqual(sample(4, 3).slice(2), [2, 3]);
  assert.ok(field.deform(4, 3, .4, .25) > 0);
  field.flushDeformation();
  drainage.rebuild();
  assert.deepEqual(sample(4, 3).slice(2), [1.75, 3]);
  field.resetDeformation();
  drainage.rebuild();
  assert.deepEqual(sample(4, 3).slice(2), [2, 3]);
 } finally {
  drainage.dispose();
  field.dispose();
 }
});

test('the runoff flow texture points downhill, scales with the slope and follows how soaked the ground is', () => {
 const extent = 32, resolution = 33;
 function flowOnSlope(slope) {
  const heights = Float32Array.from({length: resolution ** 2}, (_, index) => (index % resolution) * slope);
  const field = createTerrainField({size: [extent, extent], resolution: [resolution, resolution], heights});
  const drainage = createTerrainDrainage(field);
  const runoff = createTerrainRunoff({field, drainage});
  try {
   const texel = (16 * resolution + 16) * 4;
   const data = runoff.texture.image.data;
   const [gradeX, gradeZ, area] = [0, 1, 2].map(channel => THREE.DataUtils.fromHalfFloat(data[texel + channel]));
   assert.ok(gradeX < 0 && Math.abs(gradeZ) < 1e-3);
   assert.ok(area > 1);
   assert.equal(runoff.coverage.value, 0);
   runoff.update(1 / 60, {amount: 1, wetness: 1});
   assert.equal(runoff.coverage.value, 1);
   runoff.update(1 / 60, {amount: .5, wetness: 0});
   assert.equal(runoff.coverage.value, 0);
   assert.throws(() => runoff.update(-1, {amount: 1, wetness: 1}), /./);
   return -gradeX;
  } finally {
   runoff.dispose();
   drainage.dispose();
   field.dispose();
  }
 }
 assert.ok(flowOnSlope(.5) > flowOnSlope(.25));
});

test('the baked runoff network merges tributaries and carries their contributing area downstream', () => {
 const resolution = 5;
 const indexAt = (x, z) => z * resolution + x;
 const heights = new Float32Array(resolution ** 2).fill(9);
 const left = indexAt(1, 2), right = indexAt(3, 2), junction = indexAt(2, 2);
 const lower = indexAt(2, 3), outlet = indexAt(2, 4);
 heights[left] = heights[right] = 5;
 heights[junction] = 2;
 heights[lower] = 1;
 heights[outlet] = 0;
 const field = createTerrainField({size: [4, 4], resolution: [resolution, resolution], heights});
 const drainage = createTerrainDrainage(field);
 try {
  const {receiver, area} = drainage.bakeFlow();
  assert.equal(receiver[left], junction);
  assert.equal(receiver[right], junction);
  assert.equal(receiver[junction], lower);
  assert.equal(receiver[lower], outlet);
  // Each tributary shares its water between the junction and the cell below it; all of it has merged one step down.
  assert.ok(area[junction] > area[left]);
  assert.ok(area[lower] > area[left] + area[right]);
  assert.ok(area[outlet] > area[lower] && area[lower] > area[junction]);
 } finally {
  drainage.dispose();
  field.dispose();
 }
});

test('melting removes snow from a packed rut and leaves the underlying soil unchanged', () => {
 const resolution = 9;
 const heights = new Float32Array(resolution ** 2);
 const field = createTerrainField({size: [8, 8], resolution: [resolution, resolution], heights, snowTrackRims: true});
 try {
  field.deform(4, 4, .5, .1);
  field.flushDeformation();
  const soil = field.heightAt(4, 4);
  field.setSnowCover(true);
  field.deform(4, 4, .8, .5);
  field.flushDeformation();
  const packed = field.heightAt(4, 4);
  assert.ok(packed > soil);
  const melt = field.meltSnow(.02);
  assert.ok(melt.removed > 0 && melt.remaining > 0);
  assert.ok(field.heightAt(4, 4) < packed);
  assert.ok(field.heightAt(4, 4) > soil);
  const thaw = field.meltSnow(1);
  field.flushDeformation();
  assert.equal(thaw.remaining, 0);
  assert.equal(field.snowCover.value, false);
  assert.equal(field.heightAt(4, 4), soil);
 } finally {
  field.dispose();
 }
});

test('water crosses a hollow to its outlet and is counted as held back by it', () => {
 const resolution = 9;
 const indexAt = (x, z) => z * resolution + x;
 const heights = Float32Array.from({length: resolution ** 2}, (_, index) => (index % resolution) * .5);
 const hollow = indexAt(4, 4), upstream = indexAt(6, 4);
 heights[hollow] -= 1;
 const field = createTerrainField({size: [8, 8], resolution: [resolution, resolution], heights});
 const drainage = createTerrainDrainage(field, {maxPuddleDepth: 1});
 try {
  const {receiver, area, held} = drainage.bakeFlow();
  const outlet = receiver[hollow];
  assert.ok(outlet >= 0 && heights[outlet] > heights[hollow]);
  assert.ok(area[hollow] > area[upstream]);
  assert.ok(area[outlet] > area[hollow]);
  assert.equal(held[upstream], 0);
  assert.ok(held[outlet] >= area[hollow]);
 } finally {
  drainage.dispose();
  field.dispose();
 }
});

test('craters paint the strata they cut and the soil they throw, and tracks keep their paint', async () => {
 const {craterStrataPaint, CRATER_STRATA, TERRAIN_PALETTE_ROLES, TERRAIN_LAYERS} = await import('../../src/terrain/index.js');
 const role = name => TERRAIN_PALETTE_ROLES.indexOf(name), grassOnly = () => TERRAIN_PALETTE_ROLES.map(name => name === 'grass' ? 1 : 0);
 const sum = roles => roles.reduce((a, b) => a + b, 0);
 assert.equal(craterStrataPaint(grassOnly(), 0, 0), 0);
 for (const [dig, shown] of [[.9, 'soil'], [2.4, 'scree'], [4.5, 'rock']]) {
  const roles = grassOnly();
  assert.equal(craterStrataPaint(roles, dig, 0, CRATER_STRATA), 1);
  assert.ok(roles[role(shown)] > .99 && Math.abs(sum(roles) - 1) < 1e-6, `${dig} m shows ${shown}`);
 }
 const thrown = grassOnly();
 craterStrataPaint(thrown, 0, .5);
 assert.ok(Math.abs(thrown[role('soil')] - .5) < 1e-6 && Math.abs(sum(thrown) - 1) < 1e-6);

 const nx = 129, heights = new Float32Array(nx * nx);
 const field = createTerrainField({origin: [0, 0], size: [32, 32], resolution: [nx, nx], heights, seed: 3, rules: {rockSlope: 3, snowLine: 300, mudBelow: -20, bareSoil: 0}, crater: {ragged: 0}});
 const mud = TERRAIN_LAYERS.indexOf('mud'), rock = TERRAIN_LAYERS.indexOf('rock');
 field.deform(26, 26, 1, .4);
 assert.ok(field.layerWeightAt(26, 26, mud) < .05, 'a track keeps the surface paint');
 field.crater(12, 12, 3, 4);
 assert.ok(field.layerWeightAt(12, 12, rock) > .9, 'bedrock at the bottom of a 4 m crater');
 assert.ok(field.layerWeightAt(14.5, 12, mud) > .5, 'subsoil on the upper wall');
 assert.ok(field.layerWeightAt(16, 12, mud) + field.layerWeightAt(12, 16, mud) > .2, 'thrown soil beyond the rim');
 assert.ok(field.layerWeightAt(2, 30, mud) < .05, 'untouched ground far away');
 field.resetDeformation();
 assert.ok(field.layerWeightAt(12, 12, rock) < .05, 'reset restores the paint');
 field.dispose();
});

test('a crater tells its subscribers where it is, how much it threw out and what it was made of', async () => {
 const {createCraterLayer} = await import('../../src/terrain/index.js');
 const nx = 81, field = createTerrainField({origin: [0, 0], size: [40, 40], resolution: [nx, nx], heights: new Float32Array(nx * nx).fill(2), seed: 3, crater: {ragged: 0}});
 const events = [];
 assert.throws(() => field.subscribe(null), TypeError);
 const unsubscribe = field.subscribe(event => events.push(event));
 const result = field.crater(20, 20, 3, 4);
 const [event] = events;
 assert.equal(event.type, 'terrain:crater');
 assert.equal(event.height, 2);
 assert.ok(Math.abs(event.volume - result.volume) < 1e-9 && Math.abs(event.ejecta - result.ejecta) < 1e-9);
 const shares = Object.values(event.strata);
 assert.ok(Math.abs(shares.reduce((a, b) => a + b) - 1) < 1e-9 && event.strata.rock > 0 && event.strata.topsoil > 0);
 unsubscribe();
 field.crater(5, 5, 1, .2);
 assert.equal(events.length, 1);
 field.dispose();
 const layer = createCraterLayer(), heard = [];
 layer.subscribe(event => heard.push(event));
 layer.add({x: 1, z: 2, shape: {halfX: 2, halfZ: 1}, depth: 1});
 assert.equal(heard[0].height, null);
 assert.ok(heard[0].volume > 0 && heard[0].strata.rock === 0, 'a 1 m crater reaches no bedrock');
});

test('a ragged crater is irregular but the same crater every time, and its rays differ from one another', async () => {
 const {createCraterStamp} = await import('../../src/terrain/index.js');
 const make = (ragged, x = 3) => createCraterStamp({x, z: -7, shape: 4, depth: 2, ragged, rays: 6});
 const exact = make(0), ragged = make(1), again = make(1), elsewhere = make(1, 40), out = {t: 0, dig: 0, rise: 0};
 const around = (stamp, read, radius) => Array.from({length: 36}, (_, i) => read(stamp, Math.cos(i / 36 * 2 * Math.PI) * radius, Math.sin(i / 36 * 2 * Math.PI) * radius));
 const spread = values => Math.max(...values) - Math.min(...values);
 const outline = (stamp, dx, dz) => stamp.relief(dx, dz, out).t, thrown = (stamp, dx, dz) => stamp.thrown(dx, dz);
 assert.ok(spread(around(exact, outline, 4)) < 1e-9, 'ragged 0 keeps the exact outline');
 assert.ok(spread(around(ragged, outline, 4)) > .1, 'the outline strays');
 assert.deepEqual(around(ragged, outline, 4), around(again, outline, 4));
 assert.notDeepEqual(around(ragged, thrown, 9), around(elsewhere, thrown, 9));
 assert.equal(ragged.relief(0, 0, out).dig, 2);
 // No ninefold (or any regular) star: the soil at 1.7 radii is not the same pattern turned by one ray gap.
 const ring = around(ragged, thrown, 6.8), turnedRing = ring.map((_, i) => ring[(i + 6) % 36]);
 assert.ok(ring.some((value, i) => Math.abs(value - turnedRing[i]) > .1));
 assert.ok(around(make(1), thrown, 4 * 2.9).every(value => value === 0), 'nothing past the ejecta reach');
 assert.throws(() => createCraterStamp({x: 0, z: 0, shape: 2, depth: 1, travel: {heading: 0, obliquity: 2}}), RangeError);
 const forward = createCraterStamp({x: 0, z: 0, shape: 3, depth: 1, ragged: 0, rays: 0, travel: {heading: 0, obliquity: 1}});
 assert.ok(forward.thrown(4.5, 0) > .3 && forward.thrown(-4.5, 0) === 0, 'an oblique impact throws its soil forward');
});

test('an impact makes a crater from the weight, speed, angle and outline of the object', async () => {
 const {craterFromImpact} = await import('../../src/terrain/index.js');
 assert.throws(() => craterFromImpact({footprint: 1, mass: 0, velocity: [0, -1, 0]}), RangeError);
 assert.equal(craterFromImpact({footprint: 1, mass: 1, velocity: [0, -1, 0]}), null, 'a light tap leaves no crater');
 const boulder = craterFromImpact({footprint: 1.1, mass: 13000, velocity: [0, -28, 0]});
 const faster = craterFromImpact({footprint: 1.1, mass: 13000, velocity: [0, -56, 0]});
 const lighter = craterFromImpact({footprint: 1.1, mass: 1300, velocity: [0, -28, 0]});
 assert.ok(boulder.depth > 1.5 && boulder.depth < 4 && faster.depth > boulder.depth && lighter.depth < boulder.depth);
 assert.ok(faster.shape.halfX > boulder.shape.halfX && boulder.shape.halfX > 1.1);
 assert.equal(boulder.travel.obliquity, 0);
 const slab = craterFromImpact({footprint: {halfX: 1.7, halfZ: 1.2, yaw: .4, squareness: 1}, mass: 2700, velocity: [0, -20, 0]});
 assert.ok(slab.depth < boulder.depth && slab.shape.yaw === .4 && slab.shape.squareness === 1, 'a wide slab dents in its own outline');
 const plane = craterFromImpact({footprint: {halfX: 3.2, halfZ: 2.6, yaw: 1, squareness: .3}, mass: 1100, velocity: [0, -17, 52]});
 assert.ok(Math.abs(plane.shape.yaw - Math.PI / 2) < 1e-9 && plane.shape.halfX > 2 * plane.shape.halfZ, 'a flat impact ploughs a furrow along its heading');
 assert.ok(plane.travel.obliquity > .9 && plane.depth < boulder.depth);
});

test('hard ground gives a shallower crater that shows rock, throws rubble and fractures around it', async () => {
 const {createCraterStamp, craterStrataPaint, TERRAIN_PALETTE_ROLES, createCraterLayer} = await import('../../src/terrain/index.js');
 const out = {t: 0, dig: 0, rise: 0}, at = hardness => createCraterStamp({x: 0, z: 0, shape: 3, depth: 2, ragged: 0, rays: 0, hardness});
 const soft = at(0), hard = at(1);
 assert.equal(soft.relief(0, 0, out).dig, 2);
 assert.equal(hard.relief(0, 0, out).dig, 1);
 assert.ok(hard.relief(3.2, 0, out).rise < soft.relief(3.2, 0, out).rise);
 assert.equal(soft.fractured(4, 0), 0);
 assert.ok(hard.fractured(1, 0) === 1 && hard.fractured(4.5, 0) > 0 && hard.fractured(4.5, 0) < 1 && hard.fractured(7.5, 0) === 0);
 assert.throws(() => at(2), RangeError);
 const role = name => TERRAIN_PALETTE_ROLES.indexOf(name), grass = () => TERRAIN_PALETTE_ROLES.map(name => name === 'grass' ? 1 : 0);
 const softCut = grass(), hardCut = grass(), rubble = grass();
 craterStrataPaint(softCut, .6, 0, undefined, 0); craterStrataPaint(hardCut, .6, 0, undefined, 1); craterStrataPaint(rubble, 0, 1, undefined, 1);
 assert.ok(softCut[role('soil')] > .9 && hardCut[role('rock')] > .9 && rubble[role('scree')] === 1);
 const nx = 81, field = createTerrainField({origin: [0, 0], size: [40, 40], resolution: [nx, nx], heights: new Float32Array(nx * nx), seed: 3, crater: {ragged: 0}});
 const events = [], fracture = field.fractureMap.image.data;
 field.subscribe(event => events.push(event));
 field.crater(20, 20, 3, 2, undefined, {hardness: 1});
 assert.ok(Math.abs(field.heightAt(20, 20) + 1) < 1e-4);
 assert.ok(events[0].hardness === 1 && events[0].strata.rock > .4 && events[0].strata.rock > events[0].strata.subsoil, 'the debris is mostly rock');
 assert.ok(fracture[40 * nx + 40] === 255 && fracture[40 * nx + 49] > 0 && fracture[40 * nx + 70] === 0);
 field.resetDeformation();
 assert.ok(fracture.every(value => value === 0));
 field.dispose();
 const layer = createCraterLayer({hardness: 1}), exposure = {};
 layer.add({x: 0, z: 0, shape: 3, depth: 2});
 assert.ok(layer.exposureAt(4, 0, exposure).fracture > 0 && exposure.hardness === 1);
 assert.equal(layer.toJSON()[0].hardness, 1);
});
