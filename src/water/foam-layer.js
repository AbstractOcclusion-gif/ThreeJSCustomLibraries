import {RedFormat, Vector2, Vector4} from 'three';
import {createDataTexture} from '../core/data-texture.js';

const STEP = 1 / 30;
const BYTE = 255;
const ACTIVE_FROM = .004;   // foam below this everywhere: the layer is clear and stops updating

// Foam left on still water by splashes: a map on a fixed world grid that foam is stamped into, where it spreads a
// little, drifts with the flow and fades. origin = [xMin, zMin] (m), size = [columns, rows], cell (m).
// flow: optional createFlowBake() result; the foam drifts with it where it has water.
// settings (live): life = seconds foam takes to fade to about a third; spread = share of a cell's foam shared with
// its neighbours each second; drift = scale on the flow speed.
export function createFoamLayer({origin = [-36, -32], size = [192, 160], cell = .4, flow = null} = {}) {
  const [columns, rows] = size, [xMin, zMin] = origin;
  if (![columns, rows].every(n => Number.isInteger(n) && n >= 4 && n <= 1024) || !(cell > 0) || !origin.every(Number.isFinite)) {
    throw Error('Foam layer needs a finite origin, a grid of 4..1024 cells and a positive cell size');
  }
  const settings = {life: 4.5, spread: .6, drift: 1};
  const foam = new Float32Array(columns * rows), next = new Float32Array(foam.length);
  const pixels = new Uint8Array(foam.length);
  const texture = createDataTexture(pixels, columns, rows, {format: RedFormat, filter: 'linear'});
  const bounds = new Vector4(xMin, zMin, columns * cell, rows * cell);
  const velocity = new Vector2();
  let accumulator = 0, active = false;

  // Foam at a grid position (cells, fractional), zero outside the map.
  function sample(gx, gz) {
    if (gx < 0 || gz < 0 || gx > columns - 1 || gz > rows - 1) return 0;
    const i = Math.min(Math.floor(gx), columns - 2), j = Math.min(Math.floor(gz), rows - 2), u = gx - i, v = gz - j, k = j * columns + i;
    return (foam[k] * (1 - u) + foam[k + 1] * u) * (1 - v) + (foam[k + columns] * (1 - u) + foam[k + columns + 1] * u) * v;
  }

  function step() {
    const keep = Math.exp(-STEP / settings.life), share = Math.min(1, settings.spread * STEP);
    const drifting = Boolean(flow?.ready) && settings.drift > 0;
    let most = 0;
    for (let z = 1; z < rows - 1; z++) for (let x = 1; x < columns - 1; x++) {
      const i = z * columns + x;
      let here = foam[i];
      // Foam travels with the water: look upstream for what arrives here.
      if (drifting && flow.sample(xMin + (x + .5) * cell, zMin + (z + .5) * cell, velocity)) {
        const back = settings.drift * STEP / cell;
        here = sample(x - velocity.x * back, z - velocity.y * back);
      }
      const around = (foam[i - 1] + foam[i + 1] + foam[i - columns] + foam[i + columns]) * .25;
      const value = (here + (around - here) * share) * keep;
      next[i] = value;
      if (value > most) most = value;
    }
    foam.set(next);
    active = most > ACTIVE_FROM;
    if (!active) foam.fill(0);
  }

  return {
    texture, bounds, settings,
    get active() { return active; },
    // Stamp foam: a soft disc radius m wide, amount (0..1) at its centre. Foam adds up to full cover.
    deposit(x, z, radius, amount = 1) {
      if (![x, z, radius, amount].every(Number.isFinite) || radius <= 0 || amount < 0) throw Error('Foam deposit needs a finite position, a positive radius and a non-negative amount');
      const gx = (x - xMin) / cell - .5, gz = (z - zMin) / cell - .5, reach = radius / cell;
      for (let j = Math.max(1, Math.floor(gz - reach)); j <= Math.min(rows - 2, Math.ceil(gz + reach)); j++) {
        for (let i = Math.max(1, Math.floor(gx - reach)); i <= Math.min(columns - 2, Math.ceil(gx + reach)); i++) {
          const distance = Math.hypot(i - gx, j - gz) / reach;
          if (distance >= 1) continue;
          const k = j * columns + i;
          foam[k] = Math.min(1, foam[k] + amount * (.5 + .5 * Math.cos(Math.PI * distance)));
          active = true;
        }
      }
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw Error('Foam layer dt must be finite and non-negative');
      if (!active) return;
      accumulator = Math.min(accumulator + dt, STEP * 4);
      for (; accumulator >= STEP && active; accumulator -= STEP) step();
      for (let i = 0; i < foam.length; i++) pixels[i] = Math.round(foam[i] * BYTE);
      texture.needsUpdate = true;
    },
    clear() {
      foam.fill(0); pixels.fill(0);
      active = false;
      texture.needsUpdate = true;
    },
    dispose: () => texture.dispose(),
  };
}
