import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGrassField, createSpecimens, createProceduralMeadowTree, createFreeVegetation, createGrassClumpGeometries, loadSyntyVegetation, createSyntyVariantLoader} from '../../src/vegetation/index.js';

test('free vegetation assets: atlas, clump LODs with bendWeight, procedural tree parts', () => {
 const free = createFreeVegetation();
 assert.equal(free.atlas.image.width, 384);
 assert.equal(free.grassGeometries.length, 2);
 assert.ok(free.grassGeometries.every(g => g.attributes.bendWeight && g.attributes.uv));
 const [near, far] = createGrassClumpGeometries({cards: 4});
 assert.ok(near.attributes.position.count > far.attributes.position.count);
 const parts = createProceduralMeadowTree(free.reference, {width: 1.2, asymmetry: .3});
 assert.deepEqual(parts.map(p => p.material), ['bark', 'leaf']);
 assert.ok(parts[1].foliage && parts[1].position.length > 0);
 free.dispose();
});

test('grass field adopts per-instance tint as instanceColor and leaves untinted tiles alone', () => {
 const free = createFreeVegetation();
 const scene = new THREE.Scene();
 const placements = [
  {x: 0, y: 0, z: 0, yaw: 0, scale: 1, tint: [1, .5, .5]}, {x: 1, y: 0, z: 0, yaw: 0, scale: 1},
  {x: 30, y: 0, z: 30, yaw: 0, scale: 1},
 ];
 const grass = createGrassField({scene, geometries: free.grassGeometries, map: free.atlas, color: 0x88aa55, placements, tileSize: 5});
 const meshes = scene.children.filter(o => o.isInstancedMesh);
 assert.equal(meshes.length, 4);                       // 2 tiles × 2 LODs
 const tinted = meshes.filter(m => m.instanceColor), plain = meshes.filter(m => !m.instanceColor);
 assert.equal(tinted.length, 2);
 assert.equal(plain.length, 2);
 assert.deepEqual([...tinted[0].instanceColor.array.slice(0, 6)], [1, .5, .5, 1, 1, 1]);
 grass.update(.016, {camera: new THREE.PerspectiveCamera(), windX: 1, windZ: 0, gust: .5, transmission: 1, lodDistance: 20, farDensity: .5, shadowDistance: 10, density: 1});
 assert.equal(grass.stats.visibleTiles + grass.stats.shadowTiles >= 0, true);
 grass.dispose();
 assert.equal(scene.children.length, 0);
 free.dispose();
});

test('specimens build an instanced batch per kind from procedural parts', () => {
 const free = createFreeVegetation();
 const scene = new THREE.Scene();
 const tree = createProceduralMeadowTree(free.reference);
 const specimens = createSpecimens({scene, parts: {tree}, atlas: free.atlas, atlasRects: free.atlasRects,
  placements: {tree: [{x: 0, y: 0, z: 0, yaw: 0, scale: 1}, {x: 4, y: 0, z: 0, yaw: 1, scale: 1.2}]}, profiles: {tree: {mode: 'tree', height: 7}}});
 const mesh = scene.children[0];
 assert.equal(mesh.name, 'tree');
 assert.ok(mesh.geometry.attributes.plantMotion);
 specimens.setCount(2);
 assert.equal(mesh.count, 2);
 specimens.update(.1, {windX: 2, windZ: 0, gust: 1, sweep: {x: 1, z: 0, radius: 1, speed: 3}});
 specimens.dispose();
 assert.equal(scene.children.length, 0);
 free.dispose();
});

test('synty loaders resolve every file from baseUrl through injected fetch and loader', async () => {
 const requested = [];
 const fetcher = async url => {
  requested.push(url);
  const body = url.endsWith('grass.json') ? [{position: [0, 0, 0, 1, 0, 0, 0, 1, 0], uv: [0, 0, 1, 0, 0, 1], bend: [0, 0, 1]}]
   : url.endsWith('specimens.json') ? {bush: []}
   : url.endsWith('specimen-atlas.json') ? [[0, 0, .5, 1], [.5, 0, .1, 1], [.6, 0, .1, 1], [.7, 0, .1, 1], [.8, 0, .1, 1]]
   : url.endsWith('manifest.json') ? {rectangles: {leaf: [0, 0, 1, 1]}, variants: {abc: {label: 'x', parts: [{material: 'leaf', foliage: true, offset: 0, vertices: 1}]}}}
   : null;
  if (url.endsWith('.bin')) return {ok: true, arrayBuffer: async () => new Float32Array([1, 2, 3, .5, .5]).buffer};
  return {ok: true, json: async () => body};
 };
 const loader = {loadAsync: async () => new THREE.Texture()};
 const pack = await loadSyntyVegetation({baseUrl: 'https://example.test/veg', loader, fetch: fetcher});
 assert.equal(pack.grassGeometries.length, 1);
 assert.ok(Math.abs(pack.grassGeometries[0].attributes.uv.getX(1) - .5) < 1e-9);  // mapped into the grass rect
 assert.deepEqual(Object.keys(pack.atlasRects), ['bushTrunk', 'birchTrunk', 'leaf', 'branch']);
 const variants = createSyntyVariantLoader({baseUrl: 'https://example.test/veg/', loader, fetch: fetcher});
 const entry = await variants.load('abc');
 assert.deepEqual([...entry.parts[0].position], [1, 2, 3]);
 await assert.rejects(variants.load('nope'), /Unknown/);
 assert.ok(requested.every(u => u.startsWith('https://example.test/veg/')));
 variants.dispose(); pack.dispose();
});
