const STEP = 1 / 30;
// Wind stretches the spread radius downwind and shortens it upwind: by WIND_REACH at WIND_FULL_SPEED (m/s) and beyond.
const WIND_REACH = 0.6, WIND_FULL_SPEED = 12;

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}

// maxCatchUp: the most simulated seconds one update() may advance (a tab resume never replays minutes of O(N²) steps); Infinity disables the cap.
// environment: optional core/environment.js contract (also setEnvironment()); without it the fire spreads evenly.
export function createFireSystem({spreadRadius = 3, cooling = 0.3, maxCatchUp = 2, environment = null} = {}) {
  positive(spreadRadius, 'Spread radius');
  if (!Number.isFinite(cooling) || cooling < 0) throw new RangeError('Cooling must be nonnegative');
  const objects = new Map();
  let elapsed = 0;

  function ignite(state) {
    if (state.phase !== 'unlit') return false;
    state.phase = 'burning';
    state.heat = state.ignitionHeat;
    return true;
  }

  function step() {
    // Snapshot the sources so a new ignition cannot heat its neighbors until the next step.
    const sources = [];
    for (const state of objects.values()) {
      if (state.phase !== 'burning') continue;
      const output = state.heatOutput * Math.min(1, state.fuel / STEP);
      sources.push({position: state.position, output});
      state.fuel = Math.max(0, state.fuel - STEP);
      if (state.fuel <= 1e-9) {
        state.fuel = state.heat = 0;
        state.phase = 'burned';
      }
    }
    const wind = environment?.wind;
    const reach = wind && wind.speed > 0 ? WIND_REACH * Math.min(1, wind.speed / WIND_FULL_SPEED) / wind.speed : 0;
    for (const state of objects.values()) {
      if (state.phase !== 'unlit') continue;
      const {x, y, z} = state.position;
      let received = 0;
      for (const {position, output} of sources) {
        const dx = x - position.x, dz = z - position.z, distance = Math.hypot(dx, y - position.y, dz);
        const downwind = reach > 0 && distance > 0 ? reach * (dx * wind.x + dz * wind.z) / distance : 0;   // -WIND_REACH..WIND_REACH
        const falloff = Math.max(0, 1 - distance / (spreadRadius * (1 + downwind)));
        received += output * falloff ** 2;
      }
      state.heat = Math.max(0, state.heat + (received - cooling * state.heat) * STEP);
      if (state.heat >= state.ignitionHeat) ignite(state);
    }
  }

  const api = {
    setEnvironment(next) { environment = next ?? null; },
    add({position, ignitionHeat = 1, burnSeconds = 10, heatOutput = 2.8}) {
      if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) {
        throw new RangeError('Fire position requires finite x, y and z coordinates');
      }
      positive(ignitionHeat, 'Ignition heat');
      positive(burnSeconds, 'Burn duration');
      positive(heatOutput, 'Heat output');
      const state = {position, ignitionHeat, burnSeconds, heatOutput, fuel: burnSeconds, heat: 0, phase: 'unlit'};
      const object = {
        get phase() { return state.phase; },
        get fuel() { return state.fuel / state.burnSeconds; },
        get heat() { return state.heat / state.ignitionHeat; },
        ignite() { return objects.has(object) && ignite(state); },
      };
      objects.set(object, state);
      return object;
    },
    remove(object) { return objects.delete(object); },
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      elapsed = Math.min(elapsed + dt, maxCatchUp);
      while (elapsed + 1e-12 >= STEP) {
        elapsed -= STEP;
        step();
      }
    },
    reset() {
      elapsed = 0;
      for (const state of objects.values()) {
        state.fuel = state.burnSeconds;
        state.heat = 0;
        state.phase = 'unlit';
      }
    },
  };
  api.tick = api.update;   // former name, kept for existing callers
  return api;
}
