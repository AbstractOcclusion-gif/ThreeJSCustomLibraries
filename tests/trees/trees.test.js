import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {LeavedTrees, leavedTreeGeometry, resolveProfile, mergeProfile, PROFILES, createLeavedMaterial} from '../../src/trees/index.js';
import {createLighting} from '../../src/core/lighting.js';

test('profiles resolve by name or partial object and presets/trees mirror the built-in ones', () => {
 const tree = resolveProfile('tree'), bush = resolveProfile({base: 'bush', cards: {scale: .4}});
 assert.equal(tree.trunk.enabled, true);
 assert.equal(bush.trunk.enabled, false);
 assert.equal(bush.cards.scale, .4);
 assert.deepEqual(bush.lobes.count, [3, 5]);
 assert.throws(() => resolveProfile('oak'), /Unknown/);
 for (const name of ['tree', 'bush']) {
  const {schema, version, ...profile} = JSON.parse(fs.readFileSync(new URL(`../../presets/trees/${name}.json`, import.meta.url), 'utf8'));
  assert.equal(schema, 'three-kit.tree-profile');
  assert.deepEqual(profile, PROFILES[name]);
 }
 assert.deepEqual(mergeProfile({a: {b: 1, c: [1, 2]}}, {a: {c: [3]}}), {a: {b: 1, c: [3]}});
});

test('geometry is deterministic per variant, carries sway/leaf/color attributes, bush has no trunk', () => {
 const a = leavedTreeGeometry('tree', 2), b = leavedTreeGeometry('tree', 2), c = leavedTreeGeometry('tree', 3);
 assert.deepEqual([...a.attributes.position.array.slice(0, 30)], [...b.attributes.position.array.slice(0, 30)]);
 assert.notDeepEqual([...a.attributes.position.array.slice(0, 30)], [...c.attributes.position.array.slice(0, 30)]);
 for (const name of ['position', 'normal', 'uv', 'color', 'sway', 'leaf']) assert.ok(a.attributes[name], name);
 const leafCount = g => g.attributes.leaf.array.reduce((n, v) => n + v, 0);
 assert.ok(leafCount(a) > 0 && leafCount(a) < a.attributes.position.count);
 const tree = leavedTreeGeometry('tree', 0), bush = leavedTreeGeometry('bush', 0);
 const minY = g => Math.min(...g.attributes.position.array.filter((_, i) => i % 3 === 1));
 assert.ok(minY(tree) < 0);              // trunk foot below ground
 assert.ok(minY(bush) > -.01);           // no trunk
 const maxY = Math.max(...tree.attributes.position.array.filter((_, i) => i % 3 === 1));
 assert.ok(maxY > .9 && maxY < 1.3);     // template height ≈ 1
});

test('LeavedTrees batches per cell and variant, tints instances and rebuilds on setProfile', () => {
 const scene = new THREE.Scene();
 const trees = new LeavedTrees({scene, profile: 'tree', lighting: createLighting(), cellSize: 80, sampleGround: (x, z) => x * .01});
 const items = [];
 for (let i = 0; i < 40; i++) items.push({x: (i % 8) * 25, z: Math.floor(i / 8) * 25, h: 8, r: 2.6, tint: [.3, .5, .2]});
 items.push({x: 1, z: 1, h: 3, r: 1, tint8: [255, 0, 0]});
 trees.place(items);
 assert.equal(trees.count, 41);
 assert.ok(trees.meshes.length > 1 && trees.meshes.length <= 3 * 3 * 4);
 assert.ok(trees.meshes.every(m => m.instanceColor && m.material === trees.material));
 const red = trees.meshes.find(m => m.name && [...Array(m.count).keys()].some(i => { const c = new THREE.Color(); m.getColorAt(i, c); return c.r > .99 && c.g === 0; }));
 assert.ok(red, 'tint8 applied as sRGB');
 const before = trees.templates[0];
 trees.setProfile('bush');
 assert.notEqual(trees.templates[0], before);
 assert.equal(trees.count, 41);
 assert.equal(trees.profile.name, 'bush');
 trees.update(.5); trees.setWind(.3);
 assert.equal(trees.material.uniforms.uTime.value, .5);
 trees.dispose();
 assert.equal(scene.children.length, 0);
});

test('material honours the lighting hook and optional defines', () => {
 const lighting = {glsl: 'uniform vec3 uSunDir; vec3 shade(vec3 a, vec3 n, float s, float ao, float w) { return a; } vec3 applyFog(vec3 c, float d) { return c; }', uniforms: {uSunDir: {value: new THREE.Vector3()}}};
 const plain = createLeavedMaterial({lighting, leafTexture: new THREE.Texture()});
 assert.deepEqual(plain.defines, {});
 assert.ok(plain.fragmentShader.includes('vec3 shade(vec3 a'));
 const full = createLeavedMaterial({lighting, leafTexture: new THREE.Texture(), canopy: {texture: new THREE.Texture(), extent: new THREE.Vector2(100, 100)}, nearHole: true});
 assert.deepEqual(full.defines, {USE_CANOPY_MAP: 1, USE_NEAR_HOLE: 1});
 assert.equal(full.uniforms.uExtent.value.x, 100);
 assert.equal(plain.uniforms.uSunDir, lighting.uniforms.uSunDir);
});
