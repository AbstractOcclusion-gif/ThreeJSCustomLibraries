// Kinematic character controller on Jolt's CharacterVirtual. Jolt does the collision work (stairs, slope limit, floor
// snapping, pushing bodies); this adds the movement feel: acceleration, air control, coyote time, jump buffer and
// variable jump height. No model, camera or input device: the host passes a world-space move direction every fixed
// step and reads `position` (the feet) back. Gravity is the physics system's, along world Y.
import {assertFrameTime} from '../core/validate.js';

export const CHARACTER_DEFAULTS = Object.freeze({
  radius: .3,           // m, capsule radius
  height: 1.75,         // m, feet to top of the head
  mass: 65,             // kg, weight on the bodies it stands on
  maxStrength: 100,     // N, how hard it pushes dynamic bodies
  walkSpeed: 2.1,       // m/s
  runSpeed: 5,          // m/s
  acceleration: 18,     // m/s2 on the ground
  airControl: .3,       // share of the ground acceleration and turning left while airborne; 0 = no steering in the air
  jumpSpeed: 4.5,       // m/s at take-off
  jumpCut: .45,         // share of the rising speed kept when jump is released early
  coyoteTime: .12,      // s after walking off a ledge during which a jump still starts
  jumpBuffer: .12,      // s a jump press is remembered before landing
  stepHeight: .35,      // m, tallest stair climbed without jumping
  stickDown: .4,        // m, how far it is pulled down to stay on a descending floor
  maxSlopeDegrees: 45,  // steeper ground is slid down, not walked
  turnSpeed: 10,        // rad/s, how fast it turns to face the way it moves
});
// m. Gap Jolt keeps between the capsule and the world so it never starts a step in contact.
const PADDING = .02;
// m. How far ahead Jolt looks for contacts, so the capsule slows before a wall instead of tunnelling at speed.
const PREDICTIVE_CONTACT = .1;
// m/s. Rising faster than this relative to the ground means the character has left it (a jump, a launch).
const LEAVING_GROUND_SPEED = .1;

const TURN = Math.PI * 2;

export function createCharacterController({J, jolt, layer, position = [0, 0, 0], heading = 0, ...options} = {}) {
  if (!J || !jolt || !Number.isInteger(layer)) throw Error('Character controller needs J (the Jolt module), jolt (its JoltInterface) and the object layer it collides as');
  const unknown = Object.keys(options).filter(key => !(key in CHARACTER_DEFAULTS));
  if (unknown.length) throw Error('Unknown character option: ' + unknown.join(', '));
  const o = {...CHARACTER_DEFAULTS, ...options};
  for (const [key, value] of Object.entries(o)) if (!Number.isFinite(value) || value < 0) throw Error(`Character ${key} must be finite and non-negative`);
  if (o.height <= o.radius * 2) throw Error('Character height must exceed twice its radius');

  const system = jolt.GetPhysicsSystem(), allocator = jolt.GetTempAllocator();
  const vector = new J.Vec3(0, 0, 0), gravity = new J.Vec3(0, 0, 0), place = new J.RVec3(0, 0, 0), upright = new J.Quat(0, 0, 0, 1);

  // Capsule lifted by half its height, so the character's position is its feet.
  vector.Set(0, o.height / 2, 0);
  const shapeSettings = new J.RotatedTranslatedShapeSettings(vector, upright, new J.CapsuleShapeSettings(o.height / 2 - o.radius, o.radius));
  const built = shapeSettings.Create();
  if (built.HasError()) throw Error('Invalid character capsule');
  const shape = built.Get();
  shape.AddRef();
  J.destroy(shapeSettings);

  const settings = new J.CharacterVirtualSettings();
  settings.mMass = o.mass;
  settings.mMaxStrength = o.maxStrength;
  settings.mMaxSlopeAngle = o.maxSlopeDegrees * Math.PI / 180;
  settings.mShape = shape;
  settings.mBackFaceMode = J.EBackFaceMode_CollideWithBackFaces;
  settings.mCharacterPadding = PADDING;
  settings.mPredictiveContactDistance = PREDICTIVE_CONTACT;
  // Only contacts on the lower hemisphere of the capsule count as ground.
  vector.Set(0, 1, 0);
  const supporting = new J.Plane(vector, -o.radius);
  settings.mSupportingVolume = supporting;
  place.Set(position[0], position[1], position[2]);
  const character = new J.CharacterVirtual(settings, place, upright, system);
  J.destroy(supporting);
  J.destroy(settings);

  const stepping = new J.ExtendedUpdateSettings();
  vector.Set(0, -o.stickDown, 0);
  stepping.mStickToFloorStepDown = vector;
  vector.Set(0, o.stepHeight, 0);
  stepping.mWalkStairsStepUp = vector;
  const broadFilter = new J.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), layer);
  const layerFilter = new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), layer);
  const bodyFilter = new J.BodyFilter(), shapeFilter = new J.ShapeFilter();

  let coyote = 0, buffer = 0, jumpHeld = false, rising = false, disposed = false;
  const state = {
    position: {x: position[0], y: position[1], z: position[2]},   // feet, world space
    velocity: {x: 0, y: 0, z: 0},
    grounded: false,
    heading,         // rad about Y the character faces (0 = +Z, positive toward +X); turns toward the move direction
    jumped: false,   // true for the step a jump started
    speed: 0,        // m/s really covered over the ground, for animation
    // move: world-space direction on X/Z, length 0..1. run: use runSpeed. jump: whether the jump control is held.
    update(dt, {moveX = 0, moveZ = 0, run = false, jump = false} = {}) {
      assertFrameTime(dt, 'Character');
      if (disposed) throw Error('Character controller was disposed');
      if (jump && !jumpHeld) buffer = o.jumpBuffer;
      jumpHeld = jump;

      character.UpdateGroundVelocity();
      // Value-returned wrappers may alias across calls: read each one before the next call.
      const current = character.GetLinearVelocity(), vx = current.GetX(), vy = current.GetY(), vz = current.GetZ();
      const ground = character.GetGroundVelocity(), gx = ground.GetX(), gy = ground.GetY(), gz = ground.GetZ();
      const standing = character.GetGroundState() === J.EGroundState_OnGround && vy - gy < LEAVING_GROUND_SPEED;
      coyote = standing ? o.coyoteTime : Math.max(0, coyote - dt);

      let vertical = standing ? gy : vy;
      state.jumped = buffer > 0 && coyote > 0;
      if (state.jumped) {
        vertical = (standing ? gy : 0) + o.jumpSpeed;
        buffer = coyote = 0;
        rising = true;
      } else buffer = Math.max(0, buffer - dt);
      if (rising && vertical <= 0) rising = false;
      if (rising && !jump) { vertical *= o.jumpCut; rising = false; }
      vertical += system.GetGravity().GetY() * dt;

      if (moveX || moveZ) {
        // Shortest way round, at most turnSpeed; in the air only as far as it can still steer.
        const turn = ((Math.atan2(moveX, moveZ) - state.heading) % TURN + TURN * 1.5) % TURN - Math.PI, most = o.turnSpeed * (standing ? 1 : o.airControl) * dt;
        state.heading += Math.max(-most, Math.min(most, turn));
      }
      const length = Math.hypot(moveX, moveZ), scale = (run ? o.runSpeed : o.walkSpeed) / Math.max(1, length);
      const wantedX = moveX * scale + (standing ? gx : 0), wantedZ = moveZ * scale + (standing ? gz : 0);
      const changeX = wantedX - vx, changeZ = wantedZ - vz, change = Math.hypot(changeX, changeZ);
      const limit = o.acceleration * (standing ? 1 : o.airControl) * dt, share = change > limit ? limit / change : 1;
      vector.Set(vx + changeX * share, vertical, vz + changeZ * share);
      character.SetLinearVelocity(vector);
      gravity.Set(0, system.GetGravity().GetY(), 0);
      character.ExtendedUpdate(dt, gravity, stepping, broadFilter, layerFilter, bodyFilter, shapeFilter, allocator);

      const at = character.GetPosition(), x = at.GetX(), y = at.GetY(), z = at.GetZ();
      // Distance really covered: zero against a wall, whatever velocity was asked for.
      state.speed = dt > 0 ? Math.hypot(x - state.position.x - (standing ? gx : 0) * dt, z - state.position.z - (standing ? gz : 0) * dt) / dt : state.speed;
      state.position.x = x; state.position.y = y; state.position.z = z;
      const after = character.GetLinearVelocity();
      state.velocity.x = after.GetX(); state.velocity.y = after.GetY(); state.velocity.z = after.GetZ();
      state.grounded = character.GetGroundState() === J.EGroundState_OnGround;
      return state;
    },
    teleport(x, y, z, facing = state.heading) {
      state.heading = facing;
      place.Set(x, y, z);
      character.SetPosition(place);
      vector.Set(0, 0, 0);
      character.SetLinearVelocity(vector);
      state.position.x = x; state.position.y = y; state.position.z = z;
      state.velocity.x = state.velocity.y = state.velocity.z = state.speed = 0;
      state.grounded = state.jumped = jumpHeld = rising = false;
      coyote = buffer = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      J.destroy(character);
      shape.Release();
      for (const object of [stepping, broadFilter, layerFilter, bodyFilter, shapeFilter, vector, gravity, place, upright]) J.destroy(object);
    },
  };
  return state;
}
