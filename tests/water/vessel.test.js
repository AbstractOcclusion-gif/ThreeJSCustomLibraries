import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRipples} from '../../src/water/ripples.js';
import {createVessel, vesselAbsorption, VESSEL_MAX_CONTENTS} from '../../src/water/vessel.js';

const field = () => createRipples({origin: [-.04, -.04], size: [16, 16], cell: .005});
const texel = (vessel, i, j) => { const n = vessel.normals.image.width, d = vessel.normals.image.data, o = (j * n + i) * 4; return [d[o], d[o + 1], d[o + 2]].map(v => v / 255 * 2 - 1); };

test('a vessel checks what it is given', () => {
  assert.throws(() => createVessel(), TypeError);
  assert.throws(() => createVessel({ripples: field(), radius: 0, depth: .05}), RangeError);
  assert.throws(() => createVessel({ripples: field(), radius: .04, depth: .05, clarity: 0}), RangeError);
  assert.throws(() => createVessel({ripples: field(), radius: .04, depth: .05, colour: 1}), /Unknown/);
  assert.throws(() => createVessel({ripples: field(), radius: .04, depth: .05}).set('segments', 12), /fixed/);
});

test('the liquid absorbs as WebAquarium water does, through Three\'s attenuation, and tints its shadow by its depth', () => {
  const vessel = createVessel({ripples: field(), radius: .04, depth: .05, color: 0xff8000, clarity: .02});
  const absorb = vesselAbsorption(0xff8000, .02), c = new THREE.Color(0xff8000);
  assert.ok(Math.abs(absorb.x - (1 - c.r) * 1.6 / .02 * .35) < 1e-9 && absorb.x < absorb.y && absorb.y < absorb.z);
  const {attenuationColor: a, attenuationDistance: d} = vessel.material;
  // Three: T = colour ^ (path / distance); the same as exp(-absorb x path).
  for (const [channel, k] of [['r', absorb.x], ['g', absorb.y], ['b', absorb.z]]) assert.ok(Math.abs(Math.log(a[channel]) / d + k) < 1e-6);
  assert.ok(Math.abs(vessel.shadowGlass.color.g - Math.exp(-absorb.y * .05)) < 1e-6);
  assert.equal(vessel.shadowGlass.side, THREE.FrontSide);
  assert.equal(vessel.material.transmission, 1); assert.equal(vessel.material.thickness, .05);
});

test('the surface normals follow the slopes of the field, flat when it rests', () => {
  const ripples = field(), vessel = createVessel({ripples, radius: .04, depth: .05, heightScale: .01, detail: 1, rimCells: 0});
  const [fx, fy, fz] = texel(vessel, 8, 8);
  assert.ok(Math.abs(fx) < .01 && Math.abs(fy) < .01 && fz > .99, 'flat: straight up');
  // A slope rising toward +x: the normal leans toward -x (u); rising toward +z: it leans toward +v.
  const h = ripples.texture.image.data;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) h[j * 16 + i] = i * .5;
  vessel.set('normalScale', 1);
  const [nx, ny] = texel(vessel, 8, 8);
  assert.ok(nx < -.1 && Math.abs(ny) < .02, `x slope: ${nx} ${ny}`);
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) h[j * 16 + i] = j * .5;
  vessel.set('normalScale', 1);
  const [mx, my] = texel(vessel, 8, 8);
  assert.ok(my > .1 && Math.abs(mx) < .02, `z slope: ${mx} ${my}`);
  vessel.dispose();
});

test('the surface flattens at its rim, the normal map is finer than the field, and the colour is capped as WebAquarium caps it', () => {
  const ripples = field(), vessel = createVessel({ripples, radius: .04, depth: .05, heightScale: .01, detail: 2, rimCells: 2});
  assert.equal(vessel.normals.image.width, 32);
  const h = ripples.texture.image.data;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) h[j * 16 + i] = i * .5;
  vessel.set('normalScale', 1);
  const [edge] = texel(vessel, 31, 16), [middle] = texel(vessel, 16, 16);
  assert.ok(middle < -.1 && Math.abs(edge) < Math.abs(middle) / 4, `rim ${edge} middle ${middle}`);
  assert.throws(() => vessel.set('detail', 3), /fixed/);
  // The meniscus and the cap are written into both materials, each measuring from the waterline its own way.
  for (const [material, distance] of [[vessel.material, 'uVesselRadius - length(vVesselLocal.xz)'], [vessel.sideMaterial, '-vVesselLocal.y']]) {
    const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader};
    material.onBeforeCompile(shader);
    assert.ok(shader.fragmentShader.includes(`float dist = ${distance};`) && shader.fragmentShader.includes('min(gl_FragColor.rgb, vec3(uMaxBrightness))'));
    assert.equal(shader.uniforms.uMaxBrightness.value, 6);
  }
  vessel.set('meniscusDark', .2);
  assert.equal(vessel.material.onBeforeCompile && vessel.materials.length, 2);
});

test('an object in the liquid takes its waterline: the line and a share of the tint below the live surface', () => {
  const ripples = field(), vessel = createVessel({ripples, radius: .04, depth: .05});
  const ice = new THREE.MeshPhysicalMaterial();
  assert.throws(() => vessel.submerge({}), TypeError);
  assert.throws(() => vessel.submerge(ice, {tint: 2}), RangeError);
  vessel.submerge(ice, {tint: .25});
  const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader};
  ice.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('vVesselWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'));
  assert.ok(shader.fragmentShader.includes('float d = level - local.y;') && shader.fragmentShader.includes('uVesselTint'));
  assert.equal(shader.uniforms.uVesselTint.value, .25);
  assert.equal(shader.uniforms.uVesselRipples.value, ripples.texture);
  assert.ok(ice.customProgramCacheKey().endsWith('|vessel-submerged'));
  vessel.group.position.set(1, 2, 3); vessel.update();
  assert.deepEqual(new THREE.Vector3(1, 2, 3).applyMatrix4(shader.uniforms.uVesselInverse.value).toArray(), [0, 0, 0]);
});

test('the body has no top: nothing of it stands at the surface', () => {
  const vessel = createVessel({ripples: field(), radius: .04, depth: .05});
  const position = vessel.body.geometry.attributes.position, index = vessel.body.geometry.index;
  // Every face with all three corners at the top would be a cap: there is none.
  let caps = 0;
  for (let f = 0; f < index.count; f += 3) if ([0, 1, 2].every(k => Math.abs(position.getY(index.getX(f + k))) < 1e-9)) caps++;
  assert.equal(caps, 0);
  vessel.body.geometry.computeBoundingBox();
  assert.ok(Math.abs(vessel.body.geometry.boundingBox.min.y + .05) < 1e-9);
});

test('the surface rises and falls with the field, and stays at rest at its rim', () => {
  const ripples = field(), vessel = createVessel({ripples, radius: .04, depth: .05, heightScale: .01, rimCells: 2, rings: 8});
  const position = vessel.surface.geometry.attributes.position, heights = () => Array.from({length: position.count}, (_, i) => position.getY(i));
  assert.ok(heights().every(y => y === 0), 'flat at rest');
  ripples.texture.image.data.fill(.5);
  vessel.set('normalScale', 1);
  let middle = 0, rim = 0;
  for (let i = 0; i < position.count; i++) {
    const away = Math.hypot(position.getX(i), position.getZ(i));
    if (away < .005) middle = Math.max(middle, Math.abs(position.getY(i) - .005));
    if (away > .0399) rim = Math.max(rim, Math.abs(position.getY(i)));
  }
  assert.ok(middle < 1e-6, 'the middle stands at the field\'s height x heightScale');
  assert.ok(rim < 1e-6, 'the rim stays at the still level');
  vessel.dispose();
});

test('a thing standing in the liquid is given to its path as its rounded box; the liquid glows with its own colour', () => {
  const vessel = createVessel({ripples: field(), radius: .04, depth: .05, color: 0xff8000, scatter: .5});
  const cube = new THREE.Object3D();
  cube.position.set(.01, -.02, 0);
  assert.throws(() => vessel.contain({}, new THREE.Vector3(1, 1, 1)), TypeError);
  assert.throws(() => vessel.contain(cube, new THREE.Vector3(.01, 0, .01)), RangeError);
  assert.throws(() => vessel.contain(cube, new THREE.Vector3(.01, .01, .01), .02), RangeError);
  const release = vessel.contain(cube, new THREE.Vector3(.01, .01, .01), .003);
  const shader = {uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader};
  vessel.material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('float vesselPath(') && !shader.fragmentShader.includes('#include <transmission_fragment>'), 'the path replaces Three\'s one thickness');
  vessel.update();
  assert.equal(shader.uniforms.uVesselContentCount.value, 1);
  assert.deepEqual(shader.uniforms.uVesselContentBox.value[0].toArray(), [.01, .01, .01, .003]);
  assert.deepEqual(new THREE.Vector3(.01, -.02, 0).applyMatrix4(shader.uniforms.uVesselContentInverse.value[0]).toArray(), [0, 0, 0]);
  const colour = new THREE.Color(0xff8000);
  assert.ok(Math.abs(shader.uniforms.uVesselScatter.value.g - colour.g * .5) < 1e-9);
  release(); vessel.update();
  assert.equal(shader.uniforms.uVesselContentCount.value, 0);
  for (let i = 0; i < VESSEL_MAX_CONTENTS; i++) vessel.contain(new THREE.Object3D(), new THREE.Vector3(1, 1, 1));
  assert.throws(() => vessel.contain(new THREE.Object3D(), new THREE.Vector3(1, 1, 1)), /at most/);
  vessel.dispose();
});

test('a closed field keeps its volume: a splash leaves the mean level where it was', () => {
  const stir = closed => {
    const ripples = createRipples({origin: [-.04, -.04], size: [16, 16], cell: .005, closed});
    ripples.mask((x, z) => Math.hypot(x, z) < .035);
    ripples.splash(0, 0, 1, .01);
    for (let i = 0; i < 30; i++) ripples.update(1 / 60);
    const heights = ripples.texture.image.data;
    return {mean: heights.reduce((sum, h) => sum + h, 0) / heights.length, moved: heights.some(h => Math.abs(h) > 1e-4)};
  };
  const open = stir(false), closed = stir(true);
  assert.ok(open.mean < -1e-4, `open water: the dip lowers the level (${open.mean})`);
  assert.ok(Math.abs(closed.mean) < 1e-7 && closed.moved, `closed: the level stays (${closed.mean})`);
});
