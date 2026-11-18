import {Vector3} from 'three';
import {LEDGE_DEFAULTS, climbPoint} from './ledge.js';

// Ladders. She takes one by walking into it, or by jumping onto it in the air; on it she goes up and down, lets go
// with a jump, steps off at its foot and, at its top, climbs onto what it leans against with the ledge's own climb.
// While she holds it she is carried: the controller is not stepped. Lengths in m, speeds in m/s.
export const LADDER_DEFAULTS = Object.freeze({
 climbSpeed: .7,      // how fast she goes up or down it
 halfWidth: .35,      // she takes it within this far of its middle ...
 reach: .65,          // ... no farther ahead of her than this (her capsule stops against it a little nearer) ...
 facing: .6,          // ... facing it at least this much (cosine between the way she faces and the way into it) ...
 push: .5,            // ... and, on the ground, asking to move into it at least this much (share of a full move)
 below: .05,          // her feet may be this far under its foot
 ahead: .4,           // how far her feet stand off the ladder while she holds it ...
 aside: 0,            // ... and how far to her left it is: see fit()
 hands: 1.5,          // how far above her feet she holds it: in the air she takes it while her hands are under its top
 leapBack: 2.2,       // speed away from it as she jumps off ...
 leapUp: 2,           // ... and upward
 relock: .5,          // s after letting go before she can take a ladder again
 // Leaving at the top is the ledge's climb, from the same hang.
 hangDrop: LEDGE_DEFAULTS.hangDrop, climbSeconds: LEDGE_DEFAULTS.climbSeconds, climbUp: LEDGE_DEFAULTS.climbUp,
 topRise: LEDGE_DEFAULTS.topRise, topIn: LEDGE_DEFAULTS.topIn,
});

// controller: the character controller. radius: her capsule's. ladders: [{base: [x, y, z] (the foot of the ladder, in
// its middle), heading (rad: the way she faces while on it), height (m up to the top she climbs onto), standoff (m
// from the ladder to the wall behind it)}].
export function createLadderAction({controller, radius, ladders, ...options}) {
 const unknown = Object.keys(options).filter(key => !(key in LADDER_DEFAULTS));
 if (unknown.length) throw Error('Unknown ladder option: ' + unknown.join(', '));
 const o = {...LADDER_DEFAULTS, ...options};
 const made = ladders.map(({base: [x, y, z], heading, height, standoff}) => ({x, y, z, heading, top: y + height, standoff, intoX: Math.sin(heading), intoZ: Math.cos(heading)}));
 const point = new Vector3(), hang = new Vector3(), top = new Vector3(), anchor = new Vector3();
 let state = 'free', held = null, feet = 0, lock = 0, released = true, climbing = 0, elapsed = 0, climbed = false;
 // Where she stands off the ladder she holds, with her feet at the height `feet`.
 function place() {
  const {x, z, intoX, intoZ, heading} = held;
  // Her left is (cos, -sin) of the way she faces on X/Z.
  controller.teleport(x - intoX * o.ahead - intoZ * o.aside, feet, z - intoZ * o.ahead + intoX * o.aside, heading);
 }
 function letGo() { state = 'free'; held = null; climbing = 0; }
 return {
  get state() { return state; },                 // 'ladder' while she holds one, 'climb' while she leaves it at the top, else 'free'
  get facing() { return held ? held.heading : controller.heading; },
  get climbing() { return climbing; },           // 1 while she goes up it, -1 down, else 0
  get rise() { return held ? feet - held.y : 0; },   // how high her feet are above its foot (m)
  get plane() { return held; },                  // the ladder she holds: a point of it (x, z) and the way into it (intoX, intoZ)
  get climbSpeed() { return o.climbSpeed; },
  get pull() { return state === 'climb' ? elapsed / o.climbSeconds : 0; },
  // Where her hands hold the edge as she climbs off the top (null before the first time), as a ledge has it.
  get anchor() { return climbed ? anchor : null; },
  shimmying: 0, shimmySpeed: 0,                  // what a ledge has and a ladder has not
  // Where her climbing pose has the ladder, from her feet (m): she is carried so that it runs through her hands.
  fit({height, ahead, aside}) { o.hands = height; o.ahead = ahead; o.aside = aside; },
  reset() { letGo(); lock = 0; released = true; climbed = false; },
  // Free: takes a ladder she walks into or jumps onto. moveX, moveZ: the move asked, in the world.
  tryMount(moveX, moveZ) {
   if (state !== 'free' || lock > 0) return false;
   const {position: p, heading, grounded} = controller;
   for (const ladder of made) {
    const {intoX, intoZ} = ladder, dx = ladder.x - p.x, dz = ladder.z - p.z;
    const ahead = dx * intoX + dz * intoZ, aside = dx * intoZ - dz * intoX;
    if (Math.abs(aside) > o.halfWidth || ahead < 0 || ahead > o.reach) continue;
    if (Math.sin(heading) * intoX + Math.cos(heading) * intoZ < o.facing) continue;
    if (grounded && moveX * intoX + moveZ * intoZ < o.push) continue;
    if (p.y < ladder.y - o.below || p.y + o.hands > ladder.top) continue;
    held = ladder; feet = Math.max(p.y, ladder.y); state = 'ladder'; released = false; climbing = 0;
    place();
    return true;
   }
   return false;
  },
  // jump: whether the jump control is held (a new press lets go, away from the ladder). climb: 1 to go up, -1 down.
  // True while she holds a ladder or climbs off its top: she is placed and nothing else may move her.
  update(dt, {jump = false, climb = 0} = {}) {
   if (state === 'free') { lock = controller.grounded ? 0 : Math.max(0, lock - dt); return false; }
   if (state === 'climb') {
    elapsed = Math.min(o.climbSeconds, elapsed + dt);
    climbPoint(hang, top, elapsed / o.climbSeconds, o.climbUp, point);
    controller.teleport(point.x, point.y, point.z, held.heading);
    if (elapsed === o.climbSeconds) letGo();
    return true;
   }
   if (jump && released) {
    const {intoX, intoZ} = held;
    letGo(); lock = o.relock; released = false;
    controller.launch(-intoX * o.leapBack, o.leapUp, -intoZ * o.leapBack);
    return false;
   }
   released ||= !jump;
   // From its foot up to where her feet hang as far under its top as under a ledge.
   const highest = held.top - o.hangDrop, way = Math.sign(climb);
   const to = Math.min(highest, Math.max(held.y, feet + way * o.climbSpeed * dt));
   climbing = Math.sign(to - feet);
   feet = to;
   place();
   // At its foot, going down: she stands there and lets go.
   if (way < 0 && feet === held.y) { letGo(); return false; }
   if (way > 0 && feet === highest) {
    const {x, z, intoX, intoZ, standoff} = held;
    hang.copy(controller.position);
    top.set(x + intoX * (standoff + radius + o.topIn), held.top + o.topRise, z + intoZ * (standoff + radius + o.topIn));
    anchor.set(x + intoX * standoff, held.top, z + intoZ * standoff);
    elapsed = 0; climbing = 0; climbed = true; state = 'climb';
   }
   return true;
  },
 };
}
