// ocean/rigid-body.js -- the minimal rigid body the Unity ports need: Rigidbody's AddForceAtPosition / AddTorque in
// ForceMode.Acceleration, GetPointVelocity, world centre of mass, linear and angular velocity, and the integration step.
// Mass only enters the torque (r x m a); the inertia is a solid box about the centre of mass (Unity's default for a box).
import * as THREE from 'three';

export const GRAVITY = 9.81;
const tmpR = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpLever = new THREE.Vector3(), tmpTorque = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpInv = new THREE.Quaternion();

export class RigidBody {
  // boxSize: full extents (m) of the inertia box, centreOfMassLocal: offset from the object origin (m)
  constructor({ mass = 1, boxSize = new THREE.Vector3(1, 1, 1), centerOfMassLocal = new THREE.Vector3(), linearDamping = 0, angularDamping = 0.05 } = {}) {
    this.mass = mass; this.position = new THREE.Vector3(); this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3(); this.angularVelocity = new THREE.Vector3();   // world space, rad/s
    this.centerOfMassLocal = centerOfMassLocal.clone(); this.linearDamping = linearDamping; this.angularDamping = angularDamping;
    this.useGravity = true;
    const { x, y, z } = boxSize; this.inertiaLocal = new THREE.Vector3(mass / 12 * (y * y + z * z), mass / 12 * (x * x + z * z), mass / 12 * (x * x + y * y));
    this.accel = new THREE.Vector3(); this.angularAccel = new THREE.Vector3();   // accumulated this step
  }
  get worldCenterOfMass() { return tmpR.copy(this.centerOfMassLocal).applyQuaternion(this.quaternion).add(this.position); }
  // ForceMode.Acceleration at a world point: linear acceleration `a` plus the torque r x (m a) -> angular acceleration.
  addForceAtPosition(a, worldPoint) {
    this.accel.add(a);
    tmpLever.copy(worldPoint).sub(this.worldCenterOfMass);
    this.addTorqueWorld(tmpTorque.crossVectors(tmpLever, tmpF.copy(a).multiplyScalar(this.mass)));
  }
  addForce(a) { this.accel.add(a); }
  // ForceMode.Acceleration torque = angular acceleration directly (world space).
  addTorque(angularAccel) { this.angularAccel.add(angularAccel); }
  addTorqueWorld(torque) {   // world torque -> angular acceleration through the body-space diagonal inertia
    tmpInv.copy(this.quaternion).invert();
    const local = tmpF.copy(torque).applyQuaternion(tmpInv);
    local.set(local.x / this.inertiaLocal.x, local.y / this.inertiaLocal.y, local.z / this.inertiaLocal.z);
    this.angularAccel.add(local.applyQuaternion(this.quaternion));
  }
  getPointVelocity(worldPoint, out = new THREE.Vector3()) {
    const r = out.copy(worldPoint).sub(this.worldCenterOfMass);
    return out.crossVectors(this.angularVelocity, r).add(this.velocity);
  }
  localToWorldDirection(v, out = new THREE.Vector3()) { return out.copy(v).applyQuaternion(this.quaternion); }
  worldToLocalDirection(v, out = new THREE.Vector3()) { return out.copy(v).applyQuaternion(tmpInv.copy(this.quaternion).invert()); }
  localToWorldPoint(p, out = new THREE.Vector3()) { return out.copy(p).applyQuaternion(this.quaternion).add(this.position); }
  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.quaternion); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quaternion); }
  integrate(dt) {
    if (this.useGravity) this.accel.y -= GRAVITY;
    this.velocity.addScaledVector(this.accel, dt).multiplyScalar(Math.max(0, 1 - this.linearDamping * dt));
    this.angularVelocity.addScaledVector(this.angularAccel, dt).multiplyScalar(Math.max(0, 1 - this.angularDamping * dt));
    this.position.addScaledVector(this.velocity, dt);
    const w = this.angularVelocity, len = w.length();
    if (len > 1e-9) { tmpQ.setFromAxisAngle(tmpF.copy(w).multiplyScalar(1 / len), len * dt); this.quaternion.premultiply(tmpQ).normalize(); }
    this.accel.set(0, 0, 0); this.angularAccel.set(0, 0, 0);
  }
  applyTo(object3d) { object3d.position.copy(this.position); object3d.quaternion.copy(this.quaternion); }
}
