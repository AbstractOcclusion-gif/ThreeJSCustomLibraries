// What the valley does when the car or the bot touches it, wired the way the Crater demo wires its event: the vehicle
// and character tools say what happened ('vehicle:track', 'character:track', 'character:land'), and each line here
// hands that to the tool that owns the reaction. The terrain page's impacts tool digs the rut and stamps the track on
// the play area (and keeps rock clean), its footstep tool prints the feet, the grass tool lays its blades along the
// sweep, the particles tool throws the surface's own chips from the ruts (mud, sand or snow) and dust on dry ground, and where the tools report water the
// river ripples and splashes. A hard landing digs a crater: the terrain's craterFromImpact shapes it from the body that
// fell, its field digs it, and the field's 'terrain:crater' event throws the kit's shards and dust, clears the grass
// and tells the host its ground changed. No reaction is computed here.
import * as THREE from 'three';
import {craterFromImpact, FOOTSTEP_DEFAULTS, stampFootstepTrail, TERRAIN_LAYERS} from '../../src/terrain/index.js';
import {CONTACT_SURFACES, TRACK_RADIUS} from '../../src/terrain/physics.js';

export const REACTIONS = Object.freeze({
 grassReach: .35,       // m beyond a tyre or a foot within which the grass is pushed over
 wetFrom: .45,          // ground wetness from which wheels throw clods instead of dust
 // Thrown by a wheel: from this speed (m/s), one burst every `every` track events of that wheel.
 dust: {fromSpeed: 5, every: 3, size: [.5, 1.4], fullSpeed: 20},          // puff size (m) from fromSpeed to fullSpeed
 // Clods out of the ruts: `chips` a burst on wet ground, `dryChips` on dry. back: share of the car's speed, thrown rearward; up m/s.
 clods: {fromSpeed: 4, every: 2, chips: 4, dryChips: 2, size: .7, shockPerSpeed: 1.2, back: .35, up: 2.2},
 // In water. reach: m of water over a contact beyond which the surface is no longer disturbed. Ripples: one every
 // `every` events, full strength at fullSpeed m/s, never under `least`, times rippleGain (both as the All tools demo's boulder). A splash is thrown on entering the water above
 // entrySpeed m/s (and by a landing), full strength at fullSplash m/s, never under leastSplash; radius m for a wheel
 // and for a foot.
 water: {reach: 1.6, every: 2, fullSpeed: 8, least: .35, rippleGain: 1.4, entrySpeed: 2, fullSplash: 12, leastSplash: .2, wheelRadius: .9, footRadius: .25},
 // A landing from this speed (m/s) digs a crater, one per body every `cooldown` s. walkerMass: kg of the bot.
 crater: {fromSpeed: 6, cooldown: .8, walkerMass: 80},
});
const ROCK_LAYER = TERRAIN_LAYERS.indexOf('rock'), MS = 1000;

// play: the terrain page's play area tool. dressing: the World demo's dressing (its sweep hook). chips, puffs: the
// particles tool. wetness(): 0..1 of the ground. velocity(): the car's velocity {x, y, z}. river (optional, when the
// host has reactive water): {ripples, splash(x, z, strength, radius)}.
// car(): the car as it lands, {x, z, mass, footprint (craterFootprint's shape)}. walkerRadius: m of the bot's footprint.
// craterEffects: the kit's (createCraterEffects). onGroundChange(): the ground was dug deep enough to matter to physics.
export function connectReactions({vehicle, controller, play, dressing, chips, puffs, wetness, velocity, river, car, walkerRadius, craterEffects, onGroundChange}) {
 const point = new THREE.Vector3(), thrown = new THREE.Vector3(), counts = new Map(), wading = new Set();
 const {water, crater} = REACTIONS, dug = new Map(), share = (speed, full, least) => THREE.MathUtils.clamp(speed / full, least, 1);
 // Something touched the water: ripples as it moves, a splash as it enters fast or lands. Returns whether it is in water.
 function wade(key, {x, z}, depth, speed, radius, landed = false) {
  if (!(depth > 0)) { wading.delete(key); return false; }
  if (!river || depth > water.reach) return true;
  const entering = !wading.has(key), count = (counts.get(key) ?? 0) + 1;
  wading.add(key);
  counts.set(key, count);
  if (landed || (entering && speed > water.entrySpeed)) river.splash(x, z, share(speed, water.fullSplash, water.leastSplash), radius);
  if (entering || count % water.every === 0) river.ripples.splash(x, z, Math.min(1, water.rippleGain * share(speed, water.fullSpeed, water.least)));
  return true;
 }
 // The laid play area, when the point lies on it.
 const areaAt = ({x, z}) => {
  const area = play.area;
  watch(area);
  return area && x >= area.origin[0] && x <= area.origin[0] + area.size && z >= area.origin[1] && z <= area.origin[1] + area.size ? area : null;
 };
 // A body landed hard on the area: its crater. Returns whether the landing is dealt with (dug now, or just before).
 function dig(area, key, {x, z, mass, footprint}, down, {x: vx = 0, z: vz = 0} = {}) {
  const now = performance.now() / MS;
  if (now - (dug.get(key) ?? -Infinity) < crater.cooldown) return true;
  const impact = craterFromImpact({footprint, mass, velocity: [vx, -down, vz]});
  if (!impact || !area.field.crater(x, z, impact.shape, impact.depth, area.impacts.onHeightSample, {travel: impact.travel, hardness: area.field.layerWeightAt(x, z, ROCK_LAYER)})) return false;
  dug.set(key, now);
  return true;
 }
 // What a crater of the area does around it.
 let watched, stopWatching;
 function watch(area) {
  if (area === watched) return;
  stopWatching?.();
  watched = area;
  stopWatching = area?.field.subscribe(event => {
   const y = event.height ?? area.field.heightAt(event.x, event.z);
   craterEffects.throwShards(event, y);
   craterEffects.throwDust(event, y);
   dressing.clearGrass(event.x, event.z, event.reach);
   onGroundChange?.(event);
  });
 }
 const sweep = (from, to, radius) => dressing.sweep({fromX: from.x, fromZ: from.z, toX: to.x, toZ: to.z, radius});

 const unsubscribe = [
  vehicle.subscribe(event => {
   sweep(event.from, event.to, event.width / 2 + REACTIONS.grassReach);
   const area = areaAt(event.to);
   if (wade(event.wheel, event.to, event.water, event.landed ? Math.max(event.speed, event.impact) : event.speed, water.wheelRadius, event.landed)) { area?.impacts.lift(event.wheel); return; }
   if (area && event.landed && event.impact >= crater.fromSpeed && dig(area, 'car', car(), event.impact, velocity())) return;
   // A softer landing leaves the rut it rolls: the tool's impact mark is its test ball's, far too deep for a wheel.
   area?.impacts.press(event.wheel, event.to, {scale: event.width / 2 / TRACK_RADIUS.sphere, velocity: velocity()});
   if (area && !area.impacts.takesMarks(event.to.x, event.to.z)) return;
   const count = (counts.get(event.wheel) ?? 0) + 1, wet = wetness() >= REACTIONS.wetFrom, {clods, dust} = REACTIONS;
   counts.set(event.wheel, count);
   point.set(event.to.x, event.to.y, event.to.z);
   if (event.speed >= clods.fromSpeed && count % clods.every === 0) {
    const {x, y, z} = velocity();
    // What is thrown is the surface's own chip (the impacts tool's: its colour, its size, whether it bounces, sticks or rolls).
    chips.emit(point, {size: clods.size, ...(area ? area.impacts.chipAt(point.x, point.z) : CONTACT_SURFACES.mud.chip), chips: wet ? clods.chips : clods.dryChips}, event.speed * clods.shockPerSpeed, thrown.set(-x * clods.back, y + clods.up, -z * clods.back));
   }
   if (!wet && event.speed >= dust.fromSpeed && count % dust.every === 0) puffs.dust(point, THREE.MathUtils.mapLinear(Math.min(event.speed, dust.fullSpeed), dust.fromSpeed, dust.fullSpeed, ...dust.size));
  }),
  controller.subscribe(event => {
   if (event.type === 'character:jump') return;
   wade('walker', event.to ?? event, event.water, event.speed, water.footRadius, event.type === 'character:land');
   const area = areaAt(event.to ?? event), marks = area && !(event.water > 0) && area.impacts.takesMarks((event.to ?? event).x, (event.to ?? event).z);
   if (event.type === 'character:land') {
    if (marks && event.speed >= crater.fromSpeed && dig(area, 'walker', {x: event.x, z: event.z, mass: crater.walkerMass, footprint: walkerRadius}, event.speed)) return;
    if (marks) area.impacts.press('walker', event, {scale: FOOTSTEP_DEFAULTS.toeRadius / TRACK_RADIUS.sphere});
    return;
   }
   sweep(event.from, event.to, FOOTSTEP_DEFAULTS.toeRadius + REACTIONS.grassReach);
   if (marks) stampFootstepTrail({field: area.field, tracks: area.tracks, from: event.from, to: event.to, onSample: area.impacts.onHeightSample});
  }),
 ];
 return {dispose() { for (const stop of unsubscribe) stop(); stopWatching?.(); counts.clear(); wading.clear(); dug.clear(); }};
}
