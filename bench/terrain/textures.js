import * as THREE from 'three';
import {TERRAIN_LAYERS} from '../../src/terrain/terrain-rules.js';

const files = import.meta.glob([
 '../../assets/terrain/*/{color,height}.jpg',
 '../../assets/terrain/rock_wall_02/normal.jpg',
], {eager: true, query: '?url', import: 'default'});
const sets = {grass: 'sparse_grass', rock: 'rock_wall_02', snow: 'snow_02', mud: 'brown_mud', forest: 'mud_forest'};

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

export async function loadTerrainTextures(renderer) {
 const loader = new THREE.ImageLoader();
 const load = (set, map) => loader.loadAsync(files[`../../assets/terrain/${set}/${map}.jpg`]);
 const [images, rockNormal] = await Promise.all([
  Promise.all(Object.entries(sets).map(([layer, set]) =>
   Promise.all([layer, load(set, 'color'), load(set, 'height')]))),
  load(sets.rock, 'normal'),
 ]);
 const canvas = document.createElement('canvas');
 const context = canvas.getContext('2d', {willReadFrequently: true});
 const anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
 function configure(texture) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
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
  const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer), color.width, color.height);
  texture.flipY = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return [layer, configure(texture)];
 }));
 return {layerArray: packTerrainLayers(layers), rock: layers.rock, detail: configure(new THREE.Texture(rockNormal))};
}
