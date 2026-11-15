import {Quaternion, Vector3} from 'three';

const MAX_RISE = .25;
const MAX_DROP = .12;
const WALK_DROP = .045;
const EPSILON = .001;
const UP = new Vector3(0, 1, 0);

// bones: the rig's joints by name ('l_upleg', 'l_leg', 'l_foot' and the right side). soleHeight (m): how high the ankle
// joint sits above the sole on this rig; a wrong value drags every step into or off the ground.
export function createFootPlacement(bones, soleHeight) {
 if (!(soleHeight > 0)) throw Error('Foot placement needs the ankle height above the sole');
 const legs = ['l', 'r'].map(side => ['upleg', 'leg', 'foot'].map(name => bones.get(side + '_' + name)));
 const animated = legs.map(leg => leg.map(() => new Quaternion()));
 let applied = false;
 const hip = new Vector3(), knee = new Vector3(), ankle = new Vector3(), target = new Vector3();
 const direction = new Vector3(), bend = new Vector3(), wantedKnee = new Vector3(), normal = new Vector3();
 const before = new Vector3(), after = new Vector3(), delta = new Quaternion(), parent = new Quaternion();
 const footRotation = new Quaternion(), parentInverse = new Quaternion();

 function rotateWorld(bone, rotation) {
  bone.parent.getWorldQuaternion(parent);
  bone.quaternion.premultiply(rotation.premultiply(parentInverse.copy(parent).invert()).multiply(parent));
  bone.updateWorldMatrix(false, true);
 }
 function aim(bone, from, current, wanted) {
  before.subVectors(current, from).normalize();
  after.subVectors(wanted, from).normalize();
  rotateWorld(bone, delta.setFromUnitVectors(before, after));
 }
 return {
  restore() {
   if (!applied) return;
   legs.forEach((leg, i) => leg.forEach((bone, j) => bone.quaternion.copy(animated[i][j])));
   applied = false;
  },
  apply(groundAt, moving) {
   if (!groundAt || legs.some(leg => leg.some(bone => !bone))) return;
   legs.forEach((leg, i) => leg.forEach((bone, j) => animated[i][j].copy(bone.quaternion)));
   applied = true;
   for (const [thigh, shin, foot] of legs) {
    thigh.getWorldPosition(hip);
    shin.getWorldPosition(knee);
    foot.getWorldPosition(ankle);
    const ground = groundAt(ankle, normal);
    const offset = ground + soleHeight - ankle.y;
    if (!Number.isFinite(offset) || offset < -(moving ? WALK_DROP : MAX_DROP) || offset > MAX_RISE) continue;
    foot.getWorldQuaternion(footRotation);
    target.copy(ankle).y += offset;
    direction.subVectors(target, hip);
    const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle);
    const reach = Math.max(Math.abs(upper - lower) + EPSILON, Math.min(direction.length(), upper + lower - EPSILON));
    direction.normalize();
    bend.subVectors(knee, hip).addScaledVector(direction, -bend.dot(direction));
    if (bend.lengthSq() < EPSILON ** 2) continue;
    bend.normalize();
    const along = (upper ** 2 - lower ** 2 + reach ** 2) / (2 * reach);
    wantedKnee.copy(hip).addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, upper ** 2 - along ** 2)));
    target.copy(hip).addScaledVector(direction, reach);
    aim(thigh, hip, knee, wantedKnee);
    shin.getWorldPosition(knee);
    foot.getWorldPosition(ankle);
    aim(shin, knee, ankle, target);
    foot.parent.getWorldQuaternion(parent).invert();
    delta.setFromUnitVectors(UP, normal);
    foot.quaternion.copy(parent).multiply(delta).multiply(footRotation);
   }
  },
 };
}
