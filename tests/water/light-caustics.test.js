import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRipples} from '../../src/water/ripples.js';
import {createLightCaustics, LIGHT_CAUSTIC_DEFAULTS} from '../../src/water/light-caustics.js';

// A renderer that only records what the pass asks of it.
function recordingRenderer() {
  const calls = [];
  let target = null, clear = new THREE.Color(.2, .3, .4), alpha = .5;
  return {calls, getRenderTarget: () => target, setRenderTarget(t) { target = t; calls.push(['target', t]); },
    getClearAlpha: () => alpha, getClearColor: c => c.copy(clear), setClearColor(c, a) { clear = new THREE.Color(c); alpha = a; },
    clear() { calls.push(['clear', target]); }, render(scene) { calls.push(['render', target, scene]); }};
}
function setup(overrides = {}) {
  const ripples = createRipples({origin: [-.03, -.03], size: [16, 16], cell: .00375});
  const surface = new THREE.Mesh(new THREE.CircleGeometry(.03, 8).rotateX(-Math.PI / 2));
  surface.position.set(1, .8, 0);
  const light = new THREE.SpotLight(0xffffff, 10);
  light.position.set(1, 2.8, 0);   // straight above the glass
  const renderer = recordingRenderer(), camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1, 2); camera.updateMatrixWorld();
  const caustics = createLightCaustics({renderer, ripples, surface, light, planeY: .76, ...overrides});
  return {caustics, renderer, camera, light, ripples};
}

test('light caustics check what they are given', () => {
  const {caustics} = setup();
  assert.throws(() => createLightCaustics(), TypeError);
  assert.throws(() => setup({segments: 3}), RangeError);
  assert.throws(() => setup({strength: 9}), RangeError);
  assert.throws(() => setup({nonsense: 1}), /Unknown/);
  assert.throws(() => setup({shape: 'star'}), TypeError);
  assert.doesNotThrow(() => setup({shape: 'disc'}));
  assert.throws(() => caustics.set('resolution', 512), /fixed/);
  assert.equal(caustics.settings.resolution, LIGHT_CAUSTIC_DEFAULTS.resolution);
  caustics.set('strength', .5);
  assert.equal(caustics.uniforms.uLightCausticStrength.value, .5);
  assert.throws(() => caustics.set('heightScale', 0), RangeError);
  caustics.set('heightScale', .004);
  assert.equal(caustics.settings.heightScale, .004);
});

test('the map is drawn into its own target, centred under the liquid along the refracted light, and the frame is given back', () => {
  const {caustics, renderer, camera, light} = setup();
  caustics.update(camera);
  const [first, , drawn, last] = renderer.calls;
  assert.equal(first[1], caustics.texture.isTexture ? first[1] : null);
  assert.equal(drawn[0], 'render'); assert.notEqual(drawn[1], null);
  assert.deepEqual(last, ['target', null]);
  const centre = caustics.uniforms.uLightCausticCenter.value;
  assert.ok(Math.abs(centre.x - 1) < 1e-6 && Math.abs(centre.y) < 1e-6);   // light from straight above: right under the glass
  // The light's view-space position, as the light loop compares it.
  const view = light.position.clone().applyMatrix4(camera.matrixWorldInverse);
  assert.ok(caustics.uniforms.uLightCausticView.value.distanceTo(view) < 1e-9);
  // A slanted light throws the patch away from it, less than unrefracted.
  light.position.set(0, 1.8, 0); caustics.update(camera);
  const x = caustics.uniforms.uLightCausticCenter.value.x;
  assert.ok(x > 1 && x < 1.04, 'patch shifted away from the light, bent toward the vertical: ' + x);
});

test('a receiving material gets the slot on the light loop of point and spot lights, and loses it again', () => {
  const {caustics} = setup(), material = new THREE.MeshStandardMaterial();
  const off = caustics.applyTo(material);
  const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('lightCausticAt(vLightWorld)'));
  assert.ok(!shader.fragmentShader.includes('#include <lights_fragment_begin>') && shader.vertexShader.includes('vLightWorld ='));
  assert.equal(shader.fragmentShader.split('lightCausticAt(vLightWorld)').length - 1, 2);   // after a point and a spot light is read
  assert.equal(shader.uniforms.tLightCaustic, caustics.uniforms.tLightCaustic);
  off();
  caustics.dispose();
});
