import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWaveBank, waveCount, createRipples, createFlowBake, createChannel, createFoamTexture, createLaceTexture, createOceanSurface, proceduralSky, customSky} from '../../src/water/index.js';

test('wave bank normalises to the requested significant height and caches by parameters', () => {
 const bank = createWaveBank();
 bank.update(.4, 1.2, 0, .5);
 const variance = bank.amplitudes.reduce((sum, wave) => sum + wave.x ** 2, 0);
 assert.ok(Math.abs(Math.sqrt(8 * variance) - .4) < 1e-9);
 assert.equal(bank.carriers.length, waveCount);
 const before = bank.amplitudes[0].x;
 bank.update(.4, 1.2, 0, .5);
 assert.equal(bank.amplitudes[0].x, before);
});

test('ripples honour the grid options, mask through a callback and settle after a splash', () => {
 const ripples = createRipples({origin: [-5, -5], size: [32, 32], cell: .5});
 assert.deepEqual(ripples.bounds.toArray(), [-5, -5, 16, 16]);
 ripples.mask((x, z) => Math.hypot(x, z) < 6);
 assert.equal(ripples.active, false);
 ripples.splash(0, 0, 1);
 assert.equal(ripples.active, true);
 ripples.update(1 / 30);
 const energy = ripples.texture.image.data.reduce((sum, h) => sum + Math.abs(h), 0);
 assert.ok(energy > 0);
 for (let i = 0; i < 10; i++) ripples.update(1);
 assert.equal(ripples.active, false);
 assert.equal(ripples.texture.image.data.reduce((sum, h) => sum + Math.abs(h), 0), 0);
 ripples.dispose();
});

test('channel exposes sections, samples along the flow and reports null outside its reach', () => {
 const channel = createChannel({width: 1, depth: 1, drop: 3});
 assert.equal(channel.sectionAt(-100), null);
 const section = channel.sectionAt(0);
 assert.ok(section.width > 0 && section.speed > 0);
 const out = new THREE.Vector3();
 channel.sample(1, 0, out);
 assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z));
 assert.ok(channel.surface.attributes.flow && channel.bed.attributes.color);
 const custom = createChannel({sections: [[-10, 0, 2, .5, 2], [0, 0, 2, .5, 2], [10, 0, 2, .5, 2]]});
 assert.ok(Math.abs(custom.sectionAt(5).centre) < 1e-9);
});

test('flow bake reduces divergence and samples velocity inside the wet grid', () => {
 const channel = createChannel({});
 const flow = createFlowBake({origin: [-34, -28.6], size: [56, 44], cell: 1.3});
 assert.equal(flow.ready, false);
 const {before, after} = flow.bake(channel, [new THREE.Vector4(0, 7, .9, 0)], 40);
 assert.ok(flow.ready && after < before);
 const velocity = new THREE.Vector2();
 const section = channel.sectionAt(5);
 assert.equal(flow.sample(5, section.centre, velocity), true);
 assert.ok(velocity.x > 0);
 assert.equal(flow.sample(500, 500, velocity), false);
 flow.invalidate();
 assert.equal(flow.ready, false);
 flow.dispose();
});

test('generated foam and lace tiles are valid repeat textures', () => {
 for (const texture of [createFoamTexture(32), createLaceTexture(32)]) {
  assert.equal(texture.image.width, 32);
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  assert.ok(texture.image.data.some(v => v > 0));
  texture.dispose();
 }
});

test('ocean surface builds on the procedural sky, applies presets and rejects an incomplete custom sky', () => {
 const ocean = createOceanSurface({settings: {swell: 1.4}});
 assert.equal(ocean.uniforms.swell.value, 1.4);
 assert.ok(ocean.uniforms.uSkySun && ocean.uniforms.uSunCol && ocean.uniforms.uDaylight);
 ocean.apply({heading: 90});
 assert.ok(Math.abs(ocean.uniforms.heading.value - Math.PI / 2) < 1e-9);
 ocean.update(.5);
 assert.equal(ocean.uniforms.clock.value, .5);
 ocean.dispose();
 const sky = proceduralSky();
 sky.setSun(new THREE.Vector3(0, 1, 0));
 assert.equal(sky.uniforms.uSkySun.value.y, 1);
 assert.equal(sky.uniforms.uSkySunDir, sky.uniforms.uSkySun);
 assert.equal(sky.uniforms.uSunDir, sky.uniforms.uSkySun);
 assert.throws(() => customSky({glsl: '', uniforms: {}}), /uSkySun/);
});
