import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createLightProbes, createLightRig, LIGHT_PROBE_DEFAULTS} from '../../src/lighting/index.js';
import {createLighting, createSkyVisibility, addLightSlot} from '../../src/core/index.js';

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
 assert.ok(shader.fragmentShader.includes('lightAmbient(probeNormal, vLightWorld)') && shader.vertexShader.includes('vLightWorld ='));
 assert.equal(shader.uniforms.uHemiSky, lighting.uniforms.uHemiSky);
 assert.throws(() => probes.applyTo(new THREE.MeshBasicMaterial(), lighting).onBeforeCompile({uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader}), /lit Three material/);
 probes.dispose();
});

test('light slots let several features extend the light loop of one material, in any order', () => {
 const standard = () => ({uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader});
 const shadow = {key: 'shadow', uniforms: {uShadow: {value: 1}}, worldPosition: true, declarations: 'uniform float uShadow;', directional: 'directLight.color *= uShadow * step(0.0, vLightWorld.y);'};
 const backlight = {key: 'backlight', directionalLit: 'reflectedLight.directDiffuse += directLight.color * 0.1;'};
 const ambient = {key: 'ambient', after: 'irradiance *= 0.5;'};
 const sources = [[shadow, backlight, ambient], [ambient, backlight, shadow]].map(order => {
  const material = new THREE.MeshStandardMaterial(), shader = standard();
  for (const slot of order) addLightSlot(material, slot);
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uShadow, shadow.uniforms.uShadow);
  const source = shader.fragmentShader;
  assert.ok(!source.includes('#include <lights_fragment_begin>') && shader.vertexShader.includes('vLightWorld ='));
  // Each slot stands at its own place in the loop, whatever the order they were added in.
  const read = source.indexOf('getDirectionalLightInfo('), dim = source.indexOf(shadow.directional), apply = source.indexOf('RE_Direct( directLight', dim);
  const lit = source.indexOf(backlight.directionalLit), after = source.indexOf(ambient.after);
  assert.ok(read > 0 && read < dim && dim < apply && apply < lit && lit < after);
  assert.ok(source.indexOf('uniform float uShadow;') < source.indexOf('void main() {'));
  return material;
 });
 assert.notEqual(sources[0].customProgramCacheKey(), new THREE.MeshStandardMaterial().customProgramCacheKey());
 assert.throws(() => addLightSlot(sources[0], shadow), /already on this material/);
 assert.throws(() => addLightSlot(sources[0], {key: 'empty'}), TypeError);
 assert.throws(() => addLightSlot({}, shadow), TypeError);
});

test('a material gets its own hooks back when its last light slot is taken away', () => {
 const material = new THREE.MeshStandardMaterial(), compile = shader => { shader.uniforms.own = {value: 1}; }, key = () => 'own';
 material.onBeforeCompile = compile; material.customProgramCacheKey = key;
 const first = addLightSlot(material, {key: 'a', after: 'irradiance *= 1.0;'}), second = addLightSlot(material, {key: 'b', after: 'irradiance *= 1.0;'});
 assert.equal(material.customProgramCacheKey(), 'own|light-slots:a,b');
 const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader};
 material.onBeforeCompile(shader);
 assert.equal(shader.uniforms.own.value, 1);
 first(); first();
 assert.equal(material.customProgramCacheKey(), 'own|light-slots:b');
 second();
 assert.equal(material.onBeforeCompile, compile); assert.equal(material.customProgramCacheKey, key);
 const unlit = new THREE.MeshBasicMaterial(); addLightSlot(unlit, {key: 'a', after: 'irradiance *= 1.0;'});
 assert.throws(() => unlit.onBeforeCompile({uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader}), /lit Three material/);
});

test('the hook has no local lights by default and takes the ones of a light rig', () => {
 const plain = createLighting(), rig = createLightRig({capacity: 2}), lighting = createLighting({lights: rig.lights});
 assert.ok(plain.glsl.includes('lightLocal(vec3 n, vec3 worldPosition, float wrap) { return vec3(0.0); }'));
 assert.ok(lighting.glsl.includes('#define LIGHT_RIG_CAPACITY 2') && lighting.glsl.includes('+ lightLocal(n, worldPosition, wrap)'));
 assert.equal(lighting.uniforms.uRigCount, rig.lights.uniforms.uRigCount);
 assert.equal(lighting.uniforms.uRigPosition.value.length, 2);
 assert.throws(() => createLighting({lights: {glsl: 1}}), /lights needs glsl and uniforms/);
 for (const capacity of [0, 1.5, 33]) assert.throws(() => createLightRig({capacity}), RangeError);
 assert.throws(() => rig.add(new THREE.DirectionalLight()), TypeError);
 assert.throws(() => rig.update({}), TypeError);
});

test('the light rig writes point and spot lights as Three reads them and keeps the ones that count most at the focus', () => {
 const rig = createLightRig({capacity: 2}), {uniforms} = rig.lights, scene = new THREE.Scene();
 const point = new THREE.PointLight(0xff0000, 10, 20, 2), far = new THREE.PointLight(0xffffff, 10), spot = new THREE.SpotLight(0x00ff00, 4, 0, Math.PI / 6, .5, 1);
 const holder = new THREE.Group(); holder.position.set(0, 5, 0); holder.add(point); point.position.set(1, 0, 0);
 far.position.set(1000, 0, 0); spot.position.set(0, 10, 0); spot.target.position.set(0, 0, 10);
 scene.add(holder, far, spot, spot.target);
 const remove = rig.add(point); rig.add(far); rig.add(spot);
 assert.throws(() => rig.add(point), /already in the rig/);
 assert.equal(rig.count, 3);
 // Around the origin the far light counts least: the point light and the spot reach the hook.
 assert.equal(rig.update(new THREE.Vector3()), 2);
 assert.equal(uniforms.uRigCount.value, 2);
 const at = uniforms.uRigColor.value.findIndex(color => color.x > 0);
 assert.deepEqual(uniforms.uRigPosition.value[at].toArray(), [1, 5, 0]);                 // world position, through the parent
 assert.deepEqual(uniforms.uRigColor.value[at].toArray(), [10, 0, 0]);                   // colour x intensity
 assert.deepEqual(uniforms.uRigShape.value[at].toArray(), [20, 2, -2, -1.5]);            // no cone
 const other = 1 - at, direction = uniforms.uRigDirection.value[other], shape = uniforms.uRigShape.value[other];
 assert.ok(Math.abs(direction.y - Math.SQRT1_2) < 1e-6 && Math.abs(direction.z + Math.SQRT1_2) < 1e-6);   // from the target toward the light
 assert.ok(Math.abs(shape.z - Math.cos(Math.PI / 6)) < 1e-6 && Math.abs(shape.w - Math.cos(Math.PI / 12)) < 1e-6 && shape.y === 1 && shape.x === 0);
 // Next to the far light it comes first; a dark or hidden light is left out.
 rig.update(new THREE.Vector3(1000, 0, 1));
 assert.deepEqual(uniforms.uRigPosition.value[0].toArray(), [1000, 0, 0]);
 far.intensity = 0; spot.visible = false;
 assert.equal(rig.update(), 1);
 remove(); assert.equal(rig.has(point), false); assert.equal(rig.update(), 0);
 rig.dispose(); assert.equal(rig.count, 0);
});
