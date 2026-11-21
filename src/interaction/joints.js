// Joints: the moving parts of a prop. A drawer that slides out, a door or a lid that swings on its hinge, a dial that
// spins. A joint moves one Three object from the pose it had when the joint was made (its rest, the closed pose) by an
// amount along or about one of the object's own axes: metres for a slide, radians for a hinge or a spin. The amount
// eases toward its goal at a rate that does not depend on the frame rate (THREE.MathUtils.damp).
// A slide and a hinge go between closed (0) and open; a spin has no ends and may click from step to step (a dial).
// Several joints can share one object only if they move it the same way; give each moving part its own object.
import * as THREE from 'three';

export const JOINT_DEFAULTS = Object.freeze({
  speed: 8,          // 1 / s: how fast the amount closes on its goal (each second it covers 1 - e^-speed of the gap)
  settle: 1e-4,      // m or rad: nearer than this to its goal the joint stops and reports that it settled
});
export const JOINT_KINDS = Object.freeze(['slide', 'hinge', 'spin']);
const AXES = Object.freeze({x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1]});

function readAxis(axis) {
  const value = typeof axis === 'string' ? AXES[axis.replace('-', '')]?.map(v => (axis.startsWith('-') ? -v : v)) : axis;
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new TypeError('Joint axis must be x, y, z (or -x...) or [x, y, z]');
  const vector = new THREE.Vector3(...value);
  if (vector.lengthSq() === 0) throw new RangeError('Joint axis must not be zero');
  return vector.normalize();
}

// object: the moving part. kind: 'slide' | 'hinge' | 'spin'. axis: one of the object's own axes ('x', '-z'...) or
// [x, y, z] in its own frame. open: the amount when open (slide, hinge), any sign. step: for a spin, the amount of one
// click (0 = turns freely). speed, settle: JOINT_DEFAULTS. onSettle(joint): when it comes to rest at its goal.
// onStep(index, joint): when a spin passes onto a new step (index: steps from rest, any whole number).
// Returns {kind, object, value, goal, isOpen, moving, open(), close(), toggle(), set(amount), turn(by), step,
// update(seconds), reset(), dispose()}.
export function createJoint({object, kind, axis, open = 0, step = 0, speed = JOINT_DEFAULTS.speed, settle = JOINT_DEFAULTS.settle, onSettle, onStep} = {}) {
  if (!object?.isObject3D) throw new TypeError('A joint moves a Three Object3D');
  if (!JOINT_KINDS.includes(kind)) throw new TypeError('Joint kind must be one of ' + JOINT_KINDS.join(', '));
  if (!Number.isFinite(open) || (kind !== 'spin' && open === 0)) throw new RangeError('A slide or hinge needs a non-zero open amount');
  if (!Number.isFinite(step) || step < 0) throw new RangeError('Joint step must be 0 or more');
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('Joint speed must be above 0');
  if (!Number.isFinite(settle) || settle <= 0) throw new RangeError('Joint settle must be above 0');
  const direction = readAxis(axis);
  const restPosition = object.position.clone(), restQuaternion = object.quaternion.clone();
  const along = direction.clone().applyQuaternion(restQuaternion);   // a slide moves in the parent's frame
  const turn = new THREE.Quaternion();
  const [low, high] = kind === 'spin' ? [-Infinity, Infinity] : [Math.min(0, open), Math.max(0, open)];
  let value = 0, goal = 0, moving = false, lastStep = 0;

  function pose() {
    if (kind === 'slide') object.position.copy(restPosition).addScaledVector(along, value);
    else object.quaternion.copy(restQuaternion).multiply(turn.setFromAxisAngle(direction, value));
  }
  const clamp = amount => Math.min(high, Math.max(low, amount));
  const snap = amount => (step > 0 ? Math.round(amount / step) * step : amount);
  function aim(amount) {
    if (!Number.isFinite(amount)) throw new RangeError('Joint amount must be a number');
    goal = clamp(snap(amount));
    moving = goal !== value;
    return joint;
  }

  const joint = {
    kind, object,
    get value() { return value; },
    get goal() { return goal; },
    get moving() { return moving; },
    // Open or on its way there (slide, hinge).
    get isOpen() { return kind !== 'spin' && goal === open; },
    // The step a spin stands on (whole steps from rest; 0 without steps).
    get step() { return step > 0 ? Math.round(value / step) : 0; },
    open: () => aim(kind === 'spin' ? goal : open),
    close: () => aim(0),
    toggle: () => aim(kind !== 'spin' && goal !== open ? open : 0),
    // Sends the joint toward an amount (clamped to its ends, snapped to its steps).
    set: aim,
    // Adds to the goal, e.g. a drag on a dial; snapped to the steps.
    turn: by => aim(goal + by),
    update(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid joint duration');
      if (!moving) return joint;
      value = THREE.MathUtils.damp(value, goal, speed, seconds);
      if (Math.abs(goal - value) < settle) { value = goal; moving = false; }
      pose();
      if (step > 0) {
        const now = Math.round(value / step);
        if (now !== lastStep) { lastStep = now; onStep?.(now, joint); }
      }
      if (!moving) onSettle?.(joint);
      return joint;
    },
    // Straight back to rest, without easing or callbacks.
    reset() { value = goal = lastStep = 0; moving = false; pose(); return joint; },
    // Leaves the object at rest.
    dispose() { joint.reset(); },
  };
  return joint;
}

// Puts a pivot under an object's parent at `point` (in that parent's frame) and hangs the object from it, unmoved: a
// hinge joint made on the pivot then swings the object about that point, e.g. a door about its hinge edge. The pivot
// takes the object's rotation, so its axes are the object's own. Returns the pivot (a THREE.Group).
export function pivotAt(object, point) {
  if (!object?.isObject3D || !object.parent) throw new TypeError('pivotAt needs an Object3D that has a parent');
  if (!point?.isVector3) throw new TypeError('pivotAt needs the pivot point as a Vector3');
  const parent = object.parent, pivot = new THREE.Group();
  pivot.name = object.name ? object.name + 'Pivot' : 'pivot';
  pivot.position.copy(point);
  pivot.quaternion.copy(object.quaternion);
  parent.add(pivot);
  pivot.updateMatrixWorld(true);
  pivot.attach(object);   // keeps the object where it stands, now in the pivot's frame
  return pivot;
}
