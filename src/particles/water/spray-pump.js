// ocean/spray.js -- port of WebGpuWater's WaterSprayPump.cs (Boat mode, Continuous emission) on the boat's extra surface probes.
// It only DECIDES when / how hard to spray and calls emitSplash (particles/splash.js, the WaterSplashEmitter.EmitSplash contract;
// objects hitting the water would call the same function). Divergence: Unity differences probe positions per FixedUpdate; here
// the boat moves in fixed physics steps while frames run at the display rate, so a per-frame difference is zero on step-less
// frames (any monitor above 60 Hz) and would reset the continuous run -- the probe velocity comes from the rigid body instead. Divergence: the probe heights come from the async sampler (1-2 frames old) and
// the probe's own motion is differenced here from its world position, like Unity; Unity's Rock / Both modes (water rising
// against a static point) are not ported -- the boat only needs Boat mode.
import * as THREE from 'three';

const RAD2DEG = 180 / Math.PI, UP = new THREE.Vector3(0, 1, 0);
// WaterSprayPump values of the "MotorBoat Ready" prefab (Samples/Demos/Common/Prefabs/Prebuilt): crown never (trigger 1),
// a strong outside-turn boost, a 110 deg petal barely raked astern and pushed DOWN 42 deg (Elevate clamps at horizontal).
export const SPRAY_DEFAULTS = Object.freeze({ on: true, surfaceBand: 0.25, minImpactSpeed: 0.2, maxImpactSpeed: 4, horizontalPlowWeight: 0.5, continuousPlowMultiplier: 2,
  emitCooldownSeconds: 0.06, sprayRadius: 0.25, continuous: true, continuousRatePerSecond: 10, continuousAmountScale: 0.236, continuousCrownTriggerStrength: 1, continuousCrownRatePerSecond: 0.1,
  turnRateForFullResponse: 25, turnOutsideAmountBoost: 5, turnOutsideSpawnOffset: 0.3, petalArcDegrees: 110, petalRakeAtRest: 0, petalRakeAtSpeed: 0.261, petalSpinDegrees: 0, petalElevationDegrees: -42.4, debug: false });
// Probe gates (SprayProbeGate) for the debug view.
export const GATE = Object.freeze({ NO_SAMPLE: 0, NO_HISTORY: 1, OUT_OF_BAND: 2, COOLING: 3, BELOW_MIN: 4, ACCUMULATING: 5, FIRED: 6 });
const CONTINUOUS_RATE_AT_THRESHOLD = 0.25, CONTINUOUS_ACCUMULATOR_MAX = 2, MIN_IMPACT_SPEED_SPAN = 1e-3, MIN_PETAL_LENGTH_SQ = 1e-8, MIN_FRAME_DT = 1e-4;

const tmpOut = new THREE.Vector3(), tmpRight = new THREE.Vector3(), tmpAstern = new THREE.Vector3(), tmpPetal = new THREE.Vector3(), tmpCross = new THREE.Vector3(), tmpVel = new THREE.Vector3();

// probes: [{ local: Vector3, outwardLocal: Vector3, ignoreSurfaceBand?: bool, amountBoost?: number }] (SprayProbe); world positions / samples are read through the accessors so the pump
// shares the boat's sampler (Buoyancy extra probes). sampleAt(i) -> { valid, height }, worldAt(i, out) -> Vector3.
export class SprayPump {
  constructor(body, probes, settings = {}, emitSplash) {
    if (typeof emitSplash !== 'function') throw new TypeError('Spray pump needs a splash emitter');
    this.emitSplash = emitSplash;
    this.body = body; this.probes = probes; this.s = { ...SPRAY_DEFAULTS, ...settings };
    this.states = probes.map(() => ({ nextEmitTime: 0, emitAcc: 0, crownAcc: 0, crownEmitted: false, hasEmitted: false, gate: GATE.NO_SAMPLE, signal: 0, strength: 0 }));
    this.time = 0; this.emits = 0;
  }
  applySettings(settings) { Object.assign(this.s, settings); }
  // Per frame (after the physics step): dt seconds, signedYawRate in Unity's sense (deg/s, > 0 = turning right).
  step(dt, sampleAt, worldAt, signedYawRate) {
    this.time += dt; if (!this.s.on || dt < MIN_FRAME_DT) return;
    for (let i = 0; i < this.probes.length; i++) {
      const st = this.states[i], sample = sampleAt(i);
      if (!sample || !sample.valid) { st.gate = GATE.NO_SAMPLE; this.resetRun(st); continue; }
      const world = worldAt(i, tmpPetal), vel = this.body.getPointVelocity(world, tmpVel);
      st.gate = this.tryEmit(i, st, world, vel, sample.height, dt, signedYawRate);
    }
  }
  tryEmit(index, st, world, vel, surfaceHeight, dt, signedYawRate) {
    const s = this.s, probe = this.probes[index], continuous = s.continuous;
    if (!probe.ignoreSurfaceBand && Math.abs(world.y - surfaceHeight) > s.surfaceBand) { this.resetRun(st); return GATE.OUT_OF_BAND; }
    if (!continuous && this.time < st.nextEmitTime) return GATE.COOLING;
    const probeDescent = -vel.y, stepX = vel.x, stepZ = vel.z;   // point velocity: descent > 0 = sinking; xz = travel direction for the rake
    const horizontalSpeed = Math.hypot(stepX, stepZ);
    const signal = Math.max(0, probeDescent) + s.horizontalPlowWeight * (continuous ? s.continuousPlowMultiplier : 1) * horizontalSpeed;
    st.signal = signal;
    if (signal < s.minImpactSpeed) { this.resetRun(st); st.strength = 0; return GATE.BELOW_MIN; }
    const strength = st.strength = THREE.MathUtils.clamp((signal - s.minImpactSpeed) / Math.max(MIN_IMPACT_SPEED_SPAN, s.maxImpactSpeed - s.minImpactSpeed), 0, 1);
    let crownDue = false;
    if (continuous) {
      if (strength < s.continuousCrownTriggerStrength) { st.crownAcc = 0; st.crownEmitted = false; }
      else if (!st.crownEmitted) crownDue = true;
      else { st.crownAcc = Math.min(st.crownAcc + s.continuousCrownRatePerSecond * dt, 1); crownDue = st.crownAcc >= 1; }
      const rate = s.continuousRatePerSecond * THREE.MathUtils.lerp(CONTINUOUS_RATE_AT_THRESHOLD, 1, strength);
      st.emitAcc = Math.min(st.emitAcc + rate * dt, CONTINUOUS_ACCUMULATOR_MAX);
      if (st.emitAcc < 1) return GATE.ACCUMULATING; st.emitAcc -= 1;
    }
    let amountScale = Math.max(0, 1 + (probe.amountBoost || 0)); if (continuous) amountScale *= s.continuousAmountScale;
    const outside = this.outsideTurnWeight(probe, signedYawRate); amountScale *= 1 + s.turnOutsideAmountBoost * outside;
    let sx = world.x, sz = world.z;
    if (outside > 0 && s.turnOutsideSpawnOffset > 0) { const o = this.outwardFlat(probe, tmpOut); if (o) { sx += o.x * s.turnOutsideSpawnOffset * outside; sz += o.z * s.turnOutsideSpawnOffset * outside; } }
    const petal = this.petalDirection(probe, stepX, stepZ, strength), allowCrown = !continuous || crownDue;
    if (amountScale > 0) { this.emitSplash(sx, surfaceHeight, sz, strength, s.sprayRadius, amountScale, petal, s.petalArcDegrees, s.petalElevationDegrees, allowCrown); this.emits++; }
    if (continuous) { if (allowCrown && strength >= s.continuousCrownTriggerStrength) { st.crownEmitted = true; st.crownAcc = 0; } }
    else st.nextEmitTime = this.time + this.staggeredCooldown(st, index);
    return GATE.FIRED;
  }
  staggeredCooldown(st, index) { if (st.hasEmitted) return this.s.emitCooldownSeconds; st.hasEmitted = true; return this.s.emitCooldownSeconds * (1 + index / this.probes.length); }
  outwardFlat(probe, out) { this.body.localToWorldDirection(probe.outwardLocal, out); out.y = 0; return out.lengthSq() < MIN_PETAL_LENGTH_SQ ? null : out.normalize(); }
  outsideTurnWeight(probe, signedYawRate) {
    const signedTurn = THREE.MathUtils.clamp(signedYawRate / Math.max(0.01, this.s.turnRateForFullResponse), -1, 1); if (Math.abs(signedTurn) < 1e-6) return 0;
    const outward = this.outwardFlat(probe, tmpOut); if (!outward) return 0;
    const right = this.body.localToWorldDirection(tmpRight.set(1, 0, 0), tmpRight); right.y = 0; if (right.lengthSq() < MIN_PETAL_LENGTH_SQ) return 0; right.normalize();
    return Math.max(0, -signedTurn * outward.dot(right));
  }
  petalDirection(probe, stepX, stepZ, strength) {
    const outward = this.outwardFlat(probe, tmpOut); if (!outward) return null;
    const rake = THREE.MathUtils.lerp(this.s.petalRakeAtRest, this.s.petalRakeAtSpeed, strength);
    if (rake > 0 && stepX * stepX + stepZ * stepZ >= MIN_PETAL_LENGTH_SQ) {   // RakeTowardAstern
      tmpAstern.set(-stepX, 0, -stepZ).normalize();
      const angle = Math.atan2(tmpCross.crossVectors(outward, tmpAstern).dot(UP), outward.dot(tmpAstern));
      outward.applyAxisAngle(UP, angle * THREE.MathUtils.clamp(rake, 0, 1));
    }
    if (this.s.petalSpinDegrees) outward.applyAxisAngle(UP, this.s.petalSpinDegrees / RAD2DEG);
    return outward;
  }
  resetRun(st) { st.emitAcc = 0; st.crownAcc = 0; st.crownEmitted = false; }
}
