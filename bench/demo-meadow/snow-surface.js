import {FloatType, RedFormat} from 'three';
import {createDataTexture} from '../../src/core/data-texture.js';
import {createTerrainField} from '../../src/terrain/index.js';

const PATCH_CELLS = 16;
const HALO_CELLS = 7; // Keeps press and rim footprints, and their overlap, away from a patch's sampled edges.
const INCLUDE_RIM = 2; // Conservative radius for choosing patches. Terrain determines the actual rim reach.

const intersects = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;

export function createMeadowSnowSurface({field, heights, seed}) {
 const {data: base, width, height} = field.heightMap.image;
 const baseCover = field.snowMap.image.data;
 const {x, y: z, z: spanX, w: spanZ} = field.bounds;
 const stepX = spanX / (width - 1), stepZ = spanZ / (height - 1);
 const samples = base.slice(), cover = baseCover.slice();
 const heightMap = createDataTexture(samples, width, height, {format: RedFormat, type: FloatType});
 const snowMap = createDataTexture(cover, width, height, {format: RedFormat, filter: 'linear'});
 const patches = new Map(), dirty = new Map();
 let depthScale, heightChanged = false, coverChanged = false;

 const keyAt = (column, row) => Math.floor(column / PATCH_CELLS) + ':' + Math.floor(row / PATCH_CELLS);
 const worldX = column => x + column * stepX, worldZ = row => z + row * stepZ;
 function write(column, row, level, coverage, onSample) {
  const index = row * width + column;
  if (samples[index] !== level) {
   samples[index] = level;
   heightChanged = true;
   onSample?.(column, row, level);
  }
  if (cover[index] !== coverage) {
   cover[index] = coverage;
   coverChanged = true;
  }
 }
 function coreAt(column, row) {
  const left = Math.floor(column / PATCH_CELLS) * PATCH_CELLS;
  const top = Math.floor(row / PATCH_CELLS) * PATCH_CELLS;
  return {left, top, right: Math.min(width - 1, left + PATCH_CELLS - 1), bottom: Math.min(height - 1, top + PATCH_CELLS - 1)};
 }
 function makePatch(core) {
  const left = Math.max(0, core.left - HALO_CELLS), right = Math.min(width - 1, core.right + HALO_CELLS);
  const top = Math.max(0, core.top - HALO_CELLS), bottom = Math.min(height - 1, core.bottom + HALO_CELLS);
  const nx = right - left + 1, nz = bottom - top + 1;
  const localHeights = new Float32Array(nx * nz);
  for (let row = top; row <= bottom; row++) {
   const first = row * width + left;
   localHeights.set(heights.subarray(first, first + nx), (row - top) * nx);
  }
  const local = createTerrainField({origin: [worldX(left), worldZ(top)], size: [(nx - 1) * stepX, (nz - 1) * stepZ],
   resolution: [nx, nz], heights: localHeights, seed, snow: field.snowSettings, snowTrackRims: true});
  local.setSnowDepthScale(depthScale);
  local.setSnowCover(true);
  return {core, bounds: {left, right, top, bottom}, local, nx};
 }
 function publish(core, patch, onSample) {
  const localHeights = patch?.local.heightMap.image.data, localCover = patch?.local.snowMap.image.data;
  for (let row = core.top; row <= core.bottom; row++) for (let column = core.left; column <= core.right; column++) {
   const index = row * width + column;
   const localIndex = patch && (row - patch.bounds.top) * patch.nx + column - patch.bounds.left;
   write(column, row, localHeights?.[localIndex] ?? base[index], localCover?.[localIndex] ?? baseCover[index], onSample);
  }
 }
 function heightAt(wx, wz) {
  if (field.snowCover.value && patches.size) {
   const column = (wx - x) / stepX, row = (wz - z) / stepZ;
   if (column >= 0 && column <= width - 1 && row >= 0 && row <= height - 1) {
    const patch = patches.get(keyAt(column, row));
    if (patch) return patch.local.heightAt(wx, wz);
   }
  }
  return field.heightAt(wx, wz);
 }
 function clear(onSample) {
  for (const patch of patches.values()) {
   publish(patch.core, null, onSample);
   patch.local.dispose();
  }
  patches.clear();
  dirty.clear();
 }

 return {
  field: {...field, heightMap, snowMap, heightAt},
  setDepth(scale) { depthScale = scale; },
  copyBaseSample(column, row, level) { write(column, row, level, baseCover[row * width + column]); },
  stamp(x, z, radius) {
   const reach = radius * INCLUDE_RIM;
   return {x, z, radius, bounds: {
    left: Math.max(0, Math.floor((x - reach - field.bounds.x) / stepX)),
    right: Math.min(width - 1, Math.ceil((x + reach - field.bounds.x) / stepX)),
    top: Math.max(0, Math.floor((z - reach - field.bounds.y) / stepZ)),
    bottom: Math.min(height - 1, Math.ceil((z + reach - field.bounds.y) / stepZ)),
   }};
  },
  invalidate({bounds}) {
   if (bounds.left > bounds.right || bounds.top > bounds.bottom) return;
   const {left, top} = coreAt(bounds.left, bounds.top);
   for (let row = top; row <= bounds.bottom; row += PATCH_CELLS) for (let column = left; column <= bounds.right; column += PATCH_CELLS)
    dirty.set(keyAt(column, row), coreAt(column, row));
  },
  replay(prints, onSample) {
   for (const [key, core] of dirty) {
    const active = prints.some(print => print.snowAmount > 0 && print.stamps.some(stamp => intersects(stamp.bounds, core)));
    let patch = patches.get(key);
    if (!active) {
     if (patch) { publish(core, null, onSample); patch.local.dispose(); patches.delete(key); }
     continue;
    }
    if (!patch) patches.set(key, patch = makePatch(core));
    else {
     patch.local.configureSnow(field.snowSettings);
     patch.local.resetDeformation();
    }
    // Scratch geometry is never submitted to the renderer, so its upload ranges have no consumer.
    patch.local.geometry.getAttribute('position').clearUpdateRanges();
    patch.local.geometry.getAttribute('normal').clearUpdateRanges();
    for (const print of prints) {
     if (print.snowAmount <= 0) continue;
     for (const stamp of print.stamps) if (intersects(stamp.bounds, patch.bounds))
      patch.local.compactSnow(stamp.x, stamp.z, stamp.radius, print.snowAmount);
    }
    publish(core, patch, onSample);
   }
   dirty.clear();
  },
  flush() {
   const changed = heightChanged || coverChanged;
   if (heightChanged) heightMap.needsUpdate = true;
   if (coverChanged) snowMap.needsUpdate = true;
   heightChanged = coverChanged = false;
   return changed;
  },
  clear,
  dispose() { clear(); heightMap.dispose(); snowMap.dispose(); },
 };
}
