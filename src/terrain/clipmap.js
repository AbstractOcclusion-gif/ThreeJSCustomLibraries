import * as THREE from 'three';
import {createDataTexture} from '../core/data-texture.js';

// Camera-centred terrain: square rings of the same vertex count around a focus point, each ring's cells twice the
// size of the ring inside it, so detail is fine near the focus and the view reaches far. When the focus moves, a
// ring slides by whole cells: the samples it keeps are moved in memory and only the new strips are generated.
// Each ring carries its own height and layer maps, shaped like a terrain field, for createTerrainMaterial.
export const CLIPMAP_DEFAULTS = Object.freeze({
  levels: 7,       // rings
  cells: 256,      // cells per side of a ring: a multiple of 4
  cellSize: .25,   // m, cell of the innermost ring
  // snapCells: a ring moves by this many of its cells at a time (even, at most a quarter of `cells`): larger steps
  // mean fewer, larger updates. Default: a thirty-second of `cells`, between 2 and 8.
});
const SNAP = Object.freeze({share: 32, min: 2, max: 8});
// A ring eases into the shape of the ring outside it over the outer `band` of its half-width (see field.morph).
const MORPH = Object.freeze({band: .28});
const CHUNKS = 4;   // a ring is drawn as CHUNKS x CHUNKS meshes, so the parts outside the view are not drawn
export const CLIPMAP_LIMITS = Object.freeze({levels: [1, 10], cells: [8, 512], cellSize: [.05, 8]});
const BYTE = 255, LAYER_CHANNELS = 4, FOREST_LAYER = 4;
const PALETTE_GROUP = 4;   // palette weights per slice of the palette map
// Hollows change slowly: rings with cells under maxCell read them from a lattice of world points `spacing` m apart
// (kept up to `keep` points per ring), the coarser rings from their own heights.
const HOLLOW_LATTICE = Object.freeze({spacing: 6, maxCell: 2, keep: 20000});

const defaultSnap = cells => Math.min(SNAP.max, Math.max(SNAP.min, Math.floor(cells / SNAP.share / 2) * 2));

// world: {heightAt(x, z), paintAt({x, z, height, slope, curvature}) -> {layers, sand, palette}} (createTerrainWorld).
// With world.palette, each ring also carries paletteMap: the weight of every palette set, four per slice.
// With world.paintReach ({slope, hollow}, metres) and world.hollowAt, samples carry the slopes dx and dz and the
// hollow measured over those distances, whatever the cell of the ring, and each ring carries climateMap (moisture).
// createMaterial(field, level) returns the material of a ring; tint(x, z, paint, color) writes an optional vertex colour.
export function createTerrainClipmap({world, createMaterial, tint, ...overrides} = {}) {
  const {levels, cells, cellSize, snapCells = defaultSnap(overrides.cells ?? CLIPMAP_DEFAULTS.cells)} = {...CLIPMAP_DEFAULTS, ...overrides};
  const within = (value, [min, max]) => Number.isFinite(value) && value >= min && value <= max;
  if (!Number.isInteger(levels) || !within(levels, CLIPMAP_LIMITS.levels)) throw new RangeError('Invalid clipmap levels');
  if (!Number.isInteger(cells) || cells % 4 || !within(cells, CLIPMAP_LIMITS.cells)) throw new RangeError('Clipmap cells must be a multiple of 4 in range');
  if (!within(cellSize, CLIPMAP_LIMITS.cellSize)) throw new RangeError('Invalid clipmap cell size');
  // Even, so a ring stays on the cells of the ring outside; small enough for the inner ring to stay inside it.
  if (!Number.isInteger(snapCells) || snapCells < 2 || snapCells % 2 || snapCells > cells / 4) throw new RangeError('Clipmap snap must be an even number of cells, at most a quarter of the ring');
  if (typeof world?.heightAt !== 'function' || typeof world.paintAt !== 'function' || typeof createMaterial !== 'function') {
    throw new TypeError('A clipmap needs a world with heightAt and paintAt, and a material factory');
  }
  const n = cells + 1, count = n * n;
  const paletteSize = world.palette?.size ?? 0, paletteGroups = paletteSize / PALETTE_GROUP;
  if (!Number.isInteger(paletteGroups)) throw new RangeError('A world palette holds its weights in fours');
  const reach = world.paintReach && typeof world.hollowAt === 'function' ? world.paintReach : null;
  const group = new THREE.Group();
  const color = new THREE.Color();

  // Index buffers, shared by the rings: the cells of one chunk, except those in the square hole the inner ring
  // fills (hole: [x, z] in cells). A ring's hole takes few places, so few buffers are ever built.
  const chunkCells = cells / CHUNKS;
  const indexCache = new Map();
  function indexFor(hole, chunkX, chunkZ) {
    const key = (hole ? hole.join() : 'full') + '/' + chunkX + ',' + chunkZ;
    if (!indexCache.has(key)) {
      const indices = [];
      for (let z = chunkZ * chunkCells; z < (chunkZ + 1) * chunkCells; z++) for (let x = chunkX * chunkCells; x < (chunkX + 1) * chunkCells; x++) {
        if (hole && x >= hole[0] && x < hole[0] + cells / 2 && z >= hole[1] && z < hole[1] + cells / 2) continue;
        const a = z * n + x, b = a + 1, c = a + n, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
      indexCache.set(key, new THREE.BufferAttribute(new Uint32Array(indices), 1));
    }
    return indexCache.get(key);
  }

  // Gives a ring its vertex colours, the first time a tint asks for them.
  function colour(ring) {
    if (ring.colors) return;
    ring.colors = new Float32Array(count * 3);
    ring.attributes.color = new THREE.BufferAttribute(ring.colors, 3);
    for (const {geometry} of ring.chunks) geometry.setAttribute('color', ring.attributes.color);
  }

  const rings = Array.from({length: levels}, (_, level) => {
    const cell = cellSize * 2 ** level, size = cells * cell;
    // With a palette the material reads the palette map: the layer and forest maps are not kept.
    const heights = new Float32Array(count), weights = paletteSize ? null : new Uint8Array(count * LAYER_CHANNELS);
    const forest = paletteSize ? null : new Uint8Array(count), sand = new Uint8Array(count);
    const palette = paletteSize ? new Uint8Array(count * paletteSize) : null;
    const climate = reach ? new Uint8Array(count) : null;
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { positions[i * 3] = (i % n) * cell; positions[i * 3 + 2] = Math.floor(i / n) * cell; }
    // coarse: the height each vertex has in the shape of the ring outside, which the material eases toward.
    const coarse = new Float32Array(count);
    const attributes = {position: new THREE.BufferAttribute(positions, 3), normal: new THREE.BufferAttribute(normals, 3), terrainCoarse: new THREE.BufferAttribute(coarse, 1)};
    const field = {
      bounds: new THREE.Vector4(0, 0, size, size),
      heightMap: createDataTexture(heights, n, n, {format: THREE.RedFormat, type: THREE.FloatType}),
      sandMap: createDataTexture(sand, n, n, {format: THREE.RedFormat, filter: 'linear'}),
    };
    // The easing ends before the edge wherever the focus stands inside its snap step, so the edge always has the
    // coarse shape; the outermost ring has nothing to ease into.
    if (level < levels - 1) {
      const end = (cells / 2 - snapCells / 2 - 1) * cell;
      field.morph = {value: new THREE.Vector4(0, 0, end - MORPH.band * size / 2, end)};
    }
    if (weights) field.weightMap = createDataTexture(weights, n, n, {filter: 'linear'});
    if (forest) field.forestMap = createDataTexture(forest, n, n, {format: THREE.RedFormat, filter: 'linear'});
    if (palette) {
      field.paletteMap = new THREE.DataArrayTexture(palette, n, n, paletteGroups);
      field.paletteMap.minFilter = field.paletteMap.magFilter = THREE.LinearFilter;
      field.paletteMap.needsUpdate = true;
    }
    if (climate) field.climateMap = createDataTexture(climate, n, n, {format: THREE.RedFormat, filter: 'linear'});
    const material = createMaterial(field, level);
    // The chunks share the vertices of the ring; each has its own index and bounds.
    const ringGroup = new THREE.Group();
    const chunks = [];
    for (let chunkZ = 0; chunkZ < CHUNKS; chunkZ++) for (let chunkX = 0; chunkX < CHUNKS; chunkX++) {
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute);
      geometry.boundingSphere = new THREE.Sphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
      ringGroup.add(mesh);
      chunks.push({chunkX, chunkZ, geometry, mesh});
    }
    group.add(ringGroup);
    const signals = reach && {
      slopeStride: Math.max(1, Math.round(reach.slope / cell)), hollowStride: Math.max(1, Math.round(reach.hollow / cell)),
      lattice: cell < HOLLOW_LATTICE.maxCell ? new Map() : null,
    };
    const ring = {level, cell, size, heights, weights, forest, sand, palette, climate, signals, positions, normals, coarse, colors: null, attributes, chunks, field, material, group: ringGroup, origin: null, hole: undefined, low: 0, high: 0};
    if (tint) colour(ring);
    return ring;
  });

  // Moves what a ring keeps when its origin shifts by (dx, dz) cells: the new [i, j] is the old [i + dx, j + dz].
  function slide(array, stride, dx, dz) {
    const row = n * stride;
    if (dz > 0) array.copyWithin(0, dz * row);
    else if (dz < 0) array.copyWithin(-dz * row, 0, (n + dz) * row);
    if (!dx) return;
    for (let j = 0; j < n; j++) {
      const start = j * row, end = start + row;
      if (dx > 0) array.copyWithin(start, start + dx * stride, end);
      else array.copyWithin(start - dx * stride, start, end + dx * stride);
    }
  }

  const sample = {x: 0, z: 0, height: 0, slope: 0, curvature: 0, dx: 0, dz: 0, hollow: 0};
  // Height of sample (i, j) of a ring, from the world when it lies outside the ring; rounded like the stored ones.
  function heightOf(ring, i, j) {
    if (i >= 0 && j >= 0 && i <= cells && j <= cells) return ring.heights[j * n + i];
    return Math.fround(world.heightAt(ring.origin[0] + i * ring.cell, ring.origin[1] + j * ring.cell, ring.cell));
  }
  // Hollow at a world point, interpolated between the lattice points around it.
  function latticeHollow(lattice, x, z) {
    const g = HOLLOW_LATTICE.spacing, u = x / g, v = z / g, column = Math.floor(u), row = Math.floor(v);
    const at = (c, r) => {
      const key = c * 2097152 + r;   // columns and rows stay far below 2^21
      let value = lattice.get(key);
      if (value === undefined) {
        if (lattice.size >= HOLLOW_LATTICE.keep) lattice.clear();
        lattice.set(key, value = world.hollowAt(c * g, r * g));
      }
      return value;
    };
    const tu = u - column, tv = v - row;
    return (at(column, row) * (1 - tu) + at(column + 1, row) * tu) * (1 - tv) + (at(column, row + 1) * (1 - tu) + at(column + 1, row + 1) * tu) * tv;
  }
  // Paint, normal and tint of sample (i, j) from its four neighbours; a neighbour outside the ring comes from the world.
  function shade(ring, i, j) {
    const {cell, heights, origin} = ring, index = j * n + i;
    const x = origin[0] + i * cell, z = origin[1] + j * cell, height = heights[index];
    // Rounded like the stored heights, so a sample is shaded the same whether its neighbour is stored or not.
    const beyond = (px, pz) => Math.fround(world.heightAt(px, pz, cell));
    const west = i > 0 ? heights[index - 1] : beyond(x - cell, z), east = i < cells ? heights[index + 1] : beyond(x + cell, z);
    const north = j > 0 ? heights[index - n] : beyond(x, z - cell), south = j < cells ? heights[index + n] : beyond(x, z + cell);
    const dx = (east - west) / (2 * cell), dz = (south - north) / (2 * cell);
    const length = Math.hypot(dx, 1, dz);
    ring.normals[index * 3] = -dx / length; ring.normals[index * 3 + 1] = 1 / length; ring.normals[index * 3 + 2] = -dz / length;
    sample.x = x; sample.z = z; sample.height = height; sample.slope = Math.hypot(dx, dz);
    sample.curvature = (west + east + north + south - 4 * height) / (cell * cell);
    if (ring.signals) {
      // The signals the rules paint from, over their fixed distances rather than over one cell of this ring.
      const {slopeStride: s, hollowStride: h, lattice} = ring.signals;
      sample.dx = (heightOf(ring, i + s, j) - heightOf(ring, i - s, j)) / (2 * s * cell);
      sample.dz = (heightOf(ring, i, j + s) - heightOf(ring, i, j - s)) / (2 * s * cell);
      sample.slope = Math.hypot(sample.dx, sample.dz);
      sample.hollow = lattice ? latticeHollow(lattice, x, z)
        : (heightOf(ring, i - h, j) + heightOf(ring, i + h, j) + heightOf(ring, i, j - h) + heightOf(ring, i, j + h)) / 4 - height;
    }
    const paint = world.paintAt(sample);
    if (ring.weights) {
      for (let layer = 0; layer < LAYER_CHANNELS; layer++) ring.weights[index * LAYER_CHANNELS + layer] = Math.round(paint.layers[layer] * BYTE);
      ring.forest[index] = Math.round((paint.layers[FOREST_LAYER] ?? 0) * BYTE);
    }
    ring.sand[index] = Math.round(paint.sand * BYTE);
    if (ring.climate) ring.climate[index] = Math.round((paint.moisture ?? 0) * BYTE);
    // Slice `group` of the palette map holds weights group x 4 .. group x 4 + 3 of every sample.
    for (let slot = 0; slot < paletteSize; slot++) {
      ring.palette[(Math.floor(slot / PALETTE_GROUP) * count + index) * PALETTE_GROUP + slot % PALETTE_GROUP] = Math.round(paint.palette[slot] * BYTE);
    }
    if (ring.colors && tint) {
      tint(x, z, paint, color);
      ring.colors[index * 3] = color.r; ring.colors[index * 3 + 1] = color.g; ring.colors[index * 3 + 2] = color.b;
    }
  }

  // Generates the samples of a ring that are new after a move of (dx, dz) cells; all of them when `all`.
  function fill(ring, dx, dz, all) {
    const {cell, heights, origin} = ring;
    const fresh = (i, j) => all || (dx > 0 ? i >= n - dx : i < -dx) || (dz > 0 ? j >= n - dz : j < -dz);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (fresh(i, j)) heights[j * n + i] = world.heightAt(origin[0] + i * cell, origin[1] + j * cell, cell);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (fresh(i, j)) shade(ring, i, j);
  }

  // Writes the heights to the mesh. On the outer edge the ring takes the shape of the ring outside it, so the two
  // meet without a crack: the vertices they share get the height that ring has there (it shows less fine relief),
  // and the vertices in between sit on the straight line between their neighbours.
  function lift(ring) {
    const {positions, heights} = ring;
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < count; i++) {
      const height = positions[i * 3 + 1] = heights[i];
      if (height < low) low = height;
      if (height > high) high = height;
    }
    ring.low = low; ring.high = high;
    if (ring.level === levels - 1) return;
    const {cell, origin} = ring;
    const edges = k => [[k, 1], [cells * n + k, 1], [k * n, n], [k * n + cells, n]];
    for (let k = 0; k <= cells; k += 2) {
      for (const [index] of edges(k)) {
        positions[index * 3 + 1] = Math.fround(world.heightAt(origin[0] + (index % n) * cell, origin[1] + Math.floor(index / n) * cell, cell * 2));
      }
    }
    for (let k = 1; k < cells; k += 2) {
      for (const [index, step] of edges(k)) {
        positions[index * 3 + 1] = (positions[(index - step) * 3 + 1] + positions[(index + step) * 3 + 1]) / 2;
      }
    }
    // The coarse shape: the ring outside has every other vertex, and draws straight edges and one diagonal between.
    const {coarse} = ring;
    for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) {
      const index = j * n + i, oddI = i % 2, oddJ = j % 2;
      coarse[index] = i === 0 || j === 0 || i === cells || j === cells ? positions[index * 3 + 1]
        : !oddI && !oddJ ? heights[index]
        : oddI && !oddJ ? (heights[index - 1] + heights[index + 1]) / 2
        : !oddI ? (heights[index - n] + heights[index + n]) / 2
        : (heights[index - n + 1] + heights[index + n - 1]) / 2;   // the diagonal of the coarse quad
    }
  }

  function upload(ring) {
    const {field, origin, cell, low, high} = ring;
    field.bounds.set(origin[0], origin[1], ring.size, ring.size);
    ring.group.position.set(origin[0], 0, origin[1]);
    for (const texture of Object.values(field)) if (texture.isTexture) texture.needsUpdate = true;
    for (const attribute of Object.values(ring.attributes)) attribute.needsUpdate = true;
    // Bounds of each chunk, for the renderer to skip the ones out of view: its square, over the heights of the ring.
    const span = chunkCells * cell, radius = Math.hypot(span, span, high - low) / 2;
    for (const {chunkX, chunkZ, geometry} of ring.chunks) {
      geometry.boundingSphere.center.set((chunkX + .5) * span, (low + high) / 2, (chunkZ + .5) * span);
      geometry.boundingSphere.radius = radius;
    }
  }

  let samplesGenerated = 0;
  return {
    group, levels, cells, cellSize,
    snapCells,
    // meshes: the chunks a ring is drawn as, all with its material.
    rings: rings.map(({level, cell, size, chunks, material, field}) => ({level, cell, size, material, field, meshes: chunks.map(chunk => chunk.mesh)})),
    get extent() { return rings.at(-1).size; },
    // Samples generated by the last update: a measure of its cost.
    get samplesGenerated() { return samplesGenerated; },
    originOf: level => rings[level].origin,
    heightAt: (x, z) => world.heightAt(x, z),
    // Centres the rings on a point. Returns true when a ring moved. maxRings spreads the work: at most that many
    // rings move in one call, the outer ones first, and the others follow on the next calls.
    update(x, z, maxRings = levels) {
      if (!(maxRings >= 1)) throw new RangeError('A clipmap update moves at least one ring');
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('Clipmap focus must be finite');
      samplesGenerated = 0;
      for (const {field} of rings) if (field.morph) { field.morph.value.x = x; field.morph.value.y = z; }
      let moved = false, budget = rings[0].origin ? maxRings : levels;   // the first update places every ring
      for (let level = levels - 1; level >= 0 && budget > 0; level--) {
        const ring = rings[level];
        const snap = ring.cell * snapCells, half = ring.size / 2;
        const next = [Math.round(x / snap) * snap - half, Math.round(z / snap) * snap - half];
        const previous = ring.origin;
        if (previous && previous[0] === next[0] && previous[1] === next[1]) continue;
        const dx = previous ? Math.round((next[0] - previous[0]) / ring.cell) : n;
        const dz = previous ? Math.round((next[1] - previous[1]) / ring.cell) : n;
        const all = Math.abs(dx) >= n || Math.abs(dz) >= n;
        ring.origin = next;
        if (!all) {
          for (const [array, stride] of [[ring.heights, 1], [ring.weights, LAYER_CHANNELS], [ring.forest, 1], [ring.sand, 1], [ring.climate, 1], [ring.normals, 3], [ring.colors, 3]]) {
            if (array) slide(array, stride, dx, dz);
          }
          for (let group = 0; group < paletteGroups; group++) {
            slide(ring.palette.subarray(group * count * PALETTE_GROUP, (group + 1) * count * PALETTE_GROUP), PALETTE_GROUP, dx, dz);
          }
        }
        fill(ring, dx, dz, all);
        samplesGenerated += all ? count : count - (n - Math.abs(dx)) * (n - Math.abs(dz));
        lift(ring);
        upload(ring);
        moved = true;
        budget--;
      }
      if (moved) {
        rings.forEach((ring, level) => {
          const inner = rings[level - 1];
          const hole = inner ? [Math.round((inner.origin[0] - ring.origin[0]) / ring.cell), Math.round((inner.origin[1] - ring.origin[1]) / ring.cell)] : null;
          const key = hole ? hole.join() : 'full';
          if (ring.hole === key) return;
          ring.hole = key;
          for (const {chunkX, chunkZ, geometry, mesh} of ring.chunks) {
            const index = indexFor(hole, chunkX, chunkZ);
            geometry.setIndex(index);
            mesh.visible = index.count > 0;   // a chunk wholly inside the hole
          }
        });
      }
      return moved;
    },
    // Recomputes paint, normals and tint everywhere, e.g. after the tint or the paint rules changed.
    reshade(nextTint = tint) {
      tint = nextTint;
      for (const ring of rings) {
        if (tint) colour(ring);
        if (!ring.origin) continue;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) shade(ring, i, j);
        upload(ring);
      }
    },
    dispose() {
      for (const {chunks, field, material} of rings) {
        for (const {geometry} of chunks) { geometry.setIndex(null); geometry.dispose(); }
        material.dispose();
        for (const texture of Object.values(field)) if (texture.isTexture) texture.dispose();
      }
      indexCache.clear();
    },
  };
}
