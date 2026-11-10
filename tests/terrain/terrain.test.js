import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTerrainField, valueNoise, OceanCoastTerrain} from '../../src/terrain/index.js';
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
