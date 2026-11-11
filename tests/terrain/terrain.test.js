import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTerrainDrainage, createTerrainField, valueNoise, OceanCoastTerrain} from '../../src/terrain/index.js';
import {createTerrainRunoff} from '../../src/terrain/runoff.js';
import {createTrackMask} from '../../src/surface/index.js';
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

test('runoff beads move downhill without a phase reset and move faster on steeper slopes', () => {
 const extent = 32, resolution = 33, maskResolution = 256;
 const step = 1 / 60;
 function travelOnSlope(grade) {
  const heights = Float32Array.from({length: resolution ** 2}, (_, index) => (index % resolution) * grade);
  const field = createTerrainField({size: [extent, extent], resolution: [resolution, resolution], heights});
  const drainage = createTerrainDrainage(field);
  const runoff = createTerrainRunoff({field, drainage, resolution: maskResolution});
  function centerOfWetMark() {
   const {data, width} = runoff.texture.image;
   let weightedX = 0, weight = 0;
   for (let index = 0; index < data.length; index++) {
    weightedX += (index % width + .5) * data[index];
    weight += data[index];
   }
   assert.ok(weight > 0);
   return weightedX / weight * extent / width;
  }
  try {
   const rain = {supply: .007, amount: 1, puddleFill: 0};
   const dry = {...rain, supply: 0};
   for (let frame = 0; frame < 66; frame++) runoff.update(step, rain);
   const first = centerOfWetMark();
   for (let frame = 0; frame < 12; frame++) runoff.update(step, dry);
   const middle = centerOfWetMark();
   for (let frame = 0; frame < 12; frame++) runoff.update(step, dry);
   const last = centerOfWetMark();
   assert.ok(first > middle && middle > last);
   return first - last;
  } finally {
   runoff.dispose();
   drainage.dispose();
   field.dispose();
  }
 }
 assert.ok(travelOnSlope(.5) > travelOnSlope(.25));
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
  assert.ok(area[junction] > area[left] + area[right]);
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

test('a shallow downhill rut carries visible runoff below the general contributing-area threshold', () => {
 const resolution = 33, span = 8, maskResolution = 128;
 const heights = Float32Array.from({length: resolution ** 2}, (_, index) => (index % resolution) * .04);
 const field = createTerrainField({size: [span, span], resolution: [resolution, resolution], heights, snowTrackRims: true});
 const tracks = createTrackMask({origin: [0, 0], size: [span, span], resolution: maskResolution, directional: true});
 const drainage = createTerrainDrainage(field);
 const runoff = createTerrainRunoff({field, drainage, tracks, resolution: maskResolution});
 try {
  assert.ok(runoff.film.image.data.every(value => value === 0));
  field.setSnowCover(true);
  tracks.stamp({x: 2, z: 4}, {x: 6, z: 4}, .31);
  for (let x = 2; x <= 6; x += .25) field.deform(x, 4, .5, .08);
  field.flushDeformation();
  drainage.rebuild();
  runoff.rebuild();
  const film = runoff.film.image.data;
  const sampleFilm = (x, z) => film[Math.floor(z / span * maskResolution) * maskResolution + Math.floor(x / span * maskResolution)];
  assert.ok(sampleFilm(4, 4) > 0);
  assert.ok(sampleFilm(4.5, 4) > 0);
  assert.ok(sampleFilm(5, 4) > 0);
  assert.equal(sampleFilm(4, 3), 0);
  assert.equal(tracks.sample(4, 4), 1);
  assert.equal(tracks.sample(4, 3), 0);
 } finally {
  runoff.dispose();
  drainage.dispose();
  tracks.dispose();
  field.dispose();
 }
});
