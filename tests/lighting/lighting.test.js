import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createLightProbes, LIGHT_PROBE_DEFAULTS} from '../../src/lighting/index.js';
import {createLighting, createSkyVisibility} from '../../src/core/index.js';

// A 45 degree pit around the origin on green ground, red beyond x = 40.
const ground = {heightAt: (x, z) => Math.min(Math.hypot(x, z), 8), colorAt: (x, z, target) => x > 40 ? target.setRGB(1, 0, 0) : target.setRGB(0, .5, 0)};
const config = {columns: 8, spacing: 4, layers: 3, budget: 5, sky: {reach: 64}};
const settle = (probes, x, z) => { for (let guard = 0; probes.pending > 0 || !guard; guard++) { assert.ok(guard < 100); probes.update(x, z); } };

test('light probes validate their settings and measure the nearest columns first, a few per update', () => {
 assert.throws(() => createLightProbes(), TypeError);
 assert.throws(() => createLightProbes({ground, columns: 3}), /columns/);
 assert.throws(() => createLightProbes({ground, layers: 2.5}), /layers/);
 assert.throws(() => createLightProbes({ground, strength: 2}), /strength/);
 const probes = createLightProbes({ground, ...config});
 assert.throws(() => probes.update(NaN, 0), RangeError);
 assert.equal(probes.pending, 64);
 assert.equal(probes.update(0, 0), 5);
 assert.equal(probes.pending, 59);
 assert.ok(probes.columnAt(0, 0), 'the column under the focus comes first');
 assert.equal(probes.columnAt(-16, -16), null);
 settle(probes, 0, 0);
 assert.equal(probes.update(0, 0), 0);
 probes.dispose();
 assert.equal(LIGHT_PROBE_DEFAULTS.strength, 1);
});

test('a probe column holds the ground height, its colour dimmed by the sky it sees, and more sky with height', () => {
 const probes = createLightProbes({ground, ...config});
 settle(probes, 0, 0);
 const measure = createSkyVisibility(ground.heightAt, config.sky), bottom = probes.columnAt(0, 0), lifts = [1, 4, 16];
 assert.equal(bottom.height, 0);
 lifts.forEach((lift, layer) => assert.equal(bottom.sky[layer], Math.round(measure.at(0, 0, 4, lift) * 255) / 255));
 assert.ok(bottom.sky[0] < bottom.sky[1] && bottom.sky[1] < bottom.sky[2], 'the pit opens with height');
 const open = measure.at(0, 0, 4);
 assert.deepEqual(bottom.color, [0, Math.round(.5 * open * 255) / 255, 0]);
 // On the flat around the pit the sky is whole.
 assert.deepEqual(probes.columnAt(-12, 12).sky, [1, 1, 1]);
 assert.equal(probes.columnAt(-12, 12).height, 8);
 probes.dispose();
});

test('the grid follows the focus: columns that stay are kept, the ones that come in are measured, the rest let go', () => {
 let asked = 0;
 const counted = {heightAt: (x, z) => { asked++; return ground.heightAt(x, z); }, colorAt: ground.colorAt};
 const probes = createLightProbes({ground: counted, ...config});
 settle(probes, 0, 0);
 const whole = asked;
 asked = 0;
 probes.update(8, 0);   // two columns to the east
 assert.equal(probes.pending, 16 - 5);
 settle(probes, 8, 0);
 assert.ok(asked < whole / 2, 'only the new columns are measured');
 assert.equal(probes.columnAt(-16, 0), null, 'ground behind the grid is let go');
 assert.ok(probes.columnAt(20, 0));
 settle(probes, 48, 0);
 assert.deepEqual(probes.columnAt(52, 0).color, [1, 0, 0]);
 probes.dispose();
});

test('the probes give the lighting hook its ambient and patch a lit material to match', () => {
 const probes = createLightProbes({ground, ...config});
 const lighting = createLighting({ambient: probes.ambient});
 assert.ok(lighting.glsl.includes('uProbeVolume') && lighting.glsl.includes('shadeAt'));
 assert.equal(lighting.uniforms.uProbeVolume, probes.ambient.uniforms.uProbeVolume);
 probes.strength.value = .25; probes.update(3, -5);
 assert.equal(lighting.uniforms.uProbeLayers.value.w, .25);
 assert.deepEqual(lighting.uniforms.uProbeFocus.value.toArray(), [3, -5]);
 assert.throws(() => probes.applyTo(new THREE.MeshStandardMaterial(), createLighting()), /built with their ambient/);
 assert.throws(() => probes.applyTo({}, lighting), TypeError);
 const material = probes.applyTo(new THREE.MeshStandardMaterial(), lighting), plain = new THREE.MeshStandardMaterial();
 assert.notEqual(material.customProgramCacheKey(), plain.customProgramCacheKey());
 const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader};
 material.onBeforeCompile(shader);
 assert.ok(shader.fragmentShader.includes('lightAmbient(probeNormal, vLightProbeWorld)') && shader.vertexShader.includes('vLightProbeWorld ='));
 assert.equal(shader.uniforms.uHemiSky, lighting.uniforms.uHemiSky);
 assert.throws(() => probes.applyTo(new THREE.MeshBasicMaterial(), lighting).onBeforeCompile({uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader}), /lit Three material/);
 probes.dispose();
});
