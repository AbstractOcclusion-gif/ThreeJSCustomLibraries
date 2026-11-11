import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTerrainDrainage, createTerrainField, valueNoise, OceanCoastTerrain} from '../../src/terrain/index.js';
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
