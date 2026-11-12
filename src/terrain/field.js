import * as THREE from 'three';
import {createTerrainRules} from './terrain-rules.js';
import {createDataTexture} from '../core/data-texture.js';
import {valueNoise} from '../core/value-noise.js';

const MAX_RESOLUTION = 1025;   // samples per side
const BYTE = 255;              // 8-bit weight and coverage scale
const BASE_LAYERS = 4;         // grass, rock, snow, mud: one RGBA weight texel; layer 4 (forest floor) has its own map
const FOREST_LAYER = 4;
const MAX_DIG = .65;           // m below the original surface a deformation may dig
export const SNOW_DEPTH_SCALE = Object.freeze({min: .25, max: 2, initial: 1});
// Snow layer settings. Depths are metres before the depth scale.
export const SNOW_DEFAULTS = Object.freeze({
 driftDepth: .31,      // mean undisturbed depth on flat ground
 driftVariation: .12,  // drifts add or remove up to this much
 driftSize: 7,         // width of a drift across the wind
 driftHeading: 35,     // degrees the wind blows along: 0 = +X, 90 = +Z; drifts stretch this way
 coverFrom: .015,      // the ground shows through below this depth
 coverFull: .11,       // fully covered from this depth
 packedShare: .4,      // share of the fresh depth left under a fully packed track: lower sinks deeper (needs snowTrackRims)
 rimShare: .5,         // share of the displaced snow pushed up around a track
 rimMaxRise: .12,      // highest a rim may stand above the deepest fresh drift
});
export const SNOW_FIELDS = Object.freeze({
 driftDepth: {label: 'Drift depth · m', min: .02, max: .8, step: .01},
 driftVariation: {label: 'Drift variation · m', min: 0, max: .4, step: .01},
 driftSize: {label: 'Drift size · m', min: 1, max: 40, step: .5},
 driftHeading: {label: 'Drift wind heading · °', min: 0, max: 360, step: 5},
 coverFrom: {label: 'Ground shows below · m', min: 0, max: .1, step: .005},
 coverFull: {label: 'Full cover from · m', min: .02, max: .4, step: .005},
 packedShare: {label: 'Packed snow left under tracks', min: .05, max: 1, step: .01},
 rimShare: {label: 'Snow pushed to track rims', min: 0, max: 1, step: .01},
 rimMaxRise: {label: 'Rim max rise · m', min: 0, max: .3, step: .01},
});
export function validateSnow(values) {
 for (const [key, value] of Object.entries(values)) {
  const spec = SNOW_FIELDS[key];
  if (!spec || !Number.isFinite(value) || value < spec.min || value > spec.max) throw Error('Invalid snow setting: ' + key);
 }
 return values;
}
// Highest the snow surface may stand above the soil at depth scale 1: bounds every snow edit.
const MAX_SNOW_RISE = SNOW_FIELDS.driftDepth.max + SNOW_FIELDS.driftVariation.max + SNOW_FIELDS.rimMaxRise.max;
// Track rim profile in shares of the track radius: rises from start, peaks, and ends.
// Where displaced material piles up around a track, as shares of the track radius. Snow and soil rims share it.
const SNOW_RIM = Object.freeze({start: .7, peak: .95, end: 1.2});
const SOIL_RIM_MAX_RISE = .1;  // m a rim of soil (mud, sand) may stand above the original ground
const DIG_FALLOFF_START = .15; // share of the radius dug at full depth before the smooth falloff
const FULL_NORMALS_DIVISOR = 3;   // more than 1 / this of the grid changed: recompute all normals at once
// Snow cover: depth = (driftDepth + driftVariation x noise) x smoothstep(flatness). The noise is two octaves (the second
// `octave` x finer and weighted `detail`), `stretch` x longer along the wind than across; seed is an offset from the terrain seed.
const SNOW_DRIFT = Object.freeze({flatness: [.55, .95], stretch: 2.6, octave: 2.3, detail: .45, seed: 91});

// Heights are row-major along +X and +Z, in metres. The mesh and shaders share this grid.
export function createTerrainField({origin = [0, 0], size, resolution, heights, seed = 1, rules: settings, snow: snowOverrides, snowTrackRims = false} = {}) {
 const [nx, nz] = resolution ?? [];
 if (![nx, nz].every(n => Number.isInteger(n) && n >= 2 && n <= MAX_RESOLUTION) || heights?.length !== nx * nz ||
     origin.length !== 2 || size?.length !== 2 || !origin.every(Number.isFinite) ||
     !size.every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(seed)) throw Error('Invalid terrain grid');
 const samples = Float32Array.from(heights);
 const original = samples.slice();
 if (!samples.every(Number.isFinite)) throw Error('Terrain heights must be finite');
 const rules = createTerrainRules(seed, {mudFromRunout: false, ...settings});
 const snowSettings = {...SNOW_DEFAULTS};
 const driftNoise = valueNoise(seed + SNOW_DRIFT.seed);
 // Drift settings apply the next time snow is laid (resetDeformation); cover, packing and rim settings to the next edit.
 function configureSnow(values = {}) {
  const next = validateSnow({...snowSettings, ...values});
  if (next.coverFull <= next.coverFrom) throw Error('Snow full cover depth must exceed the depth where the ground shows');
  Object.assign(snowSettings, next);
 }
 configureSnow(snowOverrides);
 const [width, depth] = size, stepX = width / (nx - 1), stepZ = depth / (nz - 1);
 const geometry = new THREE.PlaneGeometry(width, depth, nx - 1, nz - 1).rotateX(-Math.PI / 2);
 geometry.translate(origin[0] + width / 2, 0, origin[1] + depth / 2);
 const positions = geometry.getAttribute('position');
 for (let i = 0; i < samples.length; i++) positions.setY(i, samples[i]);
 geometry.computeVertexNormals();
 // All edits stay inside this envelope, so local edits need no bounds scan.
 geometry.computeBoundingBox();
 geometry.boundingBox.min.y -= MAX_DIG;
 geometry.boundingBox.max.y += MAX_SNOW_RISE * SNOW_DEPTH_SCALE.max;
 geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
 const heightMap = createDataTexture(samples, nx, nz, {format: THREE.RedFormat, type: THREE.FloatType});
 const weights = new Uint8Array(samples.length * 4);
 const weightMap = createDataTexture(weights, nx, nz, {filter: 'linear'});
 const forestWeights = settings?.forestCover !== undefined ? new Uint8Array(samples.length) : null;
 const forestMap = forestWeights ? createDataTexture(forestWeights, nx, nz, {format: THREE.RedFormat, filter: 'linear'}) : null;
 // Sand has its own map too: it lies over the other layers. Pass rules.sandBelow to enable it.
 const sandWeights = settings?.sandBelow !== undefined ? new Uint8Array(samples.length) : null;
 const sandMap = sandWeights ? createDataTexture(sandWeights, nx, nz, {format: THREE.RedFormat, filter: 'linear'}) : null;
 const bounds = new THREE.Vector4(...origin, ...size);
 function updateRules(values = {}) {
  if (!forestMap && values.forestCover > 0) throw Error('Enable forest cover when creating the terrain field');
  if (!sandMap && values.sandBelow !== undefined) throw Error('Enable sand when creating the terrain field');
  rules.configure(values);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
   const index = z * nx + x, height = samples[index];
   const left = samples[z * nx + Math.max(0, x - 1)], right = samples[z * nx + Math.min(nx - 1, x + 1)];
   const north = samples[Math.max(0, z - 1) * nx + x], south = samples[Math.min(nz - 1, z + 1) * nx + x];
   const dx = (right - left) / (stepX * (x === 0 || x === nx - 1 ? 1 : 2));
   const dz = (south - north) / (stepZ * (z === 0 || z === nz - 1 ? 1 : 2));
   const curvature = (left + right - 2 * height) / (stepX * stepX) + (north + south - 2 * height) / (stepZ * stepZ);
   const sample = {x: bounds.x + x * stepX, z: bounds.y + z * stepZ, height, slope: Math.hypot(dx, dz), curvature};
   const layers = rules.weights(sample);
   for (let i = 0; i < BASE_LAYERS; i++) weights[index * BASE_LAYERS + i] = Math.round(layers[i] * BYTE);
   if (forestWeights) forestWeights[index] = Math.round((layers[FOREST_LAYER] ?? 0) * BYTE);
   if (sandWeights) sandWeights[index] = Math.round(rules.sand(sample) * BYTE);
  }
  weightMap.needsUpdate = true;
  if (forestMap) forestMap.needsUpdate = true;
  if (sandMap) sandMap.needsUpdate = true;
 }
 function heightAt(x, z) {
  const gx = (x - bounds.x) / stepX, gz = (z - bounds.y) / stepZ;
  if (gx < 0 || gz < 0 || gx > nx - 1 || gz > nz - 1) return undefined;
  const ix = Math.min(Math.floor(gx), nx - 2), iz = Math.min(Math.floor(gz), nz - 2);
  const u = gx - ix, v = gz - iz, a = samples[iz * nx + ix], b = samples[iz * nx + ix + 1];
  const c = samples[(iz + 1) * nx + ix], d = samples[(iz + 1) * nx + ix + 1];
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
 }
 // Match the shader's linear sampling of the baked layer map before texture height blending.
 function layerWeightAt(x, z, layer) {
  const forest = layer === FOREST_LAYER;
  if (forest && !forestWeights) return 0;
  return forest ? weightAt(forestWeights, 1, 0, x, z) : weightAt(weights, BASE_LAYERS, layer, x, z);
 }
 // Share of sand at a point (0..1); 0 where the field has no sand.
 function sandWeightAt(x, z) {
  return sandWeights ? weightAt(sandWeights, 1, 0, x, z) : 0;
 }
 // Linear sample of one channel of a byte weight map with `stride` channels per sample.
 function weightAt(data, stride, channel, x, z) {
  const gx = THREE.MathUtils.clamp((x - bounds.x) / stepX, 0, nx - 1);
  const gz = THREE.MathUtils.clamp((z - bounds.y) / stepZ, 0, nz - 1);
  const ix = Math.min(Math.floor(gx), nx - 2), iz = Math.min(Math.floor(gz), nz - 2);
  const i = (iz * nx + ix) * stride + channel;
  const lerp = THREE.MathUtils.lerp;
  const north = lerp(data[i], data[i + stride], gx - ix);
  const south = lerp(data[i + nx * stride], data[i + (nx + 1) * stride], gx - ix);
  return lerp(north, south, gz - iz) / BYTE;
 }
 let minX = nx, minZ = nz, maxX = -1, maxZ = -1;
 const soil = samples.slice();
 // freshSnow is the depth the layer would have untouched: tracks pack toward a share of it.
 let snow, freshSnow, snowEnabled = false;
 const packedFloor = index => snowTrackRims ? freshSnow[index] * snowSettings.packedShare : 0;
 let snowDepthScale = SNOW_DEPTH_SCALE.initial;
 const snowCover = {value: false};
 const snowMask = new Uint8Array(samples.length);
 let snowMaskDirty = false;
 const snowMap = createDataTexture(snowMask, nx, nz, {format: THREE.RedFormat, filter: 'linear'});
 const baseNormals = geometry.getAttribute('normal').array.slice();
 const normals = geometry.getAttribute('normal');
 const face = new THREE.Vector3();
 function accumulate(a, b, c) {
  const ax = positions.getX(a), ay = samples[a], az = positions.getZ(a);
  const ux = positions.getX(b) - ax, uy = samples[b] - ay, uz = positions.getZ(b) - az;
  const vx = positions.getX(c) - ax, vy = samples[c] - ay, vz = positions.getZ(c) - az;
  const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
  addNormal(a, fx, fy, fz); addNormal(b, fx, fy, fz); addNormal(c, fx, fy, fz);
 }
 function addNormal(index, x, y, z) {
  const column = index % nx, row = Math.floor(index / nx);
  if (column < minX || column > maxX || row < minZ || row > maxZ) return;
  normals.setXYZ(index, normals.getX(index) + x, normals.getY(index) + y, normals.getZ(index) + z);
 }
 function writeHeight(index, value, onSample) {
  samples[index] = value;
  positions.setY(index, samples[index]);
  const coverage = snowEnabled ? Math.round(BYTE * THREE.MathUtils.smoothstep(snow[index], snowSettings.coverFrom, snowSettings.coverFull)) : 0;
  if (snowMask[index] !== coverage) {
   snowMask[index] = coverage;
   snowMaskDirty = true;
  }
  const x = index % nx, z = Math.floor(index / nx);
  onSample?.(x, z, samples[index]);
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
 }
 // Lowers the samples within radius to nextHeight(index, falloff, previous). Returns the displaced volume in cubic metres.
 function press(x, z, radius, onSample, nextHeight, soilRimShare = 0) {
  const gx = (x - bounds.x) / stepX, gz = (z - bounds.y) / stepZ;
  let volume = 0;
  for (let j = Math.max(0, Math.ceil(gz - radius / stepZ)); j <= Math.min(nz - 1, Math.floor(gz + radius / stepZ)); j++) {
   for (let i = Math.max(0, Math.ceil(gx - radius / stepX)); i <= Math.min(nx - 1, Math.floor(gx + radius / stepX)); i++) {
    const distance = Math.hypot((i - gx) * stepX, (j - gz) * stepZ);
    const index = j * nx + i, previous = samples[index];
    const falloff = 1 - THREE.MathUtils.smoothstep(distance / radius, DIG_FALLOFF_START, 1);
    const next = Math.fround(nextHeight(index, falloff, previous));
    if (next >= previous) continue;
    if (snowEnabled) snow[index] = next - soil[index];
    else soil[index] = next;
    writeHeight(index, next, onSample);
    volume += (previous - samples[index]) * stepX * stepZ;
   }
  }
  if (volume > 0) {
   if (snowEnabled && snowTrackRims) raiseSnowRim(gx, gz, radius, volume / (stepX * stepZ), onSample);
   else if (!snowEnabled && soilRimShare > 0) raiseSoilRim(gx, gz, radius, volume / (stepX * stepZ) * soilRimShare, onSample);
  }
  return volume;
 }
 // Digs the ground under a contact. rimShare (0..1) is the share of the displaced soil pushed up around the dig, as
 // soft ground (mud, sand) does; it applies to bare soil only: snow rims follow the snow settings.
 function deform(x, z, radius, depth, onSample, {rimShare = 0} = {}) {
  if (![x, z, radius, depth].every(Number.isFinite) || radius <= 0 || depth <= 0) return 0;
  if (!(rimShare >= 0 && rimShare <= 1)) throw Error('Terrain deformation needs a rim share from zero to one');
  return press(x, z, radius, onSample, (index, falloff, previous) => {
   const minimum = snowEnabled ? Math.min(previous, soil[index] + packedFloor(index)) : original[index] - MAX_DIG;
   return Math.max(minimum, previous - depth * falloff);
  }, rimShare);
 }
 // Packs the snow under a contact. load (0..1) is the share of the packable depth pressed out at the centre, so the sink
 // follows the local snow depth and pressing again with the same load does not sink further.
 function compactSnow(x, z, radius, load, onSample) {
  if (![x, z, radius, load].every(Number.isFinite) || radius <= 0 || load < 0 || load > 1) {
   throw Error('Snow compaction needs a finite position, a positive radius and a load from zero to one');
  }
  if (!snowEnabled || load === 0) return 0;
  return press(x, z, radius, onSample, (index, falloff) => {
   const packed = packedFloor(index);
   return soil[index] + packed + (freshSnow[index] - packed) * (1 - load * falloff);
  });
 }
 function raiseSnowRim(gx, gz, radius, removedDepth, onSample) {
  const highest = (snowSettings.driftDepth + snowSettings.driftVariation + snowSettings.rimMaxRise) * snowDepthScale;
  raiseRim(gx, gz, radius, removedDepth * snowSettings.rimShare, (index, rise) => {
   const next = Math.fround(soil[index] + Math.min(highest, snow[index] + rise));
   if (next <= samples[index]) return;
   snow[index] = next - soil[index];
   writeHeight(index, next, onSample);
  });
 }
 function raiseSoilRim(gx, gz, radius, rimDepth, onSample) {
  raiseRim(gx, gz, radius, rimDepth, (index, rise) => {
   const next = Math.fround(Math.min(original[index] + SOIL_RIM_MAX_RISE, soil[index] + rise));
   if (next <= samples[index]) return;
   soil[index] = next;
   writeHeight(index, next, onSample);
  });
 }
 // Spreads rimDepth (summed sample depth, m) over the ring around a track: raise(index, rise) applies each share.
 function raiseRim(gx, gz, radius, rimDepth, raise) {
  const candidates = [];
  let totalWeight = 0;
  const reach = radius * SNOW_RIM.end;
  for (let z = Math.max(0, Math.ceil(gz - reach / stepZ)); z <= Math.min(nz - 1, Math.floor(gz + reach / stepZ)); z++) {
   for (let x = Math.max(0, Math.ceil(gx - reach / stepX)); x <= Math.min(nx - 1, Math.floor(gx + reach / stepX)); x++) {
    const distance = Math.hypot((x - gx) * stepX, (z - gz) * stepZ) / radius;
    const weight = THREE.MathUtils.smoothstep(distance, SNOW_RIM.start, SNOW_RIM.peak)
      * (1 - THREE.MathUtils.smoothstep(distance, SNOW_RIM.peak, SNOW_RIM.end));
    if (weight <= 0) continue;
    candidates.push({index: z * nx + x, weight});
    totalWeight += weight;
   }
  }
  if (!totalWeight) return;
  for (const {index, weight} of candidates) raise(index, rimDepth * weight / totalWeight);
 }
 function flushDeformation() {
  if (maxX < 0) return false;
  positions.addUpdateRange(minZ * nx * 3, (maxZ - minZ + 1) * nx * 3);
  positions.needsUpdate = true;
  // Every changed face also affects the normals of its immediate neighbors.
  minX = Math.max(0, minX - 1); maxX = Math.min(nx - 1, maxX + 1);
  minZ = Math.max(0, minZ - 1); maxZ = Math.min(nz - 1, maxZ + 1);
  if ((maxX - minX + 1) * (maxZ - minZ + 1) > samples.length / FULL_NORMALS_DIVISOR) {
   normals.addUpdateRange(0, normals.array.length);
   geometry.computeVertexNormals();
  } else {
   for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) normals.setXYZ(z * nx + x, 0, 0, 0);
   for (let z = Math.max(0, minZ - 1); z <= Math.min(nz - 2, maxZ); z++) {
    for (let x = Math.max(0, minX - 1); x <= Math.min(nx - 2, maxX); x++) {
     const a = z * nx + x, b = a + nx, d = a + 1;
     accumulate(a, b, d); accumulate(b, b + 1, d);
    }
   }
   for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const index = z * nx + x;
    face.fromBufferAttribute(normals, index).normalize();
    normals.setXYZ(index, face.x, face.y, face.z);
   }
   normals.addUpdateRange(minZ * nx * 3, (maxZ - minZ + 1) * nx * 3);
   normals.needsUpdate = true;
  }
  minX = nx; minZ = nz; maxX = maxZ = -1;
  heightMap.needsUpdate = true;
  if (snowMaskDirty) snowMap.needsUpdate = true;
  snowMaskDirty = false;
  return true;
 }
 function resetDeformation(onSample) {
  soil.set(original);
  snow = undefined;
  freshSnow = undefined;
  const restoreSnow = snowEnabled;
  snowEnabled = false;
  for (let index = 0; index < samples.length; index++) {
   if (samples[index] === original[index]) continue;
   writeHeight(index, original[index], onSample);
  }
  if (restoreSnow) return setSnowCover(true, onSample);
  return flushDeformation();
 }
 function setSnowDepthScale(scale, onSample) {
  if (!Number.isFinite(scale) || scale < SNOW_DEPTH_SCALE.min || scale > SNOW_DEPTH_SCALE.max) {
   throw Error('Snow depth scale is outside the supported range');
  }
  if (scale === snowDepthScale) return false;
  const ratio = scale / snowDepthScale;
  snowDepthScale = scale;
  if (!snow) return false;
  for (let index = 0; index < snow.length; index++) {
   snow[index] *= ratio;
   freshSnow[index] *= ratio;
   if (snowEnabled) writeHeight(index, soil[index] + snow[index], onSample);
  }
  return flushDeformation();
 }
 function meltSnow(depth, onSample) {
  if (!Number.isFinite(depth) || depth < 0) throw Error('Snow melt depth must be finite and non-negative');
  if (!snowEnabled || depth === 0) return null;
  let removed = 0, remaining = 0;
  for (let index = 0; index < snow.length; index++) {
   const previous = snow[index];
   if (previous <= 0) continue;
   snow[index] = Math.max(0, previous - depth);
   removed += previous - snow[index];
   remaining += snow[index];
   freshSnow[index] = Math.max(0, freshSnow[index] - depth);
   writeHeight(index, soil[index] + snow[index], onSample);
  }
  if (remaining === 0) {
   snowEnabled = false;
   snowCover.value = false;
   snow = undefined;
   freshSnow = undefined;
  }
  return {removed, remaining};
 }
 function setSnowCover(enabled, onSample) {
  if (enabled === snowEnabled) return false;
  if (enabled && !snow) {
   snow = new Float32Array(samples.length);
   const heading = THREE.MathUtils.degToRad(snowSettings.driftHeading), windX = Math.cos(heading), windZ = Math.sin(heading);
   for (let index = 0; index < snow.length; index++) {
    const x = index % nx, z = Math.floor(index / nx);
    const worldX = bounds.x + x * stepX, worldZ = bounds.y + z * stepZ;
    const along = (worldX * windX + worldZ * windZ) / (snowSettings.driftSize * SNOW_DRIFT.stretch);
    const across = (worldZ * windX - worldX * windZ) / snowSettings.driftSize;
    const wave = (driftNoise(along, across) + SNOW_DRIFT.detail * driftNoise(along * SNOW_DRIFT.octave, across * SNOW_DRIFT.octave)) / (1 + SNOW_DRIFT.detail);
    const drift = Math.max(0, snowSettings.driftDepth + snowSettings.driftVariation * wave);
    snow[index] = drift * snowDepthScale * THREE.MathUtils.smoothstep(baseNormals[index * 3 + 1], ...SNOW_DRIFT.flatness);
   }
   freshSnow = snow.slice();
  }
  snowEnabled = enabled;
  snowCover.value = enabled;
  for (let index = 0; index < samples.length; index++) {
   const next = Math.fround(soil[index] + (enabled ? snow[index] : 0));
   if (next !== samples[index]) writeHeight(index, next, onSample);
  }
  return flushDeformation();
 }
 updateRules();
 return {geometry, bounds, heightMap, weightMap, forestMap, sandMap, snowMap, snowCover, snowSettings, configureSnow, heightAt, layerWeightAt, sandWeightAt, updateRules, deform, compactSnow, flushDeformation, resetDeformation, setSnowCover, setSnowDepthScale, meltSnow,
  dispose() { geometry.dispose(); heightMap.dispose(); weightMap.dispose(); forestMap?.dispose(); sandMap?.dispose(); snowMap.dispose(); }};
}
