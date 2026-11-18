import {MathUtils, Quaternion, Vector3} from 'three';

// Turns her head, neck and upper spine toward a point: where the view looks, or something worth looking at. The turn
// is shared out along the chain, limited, and eased; a point too far behind her is ignored and she looks ahead.
// Angles in rad, rates in 1/s.
export const HEAD_LOOK_DEFAULTS = Object.freeze({
 yaw: 1.15,        // furthest she turns to either side
 pitch: .45,       // ... and up or down
 pitchShare: .5,   // share of the point's elevation she follows: the view often looks down on her
 giveUp: 2.3,      // a point further round than this from the way she faces is not looked at
 rate: 5,          // how quickly the look follows
});

const UP = new Vector3(0, 1, 0);
const shortest = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// chain: [{bone, share}] from the spine up to the head; the shares add up to 1.
export function createHeadLook(chain, options = {}) {
 const unknown = Object.keys(options).filter(key => !(key in HEAD_LOOK_DEFAULTS));
 if (unknown.length) throw Error('Unknown head look option: ' + unknown.join(', '));
 const o = {...HEAD_LOOK_DEFAULTS, ...options};
 const saved = chain.map(() => new Quaternion()), head = chain.at(-1).bone;
 const at = new Vector3(), side = new Vector3(), parent = new Quaternion(), turn = new Quaternion(), tilt = new Quaternion();
 let yaw = 0, pitch = 0, applied = false;
 function restore() {
  if (applied) chain.forEach(({bone}, i) => bone.quaternion.copy(saved[i]));
  applied = false;
 }
 return {
  restore,
  reset() { restore(); yaw = pitch = 0; },
  // Call after the clips are applied. target: the world point to look at, or null. facing: the way her body faces
  // (rad, 0 = +Z, positive toward +X). active: whether she is free to look.
  update(dt, target, facing, active) {
   let wantedYaw = 0, wantedPitch = 0;
   if (target && active) {
    head.getWorldPosition(at);
    const x = target.x - at.x, y = target.y - at.y, z = target.z - at.z, round = shortest(Math.atan2(x, z) - facing);
    if (Math.abs(round) <= o.giveUp) {
     wantedYaw = MathUtils.clamp(round, -o.yaw, o.yaw);
     wantedPitch = MathUtils.clamp(Math.atan2(y, Math.hypot(x, z)) * o.pitchShare, -o.pitch, o.pitch);
    }
   }
   yaw = MathUtils.damp(yaw, wantedYaw, o.rate, dt);
   pitch = MathUtils.damp(pitch, wantedPitch, o.rate, dt);
   if (Math.abs(yaw) < 1e-3 && Math.abs(pitch) < 1e-3) return;
   // Her left, the axis she nods about: a positive turn about it looks down.
   side.set(Math.cos(facing), 0, -Math.sin(facing));
   chain.forEach(({bone, share}, i) => {
    saved[i].copy(bone.quaternion);
    turn.setFromAxisAngle(UP, yaw * share).multiply(tilt.setFromAxisAngle(side, -pitch * share));
    bone.parent.getWorldQuaternion(parent);
    bone.quaternion.premultiply(turn.premultiply(tilt.copy(parent).invert()).multiply(parent));
   });
   applied = true;
  },
  get yaw() { return yaw; },
  get pitch() { return pitch; },
 };
}
