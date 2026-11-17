import {Quaternion, Vector3} from 'three';
import {createTwoBoneSolver} from './two-bone.js';

const MAX_RISE = .25;
const MAX_DROP = .12;
const WALK_DROP = .045;
const UP = new Vector3(0, 1, 0);

// bones: the rig's joints by name ('l_upleg', 'l_leg', 'l_foot' and the right side). soleHeight (m): how high the ankle
// joint sits above the sole on this rig; a wrong value drags every step into or off the ground.
export function createFootPlacement(bones, soleHeight) {
 if (!(soleHeight > 0)) throw Error('Foot placement needs the ankle height above the sole');
 const legs = ['l', 'r'].map(side => ['upleg', 'leg', 'foot'].map(name => bones.get(side + '_' + name)));
 const animated = legs.map(leg => leg.map(() => new Quaternion()));
 let applied = false;
 const hip = new Vector3(), knee = new Vector3(), ankle = new Vector3(), target = new Vector3();
 const normal = new Vector3(), delta = new Quaternion(), parent = new Quaternion(), footRotation = new Quaternion();
 const reach = createTwoBoneSolver();

 // Bends one leg so its ankle reaches `target` and its sole rests on `normal`.
 function place(thigh, shin, foot) {
  foot.getWorldQuaternion(footRotation);
  reach(thigh, shin, foot, target);
  foot.parent.getWorldQuaternion(parent).invert();
  delta.setFromUnitVectors(UP, normal);
  foot.quaternion.copy(parent).multiply(delta).multiply(footRotation);
 }
 // Keeps the clips' own leg pose, to put back before the next frame. Only the first bend of a frame does: a second one
 // would otherwise keep the first one's result as if it were the clip's, and the correction would pile up frame on frame.
 function remember() {
  if (!applied) legs.forEach((leg, i) => leg.forEach((bone, j) => animated[i][j].copy(bone.quaternion)));
  applied = true;
 }
 return {
  restore() {
   if (!applied) return;
   legs.forEach((leg, i) => leg.forEach((bone, j) => bone.quaternion.copy(animated[i][j])));
   applied = false;
  },
  apply(groundAt, moving, plant, filterOffset) {
   if ((!groundAt && !plant) || legs.some(leg => leg.some(bone => !bone))) return;
   remember();
   for (const [side, [thigh, shin, foot]] of legs.entries()) {
    if (plant && side !== plant.side) continue;
    thigh.getWorldPosition(hip);
    shin.getWorldPosition(knee);
    foot.getWorldPosition(ankle);
    target.copy(ankle);
    if (plant) {
     target.lerp(plant.point, plant.weight);
     normal.copy(UP).lerp(plant.normal, plant.weight).normalize();
    } else {
     const ground = groundAt(ankle, normal);
     let offset = ground + soleHeight - ankle.y;
     if (filterOffset) offset = filterOffset(side, offset);
     if (!Number.isFinite(offset) || offset < -(moving ? WALK_DROP : MAX_DROP) || offset > MAX_RISE) continue;
     target.y += offset;
    }
    place(thigh, shin, foot);
   }
  },
  // The same solver with the goals given: targets[side] is {point: where the ankle goes, normal: the ground the sole rests
  // on} in world space, or null to leave that leg as animated. For a grounder that works the goals out itself.
  solve(targets) {
   if (legs.some(leg => leg.some(bone => !bone))) return;
   remember();
   for (const [side, [thigh, shin, foot]] of legs.entries()) {
    if (!targets[side]) continue;
    thigh.getWorldPosition(hip);
    shin.getWorldPosition(knee);
    foot.getWorldPosition(ankle);
    target.copy(targets[side].point);
    normal.copy(targets[side].normal);
    place(thigh, shin, foot);
   }
  },
 };
}
