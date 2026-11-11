import {FloatType, RedFormat, Vector4} from 'three';
import {createDataTexture} from '../core/data-texture.js';

const step = 1 / 60;
// WebAquarium's ripple solver per step: velocity gains waveSpeed x laplacian, then keeps `damping`; height keeps `decay`.
const WAVE = Object.freeze({waveSpeed: .16, damping: .966, decay: .997});
// A splash: a cosine dip radius m wide, strength x depth m/step at the centre, over a square of reach cells.
const SPLASH = Object.freeze({radius: 1.1, depth: .115, reach: 3});
const ACTIVE_SECONDS = 6;   // the field runs this long after the last splash, then clears to rest

// Interactive ripple height field on a fixed world grid. origin = [xMin, zMin] (m), size = [columns, rows], cell (m).
// mask(isWet) takes a callback (x, z) -> boolean that decides which cells carry water (channel section, minus obstacles…).
export function createRipples({origin = [-36, -32], size = [192, 160], cell = .4} = {}) {
 const [columns, rows] = size, [xMin, zMin] = origin;
 const heights = new Float32Array(columns * rows);
 const velocity = new Float32Array(heights.length);
 const next = new Float32Array(heights.length);
 const wet = new Uint8Array(heights.length);
 const texture = createDataTexture(heights, columns, rows, {format: RedFormat, type: FloatType, upload: false});
 const bounds = new Vector4(xMin, zMin, columns * cell, rows * cell);
 let active = 0, accumulator = 0;

 function mask(isWet) {
  for (let x = 1; x < columns - 1; x++) {
   const worldX = xMin + (x + .5) * cell;
   for (let z = 1; z < rows - 1; z++) {
    const worldZ = zMin + (z + .5) * cell;
    const i = z * columns + x;
    wet[i] = Number(Boolean(isWet(worldX, worldZ)));
    if (!wet[i]) heights[i] = velocity[i] = 0;
   }
  }
  texture.needsUpdate = true;
 }

 function splash(x, z, strength) {
  const cx = Math.floor((x - xMin) / cell), cz = Math.floor((z - zMin) / cell);
  for (let row = Math.max(1, cz - SPLASH.reach); row <= Math.min(rows - 2, cz + SPLASH.reach); row++) {
   for (let col = Math.max(1, cx - SPLASH.reach); col <= Math.min(columns - 2, cx + SPLASH.reach); col++) {
    const i = row * columns + col;
    const distance = Math.hypot(xMin + (col + .5) * cell - x, zMin + (row + .5) * cell - z);
    if (wet[i] && distance < SPLASH.radius) velocity[i] -= strength * SPLASH.depth * (.5 + .5 * Math.cos(Math.PI * distance / SPLASH.radius));
   }
  }
  active = ACTIVE_SECONDS;
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
    const laplacian = (wet[i - 1] ? heights[i - 1] : h) + (wet[i + 1] ? heights[i + 1] : h) +
     (wet[i - columns] ? heights[i - columns] : h) + (wet[i + columns] ? heights[i + columns] : h) - 4 * h;
    velocity[i] = (velocity[i] + WAVE.waveSpeed * laplacian) * WAVE.damping;
    next[i] = (h + velocity[i]) * WAVE.decay;
   }
   for (let i = 0; i < heights.length; i++) heights[i] = wet[i] ? next[i] : 0;
  }
  if (active <= 0) {
   heights.fill(0);
   velocity.fill(0);
   accumulator = 0;
  }
  texture.needsUpdate = true;
 }

 return {texture, bounds, cell, mask, splash, update, get active() { return active > 0; },
  dispose: () => texture.dispose()};
}
