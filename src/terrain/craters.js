import {hash2, seededRandom} from '../core/hash.js';
import {valueNoise} from '../core/value-noise.js';
import {TERRAIN_PALETTE_ROLES} from './terrain-rules.js';

// Craters: the shape an object blasts into the ground, shared by the bounded field (field.crater digs its samples)
// and the endless world (a crater layer: stamps that world.heightAt adds to the relief).

// depthLimit: deepest craters may dig below the original surface, m (a field fixes it when made: it sets the envelope
// of the mesh and of colliders built from it). rimShare: share of the dug volume piled into the rim, the rest is
// thrown out (ejecta). rimMaxShare: highest a rim may stand above the original surface, as a share of depthLimit.
// ragged (0..1): how irregular a crater is — its outline, the height of its rim, the patches of its thrown soil and
// the strata in its walls; 0 is the exact shape. rays: streaks of soil thrown far out, each of its own length.
export const CRATER_DEFAULTS = Object.freeze({depthLimit: 5, rimShare: .45, rimMaxShare: .25, ragged: .7, rays: 5});
export const CRATER_FIELDS = Object.freeze({
  radius: {label: 'Crater radius · m', min: .3, max: 12, step: .1},
  depth: {label: 'Crater depth · m', min: .05, max: 8, step: .05},
  rimShare: {label: 'Dug soil piled into the rim', min: 0, max: 1, step: .01},
  ragged: {label: 'Border raggedness', min: 0, max: 1, step: .01},
  rays: {label: 'Ejecta rays', min: 0, max: 12, step: 1},
});
// Rim profile in normalised footprint distance (1 on the outline): rises from start, peaks, and ends.
export const CRATER_RIM = Object.freeze({start: .8, peak: 1.06, end: 1.75});
// What a crater cuts into, by depth below the original surface (m): the surface paint down to `topsoil`, then
// subsoil (the biome's soil set) down to `subsoil`, scree down to `scree`, bedrock (rock) below; `band`: half the
// depth over which two strata blend. A biome may carry its own as `strata`.
export const CRATER_STRATA = Object.freeze({topsoil: .3, subsoil: 1.6, scree: 3.2, band: .25});
export const CRATER_STRATA_FIELDS = Object.freeze({
  topsoil: {label: 'Topsoil depth · m', min: .02, max: 2, step: .01},
  subsoil: {label: 'Subsoil down to · m', min: .05, max: 8, step: .05},
  scree: {label: 'Scree down to · m', min: .1, max: 8, step: .05},
  band: {label: 'Strata blend · m', min: .01, max: 1, step: .01},
});
// Thrown-out subsoil around a crater, in normalised footprint distance: it starts on the bowl's upper wall (`from`),
// covers fully at the outline, lies as a blanket that breaks into patches out to `blanket`, and its rays end within
// `reach`. Its strength is `cover` x the thrown share (1 - rimShare).
export const CRATER_EJECTA = Object.freeze({from: .85, blanket: 2, reach: 2.8, cover: 1.6});
// The irregularity of a crater at ragged 1. outline: how far the outline strays, as a share of its radius, in lobes
// `lobes` (coarse, fine) to a turn; rim: how much the rim height varies around it; strata: how far the strata in the
// walls stray, as a share of the dig; patch: size of the soil patches as a share of the reach (at least minPatch m),
// `patchEdge` the softness of their edge; ray: width (radians) and length (normalised distance) ranges of a ray,
// the share of its length from which it thins out (`taper`), its weakest strength, how far its angle strays from
// an even spread (share of the gap) and how broken it is.
const CRATER_RAGGED = Object.freeze({outline: .16, lobes: [1.7, 4.3], lobeMix: .65, rim: .55, rimLobes: 2.9, strata: .22,
  patch: .3, minPatch: .5, patchEdge: .2,
  ray: Object.freeze({width: [.09, .24], length: [1.7, CRATER_EJECTA.reach], taper: .7, strength: .55, stray: .8, broken: .55, patchShare: .45})});
const CRATER_SEED = 613;            // hash seed of the irregularity of a crater
const CRATER_SEED_GRID = 16;        // positions are rounded to 1 / this m for that hash
const STRATA_ROLE = Object.freeze(Object.fromEntries(['rock', 'scree', 'soil'].map(role => [role, TERRAIN_PALETTE_ROLES.indexOf(role)])));
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

export function validateStrata(strata) {
  for (const [key, spec] of Object.entries(CRATER_STRATA_FIELDS)) {
    const value = strata?.[key];
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) throw new RangeError(`Invalid crater strata ${key}: ${value}`);
  }
  if (!(strata.topsoil < strata.subsoil && strata.subsoil < strata.scree)) throw new RangeError('Crater strata must deepen: topsoil, then subsoil, then scree');
  return strata;
}

// Paints what a crater exposed into `roles` (one weight per TERRAIN_PALETTE_ROLES, summing to 1, changed in place):
// dig, m below the original surface, cuts through the strata; ejecta (0..1) covers the ground with thrown subsoil.
// Returns the share of the ground they cover, which hides sand lying there.
export function craterStrataPaint(roles, dig, ejecta, strata = CRATER_STRATA) {
  const exposed = dig > 0 ? smoothstep(0, strata.topsoil, dig) : 0;
  if (exposed <= 0 && ejecta <= 0) return 0;
  const {subsoil, scree, band} = strata;
  const belowSoil = smoothstep(subsoil - band, subsoil + band, dig), belowScree = smoothstep(scree - band, scree + band, dig);
  for (let role = 0; role < roles.length; role++) roles[role] *= (1 - exposed) * (1 - ejecta);
  const cut = exposed * (1 - ejecta);
  roles[STRATA_ROLE.soil] += cut * (1 - belowSoil) + ejecta;
  roles[STRATA_ROLE.scree] += cut * belowSoil * (1 - belowScree);
  roles[STRATA_ROLE.rock] += cut * belowScree;
  return exposed + ejecta - exposed * ejecta;
}

// Adds to `out` {topsoil, subsoil, scree, rock} the thickness of each stratum within [from, to] m below the
// original surface, times `weight` (e.g. a sample's area, for volumes).
export function addStrataVolumes(out, from, to, weight, strata = CRATER_STRATA) {
  const bands = [['topsoil', 0, strata.topsoil], ['subsoil', strata.topsoil, strata.subsoil], ['scree', strata.subsoil, strata.scree], ['rock', strata.scree, Infinity]];
  for (const [name, top, bottom] of bands) out[name] += Math.max(0, Math.min(to, bottom) - Math.max(from, top)) * weight;
  return out;
}
// The 'terrain:crater' event both crater sources emit to their subscribers. x, z: centre; height: the ground at the
// centre before the blast (null where the source does not know it: the host reads its world); reach: the outline's
// reach, m; outer: how far the crater changed the ground (thrown soil included), m; volume, rim, ejecta: dug, piled
// into the rim and thrown out, m³; strata: share of the dug volume from each stratum; rect: the rectangle changed.
export function craterEvent({x, z, height = null, shape, depth, footprint, volume, rim, strata, rect}) {
  const total = strata.topsoil + strata.subsoil + strata.scree + strata.rock;
  const shares = Object.freeze(Object.fromEntries(Object.entries(strata).map(([name, value]) => [name, total > 0 ? value / total : 0])));
  return Object.freeze({type: 'terrain:crater', x, z, height, shape, depth, reach: footprint.reach,
    outer: footprint.reach * CRATER_EJECTA.reach, volume, rim, ejecta: volume - rim, strata: shares, rect: Object.freeze(rect)});
}
const emptyStrata = () => ({topsoil: 0, subsoil: 0, scree: 0, rock: 0});

export function validateCraterSettings(settings) {
  const {depthLimit, rimShare, rimMaxShare, ragged, rays} = settings;
  if (!(ragged >= 0 && ragged <= 1)) throw new RangeError('Crater raggedness must be within 0..1');
  if (!Number.isInteger(rays) || rays < 0 || rays > CRATER_FIELDS.rays.max) throw new RangeError(`A crater throws 0 to ${CRATER_FIELDS.rays.max} rays`);
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

// How an impact makes a crater (craterFromImpact). depth: m dug at `reference` J of impact energy per m² of
// footprint, growing with the cube root of that energy density, at most `aspect` x the footprint's narrow width;
// grow: how much wider than the object the crater is per cube root of MJ of energy, at most maxGrow x; below
// minEnergy J/m² the ground keeps no crater. An impact flatter than furrowFrom (obliquity) ploughs a furrow along
// its heading, `stretch` x longer at obliquity 1, and digs with the energy of its downward speed (at least
// glancingShare of the whole).
export const CRATER_IMPACT = Object.freeze({depth: 2.2, reference: 1e6, aspect: 1.5, grow: .25, maxGrow: 2.2, minEnergy: 2e3, furrowFrom: .35, stretch: 1.5, glancingShare: .15});
// The crater an object makes when it hits the ground. footprint: the outline it lands on (craterFootprint's shape);
// mass: kg; velocity: [x, y, z] m/s at impact. Returns {shape, depth, travel, energy} for field.crater or a crater
// layer stamp, or null when the impact is too weak to leave one.
export function craterFromImpact({footprint, mass, velocity}) {
  const {halfX, halfZ, yaw = 0, squareness = 0} = typeof footprint === 'number' ? {halfX: footprint, halfZ: footprint} : footprint ?? {};
  craterFootprint(footprint);
  if (!(mass > 0) || velocity?.length !== 3 || !velocity.every(Number.isFinite)) throw new RangeError('An impact needs a positive mass and a velocity [x, y, z]');
  const I = CRATER_IMPACT, [vx, vy, vz] = velocity, along = Math.hypot(vx, vz), speed = Math.hypot(along, vy);
  if (!speed) return null;
  const energy = .5 * mass * speed * speed, obliquity = along / speed, heading = Math.atan2(vz, vx);
  // Footprint area between an ellipse (round) and its rectangle (square).
  const density = energy / ((Math.PI + (4 - Math.PI) * squareness) * halfX * halfZ);
  if (density < I.minEnergy) return null;
  const grow = Math.min(I.maxGrow, 1 + I.grow * Math.cbrt(energy / 1e6));
  const downward = Math.max(I.glancingShare, 1 - obliquity * obliquity);
  const depth = Math.min(I.aspect * 2 * Math.min(halfX, halfZ) * grow, I.depth * Math.cbrt(density * downward / I.reference));
  let shape;
  if (obliquity >= I.furrowFrom) {
    // A furrow: the object's extent along and across its heading, stretched along it, its corners worn round.
    const turn = yaw - heading, c = Math.abs(Math.cos(turn)), s = Math.abs(Math.sin(turn));
    shape = {halfX: (halfX * c + halfZ * s) * grow * (1 + I.stretch * obliquity), halfZ: (halfX * s + halfZ * c) * grow, yaw: heading, squareness: squareness * (1 - obliquity)};
  } else shape = {halfX: halfX * grow, halfZ: halfZ * grow, yaw, squareness};
  return {shape, depth, travel: {heading, obliquity}, energy};
}

// One crater: everything it does to the ground around (x, z), for the field (which digs its samples with it) and the
// crater layer (which keeps it). shape: craterFootprint's; depth: m at the centre; rimShare, ragged, rays: see
// CRATER_DEFAULTS; travel: {heading (radians, from +X toward +Z), obliquity (0..1)} of the object that made it:
// the soil is thrown forward, all of it at obliquity 1. Its irregularity is drawn from its position, so a crater
// restored from a save is the same crater.
export function createCraterStamp({x, z, shape, depth, rimShare = CRATER_DEFAULTS.rimShare, ragged = CRATER_DEFAULTS.ragged, rays = CRATER_DEFAULTS.rays, travel}) {
  if (![x, z, depth].every(Number.isFinite) || depth <= 0) throw new RangeError('A crater needs a finite position and a positive depth');
  validateCraterSettings({...CRATER_DEFAULTS, rimShare, ragged, rays});
  const {heading = 0, obliquity = 0} = travel ?? {};
  if (!Number.isFinite(heading) || !(obliquity >= 0 && obliquity <= 1)) throw new RangeError('Crater travel needs a heading and an obliquity from zero to one');
  const footprint = craterFootprint(shape), R = CRATER_RAGGED;
  const seed = Math.floor(hash2(Math.round(x * CRATER_SEED_GRID), Math.round(z * CRATER_SEED_GRID), CRATER_SEED) * 2147483647);
  const noise = valueNoise(seed), random = seededRandom(seed);
  const stray = ragged * R.outline;
  // digReach bounds the bowl, outer everything the crater changes (thrown soil included), in m from the centre.
  const digReach = footprint.reach * (1 + stray), outer = footprint.reach * CRATER_EJECTA.reach;
  const patchSize = Math.max(R.minPatch, footprint.reach * R.patch);
  const gap = rays ? 2 * Math.PI / rays : 0, between = ([min, max]) => min + (max - min) * random();
  const streaks = Array.from({length: rays}, (_, index) => ({
    angle: (index + (random() - .5) * R.ray.stray * ragged) * gap, width: between(R.ray.width), length: between(R.ray.length),
    strength: 1 - (1 - R.ray.strength) * random() * ragged,
  }));
  const turn = random() * 2 * Math.PI;   // where the first ray points
  // Normalised distance of an offset on the ragged outline: the outline strays in lobes around the crater.
  function distance(dx, dz) {
    const t = footprint.distance(dx, dz);
    if (!stray) return t;
    const r = Math.hypot(dx, dz);
    if (r < 1e-6) return t;
    const ux = dx / r, uz = dz / r, [coarse, fine] = R.lobes;
    const lobe = R.lobeMix * noise(ux * coarse + 11.3, uz * coarse + 5.1) + (1 - R.lobeMix) * noise(ux * fine + 31.7, uz * fine + 17.9);
    return t / (1 + stray * lobe);
  }
  // Rim height at its peak: rimShare of the bowl volume spread by the rim weight, both summed over the crater.
  const step = 2 * outer / CRATER_INTEGRATION, area = step * step;
  let bowl = 0, rim = 0;
  for (let j = 0; j < CRATER_INTEGRATION; j++) for (let i = 0; i < CRATER_INTEGRATION; i++) {
    const t = distance(-outer + (i + .5) * step, -outer + (j + .5) * step);
    bowl += footprint.bowl(t);
    rim += craterRimWeight(t);
  }
  const volume = bowl * area * depth, rimPeak = rim > 0 ? rimShare * volume / (rim * area) : 0;
  const thrownShare = CRATER_EJECTA.cover * (1 - rimShare);
  return {
    data: Object.freeze({x, z, shape: typeof shape === 'number' ? shape : Object.freeze({...shape}), depth, rimShare, ragged, rays, ...(travel && {travel: Object.freeze({heading, obliquity})})}),
    x, z, depth, footprint, digReach, outer, volume, rimVolume: rimShare * volume,
    rect: Object.freeze({minX: x - outer, minZ: z - outer, maxX: x + outer, maxZ: z + outer}),
    // The shape at an offset from the centre, into out: t (normalised distance on the ragged outline), dig (m the
    // bowl cuts) and rise (m the rim stands).
    relief(dx, dz, out) {
      const t = out.t = distance(dx, dz);
      out.dig = depth * footprint.bowl(t);
      const weight = craterRimWeight(t);
      out.rise = 0;
      if (weight > 0) {
        const r = Math.hypot(dx, dz) || 1;
        out.rise = rimPeak * weight * Math.max(0, 1 + ragged * R.rim * noise(dx / r * R.rimLobes + 71.3, dz / r * R.rimLobes + 53.9));
      }
      return out;
    },
    // How far the strata stray at an offset: the dig the paint sees is the dig x this.
    strataShift: (dx, dz) => 1 + ragged * R.strata * noise(dx / patchSize + 7.7, dz / patchSize + 3.1),
    // Share of the ground covered by thrown soil at an offset (0..1): a blanket around the rim that breaks into
    // patches as it thins, and the rays.
    thrown(dx, dz) {
      const t = footprint.distance(dx, dz);
      if (t <= CRATER_EJECTA.from || t >= CRATER_EJECTA.reach) return 0;
      const onWall = smoothstep(CRATER_EJECTA.from, 1, t), fade = 1 - smoothstep(1, CRATER_EJECTA.blanket, t);
      const patch = .5 + .5 * (.65 * noise(dx / patchSize + 19.1, dz / patchSize + 41.7) + .35 * noise(dx / patchSize * 2.6 + 3.3, dz / patchSize * 2.6 + 9.9));
      const patchy = smoothstep(1 - fade - R.patchEdge, 1 - fade + R.patchEdge, patch) * Math.min(1, fade * 4);
      let cover = fade + (patchy - fade) * ragged;
      const angle = Math.atan2(dz, dx);
      for (const streak of streaks) {
        if (t >= streak.length) continue;
        let away = Math.abs(angle - streak.angle - turn) % (2 * Math.PI);
        if (away > Math.PI) away = 2 * Math.PI - away;
        if (away > streak.width * 3) continue;
        const along = 1 - smoothstep(streak.length * R.ray.taper, streak.length, t);
        const fine = .5 + .5 * noise(dx / (patchSize * R.ray.patchShare) + 57.3, dz / (patchSize * R.ray.patchShare) + 23.1);
        const broken = 1 - ragged * R.ray.broken * (1 - smoothstep(.3, .6, fine + along * .4));
        cover = Math.max(cover, Math.exp(-((away / streak.width) ** 2)) * along * streak.strength * broken);
      }
      const forward = obliquity ? Math.max(0, 1 + obliquity * Math.cos(angle - heading)) : 1;
      return Math.min(1, thrownShare * onWall * cover * forward);
    },
    // Volume dug from each stratum, m³, into out {topsoil, subsoil, scree, rock}, the dig kept within depthLimit.
    dugStrata(out, strata, depthLimit) {
      for (let j = 0; j < CRATER_INTEGRATION; j++) for (let i = 0; i < CRATER_INTEGRATION; i++) {
        const share = footprint.bowl(distance(-outer + (i + .5) * step, -outer + (j + .5) * step));
        if (share > 0) addStrataVolumes(out, 0, Math.min(depthLimit, depth * share), area, strata);
      }
      return out;
    },
  };
}

// Craters of an endless world, as stamps: {x, z, shape, depth, rimShare, ragged, rays, travel} (createCraterStamp).
// Each digs its bowl and piles rimShare of the dug volume into its rim; overlapping stamps add, the sum kept within
// depthLimit below and the rim cap above the original relief. stamps: saved stamps to start from (toJSON). Pass the
// layer to createTerrainWorld as `craters`.
// strata: what the emitted events count the dug volume in (CRATER_STRATA by default: the layer knows no biome).
// subscribe(listener) hears a 'terrain:crater' event (craterEvent) for every stamp added after it; returns unsubscribe.
export function createCraterLayer({stamps = [], strata = CRATER_STRATA, ...overrides} = {}) {
  const settings = validateCraterSettings({...CRATER_DEFAULTS, ...overrides});
  validateStrata(strata);
  const listeners = new Set();
  const rimCap = settings.depthLimit * settings.rimMaxShare;
  const entries = [], grid = new Map(), shape = {t: 0, dig: 0, rise: 0};
  const cellOf = value => Math.floor(value / CRATER_GRID);
  const keyOf = (column, row) => (column + GRID_SPAN) * 2 * GRID_SPAN + row + GRID_SPAN;

  // Adds a stamp. Returns the rectangle it changes, {minX, minZ, maxX, maxZ} in m.
  function add({rimShare = settings.rimShare, ragged = settings.ragged, rays = settings.rays, ...crater}) {
    const stamp = createCraterStamp({...crater, rimShare, ragged, rays}), {x, z, outer} = stamp;
    if (Math.abs(cellOf(x)) + Math.ceil(outer / CRATER_GRID) >= GRID_SPAN || Math.abs(cellOf(z)) + Math.ceil(outer / CRATER_GRID) >= GRID_SPAN) {
      throw new RangeError('A crater stamp lies beyond the reach of the crater layer');
    }
    entries.push(stamp);
    for (let row = cellOf(z - outer); row <= cellOf(z + outer); row++) for (let column = cellOf(x - outer); column <= cellOf(x + outer); column++) {
      const key = keyOf(column, row);
      let list = grid.get(key);
      if (!list) grid.set(key, list = []);
      list.push(stamp);
    }
    if (listeners.size) {
      const event = craterEvent({x, z, shape: stamp.data.shape, depth: stamp.depth, footprint: stamp.footprint, volume: stamp.volume, rim: stamp.rimVolume,
        strata: stamp.dugStrata(emptyStrata(), strata, settings.depthLimit), rect: stamp.rect});
      for (const listener of listeners) listener(event);
    }
    return stamp.rect;
  }
  for (const stamp of stamps) add(stamp);

  // Height the craters add at a point, m. cell: the cell size of the mesh that asks (createRelief's band limit);
  // omit for full detail.
  function offsetAt(x, z, cell = 0) {
    const list = grid.get(keyOf(cellOf(x), cellOf(z)));
    if (!list) return 0;
    let dig = 0, rise = 0;
    for (const stamp of list) {
      const dx = x - stamp.x, dz = z - stamp.z;
      if (Math.abs(dx) > stamp.outer || Math.abs(dz) > stamp.outer) continue;
      const shown = cell > 0 ? smoothstep(CRATER_BAND.from, CRATER_BAND.to, stamp.footprint.reach / cell) : 1;
      if (shown <= 0) continue;
      stamp.relief(dx, dz, shape);
      dig += shown * shape.dig;
      rise += shown * shape.rise;
    }
    return Math.min(rimCap, rise) - Math.min(settings.depthLimit, dig);
  }

  // What the craters exposed at a point, written into out {dig, ejecta}: the depth they cut below the original
  // relief as the paint sees it (m, within depthLimit; the strata stray) and the share of thrown soil lying there
  // (0..1). For craterStrataPaint.
  function exposureAt(x, z, out) {
    out.dig = out.ejecta = 0;
    const list = grid.get(keyOf(cellOf(x), cellOf(z)));
    if (!list) return out;
    for (const stamp of list) {
      const dx = x - stamp.x, dz = z - stamp.z;
      if (Math.abs(dx) > stamp.outer || Math.abs(dz) > stamp.outer) continue;
      stamp.relief(dx, dz, shape);
      if (shape.dig > 0) out.dig += shape.dig * stamp.strataShift(dx, dz);
      out.ejecta += stamp.thrown(dx, dz);
    }
    out.dig = Math.min(settings.depthLimit, out.dig);
    out.ejecta = Math.min(1, out.ejecta);
    return out;
  }

  return {
    settings,
    get count() { return entries.length; },
    add, offsetAt, exposureAt,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A crater listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Rectangle covering every stamp, or null without any.
    bounds() {
      if (!entries.length) return null;
      const rects = entries.map(stamp => stamp.rect);
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
    toJSON() { return entries.map(({data}) => ({...data, shape: typeof data.shape === 'number' ? data.shape : {...data.shape}, ...(data.travel && {travel: {...data.travel}})})); },
  };
}
