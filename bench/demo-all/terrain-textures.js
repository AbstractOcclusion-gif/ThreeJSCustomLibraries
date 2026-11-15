import * as THREE from 'three';
import {valueNoise} from '../../src/core/value-noise.js';
import {createDataTexture} from '../../src/core/data-texture.js';
import {loadTerrainTextures, packTerrainLayers} from '../terrain/textures.js';

// Free repeatable diagnostic swatches. Alpha is micro-height, never transparency.
const SWATCH_SIZE = 96;
const SWATCH_SEED = 19, BYTE = 255;
const noise = valueNoise(SWATCH_SEED);
function periodicNoise(u, v, frequency) {
 u -= Math.floor(u);
 v -= Math.floor(v);
 const x = u * frequency, y = v * frequency;
 const blendX = THREE.MathUtils.smoothstep(u, 0, 1), blendY = THREE.MathUtils.smoothstep(v, 0, 1);
 return THREE.MathUtils.lerp(
  THREE.MathUtils.lerp(noise(x, y), noise(x - frequency, y), blendX),
  THREE.MathUtils.lerp(noise(x, y - frequency), noise(x - frequency, y - frequency), blendX), blendY,
 );
}
function relief(u, v) {
 return .5 + .23 * periodicNoise(u, v, 5) + .15 * periodicNoise(u + .23, v + .41, 13) + .09 * periodicNoise(u, v, 29);
}
function tile(pixel, colorSpace = THREE.NoColorSpace) {
 const data = new Uint8Array(SWATCH_SIZE * SWATCH_SIZE * 4);
 for (let y = 0; y < SWATCH_SIZE; y++) for (let x = 0; x < SWATCH_SIZE; x++) {
  data.set(pixel(x / SWATCH_SIZE, y / SWATCH_SIZE), (y * SWATCH_SIZE + x) * 4);
 }
 return createDataTexture(data, SWATCH_SIZE, SWATCH_SIZE, {wrap: THREE.RepeatWrapping, filter: 'mipmap', colorSpace});
}
const layerColors = {grass: [99, 108, 62], rock: [118, 110, 100], snow: [204, 216, 219], mud: [108, 83, 62], forest: [64, 52, 39]};

function proceduralTextures(error) {
 console.warn('Terrain photo maps unavailable. Using procedural textures.', error);
 const layers = Object.fromEntries(Object.entries(layerColors).map(([name, rgb], index) => [name, tile((u, v) => {
  const h = relief(u + index * .17, v);
  const grain = periodicNoise(u + index * .31, v, 33);
  const strata = name === 'rock' ? .045 * Math.sin(2 * Math.PI * (v * 7 + .65 * periodicNoise(u, v, 3))) : 0;
  const variation = .73 + h * .5 + .14 * grain + strata;
  return [...rgb.map(channel => channel * variation), h * BYTE];
 }, THREE.SRGBColorSpace)]));
 const layerArray = packTerrainLayers(layers);
 for (const [name, texture] of Object.entries(layers)) {
  if (name !== "rock") texture.dispose();
 }
 const detail = tile((u, v) => {
  const step = 1 / SWATCH_SIZE;
  const n = new THREE.Vector3(relief(u - step, v) - relief(u + step, v), relief(u, v - step) - relief(u, v + step), .5).normalize();
  return [(n.x * .5 + .5) * BYTE, (n.y * .5 + .5) * BYTE, (n.z * .5 + .5) * BYTE, BYTE];
 });
 return {layerArray, rock: layers.rock, detail};
}

export async function loadDemoTerrainTextures(renderer) {
 let maps;
 try {
  maps = await loadTerrainTextures(renderer);
 } catch (error) {
  maps = proceduralTextures(error);
 }
 const {layerArray, rock, detail} = maps;
 return {layerArray, rockTexture: rock, detail, dispose() { layerArray.dispose(); rock.dispose(); detail.dispose(); }};
}
