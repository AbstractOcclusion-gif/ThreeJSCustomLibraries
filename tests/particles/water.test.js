import test from 'node:test';
import assert from 'node:assert/strict';
import * as Three from 'three';
import {createParticleDepthBinding, createWaterSpray, createPrecipitation, createOceanSheets, SOFT_DISC} from '../../src/particles/water/index.js';

function fixture(engine = Three) {
 const textures = [];
 class TextureLoader {
  load() {
   const texture = new engine.Texture();
   texture.disposals = 0;
   texture.addEventListener('dispose', () => { texture.disposals++; });
   textures.push(texture);
   return texture;
  }
 }
 const THREE = {...engine, TextureLoader};
 const camera = new THREE.PerspectiveCamera(50, 1, .1, 100);
 const scene = new THREE.Scene();
 const depthTexture = new THREE.DepthTexture(32, 32);
 const viewport = new THREE.Vector2(32, 32);
 const depth = createParticleDepthBinding({THREE, camera, depthTexture, viewport});
 const lighting = {
  direction: new THREE.Vector3(0, 1, 0),
  uniforms: {uSunCol: {value: new THREE.Color(1, .9, .8)}, uFxAmbient: {value: new THREE.Color(.2, .3, .4)}},
 };
 const surface = {
  glsl: 'uniform float uOceanAmplitude; float surfaceHeightAt(vec2 xz) { return 0.0; }',
  uniforms: {uOceanAmplitude: {value: 1}},
 };
 return {THREE, camera, scene, depth, depthTexture, textures, lighting, surface};
}

test('spray runs without any asset: generated soft disc for mist and droplets, separate pools, idempotent dispose', () => {
 const a = fixture(), b = fixture();
 const sprayA = createWaterSpray({...a, renderer: {}});
 const sprayB = createWaterSpray({...b, renderer: {}});
 assert.deepEqual(Object.keys(sprayA.sheets.SHEETS), [SOFT_DISC]);
 sprayA.mist(new Three.Vector3(0, .1, 0));
 sprayA.splash(new Three.Vector3(), .8, .2);
 sprayA.update(.01);
 assert.equal(sprayA.active.mist, 1);
 assert.ok(sprayA.active.droplets > 0);
 assert.deepEqual(sprayB.active, {mist: 0, droplets: 0});
 sprayA.clear();
 assert.deepEqual(sprayA.active, {mist: 0, droplets: 0});
 sprayA.dispose();
 sprayA.dispose();
 assert.equal(a.scene.children.length, 0);
 assert.equal(a.textures.length, 0);          // nothing went through TextureLoader
 assert.equal(b.scene.children.length, 2);
 assert.equal(a.depth.uniforms.tFxDepth.value, a.depthTexture);
 sprayB.dispose();
});

test('sheets resolve from assetBaseUrl or an explicit map and load through the injected loader', () => {
 const host = fixture();
 const sheets = createOceanSheets({THREE: host.THREE, assetBaseUrl: 'https://example.test/fx/', sheets: {custom: {url: 'https://example.test/c.webp', cols: 2, rows: 2}}});
 assert.equal(sheets.SHEETS['mist (8x8)'].src, 'https://example.test/fx/mist_sheet.webp');
 assert.deepEqual([sheets.SHEETS.custom.cols, sheets.SHEETS.custom.rows], [2, 2]);
 const spray = createWaterSpray({...host, renderer: {}, assets: {assetBaseUrl: 'https://example.test/fx/', dropletUrl: 'https://example.test/drop.png'}});
 spray.mist(new Three.Vector3(0, .1, 0));
 assert.ok(host.textures.length >= 2);        // mist sheet + droplet via the fixture loader
 spray.dispose();
 assert.ok(host.textures.every(texture => texture.disposals === 1));
});

test('droplet landings reach the supplied deposit callback', () => {
 const host = fixture();
 const landings = [];
 const originalRandom = Math.random;
 Math.random = () => .5;
 try {
  const spray = createWaterSpray({...host, renderer: {}, onDeposit: (...landing) => landings.push(landing)});
  spray.splash(new Three.Vector3(), 1, .3);
  for (let i = 0; i < 80; i++) spray.update(.02);
  assert.ok(landings.length > 0);
  assert.ok(landings.every(landing => landing.length === 4 && landing.every(Number.isFinite)));
  assert.equal(spray.active.droplets, 0);
  spray.dispose();
 } finally {
  Math.random = originalRandom;
 }
});

test('precipitation tolerates repeated disposal and later updates', () => {
 const group = new Three.Group();
 const rain = createPrecipitation({THREE: Three, group, count: 20});
 let disposed = 0;
 for (const node of group.children) {
  node.geometry.addEventListener('dispose', () => disposed++);
  node.material.addEventListener('dispose', () => disposed++);
 }
 rain.dispose();
 rain.dispose();
 rain.update(.1, {}, {}, new Three.Vector3());
 assert.equal(disposed, 4);
 assert.equal(group.children.length, 0);
 assert.equal(rain.instanceCount, 0);
});
