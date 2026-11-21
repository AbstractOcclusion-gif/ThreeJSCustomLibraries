// A swirling air for puffs: a velocity field with no sources and no sinks (the curl of a noise potential), so what it
// carries rolls up into eddies without bunching together or thinning out. It stands in for the turbulence a real
// plume makes for itself: a thread of smoke leaves straight, then folds into curls.
// The potential is three layers of the kit's 2D value noise, one across each pair of axes; each gives eddies that turn
// about the third axis. The field travels up with the smoke it stirs (`rise`), so a puff stays in its eddy long enough
// to be wound round it, and its layers slide past one another (`churn`), so no eddy lasts.
import {valueNoise} from '../core/value-noise.js';

export const SWIRL_DEFAULTS = Object.freeze({
  eddy: 0.05,     // m: the size of the larger eddies
  rise: 0.14,     // m/s the field travels up
  churn: 0.25,    // eddy sizes per second the layers slide past one another
  detail: 0.5,    // weight of a second set of eddies half the size (0: none)
  ramp: 1.2,      // s before a new puff feels the whole field, easing in: the thread leaves smooth
  seed: 7,
});
const STEP = 0.05;                   // the slope of the potential is measured this share of an eddy either side of the point
const BARE_LENGTH = 1.7;             // mean length of the curl of the three layers alone (measured): divided out, so the result is about 1
const FINE = 2;                      // the second set of eddies is this many times finer
const FINE_OFFSET = [17.3, 5.1];     // and read elsewhere in the noise, so it does not echo the first
const SLIDE = [[1, 0.6], [-0.7, 1], [0.5, -0.8]];   // how each layer slides with `churn`, per axis of its plane

// Returns {ramp, sample(out, x, y, z, time)}: sample writes the air's velocity at a point (m) and a time (s) into
// out {x, y, z}, in units of the field's mean speed: about 1 long on average, seldom over 3. Scale it by the speed the
// eddies should turn at.
export function createSwirlField(overrides = {}) {
  const settings = {...SWIRL_DEFAULTS, ...overrides};
  const {eddy, rise, churn, detail, ramp, seed} = settings;
  if (![eddy, ramp].every(value => Number.isFinite(value) && value > 0) || ![rise, churn, detail, seed].every(Number.isFinite) || detail < 0) {
    throw new RangeError('Swirl needs a positive eddy size and ramp, a finite rise, churn and seed, and a detail of 0 or more');
  }
  const layers = [valueNoise(seed), valueNoise(seed + 1), valueNoise(seed + 2)];
  const unit = 1 / (BARE_LENGTH * Math.hypot(1, detail * FINE));   // the finer eddies add their slopes, FINE times steeper
  const slope = [0, 0];
  // The slope of layer `index` at (a, b), into `slope`: [d/da, d/db], per eddy size.
  function measure(index, a, b) {
    const noise = layers[index];
    const potential = (u, v) => noise(u, v) + (detail > 0 ? detail * noise(u * FINE + FINE_OFFSET[0], v * FINE + FINE_OFFSET[1]) : 0);
    // Measured either side of the point: one-sided, the slopes of a layer disagree and the air gains sources and sinks.
    slope[0] = (potential(a + STEP, b) - potential(a - STEP, b)) / (2 * STEP);
    slope[1] = (potential(a, b + STEP) - potential(a, b - STEP)) / (2 * STEP);
  }
  return {
    ramp,
    sample(out, x, y, z, time) {
      const px = x / eddy, py = (y - rise * time) / eddy, pz = z / eddy, slid = churn * time;
      // The potential is (A(y, z), B(z, x), C(x, y)); the velocity is its curl.
      measure(0, py + SLIDE[0][0] * slid, pz + SLIDE[0][1] * slid);
      const ay = slope[0], az = slope[1];
      measure(1, pz + SLIDE[1][0] * slid, px + SLIDE[1][1] * slid);
      const bz = slope[0], bx = slope[1];
      measure(2, px + SLIDE[2][0] * slid, py + SLIDE[2][1] * slid);
      const cx = slope[0], cy = slope[1];
      out.x = (cy - bz) * unit;
      out.y = (az - cx) * unit;
      out.z = (bx - ay) * unit;
      return out;
    },
  };
}
