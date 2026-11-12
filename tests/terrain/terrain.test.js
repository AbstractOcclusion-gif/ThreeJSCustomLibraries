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
