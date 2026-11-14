import * as THREE from 'three';
import {TERRAIN_LAYERS} from '../../src/terrain/terrain-rules.js';
import {BIOME_TEXTURE_DEFAULTS, TERRAIN_PALETTE_ROUGHNESS} from '../../src/terrain/index.js';
import {DEFAULT_TERRAIN_TEXTURES, TERRAIN_TEXTURE_SETS, getTerrainTextureMap} from '../../src/terrain/textures.js';
import {configureTexture, createDataTexture} from '../../src/core/data-texture.js';

const files = import.meta.glob([
 '../../assets/terrain/*/{color,height,normal,roughness}.jpg',
], {eager: true, query: '?url', import: 'default'});

// The layer images share the same resolution and color space. Upload them as one texture unit.
// `order` names the slices: the terrain layers by default, any list of keys of `layers` otherwise.
export function packTerrainLayers(layers, order = TERRAIN_LAYERS) {
 const source = layers[order[0]];
 const {width, height} = source.image;
 const rowBytes = width * 4, layerBytes = rowBytes * height;
 const pixels = new Uint8Array(layerBytes * order.length);
 order.forEach((name, layer) => {
  const texture = layers[name];
  const {data, width: w, height: h} = texture.image;
  if (w !== width || h !== height) throw Error('Terrain layer images must share a resolution');
  for (let y = 0; y < height; y++) {
   // WebGL array uploads cannot use UNPACK_FLIP_Y_WEBGL.
   const row = (texture.flipY ? height - 1 - y : y) * rowBytes;
   pixels.set(data.subarray(row, row + rowBytes), layer * layerBytes + y * rowBytes);
  }
 });
 const array = new THREE.DataArrayTexture(pixels, width, height, order.length);
 array.colorSpace = source.colorSpace;
 array.wrapS = source.wrapS;
 array.wrapT = source.wrapT;
 array.minFilter = source.minFilter;
 array.magFilter = source.magFilter;
 array.generateMipmaps = source.generateMipmaps;
 array.anisotropy = source.anisotropy;
 array.needsUpdate = true;
 return array;
}

// True when every map of a catalogue set is bundled with the bench (a set added to the catalogue but not fetched is not).
export function hasTerrainTextureSet(set) {
 return Object.values(TERRAIN_TEXTURE_SETS[set]?.maps ?? {}).every(map => files[`../../assets/terrain/${map.path}`]) && Boolean(TERRAIN_TEXTURE_SETS[set]);
}

// The textures of a world palette ({sets, roles}): one slice per set, keyed by its place in the palette. A catalogue
// set whose files are not bundled gives way to the default set of its role and is named in `missing`.
export async function loadTerrainPalette(renderer, {sets, roles}) {
 const missing = [...new Set(sets.filter(set => !hasTerrainTextureSet(set)))];
 const bundled = sets.map((set, slice) => hasTerrainTextureSet(set) ? set : BIOME_TEXTURE_DEFAULTS[roles[slice]]);
 const textures = await loadTerrainTextures(renderer, {layerDetail: true, sets: Object.fromEntries(bundled.map((set, slice) => ['slice' + slice, set])),
  roles: Object.fromEntries(roles.map((role, slice) => ['slice' + slice, role]))});
 return {textures, missing};
}

export function terrainTextureUrl(set, role) {
 const {path} = getTerrainTextureMap(set, role);
 const url = files[`../../assets/terrain/${path}`];
 if (!url) throw Error(`Terrain bench texture is missing: ${path}`);
 return url;
}

const BYTE = 255, FLAT_NORMAL = 128;
const MEAN_STRIDE = 7;   // one pixel in this many is read for the average colour of a set

// layerDetail also returns layerDetailArray: per layer, normal xy in rg and roughness in b (createTerrainMaterial's
// layerDetailArray). A set without those maps gets a flat normal and the layer's default roughness.
// `sets` maps each slice to a catalogue set: the terrain layers by default. For other slices (a world palette), `roles`
// gives the palette role each slice plays; the shared detail normal and `rock` come from the first rock slice.
export async function loadTerrainTextures(renderer, {snowDetail = false, layerDetail = false, sets = DEFAULT_TERRAIN_TEXTURES, roles} = {}) {
 const order = Object.keys(sets);
 const roleOf = slice => roles?.[slice] ?? slice;
 const sliceOf = role => order.find(slice => roleOf(slice) === role);
 const loader = new THREE.ImageLoader();
 const load = (set, role) => loader.loadAsync(terrainTextureUrl(set, role));
 const loadDetail = (layer, role) => {
  const set = sets[sliceOf(layer)];
  return load(TERRAIN_TEXTURE_SETS[set]?.maps[role] ? set : DEFAULT_TERRAIN_TEXTURES[layer], role);
 };
 const optional = (set, role) => TERRAIN_TEXTURE_SETS[set]?.maps[role] ? load(set, role) : null;
 const [images, rockNormal, snowMaps, surfaces] = await Promise.all([
  Promise.all(Object.entries(sets).map(([layer, set]) =>
   Promise.all([layer, load(set, 'color'), load(set, 'height')]))),
  loadDetail('rock', 'normal'),
  snowDetail ? Promise.all([loadDetail('snow', 'normal'), loadDetail('snow', 'roughness')]) : null,
  layerDetail ? Promise.all(Object.entries(sets).map(([layer, set]) =>
   Promise.all([layer, optional(set, 'normal'), optional(set, 'roughness')]))) : null,
 ]);
 const canvas = document.createElement('canvas');
 const context = canvas.getContext('2d', {willReadFrequently: true});
 const anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
 function configure(texture) {
  configureTexture(texture, {wrap: THREE.RepeatWrapping, filter: 'mipmap', anisotropy});
  texture.needsUpdate = true;
  return texture;
 }
 // Average colour of each slice, linear: lets the material shift a set toward the colour of its role.
 const means = [];
 const layers = Object.fromEntries(images.map(([layer, color, height]) => {
  canvas.width = color.width;
  canvas.height = color.height;
  context.drawImage(color, 0, 0);
  const pixels = context.getImageData(0, 0, color.width, color.height).data;
  context.drawImage(height, 0, 0, color.width, color.height);
  const relief = context.getImageData(0, 0, color.width, color.height).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += MEAN_STRIDE * 4) for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[i + channel];
  const sampled = Math.ceil(pixels.length / (MEAN_STRIDE * 4));
  means.push(new THREE.Color().setRGB(...sum.map(total => total / sampled / BYTE), THREE.SRGBColorSpace));
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = relief[i];
  return [layer, createDataTexture(new Uint8Array(pixels.buffer), color.width, color.height,
   {flipY: true, colorSpace: THREE.SRGBColorSpace, wrap: THREE.RepeatWrapping, filter: 'mipmap', anisotropy})];
 }));
 const layerArray = packTerrainLayers(layers, order);
 let layerDetailArray;
 if (surfaces) {
  const {width, height} = layers[order[0]].image;
  const read = image => {
   canvas.width = width; canvas.height = height;
   context.drawImage(image, 0, 0, width, height);
   return context.getImageData(0, 0, width, height).data;
  };
  const packed = Object.fromEntries(surfaces.map(([layer, normal, roughness]) => {
   const pixels = new Uint8Array(width * height * 4).fill(BYTE);
   const tilt = normal && read(normal), rough = roughness && read(roughness);
   const flatRoughness = Math.round(TERRAIN_PALETTE_ROUGHNESS[roleOf(layer)] * BYTE);
   for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = tilt ? tilt[i] : FLAT_NORMAL;
    pixels[i + 1] = tilt ? tilt[i + 1] : FLAT_NORMAL;
    pixels[i + 2] = rough ? rough[i] : flatRoughness;
   }
   return [layer, createDataTexture(pixels, width, height,
    {flipY: true, wrap: THREE.RepeatWrapping, filter: 'mipmap', anisotropy})];
  }));
  layerDetailArray = packTerrainLayers(packed, order);
  for (const texture of Object.values(packed)) texture.dispose();
 }
 for (const [name, texture] of Object.entries(layers)) {
  if (name !== sliceOf('rock')) texture.dispose();
 }
 const snowMaterial = snowMaps && {
  normal: configure(new THREE.Texture(snowMaps[0])),
  roughness: configure(new THREE.Texture(snowMaps[1])),
 };
 return {layerArray, layerDetailArray, means, rock: layers[sliceOf('rock')], detail: configure(new THREE.Texture(rockNormal)), snowMaterial};
}
