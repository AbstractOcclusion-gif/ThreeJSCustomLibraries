import {FloatType, RedFormat, Vector4} from 'three';
import {createDataTexture} from '../core/data-texture.js';

const REFERENCE_STEP = 1 / 60;
// WebAquarium's ripple solver per step: velocity gains waveSpeed x laplacian, then keeps `damping`; height keeps `decay`.
const WAVE = Object.freeze({waveSpeed: 0.16, damping: 0.966, decay: 0.997});
// A splash: a cosine dip radius m wide, strength x depth m/step at the centre, over a square of reach cells.
const SPLASH = Object.freeze({radius: 1.1, depth: 0.115, reach: 3});
const ACTIVE_SECONDS = 6; // the field runs this long after the last splash, then clears to rest

// Interactive ripple height field on a fixed world grid. origin = [xMin, zMin] (m), size = [columns, rows], cell (m).
// Use substeps on finer grids to maintain propagation speed. splash can take a radius in metres.
// velocityRetention is the fraction of velocity kept from damping per reference 60 Hz step.
// mask(isWet) takes a callback (x, z) -> boolean that decides which cells carry water (channel section, minus obstacles…).
// closed: the water of a closed container (a glass, a bottle) keeps its volume: a splash that pushes the surface down
// here raises it elsewhere, and the level comes back by itself (open water, the default, lets a dip fade out slowly).
export function createRipples({origin = [-36, -32], size = [192, 160], cell = 0.4, substeps = 1,
  velocityRetention = WAVE.damping, closed = false} = {}) {
  if (!Number.isInteger(substeps) || substeps < 1) throw new RangeError('Ripple substeps must be a positive integer');
  if (!(velocityRetention > 0 && velocityRetention <= 1)) throw new RangeError('Ripple velocity retention must be in (0, 1]');
  const step = REFERENCE_STEP / substeps;
  const damping = velocityRetention ** (1 / substeps), decay = WAVE.decay ** (1 / substeps);
  const [columns, rows] = size,
    [xMin, zMin] = origin;
  const heights = new Float32Array(columns * rows);
  const velocity = new Float32Array(heights.length);
  const next = new Float32Array(heights.length);
  const wet = new Uint8Array(heights.length);
  const texture = createDataTexture(heights, columns, rows, {format: RedFormat, type: FloatType, upload: false});
  const bounds = new Vector4(xMin, zMin, columns * cell, rows * cell);
  let active = 0,
    accumulator = 0,
    wetCells = 0;

  // Closed container: the mean height of the wet cells is taken back out, so the volume stays what it was at rest.
  function keepVolume() {
    let sum = 0;
    for (let i = 0; i < heights.length; i++) if (wet[i]) sum += heights[i];
    const mean = sum / wetCells;
    for (let i = 0; i < heights.length; i++) if (wet[i]) heights[i] -= mean;
  }

  function mask(isWet) {
    for (let x = 1; x < columns - 1; x++) {
      const worldX = xMin + (x + 0.5) * cell;
      for (let z = 1; z < rows - 1; z++) {
        const worldZ = zMin + (z + 0.5) * cell;
        const i = z * columns + x;
        wet[i] = Number(Boolean(isWet(worldX, worldZ)));
        if (!wet[i]) heights[i] = velocity[i] = 0;
      }
    }
    wetCells = wet.reduce((count, cellIsWet) => count + cellIsWet, 0);
    texture.needsUpdate = true;
  }

  function splash(x, z, strength, radius) {
    if (radius !== undefined && (!Number.isFinite(radius) || radius <= 0))
      throw new RangeError('Ripple stamp radius must be positive and finite');
    const reach = radius === undefined ? SPLASH.reach : Math.ceil(radius / cell);
    const stampRadius = radius ?? SPLASH.radius;
    const depth = strength * SPLASH.depth / substeps;
    const cx = Math.floor((x - xMin) / cell),
      cz = Math.floor((z - zMin) / cell);
    for (let row = Math.max(1, cz - reach); row <= Math.min(rows - 2, cz + reach); row++) {
      for (let col = Math.max(1, cx - reach); col <= Math.min(columns - 2, cx + reach); col++) {
        const i = row * columns + col;
        const distance = Math.hypot(xMin + (col + 0.5) * cell - x, zMin + (row + 0.5) * cell - z);
        if (wet[i] && distance < stampRadius)
          velocity[i] -= depth * (0.5 + 0.5 * Math.cos((Math.PI * distance) / stampRadius));
      }
    }
    active = ACTIVE_SECONDS;
  }

  function clear() {
    heights.fill(0);
    velocity.fill(0);
    active = accumulator = 0;
    texture.needsUpdate = true;
  }

  function update(dt) {
    if (active <= 0) return;
    active -= dt;
    accumulator += dt;
    while (accumulator >= step) {
      accumulator -= step;
      // WebAquarium's reflective neighbour rule: a blocked neighbour reads as self.
      for (let i = columns; i < heights.length - columns; i++) {
        if (!wet[i]) continue;
        const h = heights[i];
        const laplacian =
          (wet[i - 1] ? heights[i - 1] : h) +
          (wet[i + 1] ? heights[i + 1] : h) +
          (wet[i - columns] ? heights[i - columns] : h) +
          (wet[i + columns] ? heights[i + columns] : h) -
          4 * h;
        velocity[i] = (velocity[i] + WAVE.waveSpeed * laplacian) * damping;
        next[i] = (h + velocity[i]) * decay;
      }
      for (let i = 0; i < heights.length; i++) heights[i] = wet[i] ? next[i] : 0;
      if (closed && wetCells > 0) keepVolume();
    }
    if (active <= 0) {
      clear();
      return;
    }
    texture.needsUpdate = true;
  }

  // The height of the field at (x, z) in its own frame, read between the cells (0 off the field).
  function heightAt(x, z) {
    const fx = (x - xMin) / cell - 0.5, fz = (z - zMin) / cell - 0.5;
    if (fx < 0 || fz < 0 || fx > columns - 1 || fz > rows - 1) return 0;
    const i = Math.min(Math.floor(fx), columns - 2), j = Math.min(Math.floor(fz), rows - 2), tx = fx - i, tz = fz - j, at = j * columns + i;
    return (heights[at] * (1 - tx) + heights[at + 1] * tx) * (1 - tz) + (heights[at + columns] * (1 - tx) + heights[at + columns + 1] * tx) * tz;
  }

  return {
    texture,
    bounds,
    cell,
    mask,
    splash,
    heightAt,
    update,
    clear,
    get active() {
      return active > 0;
    },
    dispose: () => texture.dispose(),
  };
}
