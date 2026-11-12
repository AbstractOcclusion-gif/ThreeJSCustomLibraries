import * as THREE from 'three';
import {TERRAIN_LAYERS} from '../../src/terrain/terrain-rules.js';
import {DEFAULT_TERRAIN_TEXTURES as sets, getTerrainTextureMap} from '../../src/terrain/textures.js';
import {configureTexture, createDataTexture} from '../../src/core/data-texture.js';

const files = import.meta.glob([
 '../../assets/terrain/*/{color,height}.jpg',
 '../../assets/terrain/rock_wall_02/normal.jpg',
 '../../assets/terrain/snow_02/{normal,roughness}.jpg',
], {eager: true, query: '?url', import: 'default'});

// The layer images share the same resolution and color space. Upload them as one texture unit.
export function packTerrainLayers(layers) {
 const source = layers.grass;
 const {width, height} = source.image;
 const rowBytes = width * 4, layerBytes = rowBytes * height;
 const pixels = new Uint8Array(layerBytes * TERRAIN_LAYERS.length);
 TERRAIN_LAYERS.forEach((name, layer) => {
  const texture = layers[name];
  const {data, width: w, height: h} = texture.image;
  if (w !== width || h !== height) throw Error('Terrain layer images must share a resolution');
  for (let y = 0; y < height; y++) {
   // WebGL array uploads cannot use UNPACK_FLIP_Y_WEBGL.
   const row = (texture.flipY ? height - 1 - y : y) * rowBytes;
   pixels.set(data.subarray(row, row + rowBytes), layer * layerBytes + y * rowBytes);
  }
 });
 const array = new THREE.DataArrayTexture(pixels, width, height, TERRAIN_LAYERS.length);
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

export async function loadTerrainTextures(renderer, {snowDetail = false} = {}) {
 const loader = new THREE.ImageLoader();
 const load = (set, role) => {
  const {path} = getTerrainTextureMap(set, role);
  const url = files[`../../assets/terrain/${path}`];
  if (!url) throw Error(`Terrain bench texture is missing: ${path}`);
  return loader.loadAsync(url);
 };
 const [images, rockNormal, snowMaps] = await Promise.all([
  Promise.all(Object.entries(sets).map(([layer, set]) =>
   Promise.all([layer, load(set, 'color'), load(set, 'height')]))),
  load(sets.rock, 'normal'),
  snowDetail ? Promise.all([load(sets.snow, 'normal'), load(sets.snow, 'roughness')]) : null,
 ]);
 const canvas = document.createElement('canvas');
 const context = canvas.getContext('2d', {willReadFrequently: true});
 const anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
 function configure(texture) {
  configureTexture(texture, {wrap: THREE.RepeatWrapping, filter: 'mipmap', anisotropy});
  texture.needsUpdate = true;
  return texture;
 }
 const layers = Object.fromEntries(images.map(([layer, color, height]) => {
  canvas.width = color.width;
  canvas.height = color.height;
  context.drawImage(color, 0, 0);
  const pixels = context.getImageData(0, 0, color.width, color.height).data;
  context.drawImage(height, 0, 0, color.width, color.height);
  const relief = context.getImageData(0, 0, color.width, color.height).data;
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = relief[i];
  return [layer, createDataTexture(new Uint8Array(pixels.buffer), color.width, color.height,
   {flipY: true, colorSpace: THREE.SRGBColorSpace, wrap: THREE.RepeatWrapping, filter: 'mipmap', anisotropy})];
 }));
 const layerArray = packTerrainLayers(layers);
 for (const [name, texture] of Object.entries(layers)) {
  if (name !== 'rock') texture.dispose();
 }
 const snowMaterial = snowMaps && {
  normal: configure(new THREE.Texture(snowMaps[0])),
  roughness: configure(new THREE.Texture(snowMaps[1])),
 };
 return {layerArray, rock: layers.rock, detail: configure(new THREE.Texture(rockNormal)), snowMaterial};
}
