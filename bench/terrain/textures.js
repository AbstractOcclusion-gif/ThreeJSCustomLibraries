import * as THREE from 'three';

const files = import.meta.glob('../../assets/terrain/*/*.jpg', {eager: true, query: '?url', import: 'default'});
const sets = {grass: 'sparse_grass', rock: 'rock_wall_02', snow: 'snow_02', mud: 'mud_forest'};

export async function loadTerrainTextures(renderer) {
 const loader = new THREE.ImageLoader();
 const load = (set, map) => loader.loadAsync(files[`../../assets/terrain/${set}/${map}.jpg`]);
 const images = await Promise.all(Object.entries(sets).map(async ([layer, set]) => [layer, await load(set, 'color'), await load(set, 'height')]));
 const rockNormal = await load(sets.rock, 'normal');
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
 return {layers, detail: configure(new THREE.Texture(rockNormal))};
}
