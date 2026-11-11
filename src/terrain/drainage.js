import {FloatType, MathUtils} from 'three';
import {createDataTexture} from '../core/data-texture.js';

// Match the heightfield's triangulation, including its shared diagonal.
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, -1]];
const CHANNELS = 4;

// RG contains the downhill grade in world X/Z. BA contains the basin floor
// and capped spill elevation. A dry sample has identical floor and spill.
export function createTerrainDrainage(field, {maxPuddleDepth = .32} = {}) {
  if (!(maxPuddleDepth > 0) || !Number.isFinite(maxPuddleDepth)) throw Error('Invalid puddle depth');
  const {data: heights, width, height} = field.heightMap.image;
  const {z: spanX, w: spanZ} = field.bounds;
  const values = new Float32Array(heights.length * CHANNELS);
  const texture = createDataTexture(values, width, height, {type: FloatType, upload: false});
  const spill = new Float32Array(heights.length);
  const frontier = new Uint32Array(heights.length);
  const grouped = new Uint8Array(heights.length);
  const stepX = spanX / (width - 1), stepZ = spanZ / (height - 1);
  let pending = 0;

  function enqueue(index) {
    let slot = pending++;
    while (slot > 0) {
      const parent = (slot - 1) >> 1;
      const above = frontier[parent];
      if (spill[above] <= spill[index]) break;
      frontier[slot] = above;
      slot = parent;
    }
    frontier[slot] = index;
  }

  function dequeue() {
    const first = frontier[0], tail = frontier[--pending];
    let slot = 0;
    for (let child = 1; child < pending; child = slot * 2 + 1) {
      if (child + 1 < pending && spill[frontier[child + 1]] < spill[frontier[child]]) child++;
      if (spill[tail] <= spill[frontier[child]]) break;
      frontier[slot] = frontier[child];
      slot = child;
    }
    if (pending) frontier[slot] = tail;
    return first;
  }

  function visitNeighbors(index, visit) {
    const x = index % width, z = Math.floor(index / width);
    for (const [dx, dz] of NEIGHBORS) {
      const nextX = x + dx, nextZ = z + dz;
      if (nextX < 0 || nextX >= width || nextZ < 0 || nextZ >= height) continue;
      visit(nextZ * width + nextX);
    }
  }

  function rebuild() {
    spill.fill(Infinity);
    grouped.fill(0);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const index = z * width + x, offset = index * CHANNELS;
        const left = Math.max(0, x - 1), right = Math.min(width - 1, x + 1);
        const north = Math.max(0, z - 1), south = Math.min(height - 1, z + 1);
        values[offset] = (heights[z * width + left] - heights[z * width + right]) / ((right - left) * stepX);
        values[offset + 1] = (heights[north * width + x] - heights[south * width + x]) / ((south - north) * stepZ);
        values[offset + 2] = values[offset + 3] = heights[index];
        if (x === 0 || x === width - 1 || z === 0 || z === height - 1) {
          spill[index] = heights[index];
          enqueue(index);
        }
      }
    }

    // Flood inward from the open boundary in ascending elevation order.
    // The lowest route out of each depression determines its spill height.
    while (pending) {
      const index = dequeue();
      visitNeighbors(index, next => {
        if (spill[next] !== Infinity) return;
        spill[next] = Math.max(heights[next], spill[index]);
        enqueue(next);
      });
    }

    for (let start = 0; start < heights.length; start++) {
      if (grouped[start] || spill[start] <= heights[start]) continue;
      const level = spill[start];
      let floor = heights[start], count = 1;
      frontier[0] = start;
      grouped[start] = 1;
      for (let head = 0; head < count; head++) {
        const index = frontier[head];
        floor = Math.min(floor, heights[index]);
        visitNeighbors(index, next => {
          if (grouped[next] || spill[next] !== level || heights[next] >= level) return;
          grouped[next] = 1;
          frontier[count++] = next;
        });
      }
      const ceiling = Math.min(level, floor + maxPuddleDepth);
      for (let slot = 0; slot < count; slot++) {
        const offset = frontier[slot] * CHANNELS;
        values[offset + 2] = floor;
        values[offset + 3] = ceiling;
      }
    }
    texture.needsUpdate = true;
  }

  function sample(x, z, target) {
    const gx = (x - field.bounds.x) / stepX, gz = (z - field.bounds.y) / stepZ;
    if (gx < 0 || gz < 0 || gx > width - 1 || gz > height - 1) return false;
    const ix = Math.min(Math.floor(gx), width - 2);
    const iz = Math.min(Math.floor(gz), height - 2);
    const u = gx - ix, v = gz - iz;
    const a = (iz * width + ix) * CHANNELS;
    const b = a + CHANNELS, c = a + width * CHANNELS, d = c + CHANNELS;
    const {lerp} = MathUtils;
    const gradeX = lerp(lerp(values[a], values[b], u), lerp(values[c], values[d], u), v);
    const gradeZ = lerp(lerp(values[a + 1], values[b + 1], u), lerp(values[c + 1], values[d + 1], u), v);
    const basin = (Math.round(gz) * width + Math.round(gx)) * CHANNELS;
    target.set(gradeX, gradeZ, values[basin + 2], values[basin + 3]);
    return true;
  }

  rebuild();
  return {texture, rebuild, sample, dispose: () => texture.dispose()};
}
