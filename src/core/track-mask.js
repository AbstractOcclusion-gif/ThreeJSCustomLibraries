import * as THREE from 'three';
import {createDataTexture} from './data-texture.js';

const BYTE = 255;

// A bounded world-XZ mask. The host decides which contacts leave marks.
export function createTrackMask({origin = [-32, -32], size = [64, 64], resolution = 256, directional = false} = {}) {
 if (origin.length !== 2 || size.length !== 2 || !origin.every(Number.isFinite) ||
     !size.every(value => Number.isFinite(value) && value > 0) ||
     !Number.isInteger(resolution) || resolution < 2 || resolution > 2048) throw Error('Invalid track mask bounds or resolution');
 const bounds = new THREE.Vector4(...origin, ...size);
 const stride = directional ? 4 : 1;
 const data = new Uint8Array(resolution * resolution * stride);
 const texture = createDataTexture(data, resolution, resolution, {format: directional ? THREE.RGBAFormat : THREE.RedFormat, filter: 'linear'});
 const cellX = size[0] / resolution, cellZ = size[1] / resolution;

 return {
  texture, bounds, directional,
  sample(x, z) {
   if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
   const column = Math.floor((x - bounds.x) / cellX), row = Math.floor((z - bounds.y) / cellZ);
   if (column < 0 || row < 0 || column >= resolution || row >= resolution) return 0;
   return data[(row * resolution + column) * stride] / BYTE;
  },
  stamp(from, to, radius, strength = 1) {
   if (![from.x, from.z, to.x, to.z, radius, strength].every(Number.isFinite) || radius <= 0 || strength < 0 || strength > 1) {
    throw Error('Track stamps need finite endpoints, a positive radius and strength from zero to one');
   }
   const dx = to.x - from.x, dz = to.z - from.z, lengthSquared = dx * dx + dz * dz;
   const length = Math.sqrt(lengthSquared);
   const dirX = length ? dx / length : 0, dirZ = length ? dz / length : 0;
   const minX = Math.max(0, Math.floor((Math.min(from.x, to.x) - radius - bounds.x) / cellX));
   const maxX = Math.min(resolution - 1, Math.floor((Math.max(from.x, to.x) + radius - bounds.x) / cellX));
   const minZ = Math.max(0, Math.floor((Math.min(from.z, to.z) - radius - bounds.y) / cellZ));
   const maxZ = Math.min(resolution - 1, Math.floor((Math.max(from.z, to.z) + radius - bounds.y) / cellZ));
   let changed = false;
   for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
     const px = bounds.x + (x + .5) * cellX - from.x, pz = bounds.y + (z + .5) * cellZ - from.z;
     const t = lengthSquared === 0 ? 0 : THREE.MathUtils.clamp((px * dx + pz * dz) / lengthSquared, 0, 1);
     const distance = Math.hypot(px - t * dx, pz - t * dz);
     const coverage = 1 - THREE.MathUtils.smoothstep(distance, radius * .55, radius);
     const value = Math.round(coverage * strength * BYTE), index = (z * resolution + x) * stride;
     if (value > data[index]) {
      data[index] = value;
      if (directional) {
       // Premultiply by strength so filtering against an empty texel preserves direction.
       data[index + 1] = Math.round(value * (.5 + .5 * dirX));
       data[index + 2] = Math.round(value * (.5 + .5 * dirZ));
      }
      changed = true;
     }
    }
   }
   if (changed) texture.needsUpdate = true;
  },
  clear() { data.fill(0); texture.needsUpdate = true; },
  dispose() { texture.dispose(); },
 };
}
