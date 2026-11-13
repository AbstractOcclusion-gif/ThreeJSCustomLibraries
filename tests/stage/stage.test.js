import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createBasicStage, STAGE_DEFAULTS} from '../../src/stage/index.js';
import {groundBounce, LIGHTING_DEFAULTS} from '../../src/core/index.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);

test('ground bounce returns the ground colour share of the sun, by its height, and of the sky', () => {
 const out = new THREE.Color(), albedo = new THREE.Color(.5, .25, 0);
 const light = {sunColor: new THREE.Color(2, 2, 2), sunDirection: new THREE.Vector3(0, .5, Math.sqrt(.75)), skyColor: new THREE.Color(1, 1, 4)};
 assert.deepEqual(groundBounce(out, albedo, light).toArray(), [1, .5, 0]);
 // A sun under the horizon lights nothing: only the sky is returned.
 light.sunDirection.set(0, -1, 0);
 assert.deepEqual(groundBounce(out, albedo, light).toArray(), [.5, .25, 0]);
});

test('the stage writes the bounce of its ground into the hemisphere light, the environment and the lighting hook', () => {
 const scene = new THREE.Scene(), stage = createBasicStage({scene, sky: false, ground: false});
 const plain = new THREE.Color(LIGHTING_DEFAULTS.hemiGround).multiplyScalar(STAGE_DEFAULTS.ambientIntensity);
 assert.deepEqual(stage.environment.ambient.ground.toArray(), plain.toArray());
 assert.throws(() => stage.setGround(0x00ff00), /colour/);
 assert.throws(() => stage.setGround(new THREE.Color(), 2), /share/);
 const albedo = new THREE.Color(.1, .3, .05), expected = new THREE.Color();
 const check = share => {
  groundBounce(expected, albedo, {sunColor: stage.environment.sun.color, sunDirection: stage.environment.sun.direction, skyColor: stage.environment.ambient.sky});
  const base = new THREE.Color(LIGHTING_DEFAULTS.hemiGround).multiplyScalar(stage.hemi.intensity).lerp(expected, share);
  const light = stage.hemi.groundColor.clone().multiplyScalar(stage.hemi.intensity);
  stage.update();
  for (const channel of ['r', 'g', 'b']) {
   close(stage.environment.ambient.ground[channel], base[channel]);
   close(light[channel], base[channel]);
   close(stage.lighting.uniforms.uHemiGround.value[channel], base[channel]);
  }
 };
 stage.setGround(albedo); check(1);
 stage.setGround(albedo, .4); check(.4);
 // It follows the sun and the light level.
 stage.setSun(10, 200); check(.4);
 stage.setLight(.3); check(.4);
 stage.setLight(0);
 assert.deepEqual(stage.environment.ambient.ground.toArray(), [0, 0, 0]);
 stage.setLight(1).setGround(null);
 assert.deepEqual(stage.environment.ambient.ground.toArray(), plain.toArray());
 stage.dispose();
});
