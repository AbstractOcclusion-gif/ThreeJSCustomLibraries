// Wheeled vehicle on Jolt's VehicleConstraint: suspension, tyres, engine, gearbox and differentials come from Jolt; this
// sets up a four-wheeled layout, turns throttle / steer / handbrake into driver input and reads the wheels back for
// drawing. No model, camera or input device. The host owns the chassis body (any Jolt rigid body whose local +Z is
// forward and +Y is up) and steps the physics system; call update(input) before each step.
export const VEHICLE_DEFAULTS = Object.freeze({
  halfTrack: .9,          // m, wheel centre to the chassis centreline
  frontAxle: 1.3,         // m, front axle ahead of the chassis centre
  rearAxle: -1.3,         // m, rear axle (negative = behind the centre)
  suspensionMount: -.1,   // m, height of the suspension mounts relative to the chassis centre
  suspensionMin: .2,      // m, suspension length fully compressed
  suspensionMax: .5,      // m, suspension length fully extended
  suspensionFrequency: 1.5, // Hz, spring stiffness (higher = stiffer)
  suspensionDamping: .5,  // 0..1, how fast the body stops bouncing
  wheelRadius: .4,        // m
  wheelWidth: .3,         // m
  maxSteerDegrees: 32,    // front wheels at full lock
  steerFadeSpeed: 12,     // m/s at which full steer input gives half lock: keeps it from spinning out at speed; 0 = off
  engineTorque: 500,      // N m at the crank
  brakeTorque: 2500,      // N m per wheel
  handBrakeTorque: 5000,  // N m on each rear wheel
  antiRollStiffness: 2000, // N/m, resists body roll in turns; 0 = no anti-roll bars
  maxRollDegrees: 55,     // the body is not allowed to pitch or roll further: keeps it on its wheels
  fourWheelDrive: 1,      // 1 = all four wheels driven, 0 = rear wheels only
});
// m/s. Rolling faster than this against the requested direction means brake first, then change direction.
const DIRECTION_CHANGE_SPEED = .5;
// Share of the wheel width rounded off in the ground sweep, so a tyre rolls over small edges instead of catching them.
const TYRE_ROUNDING = .05;
const WHEELS = Object.freeze(['frontLeft', 'frontRight', 'rearLeft', 'rearRight']);

export function createVehicle({J, jolt, body, layer, ...options} = {}) {
  if (!J || !jolt || !body || !Number.isInteger(layer)) throw Error('Vehicle needs J (the Jolt module), jolt (its JoltInterface), body (the chassis Jolt body) and the object layer its wheels collide as');
  const unknown = Object.keys(options).filter(key => !(key in VEHICLE_DEFAULTS));
  if (unknown.length) throw Error('Unknown vehicle option: ' + unknown.join(', '));
  const o = {...VEHICLE_DEFAULTS, ...options};
  for (const [key, value] of Object.entries(o)) if (!Number.isFinite(value)) throw Error(`Vehicle ${key} must be finite`);
  if (!(o.suspensionMax > o.suspensionMin && o.suspensionMin > 0 && o.wheelRadius > 0 && o.wheelWidth > 0 && o.frontAxle > o.rearAxle)) throw Error('Vehicle suspension, wheel or axle sizes are inconsistent');

  const system = jolt.GetPhysicsSystem(), bodies = system.GetBodyInterface(), vector = new J.Vec3(0, 0, 0);
  const place = new J.RVec3(0, 0, 0), facing = new J.Quat(0, 0, 0, 1);
  const settings = new J.VehicleConstraintSettings();
  settings.mMaxPitchRollAngle = o.maxRollDegrees * Math.PI / 180;
  settings.mWheels.clear();
  // +X is the vehicle's left when it faces +Z with +Y up.
  for (const [x, z, steers] of [[o.halfTrack, o.frontAxle, true], [-o.halfTrack, o.frontAxle, true], [o.halfTrack, o.rearAxle, false], [-o.halfTrack, o.rearAxle, false]]) {
    const wheel = new J.WheelSettingsWV();
    vector.Set(x, o.suspensionMount, z);
    wheel.mPosition = vector;
    wheel.mRadius = o.wheelRadius;
    wheel.mWidth = o.wheelWidth;
    wheel.mSuspensionMinLength = o.suspensionMin;
    wheel.mSuspensionMaxLength = o.suspensionMax;
    wheel.mSuspensionSpring.mFrequency = o.suspensionFrequency;
    wheel.mSuspensionSpring.mDamping = o.suspensionDamping;
    wheel.mMaxSteerAngle = steers ? o.maxSteerDegrees * Math.PI / 180 : 0;
    wheel.mMaxBrakeTorque = o.brakeTorque;
    wheel.mMaxHandBrakeTorque = steers ? 0 : o.handBrakeTorque;
    settings.mWheels.push_back(wheel);
  }
  const control = new J.WheeledVehicleControllerSettings();
  control.mEngine.mMaxTorque = o.engineTorque;
  control.mDifferentials.clear();
  const axles = o.fourWheelDrive ? [[0, 1], [2, 3]] : [[2, 3]];
  for (const [left, right] of axles) {
    const differential = new J.VehicleDifferentialSettings();
    differential.mLeftWheel = left;
    differential.mRightWheel = right;
    differential.mEngineTorqueRatio = 1 / axles.length;
    control.mDifferentials.push_back(differential);
    J.destroy(differential);
  }
  settings.mController = control;
  settings.mAntiRollBars.clear();
  if (o.antiRollStiffness > 0) for (const [left, right] of [[0, 1], [2, 3]]) {
    const bar = new J.VehicleAntiRollBar();
    bar.mLeftWheel = left;
    bar.mRightWheel = right;
    bar.mStiffness = o.antiRollStiffness;
    settings.mAntiRollBars.push_back(bar);
    J.destroy(bar);
  }

  const constraint = new J.VehicleConstraint(body, settings);
  J.destroy(settings);
  constraint.SetVehicleCollisionTester(new J.VehicleCollisionTesterCastCylinder(layer, TYRE_ROUNDING));
  system.AddConstraint(constraint);
  const listener = new J.VehicleConstraintStepListener(constraint);
  system.AddStepListener(listener);
  const controller = J.castObject(constraint.GetController(), J.WheeledVehicleController);
  // Wheel poses are given for a wheel model whose axle is its local X and whose up is its local Y.
  const axle = new J.Vec3(1, 0, 0), up = new J.Vec3(0, 1, 0);
  let disposed = false;

  const state = {
    speed: 0,   // m/s along the chassis, negative in reverse
    wheels: WHEELS.map(name => ({name, position: {x: 0, y: 0, z: 0}, quaternion: {x: 0, y: 0, z: 0, w: 1}, grounded: false})),
    // throttle: -1 (reverse) .. 1 (forward). steer: -1 (left) .. 1 (right). handBrake: locks the rear wheels.
    update({throttle = 0, steer = 0, handBrake = false} = {}) {
      if (disposed) throw Error('Vehicle was disposed');
      const velocity = body.GetLinearVelocity(), vx = velocity.GetX(), vy = velocity.GetY(), vz = velocity.GetZ();
      const q = body.GetRotation(), qx = q.GetX(), qy = q.GetY(), qz = q.GetZ(), qw = q.GetW();
      // Chassis forward (+Z turned by its rotation) dotted with its velocity.
      state.speed = vx * 2 * (qx * qz + qw * qy) + vy * 2 * (qy * qz - qw * qx) + vz * (1 - 2 * (qx * qx + qy * qy));
      const against = throttle * state.speed < 0 && Math.abs(state.speed) > DIRECTION_CHANGE_SPEED;
      const lock = o.steerFadeSpeed > 0 ? o.steerFadeSpeed / (o.steerFadeSpeed + Math.abs(state.speed)) : 1;
      controller.SetDriverInput(against ? 0 : throttle, steer * lock, against ? 1 : 0, handBrake ? 1 : 0);
      if (throttle || steer || handBrake) bodies.ActivateBody(body.GetID());
      return state;
    },
    // Call after the physics step: fills `wheels` with world poses for drawing.
    readWheels() {
      state.wheels.forEach((wheel, i) => {
        const pose = constraint.GetWheelWorldTransform(i, axle, up), at = pose.GetTranslation();
        wheel.position.x = at.GetX(); wheel.position.y = at.GetY(); wheel.position.z = at.GetZ();
        const turn = pose.GetQuaternion();
        wheel.quaternion.x = turn.GetX(); wheel.quaternion.y = turn.GetY(); wheel.quaternion.z = turn.GetZ(); wheel.quaternion.w = turn.GetW();
        wheel.grounded = constraint.GetWheel(i).HasContact();
      });
      return state.wheels;
    },
    // Puts the chassis at a point, level, facing `heading` (rad about Y, 0 = +Z, positive toward +X), at rest.
    teleport(x, y, z, heading = 0) {
      place.Set(x, y, z);
      facing.Set(0, Math.sin(heading / 2), 0, Math.cos(heading / 2));
      bodies.SetPositionAndRotation(body.GetID(), place, facing, J.EActivation_Activate);
      vector.Set(0, 0, 0);
      bodies.SetLinearAndAngularVelocity(body.GetID(), vector, vector);
      state.speed = 0;
    },
    // Must run before the host removes the chassis body.
    dispose() {
      if (disposed) return;
      disposed = true;
      system.RemoveStepListener(listener);
      system.RemoveConstraint(constraint);
      for (const object of [listener, vector, place, facing, axle, up]) J.destroy(object);
    },
  };
  return state;
}
