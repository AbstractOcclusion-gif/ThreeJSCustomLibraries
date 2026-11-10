// ocean/sphere-interactor.js -- port of WebGpuWater's WaterSphereInteractor.cs: a sphere on a moving object injects a velocity
// dipole into the sim window every frame from its world step (teleport guard, speed ramp below wakeFadeSpeed), weighted by
// its submersion (WaterVolume.SphereSubmersionWeight: Gaussian below the surface, sqrt ramp above it).
import * as THREE from 'three';

const MIN_STEP_DISTANCE = 1e-4, AUTO_RADIUS_FLOOR = 0.05, HORIZONTAL_EXTENT_MEAN_WEIGHT = 0.5;
// Defaults from the package's "MotorBoat Ready" prefab, not the component defaults: a SMALL sphere (0.1 m) at the bow, gain 0.2,
// vertical cap 0.5, full wake only at 20 m/s. The solver is linear, so Unity's pool-unit normalisation (extent.y) cancels out and
// these values carry over to the metre-unit field unchanged; an auto hull-sized sphere stamps ~300x the area and floods the window.
// verticalForceCap is metres per step here (the prefab's 0.5 pool units = 50 m, inert): 0.01 keeps a slam from throwing a symmetric wave.
export const INTERACTOR_DEFAULTS = Object.freeze({ radius: 0.1, strength: 0.2, verticalForceCap: 0.01, maxStepDistance: 5, wakeFadeSpeed: 20, wakeSpeedCap: 0 });

export function sphereSubmersionWeight(surfaceY, centerY, radius) {
  const r = Math.max(radius, 1e-3), below = surfaceY - centerY;   // > 0 submerged
  if (below >= 0) { const t = 0.5 * below / r; return Math.exp(-t * t); }
  return Math.sqrt(THREE.MathUtils.clamp(1 + below / r, 0, 1));
}
export const autoRadius = halfExtents => Math.max(AUTO_RADIUS_FLOOR, HORIZONTAL_EXTENT_MEAN_WEIGHT * (halfExtents.x + halfExtents.z));

const tmpCenter = new THREE.Vector3(), tmpStep = new THREE.Vector3();
export class SphereInteractor {
  // object: the Object3D the sphere rides (centerOffset in its local frame); hullHalfExtents sizes the auto radius.
  constructor(object, centerOffset, hullHalfExtents, settings = {}) {
    this.object = object; this.centerOffset = centerOffset.clone(); this.s = { ...INTERACTOR_DEFAULTS, ...settings };
    this.radiusAuto = autoRadius(hullHalfExtents); this.prev = new THREE.Vector3(); this.primed = false;
  }
  get effectiveRadius() { return this.s.radius > 0 ? this.s.radius : this.radiusAuto; }
  // LateUpdate: measure this frame's step and queue the stamp. surfaceY: water height under the sphere centre (from the sampler).
  update(window, dt, surfaceY) {
    const center = this.object.localToWorld(tmpCenter.copy(this.centerOffset));
    if (!this.primed) { this.prev.copy(center); this.primed = true; return; }
    const step = tmpStep.copy(center).sub(this.prev); this.prev.copy(center);
    const stepSqr = step.lengthSq(), maxSqr = this.s.maxStepDistance * this.s.maxStepDistance;
    if (stepSqr < MIN_STEP_DISTANCE * MIN_STEP_DISTANCE || stepSqr > maxSqr) return;   // still / teleport guard
    const speed = dt > 1e-5 ? Math.sqrt(stepSqr) / dt : 0;
    const speedRamp = this.s.wakeFadeSpeed > 1e-5 ? THREE.MathUtils.smoothstep(speed, 0, this.s.wakeFadeSpeed) : 1;
    if (speedRamp <= 0) return;
    const radius = this.effectiveRadius, weight = surfaceY === undefined ? 0 : sphereSubmersionWeight(surfaceY, center.y, radius);
    // Bound only injected travel; tracking, position, submersion and gameplay speed stay actual.
    const travelScale = this.s.wakeSpeedCap > 0 && speed > this.s.wakeSpeedCap ? this.s.wakeSpeedCap / speed : 1;
    window.addSphere(center.x, center.y, center.z, step.x * travelScale, step.y * travelScale, step.z * travelScale, radius, weight, this.s.strength * speedRamp, this.s.verticalForceCap, dt);
  }
}
