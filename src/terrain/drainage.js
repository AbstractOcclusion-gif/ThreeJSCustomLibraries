import {FloatType, MathUtils} from 'three';
import {createDataTexture} from '../core/data-texture.js';

// Match the heightfield's triangulation, including its shared diagonal.
const NEIGHBORS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, -1]];
// Water shares itself between all eight neighbours: the mesh's single diagonal would pull every stream to one side.
const FLOW_NEIGHBORS = [...NEIGHBORS, [-1, -1], [1, 1]];
const CHANNELS = 4;
const FLOW_CONCENTRATION = 1.5; // higher keeps water on its steepest path but shows the grid; lower spreads it into a smooth sheet
const MIN_POND_DEPTH = .03;     // m: a shallower hollow lets water straight through

// RG contains the downhill grade in world X/Z. BA contains the basin floor
// and capped spill elevation. A dry sample has identical floor and spill.
export function createTerrainDrainage(field, {maxPuddleDepth = .32} = {}) {
  function validDepth(depth) {
    if (!(depth > 0) || !Number.isFinite(depth)) throw Error('Invalid puddle depth');
    return depth;
  }
  validDepth(maxPuddleDepth);
  const {data: heights, width, height} = field.heightMap.image;
  const {z: spanX, w: spanZ} = field.bounds;
  const values = new Float32Array(heights.length * CHANNELS);
  const texture = createDataTexture(values, width, height, {type: FloatType, upload: false});
  const spill = new Float32Array(heights.length);
  const frontier = new Uint32Array(heights.length);
  const grouped = new Uint8Array(heights.length);
  // The flood visits cells from the lowest spill level up; each remembers the cell it was reached from.
  const floodOrder = new Uint32Array(heights.length);
  const floodParent = new Int32Array(heights.length);
  const flowOrder = new Uint32Array(heights.length);
  const waterLevel = new Float32Array(heights.length);
  const shareCell = new Int32Array(FLOW_NEIGHBORS.length), shareWeight = new Float64Array(FLOW_NEIGHBORS.length);
  const shareX = new Float64Array(FLOW_NEIGHBORS.length), shareZ = new Float64Array(FLOW_NEIGHBORS.length);
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

  function visitNeighbors(index, visit, neighbors = NEIGHBORS) {
    const x = index % width, z = Math.floor(index / width);
    for (const [dx, dz] of neighbors) {
      const nextX = x + dx, nextZ = z + dz;
      if (nextX < 0 || nextX >= width || nextZ < 0 || nextZ >= height) continue;
      visit(nextZ * width + nextX, dx, dz);
    }
  }

  // Pass a new puddle depth cap (m) to change it; it stays for later rebuilds.
  function rebuild({maxPuddleDepth: depth = maxPuddleDepth} = {}) {
    maxPuddleDepth = validDepth(depth);
    spill.fill(Infinity);
    grouped.fill(0);
    floodParent.fill(-1);
    let flooded = 0;
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
      floodOrder[flooded++] = index;
      visitNeighbors(index, next => {
        if (spill[next] !== Infinity) return;
        spill[next] = Math.max(heights[next], spill[index]);
        floodParent[next] = index;
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

  // Routes every cell's rain over the ground with its hollows filled to their puddle level. On a slope a cell shares
  // its water between all lower neighbours, weighted by slope ^ FLOW_CONCENTRATION. Water that reaches a puddle
  // follows the flood route to the hollow's outlet, unless the puddle depth cap keeps it below its rim: then it stays.
  // Cells are visited from the highest level down, so each forwards its water after receiving all of it.
  // receiver: the steepest (or outlet-ward) neighbour, -1 where water stays or leaves the field. area: drained m2.
  // held: the part of area that crossed a puddle deeper than MIN_POND_DEPTH, released only when puddles overflow.
  // grade: [x, z] pairs, the downhill direction scaled by the slope (rise / run); zero on puddles and flats.
  function bakeFlow() {
    const receiver = new Int32Array(heights.length).fill(-1);
    const area = new Float32Array(heights.length).fill(stepX * stepZ);
    const held = new Float32Array(heights.length);
    const grade = new Float32Array(heights.length * 2);
    const diagonal = Math.hypot(stepX, stepZ);
    for (let index = 0; index < heights.length; index++) waterLevel[index] = Math.max(heights[index], values[index * CHANNELS + 3]);
    // Highest first. The sort is stable, so cells on one level keep the reverse flood order: outlet-ward cells last.
    for (let slot = 0; slot < heights.length; slot++) flowOrder[slot] = floodOrder[heights.length - 1 - slot];
    flowOrder.sort((a, b) => waterLevel[b] - waterLevel[a]);
    for (let slot = 0; slot < heights.length; slot++) {
      const index = flowOrder[slot], level = waterLevel[index];
      let shares = 0, total = 0, steepest = 0;
      visitNeighbors(index, (next, dx, dz) => {
        const length = dx && dz ? diagonal : dx ? stepX : stepZ;
        const slope = (level - waterLevel[next]) / length;
        if (slope <= 0) return;
        const weight = slope ** FLOW_CONCENTRATION;
        shareCell[shares] = next;
        shareWeight[shares] = weight;
        shareX[shares] = dx * stepX / length * slope;
        shareZ[shares] = dz * stepZ / length * slope;
        shares++;
        total += weight;
        if (slope > steepest) {
          steepest = slope;
          receiver[index] = next;
        }
      }, FLOW_NEIGHBORS);
      if (!shares) {
        // A flat or a puddle. Its water reaches the outlet only if the puddle can fill to its rim.
        const next = floodParent[index];
        if (next < 0 || level < spill[index]) continue;
        receiver[index] = next;
        area[next] += area[index];
        const holdsWater = level > heights[index] && level - values[index * CHANNELS + 2] > MIN_POND_DEPTH;
        held[next] += holdsWater ? area[index] : held[index];
        continue;
      }
      for (let share = 0; share < shares; share++) {
        const part = shareWeight[share] / total, next = shareCell[share];
        area[next] += area[index] * part;
        held[next] += held[index] * part;
        grade[index * 2] += shareX[share] * part;
        grade[index * 2 + 1] += shareZ[share] * part;
      }
    }
    return {receiver, area, held, grade};
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
  return {texture, rebuild, sample, bakeFlow, dispose: () => texture.dispose()};
}
