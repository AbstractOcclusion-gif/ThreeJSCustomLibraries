// Craters: the shape an object blasts into the ground, shared by the bounded field (field.crater digs its samples)
// and the endless world (a crater layer: stamps that world.heightAt adds to the relief).

// depthLimit: deepest craters may dig below the original surface, m (a field fixes it when made: it sets the envelope
// of the mesh and of colliders built from it). rimShare: share of the dug volume piled into the rim, the rest is
// thrown out (ejecta). rimMaxShare: highest a rim may stand above the original surface, as a share of depthLimit.
export const CRATER_DEFAULTS = Object.freeze({depthLimit: 5, rimShare: .45, rimMaxShare: .25});
export const CRATER_FIELDS = Object.freeze({
  radius: {label: 'Crater radius · m', min: .3, max: 12, step: .1},
  depth: {label: 'Crater depth · m', min: .05, max: 8, step: .05},
  rimShare: {label: 'Dug soil piled into the rim', min: 0, max: 1, step: .01},
});
// Rim profile in normalised footprint distance (1 on the outline): rises from start, peaks, and ends.
export const CRATER_RIM = Object.freeze({start: .8, peak: 1.06, end: 1.75});
// Footprint exponent: squareness 0 is an ellipse with a parabolic bowl (a round body), 1 a rectangle with a flat floor
// and steep walls (a box). The same exponent shapes the outline and the bowl.
const CRATER_POWER = Object.freeze({round: 2, square: 8});
// A mesh with cells of `cell` m shows a crater fully once its reach spans `to` cells and not at all under `from`: the
// far rings of a clipmap lose craters they cannot draw instead of aliasing them.
const CRATER_BAND = Object.freeze({from: 1, to: 3});
// Samples per side of the square over which a stamp's bowl volume and rim weight are summed when it is added.
const CRATER_INTEGRATION = 64;
// Side of a cell of the stamp lookup grid, m: a query reads the stamps of one cell.
const CRATER_GRID = 32;
const GRID_SPAN = 2 ** 20;   // grid cells each way from the origin that the lookup keys tell apart

const smoothstep = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
// Weight of the rim at normalised distance t (CRATER_RIM).
export function craterRimWeight(t) {
  return smoothstep(CRATER_RIM.start, CRATER_RIM.peak, t) * (1 - smoothstep(CRATER_RIM.peak, CRATER_RIM.end, t));
}

export function validateCraterSettings(settings) {
  const {depthLimit, rimShare, rimMaxShare} = settings;
  if (!(depthLimit >= 0 && depthLimit <= CRATER_FIELDS.depth.max)) throw new RangeError(`Crater depth limit must be within 0..${CRATER_FIELDS.depth.max} m`);
  if (!(rimShare >= 0 && rimShare <= 1)) throw new RangeError('A crater needs a rim share from zero to one');
  if (!(rimMaxShare >= 0 && rimMaxShare <= 1)) throw new RangeError('Crater rim max share must be within 0..1');
  return settings;
}

// The shape an object leaves: a radius (round), or {halfX, halfZ, yaw, squareness} — half sizes in m along the
// object's own X and Z once turned by yaw (radians, from +X toward +Z). Returns the normalised distance of a world
// offset from the centre (1 on the outline), the bowl depth share at that distance, and the reach in m.
export function craterFootprint(shape) {
  const {halfX, halfZ, yaw = 0, squareness = 0} = typeof shape === 'number' ? {halfX: shape, halfZ: shape} : shape ?? {};
  if (![halfX, halfZ, yaw, squareness].every(Number.isFinite) || halfX <= 0 || halfZ <= 0 || squareness < 0 || squareness > 1) {
    throw new RangeError('A crater footprint needs positive half sizes, a yaw and a squareness from zero to one');
  }
  const power = CRATER_POWER.round + (CRATER_POWER.square - CRATER_POWER.round) * squareness;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  // Bounds the outline: the long axis of an ellipse; a squarer outline reaches toward the corner of its rectangle.
  const reach = squareness > 0 ? Math.hypot(halfX, halfZ) : Math.max(halfX, halfZ);
  return {power, reach,
    distance(dx, dz) {
      const u = Math.abs(dx * cos + dz * sin) / halfX, v = Math.abs(dz * cos - dx * sin) / halfZ;
      return (u ** power + v ** power) ** (1 / power);
    },
    bowl: t => t >= 1 ? 0 : 1 - t ** power};
}

// Craters of an endless world, as stamps: {x, z, shape, depth, rimShare}. Each digs its bowl and piles rimShare of the
// dug volume into its rim; overlapping stamps add, the sum kept within depthLimit below and the rim cap above the
// original relief. stamps: saved stamps to start from (toJSON). Pass the layer to createTerrainWorld as `craters`.
export function createCraterLayer({stamps = [], ...overrides} = {}) {
  const settings = validateCraterSettings({...CRATER_DEFAULTS, ...overrides});
  const rimCap = settings.depthLimit * settings.rimMaxShare;
  const entries = [], grid = new Map();
  const cellOf = value => Math.floor(value / CRATER_GRID);
  const keyOf = (column, row) => (column + GRID_SPAN) * 2 * GRID_SPAN + row + GRID_SPAN;

  // The rectangle a stamp changes, {minX, minZ, maxX, maxZ} in m.
  const rectOf = ({x, z, outer}) => ({minX: x - outer, minZ: z - outer, maxX: x + outer, maxZ: z + outer});
  function add({x, z, shape, depth, rimShare = settings.rimShare}) {
    if (![x, z, depth].every(Number.isFinite) || depth <= 0) throw new RangeError('A crater stamp needs a finite position and a positive depth');
    if (!(rimShare >= 0 && rimShare <= 1)) throw new RangeError('A crater needs a rim share from zero to one');
    const footprint = craterFootprint(shape), outer = footprint.reach * CRATER_RIM.end;
    if (Math.abs(cellOf(x)) + Math.ceil(outer / CRATER_GRID) >= GRID_SPAN || Math.abs(cellOf(z)) + Math.ceil(outer / CRATER_GRID) >= GRID_SPAN) {
      throw new RangeError('A crater stamp lies beyond the reach of the crater layer');
    }
    // Rim height at its peak: rimShare of the bowl volume spread by the rim weight over the same area.
    const step = 2 * outer / CRATER_INTEGRATION;
    let bowl = 0, rim = 0;
    for (let j = 0; j < CRATER_INTEGRATION; j++) for (let i = 0; i < CRATER_INTEGRATION; i++) {
      const t = footprint.distance(-outer + (i + .5) * step, -outer + (j + .5) * step);
      bowl += footprint.bowl(t);
      rim += craterRimWeight(t);
    }
    const area = step * step, volume = bowl * area * depth;
    const entry = {stamp: Object.freeze({x, z, shape: typeof shape === 'number' ? shape : Object.freeze({...shape}), depth, rimShare}),
      x, z, outer, footprint, depth, rimPeak: rim > 0 ? rimShare * volume / (rim * area) : 0, volume};
    entries.push(entry);
    for (let row = cellOf(z - outer); row <= cellOf(z + outer); row++) for (let column = cellOf(x - outer); column <= cellOf(x + outer); column++) {
      const key = keyOf(column, row);
      let list = grid.get(key);
      if (!list) grid.set(key, list = []);
      list.push(entry);
    }
    return rectOf(entry);
  }
  for (const stamp of stamps) add(stamp);

  // Height the craters add at a point, m. cell: the cell size of the mesh that asks (createRelief's band limit);
  // omit for full detail.
  function offsetAt(x, z, cell = 0) {
    const list = grid.get(keyOf(cellOf(x), cellOf(z)));
    if (!list) return 0;
    let dig = 0, rise = 0;
    for (const entry of list) {
      const dx = x - entry.x, dz = z - entry.z;
      if (Math.abs(dx) > entry.outer || Math.abs(dz) > entry.outer) continue;
      const shown = cell > 0 ? smoothstep(CRATER_BAND.from, CRATER_BAND.to, entry.footprint.reach / cell) : 1;
      if (shown <= 0) continue;
      const t = entry.footprint.distance(dx, dz);
      dig += shown * entry.depth * entry.footprint.bowl(t);
      rise += shown * entry.rimPeak * craterRimWeight(t);
    }
    return Math.min(rimCap, rise) - Math.min(settings.depthLimit, dig);
  }

  return {
    settings,
    get count() { return entries.length; },
    add, offsetAt,
    // Rectangle covering every stamp, or null without any.
    bounds() {
      if (!entries.length) return null;
      const rects = entries.map(rectOf);
      return {minX: Math.min(...rects.map(r => r.minX)), minZ: Math.min(...rects.map(r => r.minZ)), maxX: Math.max(...rects.map(r => r.maxX)), maxZ: Math.max(...rects.map(r => r.maxZ))};
    },
    // Removes every stamp. Returns the rectangle they covered (to refresh), or null.
    clear() {
      const covered = this.bounds();
      entries.length = 0;
      grid.clear();
      return covered;
    },
    // The stamps, plain data, for a save or a worker: createCraterLayer({stamps}) restores them.
    toJSON() { return entries.map(({stamp}) => ({...stamp, shape: typeof stamp.shape === 'number' ? stamp.shape : {...stamp.shape}})); },
  };
}
