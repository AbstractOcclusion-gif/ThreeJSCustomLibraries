import * as C from 'cannon-es';
import {Vector3} from 'three';
import {createCable, createThreeCableView} from '../../cable/index.js';

// Ropes she can catch in the air and hang from. Each one is the library's cable (src/cable), hung from a fixed point with
// a small weight at its end, in a physics world of its own: the cable runs on cannon-es, she runs on Jolt. While she
// holds a rope it carries her and she weighs nothing to it (its links are light: a real load stretches them); catching
// it, she sets it swinging with her speed. Lengths in m, masses in kg, rates in 1/s.
export const ROPE_DEFAULTS = Object.freeze({
 segments: 16,        // links per rope
 slack: 1.01,         // rope length as a share of the drop from its fixing to its weight
 weight: 1,           // the weight at its end, which keeps it hanging straight
 radius: .016,        // how thick it is drawn
 climbSpeed: .55,     // m/s she climbs up or down it
 pump: 2.6,           // m/s2 she adds to its swing, where she holds it, while she works it
 pumpFrom: .25,       // m/s it has to be moving for her to push with it; slower, she starts it forward
 turnSpeed: 1.8,      // rad/s she turns about the rope
 mostLean: .5,        // rad off the vertical past which she stops pushing
 leap: 2,             // m/s upward she adds as she lets go
 carry: .8,           // share of her speed the rope takes on when she catches it
 iterations: 32,      // solver passes per step
 hands: 1.52,         // how far above her feet she holds it, between her two hands ...
 gap: .12,            // ... with the rope this far ahead of the middle of her body ...
 aside: 0,            // ... and this far to her left: see fit()
 reach: .5,           // she catches a rope passing this close to her chest
 fromTop: 1,          // she holds it no nearer its fixing than this ...
 fromEnd: .2,         // ... and no nearer its end as she catches it;
 footRoom: .1,        // then she pulls herself up until her feet are this far above its end
 settleSpeed: 1.1,    // m/s she does that at
 lean: .9,            // her body lines up with this much of the rope above her hands
 leanRate: 10,        // how fast it does
 relock: .6,          // s after letting go before she can catch a rope again
});

export function createRopeAction({controller, scene, gravity, ropes, ...options}) {
 const unknown = Object.keys(options).filter(key => !(key in ROPE_DEFAULTS));
 if (unknown.length) throw Error('Unknown rope option: ' + unknown.join(', '));
 const o = {...ROPE_DEFAULTS, ...options};
 const world = new C.World({gravity: new C.Vec3(0, -gravity, 0)});
 world.solver.iterations = o.iterations;
 // ropes: [{top: [x, y, z] (its fixing), drop: m down to its weight}]
 const made = ropes.map(({top, drop}) => {
  const weight = new C.Body({mass: o.weight, shape: new C.Sphere(.06), position: new C.Vec3(top[0], top[1] - drop, top[2]), linearDamping: .1, collisionFilterGroup: 4, collisionFilterMask: 0});
  world.addBody(weight);
  const cable = createCable({world, endpoints: [{kind: 'fixed', position: top}, {kind: 'body', body: weight, localPoint: [0, 0, 0]}],
   length: drop * o.slack, segments: o.segments, preset: 'rope', breakStrength: 1e6});
  cable.setFracture(false);
  let state = cable.snapshot();
  const unsubscribe = cable.subscribe(() => { state = cable.snapshot(); });
  const view = createThreeCableView({scene, cable: {links: cable.links, profile: {...cable.profile, radius: o.radius}, get sections() { return state.sections; }}});
  return {top: new Vector3(...top), weight, cable, view, unsubscribe};
 });
 const point = new Vector3(), above = new Vector3(), hold = new Vector3(), feet = new Vector3(), wanted = new Vector3();
 const before = new Vector3(), speed = new Vector3();
 const up = new Vector3(0, 1, 0), line = {point: new Vector3(), way: new Vector3(0, 1, 0)};
 let state = 'free', held = null, along = 0, facing = 0, lock = 0, released = true, climbing = 0;
 // The point `s` m down a rope from its fixing: along the line through its fixing, the middles of its links and its weight.
 function at(rope, s, out) {
  let from = rope.top, fromArc = 0, start = 0;
  for (const {body, length} of rope.cable.links) {
   const arc = start + length / 2;
   if (s <= arc) return out.copy(from).lerp(body.position, Math.max(0, (s - fromArc) / (arc - fromArc)));
   from = body.position; fromArc = arc; start += length;
  }
  return out.copy(from).lerp(rope.weight.position, Math.min(1, (s - fromArc) / (start - fromArc)));
 }
 // How far down a rope the height y is, or NaN where it does not hang through that height.
 function atHeight(rope, y) {
  let low = 0, high = rope.cable.length;
  if (at(rope, high, point).y > y || rope.top.y < y) return NaN;
  for (let i = 0; i < 18; i++) { const mid = (low + high) / 2; if (at(rope, mid, point).y > y) low = mid; else high = mid; }
  return (low + high) / 2;
 }
 function place(dt) {
  before.copy(hold);
  at(held, along, hold);
  // How fast the rope carries her, for when she lets go.
  if (dt > 0) speed.subVectors(hold, before).divideScalar(dt); else speed.set(0, 0, 0);
  at(held, Math.max(0, along - o.lean), above).sub(hold);
  if (above.lengthSq() > 1e-6) wanted.copy(above).normalize(); else wanted.set(0, 1, 0);
  up.lerp(wanted, dt > 0 ? 1 - Math.exp(-dt * o.leanRate) : 1).normalize();
  feet.copy(hold).addScaledVector(up, -o.hands);
  // Her left is (cos, -sin) of the way she faces on X/Z.
  feet.x -= Math.sin(facing) * o.gap + Math.cos(facing) * o.aside; feet.z -= Math.cos(facing) * o.gap - Math.sin(facing) * o.aside;
  controller.teleport(feet.x, feet.y, feet.z, facing);
  line.point.copy(hold).sub(feet);
  line.way.copy(wanted);
 }
 function letGo() {
  held = null;
  climbing = 0;
  state = 'free';
 }
 return {
  get state() { return state; },               // 'rope' while she holds one, else 'free'
  get facing() { return facing; },
  get up() { return up; },                     // the way her body points while she holds on: along the rope
  get line() { return line; },                 // the rope where she holds it: a point on it, from her feet, and the way it runs up (world axes)
  get climbing() { return climbing; },         // 1 while she climbs up it, -1 down, else 0
  get climbSpeed() { return o.climbSpeed; },
  anchor: null, shimmying: 0, shimmySpeed: 0, pull: 0,   // what a ledge has and a rope has not
  ropes: made,
  // Where her climbing pose has the rope, from her feet (m): she is carried so that it runs through her hands.
  fit({height, ahead, aside}) { o.hands = height; o.gap = ahead; o.aside = aside; },
  reset() { letGo(); lock = 0; released = true; up.set(0, 1, 0); },
  // Steps the ropes; jump: whether the jump control is held (a new press lets go, at the speed the rope has her going);
  // climb: 1 to go up the rope, -1 down; swing: whether she works the swing, the way she faces and back, with
  // push: 1 to push it forward, -1 back, 0 to push the way it already goes; turn: 1 to turn to her left about the
  // rope, -1 to her right.
  // True while she holds a rope: she is placed on it and nothing else may move her.
  update(dt, {jump = false, climb = 0, swing = false, push = 0, turn = 0} = {}) {
   if (state === 'rope') facing += Math.sign(turn) * o.turnSpeed * dt;
   if (state === 'rope' && swing && Math.acos(Math.min(1, up.y)) < o.mostLean) {
    // She pushes the way she is told, or the way it already goes, as on a swing: most where she holds it and below, less toward its fixing.
    const sin = Math.sin(facing), cos = Math.cos(facing), going = speed.x * sin + speed.z * cos;
    const kick = (push ? Math.sign(push) : Math.abs(going) < o.pumpFrom ? 1 : Math.sign(going)) * o.pump * dt;
    let arc = 0;
    for (const {body, length} of held.cable.links) {
     const share = kick * Math.min(1, (arc + length / 2) / along);
     body.velocity.x += sin * share; body.velocity.z += cos * share;
     body.wakeUp();
     arc += length;
    }
    held.weight.velocity.x += sin * kick; held.weight.velocity.z += cos * kick;
   }
   for (const {cable} of made) cable.beforeStep(dt);
   world.step(dt);
   for (const {cable} of made) cable.afterStep(dt);
   lock = controller.grounded ? 0 : Math.max(0, lock - dt);
   if (state !== 'rope') return false;
   if (jump && released) {
    letGo(); lock = o.relock; released = false;
    controller.launch(speed.x, speed.y + o.leap, speed.z);
    return false;
   }
   released ||= !jump;
   // Up to `fromTop` under its fixing, down to where her feet are just above its end.
   const lowest = held.cable.length - o.hands - o.footRoom;
   const to = along > lowest ? Math.max(lowest, along - o.settleSpeed * dt) : Math.min(lowest, Math.max(o.fromTop, along - Math.sign(climb) * o.climbSpeed * dt));
   climbing = to === along ? 0 : Math.sign(along - to);
   along = to;
   place(dt);
   return true;
  },
  // Free and in the air: a rope passing her chest is caught.
  tryCatch() {
   if (state === 'rope' || lock > 0 || controller.grounded) return false;
   const {position: p, velocity: v} = controller;
   for (const rope of made) {
    const s = atHeight(rope, p.y + o.hands);
    if (!(s >= o.fromTop && s <= rope.cable.length - o.fromEnd)) continue;
    at(rope, s, hold);
    const dx = hold.x - p.x, dz = hold.z - p.z, distance = Math.hypot(dx, dz);
    if (distance > o.reach) continue;
    held = rope; along = s; state = 'rope'; released = false;
    facing = distance > .05 ? Math.atan2(dx, dz) : controller.heading;
    // She sets it swinging: it takes `carry` of her speed where she holds it and below, less and less toward its fixing.
    let arc = 0;
    for (const {body, length} of rope.cable.links) {
     const share = o.carry * Math.min(1, (arc + length / 2) / s);
     body.velocity.x += v.x * share; body.velocity.z += v.z * share;
     body.wakeUp();
     arc += length;
    }
    rope.weight.velocity.x += v.x * o.carry; rope.weight.velocity.z += v.z * o.carry;
    up.set(0, 1, 0);
    place(0);
    return true;
   }
   return false;
  },
  draw(camera) { for (const {view} of made) view.update(camera); },
  dispose() {
   for (const {cable, view, unsubscribe, weight} of made) { unsubscribe(); view.dispose(); cable.dispose(); world.removeBody(weight); }
  },
 };
}
