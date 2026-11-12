import * as THREE from 'three';
import {Body, Box, Material, Sphere, Vec3, World} from 'cannon-es';
import {createTerrainCollider} from './heightfield.js';

const STEP = 1 / 120;
// Per ground type: print and impact are the dig depths in metres of a rolling contact and of a hard landing.
// On lying snow, load and impactLoad replace them: the share of the packable snow depth pressed out (field.compactSnow).
export const CONTACT_SURFACES = Object.freeze({
 mud: {print: .06, impact: .29, chip: {color: 0x59412d, bounce: 0, groundMotion: {stick: true}}},
 snow: {print: .12, impact: .45, load: .7, impactLoad: 1, chip: {color: 0xd9e4e9, bounce: .12, groundMotion: {slope: .1, drag: 8, spin: .45}}},
});

// Ground contact: an impact is a speed change over impactSpeed m/s, at most once per cooldown s; rolling prints are stamped
// every printSpacing m and joined to the last print within joinDistance m. Dig radius (m) and print depth share per contact.
const CONTACT = Object.freeze({impactSpeed: 2.7, cooldown: .24, printSpacing: .24, joinDistance: 1.1, rollingStrength: .8,
  radius: {impact: 1.3, box: .85, sphere: .65}, printDepthShare: .36});
// Radius (m) of the mark a body leaves in the track mask. The default is the narrow rut it presses into snow or mud.
export const TRACK_RADIUS = Object.freeze({sphere: .31, box: .39});
// Chips thrown by an impact: count from the dug volume (m^3 x perVolume, at most max), shock from the speed change.
const IMPACT_CHIPS = Object.freeze({max: 26, perVolume: 30, size: 1.2, maxShock: 70, shockPerSpeed: 6});
const MAX_BLOCKS = 8, ICE_BREAK_ENERGY = 1100, ICE_CRACK_RADIUS = 1.8, FALL_OUT_HEIGHT = -12;   // blocks; J; m; m
const MAX_SUBSTEPS = 6;
export function createTerrainImpacts({scene, field, tracks, material, ice, lightOccluders, onIceBreak, chips, surfaces = CONTACT_SURFACES, trackRadius = TRACK_RADIUS}) {
 const world = new World({gravity: new Vec3(0, -9.82, 0), allowSleep: true});
 world.defaultContactMaterial.friction = .52;
 world.defaultContactMaterial.restitution = .12;
 const ground = createTerrainCollider(field);
 const [shape] = ground.shapes;
 world.addBody(ground);
 chips?.setGround(field.heightAt);
 const geometries = {sphere: new THREE.SphereGeometry(.72, 24, 16), box: new THREE.BoxGeometry(1.42, .94, 1.8)};
 const active = new Map(), strongest = new Map();
 const blockMaterial = new Material({friction: 1, restitution: .12});
 ice?.addContactMaterial(world, blockMaterial);
 const fractures = [];
 const axis = new Vec3(), bestAxis = new Vec3(), localAxes = [new Vec3(1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, 1)];
 // The fixed envelope contains soil cuts and the snow layer. Cannon invalidates only the edited pillars.
 const updateSample = (x, z, value) => shape.setHeightValueAtIndex(z, x, value);
 function remove(entry) {
  world.removeBody(entry.body);
  scene.remove(entry.mesh);
  active.delete(entry.body);
  const index = lightOccluders?.indexOf(entry.mesh) ?? -1;
  if (index >= 0) lightOccluders.splice(index, 1);
 }

 function stamp(entry, point, previous, strength) {
  if (entry.kind === 'sphere') {
   tracks.stamp(previous ?? point, point, trackRadius.sphere, strength);
   return;
  }
  // Extend along the longest projected box axis. The stamp follows body orientation.
  const dimensions = [.71, .47, .9];
  let extent = 0;
  localAxes.forEach((basis, i) => {
   entry.body.quaternion.vmult(basis, axis);
   const projected = Math.hypot(axis.x, axis.z) * dimensions[i];
   if (projected > extent) { extent = projected; bestAxis.copy(axis); }
  });
  const angle = Math.atan2(bestAxis.z, bestAxis.x), dx = Math.cos(angle) * extent * .7, dz = Math.sin(angle) * extent * .7;
  tracks.stamp({x: point.x - dx, z: point.z - dz}, {x: point.x + dx, z: point.z + dz}, trackRadius.box, strength);
  if (previous) tracks.stamp(previous, point, trackRadius.box, strength);
 }

 world.addEventListener('postStep', () => {
  strongest.clear();
  for (const contact of world.contacts) {
   const other = contact.bi === ground ? contact.bj : contact.bj === ground ? contact.bi : null;
   const entry = active.get(other);
   if (entry && contact.enabled && contact.multiplier > (strongest.get(entry)?.multiplier ?? 0)) strongest.set(entry, contact);
  }
  for (const entry of active.values()) {
   const contact = strongest.get(entry);
   if (!contact) continue;
   const offset = contact.bi === ground ? contact.ri : contact.rj;
   const point = {x: ground.position.x + offset.x, z: ground.position.z + offset.z};
   const speedChange = contact.multiplier * STEP * entry.body.invMass;
   const impact = speedChange > CONTACT.impactSpeed && world.time - entry.lastImpact > CONTACT.cooldown;
   if (!impact && entry.last && Math.hypot(point.x - entry.last.x, point.z - entry.last.z) < CONTACT.printSpacing) continue;
   const y = field.heightAt(point.x, point.z);
   if (y === undefined) continue;
   const style = surfaces[entry.surface];
   const joined = entry.last && Math.hypot(point.x - entry.last.x, point.z - entry.last.z) < CONTACT.joinDistance;
   stamp(entry, point, joined ? entry.last : null, impact ? 1 : CONTACT.rollingStrength);
   const radius = impact ? CONTACT.radius.impact : entry.kind === 'box' ? CONTACT.radius.box : CONTACT.radius.sphere;
   const volume = style.load !== undefined && field.snowCover.value
    ? field.compactSnow(point.x, point.z, radius, impact ? style.impactLoad : style.load, updateSample)
    : field.deform(point.x, point.z, radius, impact ? style.impact : style.print * CONTACT.printDepthShare, updateSample);
   if (impact) {
    entry.lastImpact = world.time;
    if (volume > 0) chips?.emit(new THREE.Vector3(point.x, y, point.z), {
     ...style.chip, chips: Math.min(IMPACT_CHIPS.max, Math.ceil(volume * IMPACT_CHIPS.perVolume)), size: IMPACT_CHIPS.size,
    }, Math.min(IMPACT_CHIPS.maxShock, speedChange * IMPACT_CHIPS.shockPerSpeed), entry.body.velocity);
   }
   entry.last = point;
  }
 });

 return {
  onHeightSample: updateSample,
  get moving() { return (chips?.active ?? 0) > 0 || [...active.keys()].some(body => body.sleepState !== Body.SLEEPING); },
  setSurface(surface) {
   for (const entry of active.values()) remove(entry);
   chips?.clear();
   return field.setSnowCover(surface === 'snow', updateSample);
  },
  launch(kind, surface, iceDrop) {
   if (active.size >= MAX_BLOCKS) remove(active.values().next().value);
   const rolling = kind === 'sphere';
   const x = iceDrop ? (iceDrop.hard ? -7 : -12) : rolling ? 10 : 7.5;
   const z = iceDrop ? 2 : rolling ? 13.5 : 12.5;
   const y = iceDrop ? iceDrop.level + (iceDrop.hard ? 8 : .65) : field.heightAt(x, z) + (rolling ? .88 : 6);
   const body = new Body({mass: rolling ? 22 : 36, shape: rolling ? new Sphere(.72) : new Box(new Vec3(.71, .47, .9)),
    material: blockMaterial, position: new Vec3(x, y, z),
    velocity: new Vec3(iceDrop ? (iceDrop.hard ? 0 : 3.2) : rolling ? -5.5 : -.9, 0, rolling ? -.75 : 0), angularDamping: .34});
   if (rolling) body.angularVelocity.set(-1, 0, 7.5);
   else body.quaternion.setFromEuler(iceDrop ? 0 : .13, .52, iceDrop ? 0 : .16);
   if (ice) body.addEventListener('collide', ({body: other, contact}) => {
    if (!ice.owns(other) || body.velocity.y >= 0) return;
    const energy = .5 * body.mass * contact.getImpactVelocityAlongNormal() ** 2;
    if (energy > ICE_BREAK_ENERGY) fractures.push({x: body.position.x, z: body.position.z, energy});
   });
   const mesh = new THREE.Mesh(geometries[kind], material);
   mesh.castShadow = mesh.receiveShadow = true;
   mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion);
   scene.add(mesh); world.addBody(body);
   lightOccluders?.push(mesh);
   active.set(body, {body, mesh, kind, surface, last: null, lastImpact: -Infinity});
  },
  update(dt, iceProgress = 0, waterLevel = 0) {
   if (ice?.sync(world, iceProgress, waterLevel)) for (const body of active.keys()) body.wakeUp();
   if (active.size) world.step(STEP, dt, MAX_SUBSTEPS);
   if (fractures.length) {
    for (const {x, z, energy} of fractures) {
     if (ice.crack(x, z, ICE_CRACK_RADIUS)) onIceBreak?.(x, waterLevel, z, energy);
    }
    fractures.length = 0;
    if (ice.sync(world, iceProgress, waterLevel)) for (const body of active.keys()) body.wakeUp();
   }
   for (const entry of active.values()) {
    if (entry.body.position.y < FALL_OUT_HEIGHT) { remove(entry); continue; }
    entry.mesh.position.copy(entry.body.position); entry.mesh.quaternion.copy(entry.body.quaternion);
   }
   chips?.tick(dt);
   return field.flushDeformation();
  },
  reset() {
   for (const entry of active.values()) remove(entry);
   chips?.clear(); tracks.clear();
   ice?.clear();
   return field.resetDeformation(updateSample);
  },
  dispose() {
   for (const entry of active.values()) remove(entry);
   chips?.dispose();
   Object.values(geometries).forEach(geometry => geometry.dispose());
  },
 };
}
