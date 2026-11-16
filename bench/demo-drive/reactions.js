// What the valley does when the car or the bot touches it, wired the way the Crater demo wires its event: the vehicle
// and character tools say what happened ('vehicle:track', 'character:track', 'character:land'), and each line here
// hands that to the tool that owns the reaction. The terrain page's impacts tool digs the rut and stamps the track on
// the play area (and keeps rock clean), its footstep tool prints the feet, the grass tool lays its blades along the
// sweep, the particles tool throws dust on dry ground and clods on wet, and where the tools report water the river
// ripples and splashes. No reaction is computed here.
import * as THREE from 'three';
import {stampFootstepTrail, FOOTSTEP_DEFAULTS} from '../terrain/footsteps.js';
import {CONTACT_SURFACES, TRACK_RADIUS} from '../terrain/impacts.js';

export const REACTIONS = Object.freeze({
 grassReach: .35,       // m beyond a tyre or a foot within which the grass is pushed over
 wetFrom: .45,          // ground wetness from which wheels throw clods instead of dust
 // Thrown by a wheel: from this speed (m/s), one burst every `every` track events of that wheel.
 dust: {fromSpeed: 5, every: 3, size: [.5, 1.4], fullSpeed: 20},          // puff size (m) from fromSpeed to fullSpeed
 clods: {fromSpeed: 4, every: 2, chips: 3, size: .7, shockPerSpeed: 1.2, back: .35, up: 2.2},   // back: share of the car's speed, thrown rearward; up m/s
 // In water. reach: m of water over a contact beyond which the surface is no longer disturbed. Ripples: one every
 // `every` events, full strength at fullSpeed m/s, never under `least`. A splash is thrown on entering the water above
 // entrySpeed m/s (and by a landing), full strength at fullSplash m/s, never under leastSplash; radius m for a wheel
 // and for a foot.
 water: {reach: 1.6, every: 2, fullSpeed: 8, least: .15, entrySpeed: 2, fullSplash: 12, leastSplash: .2, wheelRadius: .9, footRadius: .25},
});

// play: the terrain page's play area tool. dressing: the World demo's dressing (its sweep hook). chips, puffs: the
// particles tool. wetness(): 0..1 of the ground. velocity(): the car's velocity {x, y, z}. river (optional, when the
// host has reactive water): {ripples, splash(x, z, strength, radius)}.
export function connectReactions({vehicle, controller, play, dressing, chips, puffs, wetness, velocity, river}) {
 const point = new THREE.Vector3(), thrown = new THREE.Vector3(), counts = new Map(), wading = new Set();
 const {water} = REACTIONS, share = (speed, full, least) => THREE.MathUtils.clamp(speed / full, least, 1);
 // Something touched the water: ripples as it moves, a splash as it enters fast or lands. Returns whether it is in water.
 function wade(key, {x, z}, depth, speed, radius, landed = false) {
  if (!(depth > 0)) { wading.delete(key); return false; }
  if (!river || depth > water.reach) return true;
  const entering = !wading.has(key), count = (counts.get(key) ?? 0) + 1;
  wading.add(key);
  counts.set(key, count);
  if (landed || (entering && speed > water.entrySpeed)) river.splash(x, z, share(speed, water.fullSplash, water.leastSplash), radius);
  if (entering || count % water.every === 0) river.ripples.splash(x, z, share(speed, water.fullSpeed, water.least));
  return true;
 }
 // The laid play area, when the point lies on it.
 const areaAt = ({x, z}) => {
  const area = play.area;
  return area && x >= area.origin[0] && x <= area.origin[0] + area.size && z >= area.origin[1] && z <= area.origin[1] + area.size ? area : null;
 };
 const sweep = (from, to, radius) => dressing.sweep({fromX: from.x, fromZ: from.z, toX: to.x, toZ: to.z, radius});

 const unsubscribe = [
  vehicle.subscribe(event => {
   sweep(event.from, event.to, event.width / 2 + REACTIONS.grassReach);
   const area = areaAt(event.to);
   if (wade(event.wheel, event.to, event.water, event.landed ? Math.max(event.speed, event.impact) : event.speed, water.wheelRadius, event.landed)) { area?.impacts.lift(event.wheel); return; }
   area?.impacts.press(event.wheel, event.to, {scale: event.width / 2 / TRACK_RADIUS.sphere, speedChange: event.impact, velocity: velocity()});
   if (area && !area.impacts.takesMarks(event.to.x, event.to.z)) return;
   const count = (counts.get(event.wheel) ?? 0) + 1, wet = wetness() >= REACTIONS.wetFrom, burst = wet ? REACTIONS.clods : REACTIONS.dust;
   counts.set(event.wheel, count);
   if (event.speed < burst.fromSpeed || count % burst.every) return;
   point.set(event.to.x, event.to.y, event.to.z);
   if (wet) {
    const {x, y, z} = velocity();
    chips.emit(point, {...CONTACT_SURFACES.mud.chip, chips: burst.chips, size: burst.size}, event.speed * burst.shockPerSpeed, thrown.set(-x * burst.back, y + burst.up, -z * burst.back));
   } else puffs.dust(point, THREE.MathUtils.mapLinear(Math.min(event.speed, burst.fullSpeed), burst.fromSpeed, burst.fullSpeed, ...burst.size));
  }),
  controller.subscribe(event => {
   if (event.type === 'character:jump') return;
   wade('walker', event.to ?? event, event.water, event.speed, water.footRadius, event.type === 'character:land');
   const area = areaAt(event.to ?? event), marks = area && !(event.water > 0) && area.impacts.takesMarks((event.to ?? event).x, (event.to ?? event).z);
   if (event.type === 'character:land') {
    if (marks) area.impacts.press('walker', event, {scale: FOOTSTEP_DEFAULTS.toeRadius / TRACK_RADIUS.sphere, speedChange: event.speed});
    return;
   }
   sweep(event.from, event.to, FOOTSTEP_DEFAULTS.toeRadius + REACTIONS.grassReach);
   if (marks) stampFootstepTrail({field: area.field, tracks: area.tracks, from: event.from, to: event.to, onSample: area.impacts.onHeightSample});
  }),
 ];
 return {dispose() { for (const stop of unsubscribe) stop(); counts.clear(); wading.clear(); }};
}
