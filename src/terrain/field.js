import * as THREE from 'three';
import {createTerrainRules} from './terrain-rules.js';

// Heights are row-major along +X and +Z, in metres. The mesh and shaders share this grid.
export function createTerrainField({origin = [0, 0], size, resolution, heights, seed = 1, rules: settings} = {}) {
 const [nx, nz] = resolution ?? [];
 if (![nx, nz].every(n => Number.isInteger(n) && n >= 2 && n <= 1025) || heights?.length !== nx * nz ||
     origin.length !== 2 || size?.length !== 2 || !origin.every(Number.isFinite) ||
     !size.every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(seed)) throw Error('Invalid terrain grid');
 const samples = Float32Array.from(heights);
 if (!samples.every(Number.isFinite)) throw Error('Terrain heights must be finite');
 const rules = createTerrainRules(seed, {mudFromRunout: false, ...settings});
 const [width, depth] = size, stepX = width / (nx - 1), stepZ = depth / (nz - 1);
 const geometry = new THREE.PlaneGeometry(width, depth, nx - 1, nz - 1).rotateX(-Math.PI / 2);
 geometry.translate(origin[0] + width / 2, 0, origin[1] + depth / 2);
 const positions = geometry.getAttribute('position');
 for (let i = 0; i < samples.length; i++) positions.setY(i, samples[i]);
 geometry.computeVertexNormals();
 const heightMap = new THREE.DataTexture(samples, nx, nz, THREE.RedFormat, THREE.FloatType);
 const weights = new Uint8Array(samples.length * 4);
 const weightMap = new THREE.DataTexture(weights, nx, nz);
 weightMap.minFilter = weightMap.magFilter = THREE.LinearFilter;
 heightMap.needsUpdate = true;
 const bounds = new THREE.Vector4(...origin, ...size);
 function updateRules(values = {}) {
  rules.configure(values);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
   const index = z * nx + x, height = samples[index];
   const left = samples[z * nx + Math.max(0, x - 1)], right = samples[z * nx + Math.min(nx - 1, x + 1)];
   const north = samples[Math.max(0, z - 1) * nx + x], south = samples[Math.min(nz - 1, z + 1) * nx + x];
   const dx = (right - left) / (stepX * (x === 0 || x === nx - 1 ? 1 : 2));
   const dz = (south - north) / (stepZ * (z === 0 || z === nz - 1 ? 1 : 2));
   const curvature = (left + right - 2 * height) / (stepX * stepX) + (north + south - 2 * height) / (stepZ * stepZ);
   const layers = rules.weights({x: bounds.x + x * stepX, z: bounds.y + z * stepZ, height, slope: Math.hypot(dx, dz), curvature});
   for (let i = 0; i < 4; i++) weights[index * 4 + i] = Math.round(layers[i] * 255);
  }
  weightMap.needsUpdate = true;
 }
 function heightAt(x, z) {
  const gx = (x - bounds.x) / stepX, gz = (z - bounds.y) / stepZ;
  if (gx < 0 || gz < 0 || gx > nx - 1 || gz > nz - 1) return undefined;
  const ix = Math.min(Math.floor(gx), nx - 2), iz = Math.min(Math.floor(gz), nz - 2);
  const u = gx - ix, v = gz - iz, a = samples[iz * nx + ix], b = samples[iz * nx + ix + 1];
  const c = samples[(iz + 1) * nx + ix], d = samples[(iz + 1) * nx + ix + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
 }
 updateRules();
 return {geometry, bounds, heightMap, weightMap, heightAt, updateRules,
  dispose() { geometry.dispose(); heightMap.dispose(); weightMap.dispose(); }};
}
