// Fixed-step driver for physics that must not see a variable frame time (cable, destruction, buoyancy).
// advance(dt, run) calls run(step) once per whole step owed and keeps the remainder for the next frame. A slow frame runs at
// most maxSteps and drops the backlog beyond that, so a stalled tab never replays seconds of simulation at once.
export const FIXED_STEP_DEFAULTS = Object.freeze({step: 1 / 120, maxSteps: 6});

export function createFixedStep({step = FIXED_STEP_DEFAULTS.step, maxSteps = FIXED_STEP_DEFAULTS.maxSteps} = {}) {
  if (!(step > 0) || !Number.isInteger(maxSteps) || maxSteps < 1) throw Error('Fixed step needs a positive step and a whole maxSteps of at least 1');
  let owed = 0;
  return {
    step,
    advance(dt, run) {
      if (!Number.isFinite(dt) || dt < 0) throw Error('Fixed step dt must be finite and non-negative');
      owed += dt;
      let steps = 0;
      for (; owed >= step && steps < maxSteps; steps++, owed -= step) run(step);
      if (owed >= step) owed %= step;
      return steps;
    },
    reset() { owed = 0; },
  };
}
