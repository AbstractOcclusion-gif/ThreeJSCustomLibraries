import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import initJolt from 'jolt-physics';
import {createFixedStep} from '../../src/core/fixed-step.js';
import {createBasicStage} from '../../src/stage/index.js';
import {createTerrainField} from '../../src/terrain/index.js';
import {createCameraCollision, createCameraDirector, createThirdPersonRig} from '../../src/camera/index.js';
import {createCharacterController} from '../../src/character/index.js';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {createTerrainCollider} from '../terrain/heightfield.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop} from '../kit/page.js';
import {loadCharacter} from './character.js';
import {createOutdoorProps} from './props.js';

const COURSE = {span: 32, resolution: 65, step: [.95, .16, .65]};
// Capsule of the character controller; every other movement setting is the controller's default.
const PLAYER = {radius: .3, height: 1.7};
// Foot IK probes: how far above and below a foot the ground is searched, and the flattest normal a foot rests on.
const FOOT = {reach: .2, slopeNormal: .65};
const RUN_KEYS = ['ShiftLeft', 'ShiftRight'];
// Third-person camera: start heading and angle (rad), arm (m), look-at height on the character (m), mouse turn (rad per pixel).
const VIEW = {yaw: -.6, pitch: .38, distance: 6, height: 1.05, fov: 42, sensitivity: .0025};
const MOVE = {KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
 KeyA: [1, 0], ArrowLeft: [1, 0], KeyD: [-1, 0], ArrowRight: [-1, 0]};
const GROUND = 1;

const renderer = benchRenderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, .1, 150);
renderer.shadowMap.enabled = true;
const unbindResize = bindResize(renderer, camera);
const stage = createBasicStage({scene, ground: false, shadows: true});
const look = createThirdPersonRig(VIEW);
const director = createCameraDirector(camera).register('look', look);
// Physics: Cannon bodies as the model, Jolt solving them (the destruction module's driver), so the character and the
// props share one solver. Nothing here is rubble, so nothing is frozen once it settles.
const J = await initJolt();
const world = new CANNON.World({gravity: new CANNON.Vec3(0, -9.82, 0)});
const driver = createJoltDriver(J, {settleFreeze: false});
const clock = createFixedStep(), half = COURSE.span / 2;
const heights = Float32Array.from({length: COURSE.resolution ** 2}, (_, i) => {
 const x = i % COURSE.resolution / (COURSE.resolution - 1) * COURSE.span - half;
 const z = Math.floor(i / COURSE.resolution) / (COURSE.resolution - 1) * COURSE.span - half;
 return Math.sin(x * .48) * .25 + Math.max(0, Math.min(z - 5, 7)) * .13 + Math.sin(z * .42) * .16;
});
const field = createTerrainField({origin: [-half, -half], size: [COURSE.span, COURSE.span],
 resolution: [COURSE.resolution, COURSE.resolution], heights});
const terrain = new THREE.Mesh(field.geometry, new THREE.MeshStandardMaterial({color: 0x659261, roughness: .95}));
terrain.receiveShadow = true;
scene.add(terrain);
world.addBody(createTerrainCollider(field));

const [width, height, depth] = COURSE.step;
const step = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({color: 0xc5935b}));
step.position.set(0, field.heightAt(0, 2) + height / 2, 2);
step.castShadow = step.receiveShadow = true;
scene.add(step);
world.addBody(new CANNON.Body({mass: 0, position: new CANNON.Vec3(...step.position),
 shape: new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2))}));

driver.attach(world);
const controller = createCharacterController({J, jolt: driver.native, layer: driver.layers.moving, ...PLAYER});
const playerView = new THREE.Group();
const proxy = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2), new THREE.MeshStandardMaterial({color: 0xf2a755}));
proxy.position.y = PLAYER.height / 2;
proxy.castShadow = true;
playerView.add(proxy);
scene.add(playerView);

const keys = new Set(), desired = new THREE.Vector2(), target = new THREE.Vector3();
const rayStart = new CANNON.Vec3(), rayEnd = new CANNON.Vec3(), hit = new CANNON.RaycastResult();
const groundFilter = {collisionFilterMask: GROUND, skipBackfaces: true};
// The camera is pulled in front of whatever stands between it and the character.
director.setCollision(createCameraCollision({raycast(start, end) {
 hit.reset();
 world.raycastClosest(rayStart.set(start.x, start.y, start.z), rayEnd.set(end.x, end.y, end.z), groundFilter, hit);
 return hit.hasHit ? hit.distance : Infinity;
}}));
let grounded = false, mode = 'play', character, disposed = false;
let needsReset = false, jumped = false;
const status = document.querySelector('#status'), idleButton = document.querySelector('#idle'), walkButton = document.querySelector('#walk');
const props = createOutdoorProps({scene, world, field, stage, actor: controller, prompt: document.querySelector('#interaction')});
function groundAt(foot, normal) {
 hit.reset();
 rayStart.set(foot.x, foot.y + FOOT.reach, foot.z);
 rayEnd.set(foot.x, foot.y - FOOT.reach * 2, foot.z);
 world.raycastClosest(rayStart, rayEnd, groundFilter, hit);
 if (!hit.hasHit || hit.hitNormalWorld.y < FOOT.slopeNormal) return NaN;
 normal.copy(hit.hitNormalWorld);
 return hit.hitPointWorld.y;
}
function reset() {
 controller.teleport(0, field.heightAt(0, 0), 0, 0);
 jumped = grounded = false;
 needsReset = false;
 clock.reset();
 director.reset();
 character?.reset();
 props.reset();
}
reset();

function simulate(dt) {
 if (needsReset) return;
 desired.set(0, 0);
 if (mode === 'play') for (const key of keys) {
  const axis = MOVE[key];
  if (axis) { desired.x += axis[0]; desired.y += axis[1]; }
 }
 if (desired.lengthSq() > 1) desired.normalize();
 const playing = mode === 'play';
 // Keys are relative to the camera: forward is the way it looks, left is its left.
 const sin = Math.sin(look.yaw), cos = Math.cos(look.yaw);
 controller.update(dt, {moveX: sin * desired.y + cos * desired.x, moveZ: cos * desired.y - sin * desired.x,
  run: playing && RUN_KEYS.some(key => keys.has(key)), jump: playing && keys.has('Space')});
 grounded = controller.grounded;
 jumped ||= controller.jumped;
 world.step(dt);
 const {position} = controller;
 needsReset = position.y < -half || Math.max(Math.abs(position.x), Math.abs(position.z)) >= half;
}

function keydown(event) {
 if (!MOVE[event.code] && !['Space', 'KeyR', 'KeyE', ...RUN_KEYS].includes(event.code)) return;
 if (event.target.closest?.('button, input, textarea, select, [contenteditable]')) return;
 event.preventDefault();
 keys.add(event.code);
 if (!event.repeat && event.code === 'KeyR') reset();
 if (!event.repeat && event.code === 'KeyE' && mode === 'play') props.press();
}
function keyup(event) { keys.delete(event.code); if (event.code === 'KeyE') props.release(); }
function blur() { keys.clear(); props.release(); }
// Click the view to turn the camera with the mouse; Esc gives the pointer back.
function capturePointer() { renderer.domElement.requestPointerLock(); }
function mousemove(event) {
 if (document.pointerLockElement === renderer.domElement) look.look(-event.movementX * VIEW.sensitivity, event.movementY * VIEW.sensitivity);
}
renderer.domElement.addEventListener('click', capturePointer);
window.addEventListener('mousemove', mousemove);
window.addEventListener('keydown', keydown);
window.addEventListener('keyup', keyup);
window.addEventListener('blur', blur);
for (const id of ['idle', 'walk', 'play']) document.querySelector('#' + id).addEventListener('click', event => {
 mode = id;
 blur();
 character?.reset();
 event.currentTarget.blur();
});

startFrameLoop(renderer, dt => {
 clock.advance(dt, simulate);
 if (needsReset) reset();
 playerView.position.copy(controller.position);
 playerView.rotation.y = controller.heading;
 character?.update(dt, {moving: mode === 'walk' || (mode === 'play' && desired.lengthSq() > 0),
  speed: controller.speed, grounded, jumped, preview: mode !== 'play', groundAt});
 jumped = false;
 props.update(dt, mode === 'play');
 target.copy(playerView.position).y += VIEW.height;
 director.update(dt, {target});
 stage.update(camera);
 renderer.render(scene, camera);
});
window.outdoorBench = {controller, world, playerView, reset};

async function selectCharacter() {
 const requested = new URLSearchParams(location.search).get('character');
 for (const variant of requested === 'sci-fi' ? ['sci-fi'] : ['preferred', 'sci-fi']) {
  try {
   const candidate = await loadCharacter(variant);
   if (disposed) return;
   character = candidate;
   playerView.add(candidate.model);
   proxy.visible = false;
   idleButton.disabled = !candidate.hasIdle;
   walkButton.disabled = false;
   status.textContent = candidate.label;
   document.body.dataset.character = variant;
   return;
  } catch (error) { console.warn('Outdoor character could not load', variant, error); }
 }
 status.textContent = 'Capsule · local character assets unavailable';
}
selectCharacter();
onLeave(() => {
 disposed = true;
 renderer.setAnimationLoop(null);
 window.removeEventListener('keydown', keydown);
 window.removeEventListener('keyup', keyup);
 window.removeEventListener('blur', blur);
 window.removeEventListener('mousemove', mousemove);
 renderer.domElement.removeEventListener('click', capturePointer);
 unbindResize();
 props.dispose();
 controller.dispose();
 driver.dispose();
 stage.dispose();
 field.dispose();
 const resources = new Set();
 scene.traverse(node => {
  if (node.geometry && node.geometry !== field.geometry) resources.add(node.geometry);
  for (const material of [].concat(node.material ?? [])) {
   resources.add(material);
   for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
  }
 });
 for (const resource of resources) resource.dispose();
 renderer.dispose();
});
