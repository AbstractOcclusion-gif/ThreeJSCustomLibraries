import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {TERRAIN_LAYERS} from '../../src/terrain/terrain-rules.js';
import {DEFAULT_TERRAIN_TEXTURES, TERRAIN_TEXTURE_SETS, getTerrainTextureMap} from '../../src/terrain/textures.js';

const ASSETS = fileURLToPath(new URL('../../assets/terrain/', import.meta.url));
const REQUIRED_ROLES = ['color', 'height'];

// Width and height from the first start-of-frame segment of a JPEG.
function jpegSize(path) {
 const data = readFileSync(path);
 assert.equal(data.readUInt16BE(0), 0xffd8, `${path} is not a JPEG`);
 for (let offset = 2; offset < data.length;) {
  const marker = data.readUInt16BE(offset), length = data.readUInt16BE(offset + 2);
  const frame = marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker);
  if (frame) return [data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5)];
  offset += 2 + length;
 }
 throw Error(`${path} has no JPEG frame`);
}

test('the texture catalogue gives every layer a default set with colour and height', () => {
 assert.deepEqual(Object.keys(DEFAULT_TERRAIN_TEXTURES), TERRAIN_LAYERS);
 for (const [layer, id] of Object.entries(DEFAULT_TERRAIN_TEXTURES)) assert.ok(TERRAIN_TEXTURE_SETS[id], `${layer} defaults to unknown set ${id}`);
 for (const set of Object.values(TERRAIN_TEXTURE_SETS)) {
  for (const role of REQUIRED_ROLES) assert.ok(set.maps[role], `${set.id} has no ${role} map`);
  assert.equal(set.maps.color.colorSpace, 'srgb');
  for (const [role, map] of Object.entries(set.maps)) if (role !== 'color') assert.equal(map.colorSpace, 'linear', `${set.id}/${role}`);
 }
 assert.throws(() => getTerrainTextureMap('sparse_grass', 'metalness'), RangeError);
 assert.throws(() => getTerrainTextureMap('toString', 'color'), RangeError);
});

test('every catalogue map is in assets/terrain and all colour maps share one size, so any set can go on any layer', () => {
 const sizes = new Map();
 for (const set of Object.values(TERRAIN_TEXTURE_SETS)) {
  for (const [role, map] of Object.entries(set.maps)) {
   assert.ok(existsSync(ASSETS + map.path), `assets/terrain/${map.path} is missing: run npm run textures:fetch`);
   if (role === 'color') sizes.set(set.id, jpegSize(ASSETS + map.path).join('x'));
  }
 }
 const [expected] = sizes.values();
 for (const [id, size] of sizes) assert.equal(size, expected, `${id} colour map is ${size}, the others are ${expected}`);
});
