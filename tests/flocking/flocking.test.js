import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFishFlock, FISH_SPECIES, BUNDLED_FISH_MODELS_URL} from '../../src/flocking/index.js';
import {BoatController} from '../../src/water/ocean/boat-controller.js';

test('flock validates bounds/counts and resolves the bundled models URL', () => {
 assert.ok(BUNDLED_FISH_MODELS_URL.endsWith('assets/fish/webaquarium-species.json'));
 assert.ok(Object.keys(FISH_SPECIES).length >= 3);
 const bounds = new THREE.Box3(new THREE.Vector3(-5, -3, -5), new THREE.Vector3(5, 0, 5));
 await_rejects(createFishFlock({bounds: new THREE.Box3(), size: 1}), /bounds/);
 await_rejects(createFishFlock({bounds, counts: {roach: 1000}}), /count/);
});
async function await_rejects(promise, pattern) { await assert.rejects(promise, pattern); }

test('boat controller takes injected input and does not touch globals by default', () => {
 const body = {position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: {x: 0, y: 0, z: 0}, angularVelocity: {x: 0, y: 0, z: 0}};
 const target = new EventTarget(); let listeners = 0;
 const original = target.addEventListener.bind(target); target.addEventListener = (...a) => { listeners++; original(...a); };
 const withInput = new BoatController(body, new THREE.Vector3(), {}, {input: target});
 assert.equal(listeners, 3);
 withInput.dispose(); withInput.dispose();
 const silent = new BoatController(body, new THREE.Vector3(), {});
 assert.equal(silent.input, null);
 silent.dispose();
});
