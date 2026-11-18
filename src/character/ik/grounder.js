import {MathUtils, Matrix3, Vector3} from 'three';

// Keeps her feet on the ground she actually stands on, every frame she is grounded. For each foot: the ground under it,
// a smoothed height offset from the flat floor the clips were made on, the sole tilted to the ground, and the stance foot
// pinned in the world so it does not slide. The pelvis drops to let the lower foot reach, and a step the capsule climbs
// in one frame is taken by the body over a moment instead. Lengths in m, rates in 1/s (higher = tighter), angles in rad.
export const GROUNDER_DEFAULTS = Object.freeze({
 maxStep: .4,        // tallest step up or down the feet follow
 footUp: 16,         // how tightly a foot's offset follows ground that rises under it
 footDown: 14,       // ... and ground that falls away
 predict: .12,       // s of the foot's own motion looked ahead for ground, so it starts rising before it reaches a step
 pelvisRate: 9,      // how tightly the pelvis follows the lower foot
 riseRate: 11,       // how tightly the body follows the capsule up or down a step
 pelvisLift: .08,    // most the pelvis rises when both feet stand above the capsule's floor
 pelvisTrail: .25,   // going up, share of the drop to the foot left behind that the pelvis takes: she stands over the leading foot
 tilt: .6,           // steepest ground the sole tilts to
 tiltFrom: .02,      // a foot this low over its floor is fully tilted to the ground ...
 tiltTo: .14,        // ... and this high keeps the clip's own rotation
 lockHeight: .012,   // a foot lower than this over its floor is planted
 lockSpeed: .45,     // m/s over the ground under which a planted foot is pinned: it has stopped travelling with the stride
 lockTurn: .45,      // rad the body may turn over a pinned foot before it is let go to step round
 lockIn: 20,         // how fast a planted foot is pinned
 lockOut: 12,        // how fast it is let go when the clip lifts it
 lockEase: 4.5,      // ... and when it is let go while still on the ground: she stopped, turned over it, or the clip carried it off
 lockStretch: .2,    // a pinned foot is let go when the clip has carried it this far from its pin
 fade: 10,           // how fast the whole correction comes in on the ground and goes out in the air
});

const UP = new Vector3(0, 1, 0);

// bones: the rig's joints by name ('hips', 'l_foot', 'r_foot', 'l_toebase', 'r_toebase'). footIK: the leg solver (solve, restore). soleHeight: how
// high the ankle sits over the floor when the foot is flat on it in the stride (not in a standing pose, where it can sit higher). groundAt(point, normal): the ground height under a world point and its normal, or NaN.
export function createGrounder({bones, footIK, soleHeight, groundAt, ...options}) {
 const unknown = Object.keys(options).filter(key => !(key in GROUNDER_DEFAULTS));
 if (unknown.length) throw Error('Unknown grounder option: ' + unknown.join(', '));
 const o = {...GROUNDER_DEFAULTS, ...options};
 const hips = bones.get('hips');
 const feet = ['l', 'r'].map(side => ({
  bone: bones.get(side + '_foot'), toe: bones.get(side + '_toebase'), ball: new Vector3(), ankle: new Vector3(), normal: new Vector3(0, 1, 0), tilt: new Vector3(0, 1, 0), point: new Vector3(),
  pin: new Vector3(), pinYaw: 0, sunk: 0, rest: 0, rested: false, last: new Vector3(), seen: false, ground: 0, planted: false, onGround: false, offset: 0, lock: 0, pinned: false, easing: false,
 }));
 const goals = feet.map(foot => ({point: foot.point, normal: foot.normal}));
 const targets = [null, null];
 const animatedHips = new Vector3(), toPelvis = new Matrix3(), shift = new Vector3(), probe = new Vector3(), found = new Vector3(), other = new Vector3(), centre = new Vector3();
 let moved = false, weight = 0, pelvis = 0, body = null, rise = 0;
 function restore() {
  footIK.restore();
  if (moved) hips.position.copy(animatedHips);
  moved = false;
 }
 function reset() {
  restore();
  weight = pelvis = rise = 0;
  body = null;
  for (const foot of feet) { foot.offset = foot.lock = 0; foot.pinned = foot.seen = foot.easing = foot.rested = false; foot.tilt.copy(UP); }
 }
 return {
  restore,
  reset,
  // Shows what it is doing, for a host that tunes it: the pelvis offset, each foot's offset and how firmly it is pinned.
  // rise: how far the body still is from the capsule's floor after a step.
  get state() { return {weight, pelvis, rise, feet: feet.map(foot => ({offset: foot.offset, lock: foot.lock, pinned: foot.pinned, planted: foot.planted}))}; },
  // Call after the clips are applied. floor: world height of the flat floor the clips stand on (her feet, as drawn).
  // active: whether she stands on the ground and the clip playing keeps her feet under her. pinning: whether planted feet
  // are pinned in the world; a host turns it off while she stands still, so her feet rest where the pose puts them.
  // stride: share of the clip's stride her feet reach (1 = as authored); under 1 they are drawn in toward her along the
  // way she faces, for a host that shortens her steps (on stairs) and advances the clip to match.
  update(dt, floor, active, pinning = true, stride = 1) {
   const ease = rate => 1 - Math.exp(-dt * rate);
   weight = MathUtils.clamp(weight + (active ? 1 : -1) * dt * o.fade, 0, 1);
   // The body's own floor: the capsule's, eased, so a step taken in one frame does not pop her up or down.
   body = body === null || !active ? floor : MathUtils.clamp(MathUtils.lerp(body, floor, ease(o.riseRate)), floor - o.maxStep, floor + o.maxStep);
   rise = body - floor;
   if (weight === 0) { for (const foot of feet) { foot.offset = foot.lock = 0; foot.pinned = foot.seen = foot.easing = foot.rested = false; } pelvis = 0; return; }
   let lowest = Infinity, highest = -Infinity, lowestAhead = 0;
   // The way the body faces, to let a pinned foot go when she turns over it.
   const facing = hips.parent.matrixWorld.elements, yaw = Math.atan2(facing[8], facing[10]);
   const faceX = Math.sin(yaw), faceZ = Math.cos(yaw);
   hips.getWorldPosition(centre);
   for (const foot of feet) {
    foot.bone.getWorldPosition(foot.ankle);
    foot.toe.getWorldPosition(foot.ball);
    if (stride !== 1) {
     // Shorter steps: the foot, heel and ball alike, is drawn toward her along the way she faces.
     const drawn = ((foot.ankle.x - centre.x) * faceX + (foot.ankle.z - centre.z) * faceZ) * (1 - stride) * weight;
     foot.ankle.x -= faceX * drawn; foot.ankle.z -= faceZ * drawn;
     foot.ball.x -= faceX * drawn; foot.ball.z -= faceZ * drawn;
    }
    const height = foot.ankle.y - soleHeight - floor;
    // The ground is read where the foot will be (its pin while it is pinned): under the heel, under the ball, and
    // where its own motion takes it next. It rests on the highest, so it neither sinks into a step's edge nor hangs
    // off it, and it starts rising before it reaches a step.
    const pinned = MathUtils.smoothstep(foot.lock, 0, 1), x = MathUtils.lerp(foot.ankle.x, foot.pin.x, pinned), z = MathUtils.lerp(foot.ankle.z, foot.pin.z, pinned);
    const lead = foot.seen && dt > 0 ? o.predict / dt * (1 - pinned) : 0;
    const travelling = foot.seen && dt > 0 ? Math.hypot(foot.ankle.x - foot.last.x, foot.ankle.z - foot.last.z) / dt : Infinity;
    let ground = groundAt(probe.set(x, floor, z), found);
    for (const [aheadX, aheadZ] of [[foot.ball.x - foot.ankle.x, foot.ball.z - foot.ankle.z], [(foot.ankle.x - foot.last.x) * lead, (foot.ankle.z - foot.last.z) * lead]]) {
     const ahead = groundAt(probe.set(x + aheadX, floor, z + aheadZ), other);
     if (Number.isFinite(ahead) && Math.abs(ahead - floor) <= o.maxStep && !(ground >= ahead)) { ground = ahead; found.copy(other); }
    }
    foot.last.copy(foot.ankle);
    foot.seen = true;
    const onGround = foot.onGround = Number.isFinite(ground) && Math.abs(ground - floor) <= o.maxStep;
    foot.ground = onGround ? ground : floor;
    // The height the foot rests at is eased in the world, so the body easing up a step does not drag it along. A foot
    // coming down has to clear a step at once; one that is pinned or being let go takes it gently.
    const level = onGround ? ground : body;
    foot.rest = foot.rested ? MathUtils.lerp(foot.rest, level, ease(level > foot.rest && foot.lock === 0 ? o.footUp : o.footDown)) : level;
    foot.rested = true;
    foot.offset = foot.rest - body;
    // Which foot is lower, and whether it is the one ahead of her.
    const ahead = (foot.ankle.x - centre.x) * faceX + (foot.ankle.z - centre.z) * faceZ;
    if (foot.offset < lowest) { lowest = foot.offset; lowestAhead = ahead; }
    highest = Math.max(highest, foot.offset);
    // The sole tilts to the ground only as it comes down on it, and never past `tilt`.
    const flat = 1 - MathUtils.smoothstep(height, o.tiltFrom, o.tiltTo);
    foot.tilt.lerp(onGround && found.angleTo(UP) <= o.tilt ? found : UP, ease(o.footDown));
    foot.normal.lerpVectors(UP, foot.tilt, flat * weight).normalize();
    // A planted foot is pinned where it came down until the clip lifts it or carries it too far from the pin.
    const planted = foot.planted = active && onGround && height < o.lockHeight;
    foot.sunk = planted ? Math.max(0, -height) : 0;   // how far the clip dips the ankle under where a flat foot holds it
    if (planted && pinning && !foot.pinned && foot.lock === 0 && travelling < o.lockSpeed) { foot.pinned = true; foot.pin.set(foot.ankle.x, 0, foot.ankle.z); foot.pinYaw = yaw; }
    const turned = Math.abs(Math.atan2(Math.sin(yaw - foot.pinYaw), Math.cos(yaw - foot.pinYaw)));
    if (foot.pinned && !planted) foot.pinned = false;
    else if (foot.pinned && (!pinning || turned > o.lockTurn || Math.hypot(foot.pin.x - foot.ankle.x, foot.pin.z - foot.ankle.z) > o.lockStretch)) {
     foot.pinned = false;
     foot.easing = true;
    }
    foot.lock = MathUtils.clamp(foot.lock + (foot.pinned ? o.lockIn : foot.easing ? -o.lockEase : -o.lockOut) * dt, 0, 1);
    if (foot.lock === 0) foot.easing = false;
   }
   // Stepping down, the pelvis drops to let the leading foot reach the lower ground. Stepping up, the lower foot is the
   // one left behind: the pelvis stays over the leading foot and the trailing one comes off the ground.
   const behind = MathUtils.smoothstep(-lowestAhead, 0, .15);
   pelvis = MathUtils.lerp(pelvis, Math.min(MathUtils.lerp(lowest, MathUtils.lerp(highest, lowest, o.pelvisTrail), behind), o.pelvisLift), ease(o.pelvisRate));
   // Move the pelvis: the body's eased floor plus the drop to the lower foot.
   const drop = (rise + pelvis) * weight;
   animatedHips.copy(hips.position);
   toPelvis.setFromMatrix4(hips.parent.matrixWorld).invert();
   hips.position.add(shift.set(0, drop, 0).applyMatrix3(toPelvis));
   moved = true;
   hips.updateWorldMatrix(false, true);
   for (const [side, foot] of feet.entries()) {
    // Where the clip puts the ankle over its own floor, carried to the ground under the foot; a planted foot never dips into it.
    const wanted = foot.ankle.y + (rise + foot.offset) * weight;
    const lock = MathUtils.smoothstep(foot.lock, 0, 1) * weight;
    foot.point.set(MathUtils.lerp(foot.ankle.x, foot.pin.x, lock), wanted + foot.sunk * weight,
     MathUtils.lerp(foot.ankle.z, foot.pin.z, lock));
    targets[side] = goals[side];
   }
   footIK.solve(targets);
  },
 };
}
