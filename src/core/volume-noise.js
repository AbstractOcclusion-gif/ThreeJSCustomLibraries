import {Data3DTexture, LinearFilter, RedFormat, RepeatWrapping} from 'three';
import {fbmP} from './noise-3d.js';

// A periodic scalar noise field. Normalise the actual sampled range so density thresholds
// do not depend on the amplitude of a particular seed. Caller owns the texture.
export function createNoiseVolume({size = 32, period = 4, octaves = 3, seed = 17} = {}) {
  if (!Number.isInteger(size) || size < 8 || size > 64 ||
      !Number.isInteger(period) || period < 1 || period > size ||
      !Number.isInteger(octaves) || octaves < 1 || octaves > 5 || !Number.isInteger(seed)) {
    throw new RangeError('Volume noise needs size 8..64, period 1..size, octaves 1..5, and an integer seed');
  }
  const values = new Float32Array(size ** 3);
  const scale = period / size;
  let i = 0, low = Infinity, high = -Infinity;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbmP(x * scale, y * scale, z * scale, period, seed, octaves);
    values[i++] = n;
    low = Math.min(low, n);
    high = Math.max(high, n);
  }
  const range = Math.max(high - low, 1e-6);
  const data = Uint8Array.from(values, value => Math.round((value - low) / range * 255));
  const texture = new Data3DTexture(data, size, size, size);
  texture.format = RedFormat;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
