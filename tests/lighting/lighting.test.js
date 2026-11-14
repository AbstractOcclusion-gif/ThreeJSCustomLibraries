import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createLightProbes, createLightRig, createSunShadows, cascadeSplits, createCascadeFitter, LIGHT_PROBE_DEFAULTS} from '../../src/lighting/index.js';
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

test('cascade splits end at the shadow distance and go from an even to a logarithmic cut', () => {
 assert.deepEqual(cascadeSplits(1, 101, 4, 0), [26, 51, 76, 101]);
 const log = cascadeSplits(1, 81, 4, 1);
 for (const [index, expected] of [3, 9, 27, 81].entries()) assert.ok(Math.abs(log[index] - expected) < 1e-9);
 const mixed = cascadeSplits(.5, 150, 4, .75);
 assert.ok(mixed.every((split, index) => split > (index ? mixed[index - 1] : .5)) && mixed[3] === 150);
 for (const bad of [[0, 10, 4, .5], [5, 5, 4, .5], [1, 10, 0, .5], [1, 10, 4, 2]]) assert.throws(() => cascadeSplits(...bad), RangeError);
});

test('a cascade wraps its slice of the view whichever way the view turns, and moves by whole texels', () => {
 const fitter = createCascadeFitter(), light = new THREE.OrthographicCamera(), sun = new THREE.Vector3(.3, .8, .5).normalize();
 const camera = new THREE.PerspectiveCamera(50, 16 / 9, .1, 400), resolution = 512, reach = 100;
 const fit = () => { camera.updateMatrixWorld(true); return fitter.fit(light, camera, 5, 30, sun, resolution, reach); };
 camera.position.set(10, 4, -6); camera.lookAt(0, 0, 0);
 const texel = fit(), radius = light.right;
 assert.ok(Math.abs(texel - 2 * radius / resolution) < 1e-12 && light.far === reach + 2 * radius);
 // Every corner of the slice falls inside the light camera.
 const tangent = Math.tan(THREE.MathUtils.degToRad(25)), corner = new THREE.Vector3();
 for (const distance of [5, 30]) for (const x of [-1, 1]) for (const y of [-1, 1]) {
  corner.set(x * tangent * distance * camera.aspect, y * tangent * distance, -distance).applyMatrix4(camera.matrixWorld).project(light);
  assert.ok(Math.abs(corner.x) <= 1 && Math.abs(corner.y) <= 1 && Math.abs(corner.z) < 1);
 }
 // The light camera looks along the sun, and its centre sits on a grid of whole texels in the light's own axes.
 const along = new THREE.Vector3(); light.getWorldDirection(along);
 assert.ok(along.dot(sun) < -.999999);
 const centre = light.position.clone().addScaledVector(sun, -(reach + radius)).applyMatrix4(light.matrixWorldInverse.clone().setPosition(0, 0, 0));
 for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(centre[axis] / texel - Math.round(centre[axis] / texel)) < 1e-6);
 // Turning the view keeps the size; a move smaller than a texel leaves the cascade where it is or shifts it by whole texels.
 const before = light.position.clone();
 camera.position.x += texel * .2; fit();
 const moved = light.position.clone().sub(before).applyMatrix4(light.matrixWorldInverse.clone().setPosition(0, 0, 0));
 for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(moved[axis] / texel - Math.round(moved[axis] / texel)) < 1e-6);
 camera.rotateY(1.1); fit();
 assert.equal(light.right, radius);
 assert.throws(() => fitter.fit(light, new THREE.OrthographicCamera(), 5, 30, sun, resolution, reach), TypeError);
});

// A renderer that only records what the shadows ask of it.
function recordingRenderer() {
 const calls = [];
 return {calls, autoClear: true, capabilities: {}, render: (scene, camera) => calls.push(['render', camera.layers.mask]), clear: () => calls.push(['clear']),
  setRenderTarget: target => calls.push(['target', target ? target.viewport.toArray() : null]), getRenderTarget: () => null, getActiveCubeFace: () => 0,
  getActiveMipmapLevel: () => 0, getScissorTest: () => false, getViewport: v => v, getScissor: v => v, getClearColor: c => c, getClearAlpha: () => 1,
  setScissorTest() {}, setViewport() {}, setScissor() {}, setClearColor: color => calls.push(['clearColor', color?.isColor ? color.toArray() : null]),
  state: {buffers: {color: {setMask: mask => calls.push(['colorMask', mask]), setLocked: locked => calls.push(['colorLock', locked])}}}};
}

test('sun shadows draw their cascades into the tiles of one atlas and give both lighting paths the same read', () => {
 const renderer = recordingRenderer(), shadows = createSunShadows({renderer, resolution: 256}), {uniforms} = shadows.sun;
 assert.throws(() => createSunShadows(), TypeError);
 for (const bad of [{cascades: 5}, {resolution: 100.5}, {lambda: 2}, {near: 200}, {every: [1, 1]}]) assert.throws(() => createSunShadows({renderer, ...bad}), RangeError);
 assert.throws(() => shadows.set('cascades', 2), /fixed at creation/); assert.throws(() => shadows.set('strength', 2), RangeError);
 assert.equal(shadows.set('strength', .5).settings.strength, .5);
 assert.deepEqual([shadows.atlas.image.width, shadows.atlas.image.height], [512, 512]);
 // The hook part and the slot of a lit material carry the same read, written once.
 const lighting = createLighting({sun: shadows.sun});
 assert.ok(lighting.glsl.includes('lightSunVisibility(worldPosition, n) * (ndl * sunVisibility)') && lighting.glsl.includes('#define SUN_SHADOW_CASCADES 4'));
 assert.equal(lighting.uniforms.uSunShadowAtlas.value, shadows.atlas);
 const material = new THREE.MeshStandardMaterial(), detach = shadows.applyTo(material);
 const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader};
 material.onBeforeCompile(shader);
 assert.match(shader.fragmentShader, /getDirectionalLightInfo\( directionalLight, directLight \);\s*\{[^\n]*\s*if \(directLight\.visible && dot\(directLight\.direction, transformDirection\(uSunShadowDir/);
 assert.equal(shader.uniforms.uSunShadowMatrix, uniforms.uSunShadowMatrix);
 detach();

 const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 16 / 9, .1, 400), sun = new THREE.Vector3(.3, .8, .5).normalize();
 const own = new THREE.MeshStandardMaterial(), glass = new THREE.MeshStandardMaterial({transparent: true});
 const caster = new THREE.Mesh(new THREE.BoxGeometry(), own), still = new THREE.Mesh(new THREE.BoxGeometry(), own), pane = new THREE.Mesh(new THREE.BoxGeometry(), glass);
 caster.castShadow = pane.castShadow = true; scene.add(caster, still, pane);
 camera.position.set(22, 3, -27); camera.lookAt(4, -2, -3); camera.updateMatrixWorld(true);
 const seen = [];
 renderer.render = () => seen.push([caster.material.isMeshDepthMaterial, caster.material.side, caster.layers.mask !== 1, still.layers.mask, pane.material === glass && pane.layers.mask === 1]);
 // First frame: every cascade; then the far ones wait (every: 1, 1, 2, 4).
 assert.deepEqual([0, 1, 2, 3, 4].map(() => shadows.render(scene, camera, sun)), [4, 2, 3, 3, 3]);
 // While a cascade is drawn the caster wears a depth material (back faces, as Three) on the shadow layer; then all is put back.
 assert.deepEqual(seen[0], [true, THREE.BackSide, true, 1, true]);
 assert.ok(caster.material === own && caster.layers.mask === 1 && renderer.autoClear === true && scene.background === null);
 assert.deepEqual(renderer.calls.filter(call => call[0] === 'target').slice(0, 4).map(call => call[1]), [[0, 0, 256, 256], [256, 0, 256, 256], [0, 256, 256, 256], [256, 256, 256, 256]]);
 // The point the camera looks at, 38 m away, lands inside the tile of a cascade, at a depth between the planes.
 const target = new THREE.Vector3(4, -2, -3), inside = uniforms.uSunShadowMatrix.value.map((matrix, index) => {
  const at = target.clone().applyMatrix4(matrix), tile = uniforms.uSunShadowTile.value[index];
  return at.x > tile.x && at.x < tile.z && at.y > tile.y && at.y < tile.w && at.z > 0 && at.z < 1;
 });
 assert.ok(!inside[0] && inside.includes(true));
 assert.ok(uniforms.uSunShadowTexel.value.x < uniforms.uSunShadowTexel.value.w && uniforms.uSunShadowLook.value.x === .5);
 assert.throws(() => shadows.render(scene, camera, [0, 1, 0]), TypeError);
 shadows.dispose(); assert.equal(shadows.render(scene, camera, sun), 0);
});

test('light shadows give each caster a block of the atlas, draw a spot once and a point light six times, and take turns', () => {
 const renderer = recordingRenderer(), rig = createLightRig({capacity: 4, shadows: {renderer, casters: 2, resolution: 128}}), {uniforms} = rig.lights;
 assert.throws(() => createLightRig().renderShadows(new THREE.Scene()), /no shadows/);
 for (const bad of [{casters: 0}, {resolution: 64.5}, {perFrame: 0}]) assert.throws(() => createLightRig({shadows: {renderer, ...bad}}), RangeError);
 assert.throws(() => rig.shadows.set('casters', 3), /fixed at creation/); assert.throws(() => rig.shadows.set('strength', -1), RangeError);
 // Two blocks of 3 x 2 tiles, side by side.
 assert.deepEqual([rig.shadows.atlas.image.width, rig.shadows.atlas.image.height], [768, 256]);
 assert.ok(rig.lights.glsl.includes('lightShadowOf(uRigCaster[i], worldPosition, n)') && !createLightRig().lights.glsl.includes('uRigCaster'));
 const scene = new THREE.Scene(), box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); box.castShadow = true;
 const point = new THREE.PointLight(0xffffff, 50, 20), spot = new THREE.SpotLight(0xffffff, 40, 0, Math.PI / 6), plain = new THREE.PointLight(0xffffff, 30), weak = new THREE.PointLight(0xffffff, 1);
 point.position.set(0, 4, 0); spot.position.set(5, 10, 0); spot.target.position.set(5, 0, 0);
 scene.add(box, point, spot, spot.target, plain, weak);
 rig.add(point, {shadow: true}); rig.add(spot, {shadow: true}); rig.add(plain); rig.add(weak, {shadow: true});
 assert.throws(() => rig.setShadow(new THREE.PointLight(), true), /not in the rig/);
 // Three lights want to cast, two blocks: the weakest waits.
 assert.equal(rig.update(), 4);
 const blockOf = light => rig.shadows.blockOf(light), casterOf = light => uniforms.uRigCaster.value[uniforms.uRigColor.value.findIndex(color => color.x === light.intensity)];
 assert.deepEqual([blockOf(point), blockOf(spot), blockOf(weak)].sort(), [-1, 0, 1]);
 assert.equal(blockOf(weak), -1); assert.equal(casterOf(point), blockOf(point)); assert.equal(casterOf(plain), -1);
 // New casters are all drawn at once: six faces and one cone.
 assert.equal(rig.renderShadows(scene), 2);
 assert.equal(renderer.calls.filter(call => call[0] === 'render').length, 7);
 assert.ok(box.material.isMeshStandardMaterial && box.layers.mask === 1);
 const place = uniforms.uLightShadowPlace.value[blockOf(point)], spotBlock = blockOf(spot);
 assert.deepEqual(place.toArray(), [0, 4, 0, 20]);                                           // where it was drawn, and its cutoff as far plane
 assert.equal(uniforms.uLightShadowPlace.value[spotBlock].w, rig.shadows.settings.range);    // no cutoff: the range
 assert.deepEqual(uniforms.uLightShadowKind.value[blockOf(point)].toArray(), [1, 1]);
 assert.ok(Math.abs(uniforms.uLightShadowKind.value[spotBlock].y - Math.tan(Math.PI / 6)) < 1e-9);
 // The point under the spot is seen in the middle of its tile.
 const seen = new THREE.Vector3(5, 0, 0).applyMatrix4(uniforms.uLightShadowMatrix.value[spotBlock]);
 assert.ok(Math.abs(seen.x) < 1e-6 && Math.abs(seen.y) < 1e-6 && seen.z > -1 && seen.z < 1);
 // Then one light per frame, in turn.
 assert.deepEqual([0, 1, 2].map(() => { rig.update(); return rig.renderShadows(scene); }), [1, 1, 1]);
 assert.equal(renderer.calls.filter(call => call[0] === 'render').length, 7 + 6 + 1 + 6 - (blockOf(point) === 0 ? 0 : 5));
 // A light that stops casting gives its block to the one that waited.
 rig.setShadow(point, false); rig.update();
 assert.ok(blockOf(point) === -1 && blockOf(weak) >= 0 && rig.castsShadow(spot) && !rig.castsShadow(point));
 // A lit Three material: the cut stands right after each kind of light is read.
 const material = new THREE.MeshStandardMaterial(); rig.applyTo(material);
 const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader};
 material.onBeforeCompile(shader);
 for (const kind of ['point', 'spot']) assert.ok(new RegExp(`get${kind[0].toUpperCase()}${kind.slice(1)}LightInfo\\( ${kind}Light, geometryPosition, directLight \\);\\s*\\{[^\\n]*\\s*if \\(directLight\\.visible\\) directLight\\.color \\*= lightShadowNear\\(${kind}Light\\.position`).test(shader.fragmentShader));
 assert.equal(shader.uniforms.uLightShadowAtlas.value, rig.shadows.atlas);
 rig.dispose(); assert.equal(rig.renderShadows(scene), 0);
});

test('with translucent shadows a transparent caster tints the light: a second draw behind the opaque depth, into the colour of the atlas', () => {
 const renderer = recordingRenderer(), shadows = createSunShadows({renderer, cascades: 1, resolution: 64, translucent: true});
 const rig = createLightRig({shadows: {renderer, casters: 1, resolution: 64, translucent: true}});
 assert.throws(() => shadows.set('translucent', false), /fixed at creation/);
 for (const [glsl, uniforms, name] of [[shadows.sun.glsl, shadows.sun.uniforms, 'uSunShadowGlass'], [rig.lights.glsl, rig.lights.uniforms, 'uLightShadowGlass']]) {
  assert.ok(glsl.includes(`uniform sampler2D ${name};`) && uniforms[name].value.isTexture && uniforms[name].value.type === THREE.HalfFloatType);
 }
 assert.ok(!createSunShadows({renderer}).sun.glsl.includes('uniform sampler2D uSunShadowGlass') && !('uSunShadowGlass' in createSunShadows({renderer}).sun.uniforms));
 const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, .1, 100), sun = new THREE.Vector3(0, 1, 0);
 const paneMaterial = new THREE.MeshStandardMaterial({color: 0xff0000, transparent: true, opacity: .5, side: THREE.DoubleSide});
 const pane = new THREE.Mesh(new THREE.PlaneGeometry(), paneMaterial), box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
 pane.castShadow = box.castShadow = true; scene.add(pane, box); camera.updateMatrixWorld(true);
 const seen = [];
 renderer.render = (drawn, lightCamera) => seen.push({layers: lightCamera.layers.mask, pane: pane.material, paneLayers: pane.layers.mask, box: box.material.isMeshDepthMaterial});
 assert.equal(shadows.render(scene, camera, sun), 1);
 // Two draws of the tile: the opaque casters with the colour locked, then the glass alone.
 assert.equal(seen.length, 2);
 assert.ok(seen[0].layers !== seen[1].layers && seen[0].box && (seen[1].paneLayers & seen[1].layers) !== 0 && (seen[0].paneLayers & seen[0].layers) === 0);
 const glass = seen[1].pane;
 assert.ok(glass.isMeshBasicMaterial && glass !== paneMaterial && glass.opacity === .5 && glass.color.equals(paneMaterial.color) && glass.side === THREE.DoubleSide);
 assert.ok(glass.blending === THREE.CustomBlending && glass.blendDst === THREE.SrcColorFactor && glass.blendEquationAlpha === THREE.MinEquation && glass.depthWrite === false);
 const order = renderer.calls.filter(call => ['clearColor', 'clear', 'colorMask', 'colorLock'].includes(call[0])).map(call => call.join(':'));
 assert.deepEqual(order.slice(0, 6), ['clearColor:1,1,1', 'clear', 'colorMask:false', 'colorLock:true', 'colorLock:false', 'colorMask:true']);
 assert.ok(pane.material === paneMaterial && pane.layers.mask === 1);
 // The glass follows its source, and its shader writes what it lets through and its depth.
 paneMaterial.opacity = .8; shadows.render(scene, camera, sun);
 assert.equal(glass.opacity, .8);
 const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader};
 glass.onBeforeCompile(shader);
 assert.ok(shader.fragmentShader.includes('1.0 - diffuseColor.a + diffuseColor.a * diffuseColor.rgb') && !shader.fragmentShader.includes('#include <opaque_fragment>') && shader.vertexShader.includes('vGlassDepth = -mvPosition.z;'));
 // Without glass in sight a tile is drawn once.
 pane.visible = false; seen.length = 0; shadows.render(scene, camera, sun);
 assert.equal(seen.length, 1);
 // A light: the far plane of its camera reaches the glass, so its depth is written over it.
 pane.visible = true; const spot = new THREE.SpotLight(0xffffff, 10, 25); spot.position.set(0, 5, 0); scene.add(spot, spot.target);
 rig.add(spot, {shadow: true}); rig.update(); seen.length = 0;
 assert.equal(rig.renderShadows(scene), 1); assert.equal(seen.length, 2);
 const lightShader = {uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader};
 seen[1].pane.onBeforeCompile(lightShader);
 assert.equal(lightShader.uniforms.uGlassFar.value, 25); assert.equal(shader.uniforms.uGlassFar.value, 0);
 shadows.dispose(); rig.dispose();
});
