// ocean/buoyancy.js -- port of WebGpuWater's WaterBuoyancy.cs on the ocean's SurfaceProbes: an n^3 probe lattice through a local
// box, each probe a sphere whose submerged cap fraction scales a partial Archimedes lift applied AT the probe (torque -> lean,
// rock, self-right), per-probe drag at the probe velocity, surface-flow drift, body angular / vertical settle damping, surface glue.
// Divergence: the probes are read through the async sampler (1-2 frames old, see surface-sampler.js), not a synchronous query.
import * as THREE from 'three';
import { GRAVITY } from './fft-spectrum.js';

const MIN_SAMPLES_PER_AXIS = 1, MAX_SAMPLES_PER_AXIS = 3, MIN_SPHERE_RADIUS = 0.01, MINIMUM_FLOATING_BUOYANCY = 1, MAX_SURFACE_GLUE = 4;
// Unity defaults (WaterBuoyancy.cs serialized fields).
export const BUOYANCY_DEFAULTS = Object.freeze({ buoyancy: 2.5, waterLinearDamping: 2, waterAngularDamping: 1, samplesPerAxis: 2, floatRadiusScale: 1.5,
  waveDriftStrength: 1, verticalSettleDamping: 1, surfaceGlueIntensity: 0, maxBuoyancyForce: 0, surfaceRelativeDrag: false, dragCoefficients: [1, 1, 1] });

const tmpLift = new THREE.Vector3(), tmpDrag = new THREE.Vector3(), tmpDrift = new THREE.Vector3(), tmpVel = new THREE.Vector3(), tmpLocal = new THREE.Vector3();

export function sphereSubmergedFraction(depth, radius) {
  if (depth >= radius) return 1; if (depth <= -radius) return 0;
  const capHeight = depth + radius; return (capHeight * capHeight * (3 * radius - capHeight)) / (4 * radius * radius * radius);
}
export function surfaceGlueAcceleration(gravity, floatStrength, averageFraction, intensity) {
  if (gravity <= 0 || floatStrength <= MINIMUM_FLOATING_BUOYANCY || intensity <= 0) return 0;
  const safeIntensity = THREE.MathUtils.clamp(intensity, 0, MAX_SURFACE_GLUE), equilibriumFraction = 1 / floatStrength;
  return gravity * floatStrength * safeIntensity * (THREE.MathUtils.clamp(averageFraction, 0, 1) - equilibriumFraction);
}

export class Buoyancy {
  // body: RigidBody; localCenter/localSize: the hull box in body space (metres); extraProbes: additional world points other
  // systems need sampled in the same pass (the boat's stern and hull centre for BoatController.Wetness).
  // The host supplies its physics body adapter and a probe factory for this water instance.
  constructor(body, localCenter, localSize, settings = {}, extraProbes = 0, probesFactory) {
    if (typeof probesFactory !== 'function') throw new TypeError('Buoyancy needs a surface probe factory');
    this.body = body; this.s = { ...BUOYANCY_DEFAULTS, ...settings };
    const n = THREE.MathUtils.clamp(Math.round(this.s.samplesPerAxis), MIN_SAMPLES_PER_AXIS, MAX_SAMPLES_PER_AXIS);
    this.localPoints = [];
    for (let ix = 0; ix < n; ix++) for (let iy = 0; iy < n; iy++) for (let iz = 0; iz < n; iz++)
      this.localPoints.push(new THREE.Vector3(localCenter.x + ((ix + 0.5) / n - 0.5) * localSize.x, localCenter.y + ((iy + 0.5) / n - 0.5) * localSize.y, localCenter.z + ((iz + 0.5) / n - 0.5) * localSize.z));
    this.localSize = localSize.clone(); this.samplesPerAxis = n;
    this.sphereRadius = Math.max(MIN_SPHERE_RADIUS, 0.5 * (localSize.y / n) * this.s.floatRadiusScale);
    this.probes = probesFactory(this.localPoints.length + extraProbes);
    this.extraOffset = this.localPoints.length;
    this.submergedFraction = 0;
  }
  // Live tuning: everything but the lattice count (that would need a new probe set).
  applySettings(settings) {
    this.s = { ...this.s, ...settings, samplesPerAxis: this.samplesPerAxis };
    this.sphereRadius = Math.max(MIN_SPHERE_RADIUS, 0.5 * (this.localSize.y / this.samplesPerAxis) * this.s.floatRadiusScale);
  }
  // Keep the probe points on the hull (call before issuing the sample pass).
  updateProbePoints() { for (let i = 0; i < this.localPoints.length; i++) this.body.localToWorldPoint(this.localPoints[i], this.probes.points[i]); }
  extraProbe(i) { return this.probes.points[this.extraOffset + i]; }
  extraSample(i) { return this.probes.samples[this.extraOffset + i]; }
  // Fixed step: WaterBuoyancy.Step(applyForces = true).
  step() {
    const s = this.s, body = this.body, gravity = s.gravity ?? GRAVITY, invCount = 1 / this.localPoints.length; let submergedSum = 0;
    for (let i = 0; i < this.localPoints.length; i++) {
      const sample = this.probes.samples[i]; if (!sample.valid) continue;
      const world = body.localToWorldPoint(this.localPoints[i], this.probes.points[i]);
      const depth = sample.height - world.y;
      const fraction = sphereSubmergedFraction(depth, this.sphereRadius); if (fraction <= 0) continue;
      submergedSum += fraction;
      this.applyPointForces(world, sample, gravity, fraction * invCount);
    }
    if (submergedSum <= 0) { this.submergedFraction = 0; return; }
    const averageFraction = submergedSum * invCount; this.submergedFraction = averageFraction;
    const glue = surfaceGlueAcceleration(gravity, s.buoyancy, averageFraction, s.surfaceGlueIntensity);
    if (glue !== 0) body.addForce(tmpLift.set(0, glue, 0));
    // ApplyBodyDamping
    body.addTorque(tmpDrag.copy(body.angularVelocity).multiplyScalar(-s.waterAngularDamping * averageFraction));
    body.addForce(tmpLift.set(0, -body.velocity.y * s.verticalSettleDamping * averageFraction, 0));
  }
  applyPointForces(world, sample, gravity, weight) {
    const s = this.s, body = this.body;
    tmpLift.set(0, gravity * s.buoyancy * weight, 0);
    if (s.maxBuoyancyForce > 0) tmpLift.clampLength(0, s.maxBuoyancyForce * weight);
    body.addForceAtPosition(tmpLift, world);
    body.addForceAtPosition(this.surfaceDrag(world, sample).multiplyScalar(-weight), world);
    const drift = s.surfaceRelativeDrag ? tmpDrift.copy(sample.velocity) : tmpDrift.set(sample.velocity.x, 0, sample.velocity.z);
    body.addForceAtPosition(drift.multiplyScalar(s.waveDriftStrength * weight), world);
  }
  surfaceDrag(world, sample) {
    const s = this.s, body = this.body, pointVelocity = body.getPointVelocity(world, tmpVel);
    if (!s.surfaceRelativeDrag) return tmpDrag.copy(pointVelocity).multiplyScalar(s.waterLinearDamping);
    const relative = pointVelocity.sub(sample.velocity), local = body.worldToLocalDirection(relative, tmpLocal);
    local.set(local.x * s.dragCoefficients[0], local.y * s.dragCoefficients[1], local.z * s.dragCoefficients[2]);
    return body.localToWorldDirection(local, tmpDrag).multiplyScalar(s.waterLinearDamping);
  }
  dispose() { this.probes.dispose(); }
}
