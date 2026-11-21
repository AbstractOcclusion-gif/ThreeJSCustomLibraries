import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import initJolt from 'jolt-physics';
import {createCharacterController} from '../../src/character/index.js';
import {createFixedStep} from '../../src/core/index.js';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {createTerrainCollider} from '../../src/terrain/physics.js';
import {recoverTraversalLanding, TRAVERSAL_GRAVITY, TRAVERSAL_PLAYER} from '../kit/traversal-movement.js';
import {disposeModel, loadMeadowAvatar} from './avatars.js';
import {createFootContacts} from './foot-contacts.js';
import {SITE, TREES} from './layout.js';

const MEADOW_GROUND = {wadeFull: .8, stickDown: .65};
const BOT = {radius: .3, height: 1.75, walkSpeed: 1.2, runSpeed: 3.7, airControl: 0, ...MEADOW_GROUND};
const PLAYER = {...TRAVERSAL_PLAYER, ...MEADOW_GROUND};
const FOOT = {up: .25, down: .5, slope: .65};
const TRUNK = {radiusShare: .022, heightShare: .4, sides: 8};
const EDGE = {margin: .5, fallBelow: 4};
const GROUND_RECOVERY_DEPTH = .05; // m of overlap before lifting the capsule out of raised terrain
const GRAVITY = -9.82;
const AXES = {KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
 KeyA: [1, 0], ArrowLeft: [1, 0], KeyD: [-1, 0], ArrowRight: [-1, 0]};
const RUN = ['ShiftLeft', 'ShiftRight'];
export const MOVE_KEYS = new Set([...Object.keys(AXES), ...RUN, 'Space']);

export async function createMeadowWalker({scene, field, heights, levelAt, onContact, report}) {
 const J = await initJolt();
 const world = new CANNON.World({gravity: new CANNON.Vec3(0, GRAVITY, 0)});
 const terrainBody = createTerrainCollider(field);
 world.addBody(terrainBody);
 const trunks = Object.fromEntries(Object.entries(TREES).map(([species, placements]) => [species, placements.map(([x, z, size]) => {
  const radius = size * TRUNK.radiusShare, height = size * TRUNK.heightShare;
  const body = new CANNON.Body({mass: 0, position: new CANNON.Vec3(x, field.heightAt(x, z) + height / 2, z),
   shape: new CANNON.Cylinder(radius, radius, height, TRUNK.sides)});
  world.addBody(body);
  return body;
 })]));
 // Use the existing bridge from the terrain's heightfield to the controller's Jolt world.
 const driver = createJoltDriver(J, {settleFreeze: false});
 driver.attach(world);
 function makeController(settings) {
  const next = createCharacterController({J, jolt: driver.native, layer: driver.layers.moving, waterLevelAt: levelAt, ...settings});
  next.subscribe(onContact);
  return next;
 }
 let controller = makeController(BOT), player = BOT;
 const model = new THREE.Group();
 const proxy = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2),
  new THREE.MeshStandardMaterial({color: 0xdba365}));
 proxy.position.y = PLAYER.height / 2;
 proxy.castShadow = true;
 model.add(proxy);
 scene.add(model);
 let character, disposed = false, jumped = false, groundDirty = false, request = 0;
 const avatars = new Map(), contacts = createFootContacts(field);
 function releaseAvatar(avatar) { avatar.dispose?.(); disposeModel(avatar.model); }
 const start = new CANNON.Vec3(), end = new CANNON.Vec3(), hit = new CANNON.RaycastResult();
 const rayOptions = {skipBackfaces: true};
 function cast(from, to) {
  hit.reset();
  world.raycastClosest(start.copy(from), end.copy(to), rayOptions, hit);
  return hit.hasHit ? hit : null;
 }
 const top = new THREE.Vector3(), bottom = new THREE.Vector3();
 function groundAt(point, normal) {
  const ground = cast(top.copy(point).addScaledVector(UP, FOOT.up), bottom.copy(point).addScaledVector(UP, -FOOT.down));
  if (!ground || ground.hitNormalWorld.y < FOOT.slope) return NaN;
  normal.copy(ground.hitNormalWorld);
  return ground.hitPointWorld.y;
 }
 async function selectAvatar(name) {
  const id = ++request;
  const settings = name === 'lara' ? PLAYER : BOT;
  let avatar = avatars.get(name);
  if (!avatar) {
   avatar = await loadMeadowAvatar(name, settings, groundAt);
   if (disposed || id !== request) { releaseAvatar(avatar); return; }
   avatars.set(name, avatar);
  }
  if (settings !== player) {
   const {position, heading, velocity} = controller;
   const next = makeController(settings);
   next.teleport(position.x, position.y, position.z, heading);
   next.launch(velocity.x, velocity.y, velocity.z);
   controller.dispose();
   controller = next;
   player = settings;
   world.gravity.y = player === PLAYER ? -TRAVERSAL_GRAVITY : GRAVITY;
   const nativeGravity = new J.Vec3(0, world.gravity.y, 0);
   driver.native.GetPhysicsSystem().SetGravity(nativeGravity);
   J.destroy(nativeGravity);
   clock.reset();
   jumped = false;
  }
  character?.model.removeFromParent();
  character = avatar;
  character.reset();
  contacts.reset();
  model.add(avatar.model);
  proxy.visible = false;
 }
 selectAvatar('bot').catch(error => { if (!disposed) report(error); });
 const move = new THREE.Vector2(), clock = createFixedStep();
 const wish = {x: 0, z: 0, run: false};
 const reset = () => {
  const [x, z] = SITE.spawn;
  const ground = cast(top.set(x, field.heightAt(x, z) + FOOT.up, z), bottom.set(x, -EDGE.fallBelow, z));
  controller.teleport(x, ground?.hitPointWorld.y ?? field.heightAt(x, z), z, SITE.heading);
  clock.reset();
  character?.reset();
  contacts.reset();
  jumped = false;
 };
 reset();
 return {
  get controller() { return controller; },
  model, reset, selectAvatar,
  setTreeCount(species, count) {
   trunks[species].forEach((body, index) => {
    if (index < count && !body.world) world.addBody(body);
    else if (index >= count && body.world) world.removeBody(body);
   });
  },
  updateHeightSample(x, z, value) {
   if (field.snowCover.value) return;
   terrainBody.shapes[0].setHeightValueAtIndex(z, x, value);
   groundDirty = true;
  },
  laySnowSupport() {
   // Loose snow deforms above the packed layer that carries the capsule and planted soles.
   const {packedShare} = field.snowSettings;
   const surface = field.heightMap.image.data, shape = terrainBody.shapes[0];
   for (let z = 0; z < SITE.samples; z++) for (let x = 0; x < SITE.samples; x++) {
    const index = z * SITE.samples + x;
    shape.setHeightValueAtIndex(z, x, THREE.MathUtils.lerp(heights[index], surface[index], packedShare));
   }
   groundDirty = true;
  },
  refreshGround() {
   if (!groundDirty) return;
   driver.reshape(terrainBody);
   groundDirty = false;
   if (field.snowCover.value) return;
   const {x, y, z} = controller.position;
   const surface = field.heightAt(x, z);
   if (!Number.isFinite(surface)) return;
   const overlap = surface - y;
   if (overlap <= GROUND_RECOVERY_DEPTH) return;
   controller.teleport(x, surface, z, controller.heading);
   contacts.reset();
   jumped = false;
  },
  raycast: (from, to) => cast(from, to)?.distance ?? Infinity,
  update(dt, keys, yaw, onPlant, deepSnowAt, touch) {
   move.set(touch?.move.x ?? 0, touch?.move.y ?? 0);
   for (const key of keys) {
    const axis = AXES[key];
    if (axis) { move.x += axis[0]; move.y += axis[1]; }
   }
   if (move.lengthSq() > 1) move.normalize();
   const sin = Math.sin(yaw), cos = Math.cos(yaw);
   wish.x = sin * move.y + cos * move.x;
   wish.z = cos * move.y - sin * move.x;
   wish.run = Boolean(touch?.running) || RUN.some(key => keys.has(key));
   let landing = null;
   clock.advance(dt, step => {
    controller.update(step, {moveX: wish.x, moveZ: wish.z, run: wish.run, jump: keys.has('Space')});
    if (player === PLAYER) landing = recoverTraversalLanding(controller, wish, character?.recovery) ?? landing;
    jumped ||= controller.jumped;
    world.step(step);
   });
   const {x, y, z} = controller.position;
   if (Math.max(Math.abs(x), Math.abs(z)) >= SITE.span / 2 - EDGE.margin || y < -EDGE.fallBelow) reset();
   model.position.copy(controller.position);
   model.rotation.y = controller.heading;
   character?.update(dt, controller, jumped, wish, deepSnowAt(controller), landing);
   contacts.update(character, controller, onPlant);
   jumped = false;
   return move.lengthSq() > 0 && !keys.has('Space');
  },
  dispose() {
   disposed = true;
   controller.dispose();
   driver.dispose();
   for (const avatar of avatars.values()) {
    avatar.model.removeFromParent();
    releaseAvatar(avatar);
   }
   model.removeFromParent();
   disposeModel(model);
  },
 };
}

const UP = new THREE.Vector3(0, 1, 0);
