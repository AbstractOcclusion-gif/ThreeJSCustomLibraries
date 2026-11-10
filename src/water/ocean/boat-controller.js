// ocean/boat-controller.js -- port of WebGpuWater's BoatController.cs: a single-rigid-body drive model supplying only what buoyancy
// can't -- thrust at the stern (fading as a wave lifts the propeller clear), rudder authority with speed, quadratic keel / lateral
// drag that sets the top speed and carves turns, yaw damping -- plus the keyboard / touch-stick input of BoatTouchDriver.
// Wetness reads the two extra probes the Buoyancy sampler carries (stern, hull centre) instead of Unity's analytic waterline query.
import * as THREE from 'three';

const MIN_DIVISOR = 0.01;
// Unity is left-handed (right = +X beside forward +Z); three is right-handed (right = -X), so a positive yaw about +up turns
// LEFT here. The steer torque is negated to keep "steer > 0 = turn right" as in BoatController.cs.
const YAW_HANDEDNESS = -1;
// Unity defaults (BoatController.cs serialized fields). sternOffset is for the ~5 m demo boat; Boat scales it to the hull length.
export const BOAT_DEFAULTS = Object.freeze({ enginePower: 9, reverseCoefficient: 0.35, turnAcceleration: 2.5, fullAuthoritySpeed: 3, reverseSteerWhenBackward: true,
  forwardDrag: 0.06, lateralDrag: 0.8, yawDamping: 3, propellerDepth: 0.5, hullDepth: 0.6, throttleResponse: 2, steerResponse: 3 });

const tmpF = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3(), tmpU = new THREE.Vector3();
const moveTowards = (a, b, maxDelta) => Math.abs(b - a) <= maxDelta ? b : a + Math.sign(b - a) * maxDelta;

export class BoatController {
  // body: RigidBody; sternOffset: local point the propeller pushes from; wetnessAt(i): sample of extra probe 0 (stern) / 1 (hull)
  constructor(body, sternOffset, settings = {}) {
    this.body = body; this.sternOffset = sternOffset.clone(); this.s = { ...BOAT_DEFAULTS, ...settings };
    this.rawThrottle = 0; this.rawSteer = 0; this.throttle = 0; this.steer = 0; this.inputEnabled = true;
    this.keys = new Set(); this.stick = new THREE.Vector2();
    this.onKey = e => { if (e.repeat) return; const k = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
      if (e.type === 'keyup') this.keys.delete(k);
      else if (!e.target.closest?.('input, select, textarea, [contenteditable]')) this.keys.add(k); };
    this.onBlur = () => this.keys.clear();
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey);
    addEventListener('blur', this.onBlur);

  }
  // Update(): poll input into the raw axes.
  readInput() {
    if (!this.inputEnabled) { this.rawThrottle = this.rawSteer = 0; return; }
    const k = this.keys, fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0), right = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    this.rawThrottle = THREE.MathUtils.clamp(fwd + this.stick.y, -1, 1); this.rawSteer = THREE.MathUtils.clamp(right + this.stick.x, -1, 1);
  }
  sternWorld(out = tmpF) { return this.body.localToWorldPoint(this.sternOffset, out); }
  // FixedUpdate(dt). sternSample / hullSample: the sampler's (height, valid) at the stern and the hull centre.
  step(dt, sternSample, hullSample) {
    const s = this.s, body = this.body;
    this.throttle = moveTowards(this.throttle, this.rawThrottle, s.throttleResponse * dt);
    this.steer = moveTowards(this.steer, this.rawSteer, s.steerResponse * dt);
    const stern = this.sternWorld();
    const sternWetness = wetness(stern.y, sternSample, s.propellerDepth);
    if (sternWetness > 0) { const reverse = this.throttle >= 0 ? 1 : s.reverseCoefficient;
      body.addForceAtPosition(body.forward(tmpV).multiplyScalar(this.throttle * s.enginePower * reverse * sternWetness), stern); }
    const hullWetness = wetness(body.worldCenterOfMass.y, hullSample, s.hullDepth);
    if (hullWetness <= 0) return;                        // fully airborne (jumped a wave): no steering or water drag
    const forward = body.forward(tmpV), up = body.up(tmpU), forwardSpeed = body.velocity.dot(forward);
    // ApplySteering
    const authority = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / Math.max(s.fullAuthoritySpeed, MIN_DIVISOR), 0, 1);
    const direction = s.reverseSteerWhenBackward && forwardSpeed < 0 ? -1 : 1;
    body.addTorque(tmpL.copy(up).multiplyScalar(YAW_HANDEDNESS * this.steer * s.turnAcceleration * authority * direction));
    // ApplyHydrodynamicResistance
    const lv = body.worldToLocalDirection(body.velocity, tmpL);
    lv.set(-lv.x * Math.abs(lv.x) * s.lateralDrag, 0, -lv.z * Math.abs(lv.z) * s.forwardDrag);
    body.addForce(body.localToWorldDirection(lv, tmpF).multiplyScalar(hullWetness));
    const yawRate = body.angularVelocity.dot(up);
    body.addTorque(tmpL.copy(up).multiplyScalar(-yawRate * s.yawDamping * hullWetness));
  }
  dispose() { removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey); removeEventListener('blur', this.onBlur); }
}
// 1 while the point is submerged, easing to 0 as it rises depthScale metres clear of the surface (BoatController.Wetness).
function wetness(pointY, sample, depthScale) {
  if (!sample || !sample.valid) return 0;
  return THREE.MathUtils.clamp(1 - (pointY - sample.height) / Math.max(depthScale, MIN_DIVISOR), 0, 1);
}
