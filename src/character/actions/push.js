import {Quaternion, Vector3} from 'three';

// Pushing and pulling, after Invector's push action: she takes hold of something, and from then on that thing leads
// and she follows. Asking to move the way she faces pushes it, the other way pulls it; what she holds goes at her
// pace, stops where something stands in its way, and her steps follow the speed it really has. Two things can be
// held: a block, which goes straight along the side she holds, and a turning thing (a capstan's arm), which she walks
// round its pivot. While she holds on she is carried: the controller is not stepped. Lengths in m, speeds in m/s.
export const PUSH_DEFAULTS = Object.freeze({
 pushSpeed: .7,       // how fast she pushes ...
 pullSpeed: .45,      // ... and pulls: see fit()
 ahead: .5,           // how far her middle stands from the side she holds: see fit()
 from: .5,            // share of a full move, along the way she faces, from which she pushes (or, against it, pulls)
 ease: 6,             // 1/s her effort builds up and dies down
 enterSeconds: .3,    // how long she takes to come to her place
 chest: 1,            // height above her feet at which room is looked for behind her ...
 behind: .25,         // ... and how much of it she needs, beyond her capsule, to step back
 probe: .3,           // how far along her way the ground is looked for
 stepUp: .35,         // the ground there may be this much higher than her feet ...
 stepDown: .5,        // ... or this much lower
 upright: .95,        // a block has to stand this upright (its up's Y) to be taken ...
 drop: .15,           // ... and she lets go of one that sinks or rises this far (it went over an edge)
});

// controller: the character controller. host: the physics host (readPose, raycast, setGroundVelocity). radius: her capsule's.
export function createPushAction({controller, host, radius, ...options}) {
 const unknown = Object.keys(options).filter(key => !(key in PUSH_DEFAULTS));
 if (unknown.length) throw Error('Unknown push option: ' + unknown.join(', '));
 const o = {...PUSH_DEFAULTS, ...options};
 const at = new Vector3(), turn = new Quaternion(), up = new Vector3(), from = new Vector3(), to = new Vector3(), start = new Vector3();
 // Where she stands now (x, z, heading) and the side she holds: a point of it and the way into it.
 const spot = {x: 0, z: 0, heading: 0}, face = {x: 0, z: 0, intoX: 0, intoZ: 1};
 let state = 'free', guide = null, entering = 0, startHeading = 0, effort = 0, way = 1, moving = 0, feet = 0;

 // A block: it goes straight, along the way into the side she holds.
 function blockGuide({body, halfExtents}) {
  host.readPose(body, at, turn);
  if (up.set(0, 1, 0).applyQuaternion(turn).y < o.upright) return null;
  // Its own axes on the ground, and where she is in them: she holds the side she stands nearest, in its middle.
  const forward = from.set(0, 0, 1).applyQuaternion(turn), yaw = Math.atan2(forward.x, forward.z);
  const axes = [[Math.cos(yaw), -Math.sin(yaw), halfExtents[0]], [Math.sin(yaw), Math.cos(yaw), halfExtents[2]]];
  const dx = controller.position.x - at.x, dz = controller.position.z - at.z;
  const [outX, outZ, half] = axes.map(([x, z, extent]) => { const along = dx * x + dz * z; return [x * Math.sign(along), z * Math.sign(along), extent, Math.abs(along) / extent]; })
   .sort((a, b) => b[3] - a[3])[0];
  const intoX = -outX, intoZ = -outZ, height = at.y;
  let last = 0;
  const along = () => at.x * intoX + at.z * intoZ;
  host.readPose(body, at, turn);
  last = along();
  return {
   // Takes its place this step; returns how far it has gone the way she faces since the last one.
   read() { host.readPose(body, at, turn); const now = along(), gone = now - last; last = now; return gone; },
   lost: () => Math.abs(at.y - height) > o.drop || up.set(0, 1, 0).applyQuaternion(turn).y < o.upright,
   place() {
    spot.x = at.x - intoX * (half + o.ahead); spot.z = at.z - intoZ * (half + o.ahead); spot.heading = Math.atan2(intoX, intoZ);
    face.x = at.x - intoX * half; face.z = at.z - intoZ * half; face.intoX = intoX; face.intoZ = intoZ;
   },
   advance(speed) { host.setGroundVelocity(body, intoX * speed, intoZ * speed); },
  };
 }
 // A turning thing: {pivot: {x, z}, radius (m from the pivot to where she holds its arm), thickness (m, of the arm),
 // angle (rad: the arm points along (sin, cos) of it), turn(by) -> the angle it really turned by}. She walks it round.
 function turnGuide(lever) {
  const armX = Math.sin(lever.angle), armZ = Math.cos(lever.angle);
  // The way the arm's end goes as the angle grows; she pushes that way from behind it, or the other way from in front.
  const side = (controller.position.x - (lever.pivot.x + armX * lever.radius)) * armZ - (controller.position.z - (lever.pivot.z + armZ * lever.radius)) * armX <= 0 ? 1 : -1;
  let gone = 0;
  return {
   read() { const moved = gone; gone = 0; return moved; },
   lost: () => false,
   place() {
    const x = Math.sin(lever.angle), z = Math.cos(lever.angle), intoX = z * side, intoZ = -x * side;
    const endX = lever.pivot.x + x * lever.radius, endZ = lever.pivot.z + z * lever.radius;
    face.x = endX - intoX * lever.thickness / 2; face.z = endZ - intoZ * lever.thickness / 2; face.intoX = intoX; face.intoZ = intoZ;
    spot.x = face.x - intoX * o.ahead; spot.z = face.z - intoZ * o.ahead; spot.heading = Math.atan2(intoX, intoZ);
   },
   advance(speed, dt) { gone = lever.turn(side * speed * dt / lever.radius) * side * lever.radius; },
  };
 }
 // The ground under a point near her feet, or NaN where there is none she could step to.
 function groundAt(x, z) {
  const hit = host.raycast(from.set(x, feet + o.stepUp, z), to.set(x, feet - o.stepDown, z));
  return hit ? hit.point.y : NaN;
 }
 function take(made) {
  if (!made || state !== 'free' || !controller.grounded) return false;
  guide = made;
  start.copy(controller.position); startHeading = controller.heading; feet = start.y;
  entering = effort = moving = 0; way = 1; state = 'push';
  guide.place();
  return true;
 }
 function release() {
  guide?.advance(0, 0);
  guide = null; state = 'free'; effort = moving = 0;
 }
 return {
  get state() { return state; },              // 'push' while she holds something, else 'free'
  get facing() { return spot.heading; },
  get moving() { return moving; },            // how fast what she holds really goes, the way she faces (m/s; under 0 as she pulls)
  get way() { return way; },                  // 1 while she pushes or last pushed, -1 for a pull: the stance she keeps
  get face() { return face; },                // the side she holds: a point of it (x, z) and the way into it (intoX, intoZ)
  anchor: null, shimmying: 0, shimmySpeed: 0, pull: 0, climbing: 0,   // what a ledge or a rope has and this has not
  // What her clips say: how far ahead of her they have her hands (m) and how fast each walks (m/s).
  fit({ahead, pushSpeed, pullSpeed}) { o.ahead = ahead; o.pushSpeed = pushSpeed; o.pullSpeed = pullSpeed; },
  // Takes hold of a block ({body, halfExtents}: a moving body of the host and its half sizes) or of a turning thing.
  // False when she cannot (she is not on her feet, the block has fallen over).
  grabBlock(block) { return take(blockGuide(block)); },
  grabTurning(lever) { return take(turnGuide(lever)); },
  release,
  reset: release,
  // moveX, moveZ: the move asked, in the world. True while she holds on: she is placed and nothing else may move her.
  update(dt, {moveX = 0, moveZ = 0} = {}) {
   if (state !== 'push') return false;
   const gone = guide.read();
   if (guide.lost()) { release(); return false; }
   moving = dt > 0 ? gone / dt : 0;
   guide.place();
   if (entering < 1) {
    // She comes to her place first, the short way round, and nothing moves yet.
    entering = Math.min(1, entering + dt / o.enterSeconds);
    const share = entering * entering * (3 - 2 * entering), swing = Math.atan2(Math.sin(spot.heading - startHeading), Math.cos(spot.heading - startHeading));
    guide.advance(0, dt);
    controller.teleport(start.x + (spot.x - start.x) * share, feet, start.z + (spot.z - start.z) * share, startHeading + swing * share);
    return true;
   }
   const sin = Math.sin(spot.heading), cos = Math.cos(spot.heading), ask = moveX * sin + moveZ * cos;
   let wanted = ask > o.from ? 1 : ask < -o.from ? -1 : 0;
   // Stepping back she needs room behind her; either way, ground to step onto.
   if (wanted < 0 && host.raycast(from.set(spot.x, feet + o.chest, spot.z), to.set(spot.x - sin * (radius + o.behind), feet + o.chest, spot.z - cos * (radius + o.behind)))) wanted = 0;
   const ahead = wanted ? groundAt(spot.x + sin * o.probe * wanted, spot.z + cos * o.probe * wanted) : feet;
   if (!(ahead <= feet + o.stepUp)) wanted = 0;
   if (wanted) way = wanted;
   effort += (wanted - effort) * (1 - Math.exp(-dt * o.ease));
   guide.advance(effort * (effort > 0 ? o.pushSpeed : o.pullSpeed), dt);
   const ground = groundAt(spot.x, spot.z);
   if (Number.isFinite(ground)) feet = ground;
   controller.teleport(spot.x, feet, spot.z, spot.heading);
   return true;
  },
 };
}
