import {Quaternion, Vector3} from 'three';

const EPSILON = .001;

// Bends a two-bone limb (thigh and shin, upper arm and forearm) so its end joint reaches a goal. The middle joint keeps
// the side it bends to in the clip, carried round with the limb as it swings to the goal: read off the goal's own line
// instead, it flips when the goal sits far from where the clip had the end. A goal farther than the clip had the end
// stretches the limb toward straight without ever reaching it, because a limb that locks straight snaps its middle
// joint the moment the goal comes back in range. The end joint's own rotation is left to the caller.
export function createTwoBoneSolver() {
 const root = new Vector3(), middle = new Vector3(), end = new Vector3(), target = new Vector3();
 const direction = new Vector3(), bend = new Vector3(), wantedMiddle = new Vector3(), line = new Vector3();
 const before = new Vector3(), after = new Vector3(), delta = new Quaternion(), parent = new Quaternion(), parentInverse = new Quaternion(), swing = new Quaternion();
 function aim(bone, from, current, wanted) {
  before.subVectors(current, from).normalize();
  after.subVectors(wanted, from).normalize();
  bone.parent.getWorldQuaternion(parent);
  bone.quaternion.premultiply(delta.setFromUnitVectors(before, after).premultiply(parentInverse.copy(parent).invert()).multiply(parent));
  bone.updateWorldMatrix(false, true);
 }
 // upper, lower: the two bones; tip: the joint at the end of the lower one; goal: where it goes, in world space.
 return (upper, lower, tip, goal) => {
  upper.getWorldPosition(root);
  lower.getWorldPosition(middle);
  tip.getWorldPosition(end);
  direction.subVectors(goal, root);
  const first = root.distanceTo(middle), second = middle.distanceTo(end);
  const stretched = direction.length(), animatedReach = root.distanceTo(end), room = Math.max(EPSILON, first + second - animatedReach);
  const softened = stretched > animatedReach ? animatedReach + room * (1 - Math.exp(-(stretched - animatedReach) / room)) : stretched;
  const reach = Math.max(Math.abs(first - second) + EPSILON, Math.min(softened, first + second - EPSILON));
  direction.normalize();
  line.subVectors(end, root).normalize();
  bend.subVectors(middle, root).addScaledVector(line, -bend.dot(line));
  if (bend.lengthSq() >= EPSILON ** 2) bend.applyQuaternion(swing.setFromUnitVectors(line, direction));
  else bend.subVectors(middle, root);   // a dead straight limb: any side of the goal's line will do
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < EPSILON ** 2) return;
  bend.normalize();
  const along = (first ** 2 - second ** 2 + reach ** 2) / (2 * reach);
  wantedMiddle.copy(root).addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, first ** 2 - along ** 2)));
  target.copy(root).addScaledVector(direction, reach);
  aim(upper, root, middle, wantedMiddle);
  lower.getWorldPosition(middle);
  tip.getWorldPosition(end);
  aim(lower, middle, end, target);
 };
}
