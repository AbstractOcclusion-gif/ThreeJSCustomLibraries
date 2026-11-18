import {Quaternion, Vector3} from 'three';
import {createTwoBoneSolver} from './two-bone.js';

// Arm reach: bends an arm so its hand comes to a point. For hanging from a ledge (both hands) and for touching a wall.
// Where her hands hold a ledge: this far either side of the middle, with the knuckles this far above the edge and back
// from it (m). It is the knuckles that are put there, not the wrist, so her fingers lie over the edge.
const HOLD = {apart: .25, above: .015, back: 0};
const GRIP_PASSES = 2;   // the wrist's goal is worked out from where the knuckles are, which the reach itself moves a little
export function createHandPlacement(rig) {
 const arms = ['Left', 'Right'].map(side => {
  const [upper, lower, hand] = ['Arm', 'ForeArm', 'Hand'].map(joint => rig.getObjectByName('mixamorig' + side + joint));
  return {chain: [lower, upper], upper, lower, hand, grip: rig.getObjectByName('mixamorig' + side + 'HandMiddle1') ?? hand, saved: [new Quaternion(), new Quaternion()], moved: false};
 });
 const to = new Vector3(), goal = new Vector3(), hold = new Vector3(), knuckles = new Vector3();
 const reach = createTwoBoneSolver();
 // Brings one hand toward `goal` (world), by `weight` of the way from where the clip has it.
 function pull(arm, weight) {
  const {chain, hand, saved} = arm;
  if (!arm.moved) chain.forEach((bone, index) => saved[index].copy(bone.quaternion));
  arm.moved = true;
  goal.lerp(hand.getWorldPosition(to), 1 - weight);
  reach(arm.upper, arm.lower, hand, goal);
 }
 return {
  restore() {
   for (const arm of arms) {
    if (arm.moved) arm.chain.forEach((bone, index) => bone.quaternion.copy(arm.saved[index]));
    arm.moved = false;
   }
  },
  // Both hands onto a ledge at `anchor`, a hand's width either side of it. facing: the way she faces it (rad, 0 = +Z,
  // positive toward +X); her left is (cos, -sin) of it on X/Z. along: keep each hand where the clip has it along the
  // edge (hand over hand, in a shimmy) and only bring it onto the edge.
  apply(anchor, weight, facing = 0, along = false) {
   if (!anchor || weight <= 0) return;
   const sin = Math.sin(facing), cos = Math.cos(facing);
   arms.forEach((arm, side) => {
    arm.hand.getWorldPosition(to);
    const across = along ? (to.x - anchor.x) * cos - (to.z - anchor.z) * sin : side === 0 ? HOLD.apart : -HOLD.apart;
    hold.set(anchor.x + cos * across - sin * HOLD.back, anchor.y + HOLD.above, anchor.z - sin * across - cos * HOLD.back);
    // The wrist goes where it puts the knuckles on the hold; once she holds on fully, a second pass makes it exact.
    for (let pass = 0; pass < (weight < 1 ? 1 : GRIP_PASSES); pass++) {
     goal.copy(hold).add(arm.hand.getWorldPosition(to)).sub(arm.grip.getWorldPosition(knuckles));
     pull(arm, weight);
    }
   });
  },
  // Where a hand (0 left, 1 right) is now, in the world.
  wrist(side, out) { return arms[side].hand.getWorldPosition(out); },
  // One hand (0 left, 1 right) to a world point.
  touch(side, point, weight) {
   if (weight <= 0) return;
   goal.copy(point);
   pull(arms[side], weight);
  },
 };
}
