// The two the player can be in the drive demo: the bot (character tool) and the SUV (vehicle tool), on one Jolt world
// through the destruction module's driver, with E to change seats. It imports no terrain, weather or rendering: the
// ground comes through hooks (its height, how far lying snow lifts it, the water level) and reaches the physics as
// the terrain page's surround collider, laid again around each of the two as it moves. What the two do to the ground
// goes out through the tools' own hooks (vehicle.subscribe, controller.subscribe).
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {createCharacterController} from '../../src/character/index.js';
import {createVehicle} from '../../src/vehicle/index.js';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {FOOTSTEP_DEFAULTS} from '../terrain/footsteps.js';
import {createSurroundCollider} from '../terrain/heightfield.js';
import {SURROUND} from '../terrain/impacts.js';

export const PLAYERS = Object.freeze({
 gravity: 9.82,   // m/s2
 // Chassis: a low, flat physics box as wide and long as the model, so the car resists tipping. halfHeight m, mass kg.
 chassis: {halfHeight: .25, mass: 1500},
 // Suspension (m): mounts above the chassis centre, travel, and the length it settles at under this mass (measured).
 suspension: {mount: .15, min: .15, max: .4, rest: .33},
 tyreGrip: 1.6,   // against road tyres (1): more bite, so the car slides less on slopes
 dropHeight: 1.2, // m above the ground the car is set down from
 // Walker capsule (m) and speeds (m/s) that sit on the locomotion clips; no steering in the air. A stride is the
 // terrain page's two footprints, so its footstep tool prints one left and one right foot per stride.
 walker: {radius: .3, height: 1.7, walkSpeed: 1, runSpeed: 3.6, airControl: 0, strideLength: FOOTSTEP_DEFAULTS.spacing * 2},
 // Foot placement probes: reach above a foot (m), how many times that below it, the flattest normal a foot rests on.
 foot: {reach: .2, below: 2, slopeNormal: .65},
 // Getting in and out: how close to the car's centre the walker must be (m), how slow the car must be (m/s), and how
 // far beside the body the walker is set down (m).
 door: {reach: 3.2, maxSpeed: 1.5, gap: .9},
 groundGroup: 1,  // collision group of the ground, for the camera and foot probes
});

// suv: loadSuv()'s result. character: loadCharacter()'s. ground: {heightAt(x, z), lift(), waterLevelAt(x, z)}.
// spawn: {car: [x, z], walker: [x, z], heading} (heading: rad about Y, 0 = +Z).
export function createPlayers({J, suv, character, ground, spawn}) {
 const {chassis: box, suspension, walker: capsule, foot, door} = PLAYERS;
 const world = new CANNON.World({gravity: new CANNON.Vec3(0, -PLAYERS.gravity, 0)});
 const driver = createJoltDriver(J, {settleFreeze: false});
 const chassis = new CANNON.Body({mass: box.mass, shape: new CANNON.Box(new CANNON.Vec3(suv.size.x / 2, box.halfHeight, suv.size.z / 2))});
 world.addBody(chassis);
 driver.attach(world);
 const grounds = {car: null, walker: null};
 function layGround(owner, x, z) {
  if (grounds[owner]) world.removeBody(grounds[owner].body);
  grounds[owner] = createSurroundCollider({heightAt: ground.heightAt, center: {x, z}, size: SURROUND.size, cell: SURROUND.cell, lift: ground.lift()});
  world.addBody(grounds[owner].body);
 }
 const keepGround = (owner, {x, z}) => { if (grounds[owner].inset(x, z) < SURROUND.margin) layGround(owner, x, z); };
 layGround('car', ...spawn.car);
 layGround('walker', ...spawn.walker);
 const vehicle = createVehicle({J, jolt: driver.native, body: driver.nativeBody(chassis), layer: driver.layers.moving, waterLevelAt: ground.waterLevelAt,
  ...suv.layout, suspensionMount: suspension.mount, suspensionMin: suspension.min, suspensionMax: suspension.max, grip: PLAYERS.tyreGrip});
 const controller = createCharacterController({J, jolt: driver.native, layer: driver.layers.moving, waterLevelAt: ground.waterLevelAt, ...capsule});

 // The car model stands on y = 0 at its own origin: it hangs under the chassis centre so its arches meet the wheels.
 const car = new THREE.Group(), walker = new THREE.Group(), {wheels} = suv;
 suv.body.position.set(0, suspension.mount - suspension.rest - suv.layout.wheelRadius, -suv.centreZ);
 car.add(suv.body);
 walker.add(character.model);

 const rayStart = new CANNON.Vec3(), rayEnd = new CANNON.Vec3(), hit = new CANNON.RaycastResult();
 const groundFilter = {collisionFilterMask: PLAYERS.groundGroup, skipBackfaces: true};
 function raycast(start, end) {
  hit.reset();
  world.raycastClosest(rayStart.set(start.x, start.y, start.z), rayEnd.set(end.x, end.y, end.z), groundFilter, hit);
  return hit.hasHit && hit.body !== chassis ? hit : null;
 }
 const probeTop = new THREE.Vector3(), probeBottom = new THREE.Vector3();
 function groundAt(at, normal) {
  const found = raycast(probeTop.set(at.x, at.y + foot.reach, at.z), probeBottom.set(at.x, at.y - foot.reach * foot.below, at.z));
  if (!found || found.hitNormalWorld.y < foot.slopeNormal) return NaN;
  normal.copy(found.hitNormalWorld);
  return found.hitPointWorld.y;
 }

 const drive = {throttle: 0, steer: 0, handBrake: false}, forward = new THREE.Vector3(), left = new THREE.Vector3(), walk = new THREE.Vector2();
 let mode = 'walk', grounded = false, jumped = false, moving = false;
 const carHeading = () => { forward.set(0, 0, 1).applyQuaternion(chassis.quaternion); return Math.atan2(forward.x, forward.z); };
 const doorDistance = () => Math.hypot(controller.position.x - chassis.position.x, controller.position.z - chassis.position.z);

 const players = {
  car, wheels, walker, vehicle, controller, chassis,
  get mode() { return mode; },
  get speed() { return mode === 'drive' ? Math.abs(vehicle.speed) : controller.speed; },   // m/s
  get position() { return mode === 'drive' ? chassis.position : controller.position; },
  get velocity() { return mode === 'drive' ? chassis.velocity : controller.velocity; },
  get carHeading() { return carHeading(); },
  get canSwap() { return mode === 'walk' ? doorDistance() <= door.reach : Math.abs(vehicle.speed) <= door.maxSpeed; },
  // Nearest ground hit between two points (a Cannon RaycastResult), or null: for the camera.
  raycast,
  // One fixed physics step. input: {left, ahead} (-1..1 each), run, action (jump on foot, handbrake in the car), and
  // yaw, the heading the keys are relative to on foot (the camera's).
  step(dt, {left: sideways = 0, ahead = 0, run = false, action = false, yaw = 0} = {}) {
   if (mode === 'drive') {
    // The vehicle wants steer right positive; `left` is positive to the left.
    drive.throttle = ahead; drive.steer = -sideways; drive.handBrake = action;
    vehicle.update(drive);
   } else {
    // The parked car holds its handbrake.
    drive.throttle = drive.steer = 0; drive.handBrake = true;
    vehicle.update(drive);
    walk.set(sideways, ahead);
    if (walk.lengthSq() > 1) walk.normalize();
    moving = walk.lengthSq() > 0;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    controller.update(dt, {moveX: sin * walk.y + cos * walk.x, moveZ: cos * walk.y - sin * walk.x, run, jump: action});
    grounded = controller.grounded;
    jumped ||= controller.jumped;
   }
   world.step(dt);
  },
  // E: into the car when standing next to it, out of it once it is nearly stopped, set down beside the left door.
  // Returns whether the seat changed.
  swap() {
   if (!players.canSwap) return false;
   if (mode === 'walk') {
    mode = 'drive';
    walker.visible = false;
   } else {
    left.set(1, 0, 0).applyQuaternion(chassis.quaternion).setY(0).normalize().multiplyScalar(suv.size.x / 2 + door.gap);
    const x = chassis.position.x + left.x, z = chassis.position.z + left.z;
    layGround('walker', x, z);
    controller.teleport(x, ground.heightAt(x, z) + ground.lift(), z, carHeading());
    mode = 'walk';
    walker.visible = true;
    character.reset();
   }
   return true;
  },
  // Once a frame, after the steps: the ground follows the two, the models follow the physics, the bot is animated.
  update(dt) {
   keepGround('car', chassis.position);
   if (mode === 'walk') keepGround('walker', controller.position);
   car.position.copy(chassis.position);
   car.quaternion.copy(chassis.quaternion);
   vehicle.readWheels().forEach((wheel, i) => { wheels[i].position.copy(wheel.position); wheels[i].quaternion.copy(wheel.quaternion); });
   if (mode !== 'walk') return;
   walker.position.copy(controller.position);
   walker.rotation.y = controller.heading;
   character.update(dt, {moving, speed: controller.speed, grounded, jumped, preview: false, groundAt});
   jumped = false;
  },
  reset() {
   const [carX, carZ] = spawn.car, [walkX, walkZ] = spawn.walker, lift = ground.lift();
   layGround('car', carX, carZ);
   layGround('walker', walkX, walkZ);
   vehicle.teleport(carX, ground.heightAt(carX, carZ) + lift + PLAYERS.dropHeight, carZ, spawn.heading);
   controller.teleport(walkX, ground.heightAt(walkX, walkZ) + lift, walkZ, spawn.heading);
   mode = 'walk';
   walker.visible = true;
   grounded = jumped = moving = false;
   character.reset();
  },
  dispose() {
   vehicle.dispose();
   controller.dispose();
   driver.dispose();
  },
 };
 players.reset();
 return players;
}
