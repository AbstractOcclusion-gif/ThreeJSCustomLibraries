import {bakeSkyRow} from '../core/sky-visibility.js';

const BYTE = 255;
export const CLIPMAP_NORMAL_CHANNELS = 4;

// Moves what a ring keeps when its origin shifts by (dx, dz) cells: the new [i, j] is the old [i + dx, j + dz].
// `side`: samples per side of the array (including edge samples).
export function slideSamples(array, stride, dx, dz, side) {
  const row = side * stride;
  if (dz > 0) array.copyWithin(0, dz * row);
  else if (dz < 0) array.copyWithin(-dz * row, 0, (side + dz) * row);
  if (!dx) return;
  for (let j = 0; j < side; j++) {
    const start = j * row, end = start + row;
    if (dx > 0) array.copyWithin(start, start + dx * stride, end);
    else array.copyWithin(start - dx * stride, start, end + dx * stride);
  }
}

// Queues every texel of a baked map of a ring, or after a move of (fx, fz) texels keeps what stays and queues the
// rest. stride: bytes per texel; blank: the value of a texel not baked yet.
export function queueBake(bake, texture, stride, blank, fx, fz, all) {
  if (!bake) return;
  const {side, data} = bake, last = side - 1;
  if (all) { data.fill(blank); bake.jobs = [[0, last, 0, last]]; texture.needsUpdate = true; return; }
  slideSamples(data, stride, fx, fz, side);
  // Pending rectangles move with the texels they name; the strips that came into view are blank and queued.
  bake.jobs = bake.jobs.map(([i0, i1, j0, j1]) => [Math.max(0, i0 - fx), Math.min(last, i1 - fx), Math.max(0, j0 - fz), Math.min(last, j1 - fz)])
    .filter(([i0, i1, j0, j1]) => i0 <= i1 && j0 <= j1);
  const strips = [];
  if (fx > 0) strips.push([side - fx, last, 0, last]); else if (fx < 0) strips.push([0, -fx - 1, 0, last]);
  if (fz > 0) strips.push([0, last, side - fz, last]); else if (fz < 0) strips.push([0, last, 0, -fz - 1]);
  for (const [i0, i1, j0, j1] of strips) {
    for (let j = j0; j <= j1; j++) data.fill(blank, (j * side + i0) * stride, (j * side + i1 + 1) * stride);
    bake.jobs.unshift([i0, i1, j0, j1]);   // the newest ground first
  }
  texture.needsUpdate = true;
}
export const pendingTexels = bake => bake ? bake.jobs.reduce((sum, [i0, i1, j0, j1]) => sum + (i1 - i0 + 1) * (j1 - j0 + 1), 0) : 0;

// Index range [first, last] of the samples (spacing m apart, from `start`) within [min - margin, max + margin], clamped
// to 0..side; null when the range misses the array.
export function spanOf(start, spacing, side, min, max, margin) {
  const first = Math.max(0, Math.floor((min - margin - start) / spacing)), last = Math.min(side, Math.ceil((max + margin - start) / spacing));
  return first <= last ? [first, last] : null;
}
// Queues the texels of a baked map over a world rectangle, ahead of the other jobs.
export function queueRect(bake, origin, rect, margin) {
  if (!bake) return;
  const last = bake.side - 1;
  const columns = spanOf(origin[0], bake.spacing, last, rect.minX, rect.maxX, margin), rows = spanOf(origin[1], bake.spacing, last, rect.minZ, rect.maxZ, margin);
  if (columns && rows) bake.jobs.unshift([columns[0], columns[1], rows[0], rows[1]]);
}

export function createClipmapBaker(rings, {heightAt, visibility}) {
  // Bakes queued sky visibility, nearest ring first, a row at a time, until `budget` relief samples are spent.
  function bakeSky(budget) {
    let spent = 0;
    for (const {skyBake, origin, field} of rings) {
      if (!skyBake || !origin) continue;
      const {side, data, spacing, jobs} = skyBake, cost = visibility.samples(spacing);
      while (jobs.length && spent < budget) {
        const job = jobs[0];
        bakeSkyRow(visibility, data, side, origin, spacing, job[2], job[0], job[1]);
        spent += (job[1] - job[0] + 1) * cost;
        if (++job[2] > job[3]) jobs.shift();
        field.skyMap.needsUpdate = true;
      }
      if (spent >= budget) break;
    }
    return spent;
  }

  // Bakes queued normals, nearest ring first, for at most `budget` relief samples. Returns the samples spent.
  const rowAbove = [], rowHere = [], rowBelow = [];
  function bakeNormals(budget) {
    let spent = 0;
    for (const ring of rings) {
      const {bake, origin} = ring;
      if (!bake || !origin) continue;
      const {side, data, spacing, jobs} = bake;
      const heightRow = (target, j, i0, i1) => {
        for (let i = i0 - 1; i <= i1 + 1; i++) target[i - i0 + 1] = heightAt(origin[0] + i * spacing, origin[1] + j * spacing, spacing);
        spent += i1 - i0 + 3;
      };
      let wrote = false;
      while (jobs.length && spent < budget) {
        const job = jobs[0], [i0, i1] = job;
        let above = rowAbove, here = rowHere, below = rowBelow;
        heightRow(above, job[2] - 1, i0, i1);
        heightRow(here, job[2], i0, i1);
        while (job[2] <= job[3]) {
          const j = job[2];
          heightRow(below, j + 1, i0, i1);
          for (let i = i0; i <= i1; i++) {
            const k = i - i0 + 1;
            const dx = (here[k + 1] - here[k - 1]) / (2 * spacing), dz = (below[k] - above[k]) / (2 * spacing);
            const length = Math.hypot(dx, 1, dz), texel = (j * side + i) * CLIPMAP_NORMAL_CHANNELS;
            data[texel] = Math.round((-dx / length * .5 + .5) * BYTE);
            data[texel + 1] = Math.round((-dz / length * .5 + .5) * BYTE);
            data[texel + 3] = BYTE;
          }
          wrote = true;
          job[2]++;
          [above, here, below] = [here, below, above];
          if (spent >= budget) break;
        }
        if (job[2] > job[3]) jobs.shift();
      }
      if (wrote) ring.field.normalMap.needsUpdate = true;
      if (spent >= budget) break;
    }
    return spent;
  }
  return {bakeNormals, bakeSky};
}
