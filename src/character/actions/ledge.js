import {Vector3} from 'three';

// Catching a ledge. While she falls from a jump toward a wall, the wall ahead and the top of it are looked for; if the
// top is within her reach, flat, clear to hang under and clear to stand on, she catches it, facing the wall. From the
// hang she climbs up, drops, or moves along the ledge for as long as it carries on. Lengths in m, speeds in m/s.
export const LEDGE_DEFAULTS = Object.freeze({
 reach: .76,          // farthest ahead of her the wall may be
 wallProbe: .3,       // height above her feet the wall is looked for at
 handLow: .45,        // the ledge has to be at least this far above her feet ...
 handHigh: 1.95,      // ... and at most this far
 inset: .12,          // how far past the wall's face the top is looked for
 approach: .4,        // she has to be closing on the wall at least this fast
 touching: .1,        // ... unless she is against it: no farther than this from her capsule (a jump straight up at a wall)
 facing: .6,          // cosine between the way she faces and the way to the wall, at least
 upright: .3,         // the wall's normal may lean this much (its Y) at most
 flat: .7,            // the top's normal has to point up at least this much (its Y)
 level: .1,           // the top may differ this much in height across her width
 hangDrop: 1.48,      // her feet hang this far under the ledge
 hangGap: .055,       // gap kept between her capsule and the wall while she hangs
 topRise: .04,        // she stands this far over the top after climbing
 topIn: .24,          // ... and this far past the edge, beyond her own radius
 climbSeconds: 1.13,  // how long the climb takes
 climbUp: .65,        // share of the climb spent rising before she moves in over the top
 shimmySpeed: .5,     // how fast she moves along the ledge while she hangs
 shimmyFace: .3,      // how far either side of the edge the wall under it is looked for
 edgeReach: .6,       // standing, the edge she lowers herself from is looked for this far ahead of her ...
 edgeFacing: .7,      // ... and she has to face out over it this squarely (cosine)
 cornerReach: .5,     // a corner of the ledge is looked for this far past her side, the way she is going ...
 cornerFacing: .7,    // ... and the wall round it has to stand this square to that way (cosine)
 cornerSeconds: .7,   // how long she takes to go round it
});

const smooth = x => x * x * (3 - 2 * x);

// Where a climb has her, `t` (0..1) of the way from where she hangs to where she stands on top: up the wall for the
// first `climbUp` of it, then in over the top. Whatever ends in the same climb uses it (a ladder's top).
export function climbPoint(hang, top, t, climbUp, out) {
 const over = smooth(Math.max(0, (t - climbUp) / (1 - climbUp)));
 return out.set(hang.x + (top.x - hang.x) * over, hang.y + (top.y - hang.y) * smooth(Math.min(1, t / climbUp)), hang.z + (top.z - hang.z) * over);
}

// controller: the character controller. host: the physics host (raycast). radius, height: her capsule.
export function createLedgeAction({controller, host, radius, height, ...options}) {
 const unknown = Object.keys(options).filter(key => !(key in LEDGE_DEFAULTS));
 if (unknown.length) throw Error('Unknown ledge option: ' + unknown.join(', '));
 const o = {...LEDGE_DEFAULTS, ...options};
 const from = new Vector3(), to = new Vector3(), probe = new Vector3(), end = new Vector3();
 const hang = new Vector3(), top = new Vector3(), anchor = new Vector3(), wall = new Vector3();
 let state = 'free', elapsed = 0, locked = false, launched = false, caught = false, facing = 0;
 // The ledge she holds: its height, the way into the wall and her left along it; and which way she is moving along it.
 let ledgeY = 0, towardX = 0, towardZ = 1, sideX = 1, sideZ = 0, shimmying = 0;
 // Lowering herself from an edge she stood at: the climb, taken backward from where she stood, turning to the wall.
 const lowerFrom = new Vector3(), found = {x: 0, z: 0, y: 0, intoX: 0, intoZ: 0};
 let lowering = false, lowerSwing = 0;
 // Going round a corner: how far through it she is (0..1), which way, and where it takes her from and to.
 const round = {share: 1, way: 0, fromHang: new Vector3(), toHang: new Vector3(), fromAnchor: new Vector3(), toAnchor: new Vector3(), fromFacing: 0, swing: 0, intoX: 0, intoZ: 0};
 const clear = (a, b) => !host.raycast(a, b);
 const place = point => controller.teleport(point.x, point.y, point.z, facing);
 // Room to hang where she is, to rise past the edge, and to stand on top, across her width.
 function room() {
  for (const across of [-radius, 0, radius]) {
   const dx = sideX * across, dz = sideZ * across;
   probe.set(hang.x + dx, hang.y + .06, hang.z + dz);
   end.set(hang.x + dx, top.y + height, hang.z + dz);
   if (!clear(probe, end)) return false;
   probe.set(top.x + dx, top.y + height, top.z + dz);
   if (!clear(end, probe)) return false;
   end.set(top.x + dx, top.y, top.z + dz);
   if (!clear(probe, end)) return false;
  }
  return true;
 }
 // Moves her along the ledge, to her left (way = 1) or her right (-1), if it carries on there: the top still under her
 // leading hand, the wall still under the top, and room for her to hang.
 function slide(way, dt) {
  const step = o.shimmySpeed * dt * way, lead = step + way * radius;
  const x = wall.x + sideX * lead, z = wall.z + sideZ * lead;
  const surface = host.raycast(from.set(x + towardX * o.inset, ledgeY + o.shimmyFace, z + towardZ * o.inset), to.set(x + towardX * o.inset, ledgeY - o.shimmyFace, z + towardZ * o.inset));
  if (!surface || surface.normal.y < o.flat || Math.abs(surface.point.y - ledgeY) > o.level) return false;
  const face = host.raycast(from.set(x - towardX * o.shimmyFace, ledgeY - o.shimmyFace, z - towardZ * o.shimmyFace), to.set(x + towardX * o.shimmyFace, ledgeY - o.shimmyFace, z + towardZ * o.shimmyFace));
  if (!face || Math.abs(face.normal.y) > o.upright) return false;
  if (!clear(probe.set(hang.x + sideX * lead, hang.y + .06, hang.z + sideZ * lead), end.set(hang.x + sideX * lead, ledgeY - .1, hang.z + sideZ * lead))) return false;
  for (const point of [wall, hang, top, anchor]) { point.x += sideX * step; point.z += sideZ * step; }
  place(hang);
  return true;
 }
 // Sets the ledge she holds: a point of the wall under her hands and the way into that wall.
 function hold(x, z, intoX, intoZ) {
  wall.set(x, 0, z);
  towardX = intoX; towardZ = intoZ; sideX = intoZ; sideZ = -intoX;
  hang.set(x - intoX * (radius + o.hangGap), ledgeY - o.hangDrop, z - intoZ * (radius + o.hangGap));
  top.set(x + intoX * (radius + o.topIn), ledgeY + o.topRise, z + intoZ * (radius + o.topIn));
  anchor.set(x, ledgeY, z);
  facing = Math.atan2(intoX, intoZ);
 }
 // Where the ledge she moves along ends, it may go on round a corner: an inner one, where another wall stands across
 // her way, or an outer one, where this wall ends and its other side carries on. If the ledge is there at the same
 // height, with room to hang, she starts round it. way: 1 to her left, -1 to her right.
 function corner(way) {
  const wayX = sideX * way, wayZ = sideZ * way, low = ledgeY - o.shimmyFace, out = radius + o.hangGap, reach = radius + o.cornerReach;
  let intoX = wayX, intoZ = wayZ;
  // Inner: the wall across her way, met from where she hangs; she will face it.
  let hit = host.raycast(from.set(hang.x, low, hang.z), to.set(hang.x + wayX * reach, low, hang.z + wayZ * reach));
  if (!hit || hit.normal.x * wayX + hit.normal.z * wayZ > -o.cornerFacing) {
   // Outer: from past the end of this wall and beside it, back toward its other side; she will face that side.
   const pastX = wall.x + wayX * reach + towardX * out, pastZ = wall.z + wayZ * reach + towardZ * out;
   hit = host.raycast(from.set(pastX, low, pastZ), to.set(pastX - wayX * reach, low, pastZ - wayZ * reach));
   // A ray that starts inside the wall (it does not end there) is met at once: that is no corner.
   if (!hit || hit.distance < o.touching || hit.normal.x * wayX + hit.normal.z * wayZ < o.cornerFacing) return false;
   intoX = -wayX; intoZ = -wayZ;
  }
  const x = hit.point.x, z = hit.point.z;
  // The ledge is there too, as high as this one, and she can hang under it.
  const surface = host.raycast(from.set(x + intoX * o.inset, ledgeY + o.shimmyFace, z + intoZ * o.inset), to.set(x + intoX * o.inset, ledgeY - o.shimmyFace, z + intoZ * o.inset));
  if (!surface || surface.normal.y < o.flat || Math.abs(surface.point.y - ledgeY) > o.level) return false;
  round.toHang.set(x - intoX * out, hang.y, z - intoZ * out);
  if (!clear(probe.set(round.toHang.x, hang.y + .06, round.toHang.z), end.set(round.toHang.x, ledgeY - .1, round.toHang.z))) return false;
  round.fromHang.copy(hang); round.fromAnchor.copy(anchor); round.toAnchor.set(x, ledgeY, z);
  round.fromFacing = facing;
  const toFacing = Math.atan2(intoX, intoZ);
  round.swing = Math.atan2(Math.sin(toFacing - facing), Math.cos(toFacing - facing));
  round.intoX = intoX; round.intoZ = intoZ; round.way = way; round.share = 0;
  return true;
 }
 // Takes her on round the corner she has started; at its end she holds the ledge of the new wall.
 function turnCorner(dt) {
  round.share = Math.min(1, round.share + dt / o.cornerSeconds);
  const share = smooth(round.share);
  hang.lerpVectors(round.fromHang, round.toHang, share);
  anchor.lerpVectors(round.fromAnchor, round.toAnchor, share);
  facing = round.fromFacing + round.swing * share;
  if (round.share === 1) hold(round.toAnchor.x, round.toAnchor.z, round.intoX, round.intoZ);
  place(hang);
 }
 // The ledge ahead of her, if there is one she can catch from where she is: fills hang, top, anchor and the way she faces.
 function find() {
  const {position: p, velocity: v, heading} = controller;
  const aheadX = Math.sin(heading), aheadZ = Math.cos(heading);
  // The wall, looked for the way she faces from just above her feet.
  const hit = host.raycast(from.set(p.x, p.y + o.wallProbe, p.z), to.set(p.x + aheadX * (o.reach + radius), p.y + o.wallProbe, p.z + aheadZ * (o.reach + radius)));
  if (!hit || Math.abs(hit.normal.y) > o.upright || hit.distance < radius - .05 || hit.distance > o.reach) return false;
  const length = Math.hypot(hit.normal.x, hit.normal.z), intoX = -hit.normal.x / length, intoZ = -hit.normal.z / length;
  if (intoX * aheadX + intoZ * aheadZ < o.facing || (v.x * intoX + v.z * intoZ <= o.approach && hit.distance > radius + o.touching)) return false;
  wall.set(hit.point.x, 0, hit.point.z);
  // Into the wall, and her left along it for checking across her width.
  towardX = intoX; towardZ = intoZ; sideX = intoZ; sideZ = -intoX;
  // The top of the wall, under her hands and under each side of her: there, within reach, flat and level.
  let topY = NaN;
  for (const across of [0, -radius, radius]) {
   const x = wall.x + towardX * o.inset + sideX * across, z = wall.z + towardZ * o.inset + sideZ * across;
   const surface = host.raycast(from.set(x, p.y + o.handHigh, z), to.set(x, p.y + o.handLow, z));
   if (!surface || surface.normal.y < o.flat) return false;
   if (across === 0) topY = surface.point.y;
   else if (Math.abs(surface.point.y - topY) > o.level) return false;
  }
  ledgeY = topY;
  // Her hands keep easing off the last ledge she held until this one is really caught.
  const heldX = anchor.x, heldY = anchor.y, heldZ = anchor.z, faced = facing;
  hold(wall.x, wall.z, towardX, towardZ);
  round.share = 1;
  if (room()) return true;
  anchor.set(heldX, heldY, heldZ);
  facing = faced;
  return false;
 }
 // Standing at an edge and facing out over it: the ledge under her feet, if she could hang from it. Fills `found`
 // with a point of the wall under the edge, the height of its top and the way into that wall.
 function edge() {
  if (state !== 'free' || !controller.grounded) return false;
  const {position: p, heading} = controller, outX = Math.sin(heading), outZ = Math.cos(heading);
  const x = p.x + outX * o.edgeReach, z = p.z + outZ * o.edgeReach;
  // Nothing to stand on out there, down to where her feet would hang.
  if (!clear(from.set(x, p.y + o.shimmyFace, z), to.set(x, p.y - o.hangDrop - o.level, z))) return false;
  // The wall under the edge, from out there back toward her.
  const face = host.raycast(from.set(x, p.y - o.shimmyFace, z), to.set(p.x, p.y - o.shimmyFace, p.z));
  if (!face || face.distance < o.touching || face.normal.x * outX + face.normal.z * outZ < o.edgeFacing) return false;
  const length = Math.hypot(face.normal.x, face.normal.z);
  found.intoX = -face.normal.x / length; found.intoZ = -face.normal.z / length;
  found.x = face.point.x; found.z = face.point.z;
  const surface = host.raycast(from.set(found.x + found.intoX * o.inset, p.y + o.shimmyFace, found.z + found.intoZ * o.inset), to.set(found.x + found.intoX * o.inset, p.y - o.shimmyFace, found.z + found.intoZ * o.inset));
  if (!surface || surface.normal.y < o.flat) return false;
  found.y = surface.point.y;
  return true;
 }
 return {
  get state() { return state; },
  // Whether she stands at an edge she could lower herself from (for a host that offers it).
  canLower: edge,
  // Lowers her from the edge she stands at into a hang: the climb taken backward. False when she cannot.
  lower() {
   if (!edge()) return false;
   const heldX = anchor.x, heldY = anchor.y, heldZ = anchor.z, faced = facing, height = ledgeY;
   ledgeY = found.y;
   hold(found.x, found.z, found.intoX, found.intoZ);
   round.share = 1;
   if (!room()) { anchor.set(heldX, heldY, heldZ); facing = faced; ledgeY = height; return false; }
   lowerFrom.copy(controller.position);
   lowerSwing = Math.atan2(Math.sin(controller.heading - facing), Math.cos(controller.heading - facing));
   lowering = true; caught = true; locked = true;
   elapsed = o.climbSeconds;
   state = 'climb';
   return true;
  },
  // Where her hands hold, on the edge of the last ledge she caught (null before the first). It stays after she lets
  // go, so her arms can ease off it instead of snapping away.
  get anchor() { return caught ? anchor : null; },
  get facing() { return facing; },                              // the way she faces while she hangs (rad)
  get shimmying() { return shimmying; },                        // 1 while she moves to her left along the ledge, -1 to her right, else 0
  get shimmySpeed() { return o.shimmySpeed; },
  get pull() { return elapsed / o.climbSeconds; },
  reset() { state = 'free'; elapsed = shimmying = 0; locked = false; launched = caught = lowering = false; round.share = 1; },
  // shimmy: 1 to move to her left along the ledge, -1 to her right, 0 to hold still.
  update(dt, {jump, climb, drop, shimmy = 0}, move) {
   if (state === 'hang') {
    shimmying = 0;
    // Half way round a corner she goes on round it: she cannot drop or climb from there.
    if (round.share < 1) { turnCorner(dt); shimmying = round.way; }
    else if (drop) { state = 'free'; locked = true; }
    else if (climb) { if (room()) { state = 'climb'; elapsed = 0; } }   // she may have moved under something since she caught it
    else if (shimmy && (slide(Math.sign(shimmy), dt) || corner(Math.sign(shimmy)))) shimmying = Math.sign(shimmy);
    return;
   }
   if (state === 'climb' && lowering) {
    // The climb backward: she turns to the wall where she stood, then goes out over the edge and down it.
    elapsed = Math.max(0, elapsed - dt);
    const share = elapsed / o.climbSeconds, wallFacing = Math.atan2(towardX, towardZ);
    facing = wallFacing + lowerSwing * smooth(Math.max(0, (share - o.climbUp) / (1 - o.climbUp)));
    place(climbPoint(hang, lowerFrom, share, o.climbUp, probe));
    if (elapsed === 0) { lowering = false; facing = wallFacing; state = 'hang'; }
    return;
   }
   if (state === 'climb') {
    // Up the wall first, then in over the top.
    elapsed = Math.min(o.climbSeconds, elapsed + dt);
    place(climbPoint(hang, top, elapsed / o.climbSeconds, o.climbUp, probe));
    if (elapsed === o.climbSeconds) state = 'free';
    return;
   }
   move(jump);
   if (controller.grounded) { locked = false; launched = false; }
   if (controller.jumped) launched = true;
   if (!launched || locked || controller.grounded || controller.velocity.y >= 0 || !find()) return;
   place(hang);
   elapsed = 0;
   caught = true;
   state = 'hang';
  },
 };
}
