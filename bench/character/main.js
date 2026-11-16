// The character tool on its own: the controller on the core Jolt host, over the stage's flat ground with stairs, a
// ramp, a wall and crates to push. No other tool is needed: the ground is the stage's, the physics world is core's.
// Its hooks are shown, not wired: the status line names the last event a mixed demo would hand to its ground.
import * as THREE from 'three';
import initJolt from 'jolt-physics';
import {createFixedStep, createJoltHost} from '../../src/core/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {createCameraCollision, createCameraDirector, createThirdPersonRig} from '../../src/camera/index.js';
import {createCharacterController} from '../../src/character/index.js';
import {addJoltBlocks} from '../kit/jolt-blocks.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop} from '../kit/page.js';
import {loadCharacter} from './character.js';

// The course: a flat square (m a side, its physics slab thick m) and blocks on it. A block with a pitch is a ramp.
const COURSE = {size: 60, thickness: 1, color: 0xc5935b, blocks: [
 {halfExtents: [1.2, .1, .4], position: [0, .1, 4]}, {halfExtents: [1.2, .2, .4], position: [0, .2, 4.8]}, {halfExtents: [1.2, .3, 1.2], position: [0, .3, 6.4]},
 {halfExtents: [1.5, .1, 3], position: [5, .55, 5], pitch: -.2},
 {halfExtents: [2, 1, .2], position: [-5, 1, 6]},
 {halfExtents: [.3, .3, .3], position: [-3, .3, 2], mass: 15, color: 0x8a5a36}, {halfExtents: [.4, .4, .4], position: [3, .4, -3], mass: 30, color: 0x8a5a36},
]};
// Walker capsule (m) and speeds (m/s) that sit on the locomotion clips; no steering in the air.
const PLAYER = {radius: .3, height: 1.7, walkSpeed: 1, runSpeed: 3.6, airControl: 0};
// Foot placement probes: reach above a foot (m), how many times that below it, the flattest normal a foot rests on.
const FOOT = {reach: .2, below: 2, slopeNormal: .65};
// Third-person camera: start heading and angle (rad), arm (m), look-at height on the character (m), mouse turn (rad per pixel).
const VIEW = {yaw: 0, pitch: .38, distance: 6, height: 1.05, fov: 42, sensitivity: .0025};
const MOVE = {KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [1, 0], ArrowLeft: [1, 0], KeyD: [-1, 0], ArrowRight: [-1, 0]};
const RUN_KEYS = ['ShiftLeft', 'ShiftRight'], OTHER_KEYS = ['Space', 'KeyR'];
const PROXY_COLOR = 0xf2a755;   // the capsule drawn while the model loads, or when it cannot

const renderer = benchRenderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, 1, .1, 200);
renderer.shadowMap.enabled = true;
const unbindResize = bindResize(renderer, camera);
const half = COURSE.size / 2;
const stage = createBasicStage({scene, shadows: true, groundSize: COURSE.size});

const J = await initJolt();
const host = createJoltHost(J);
const floor = host.addBox({halfExtents: [half, COURSE.thickness / 2, half], position: [0, -COURSE.thickness / 2, 0]});
const blocks = addJoltBlocks({host, scene, blocks: COURSE.blocks, color: COURSE.color});
const controller = createCharacterController({J, jolt: host.jolt, layer: host.layers.moving, ...PLAYER});
const status = document.querySelector('#status');
let label = 'Capsule', last = '';
const stopListening = controller.subscribe(event => { last = event.type; });

const walker = new THREE.Group();
const proxy = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2), new THREE.MeshStandardMaterial({color: PROXY_COLOR}));
proxy.position.y = PLAYER.height / 2;
proxy.castShadow = true;
walker.add(proxy);
scene.add(walker);
let character, disposed = false;
loadCharacter('bot').then(loaded => {
 if (disposed) return;
 character = loaded;
 walker.add(loaded.model);
 proxy.visible = false;
 label = loaded.label;
}, error => { console.warn('Character model could not load', error); });

const look = createThirdPersonRig(VIEW), director = createCameraDirector(camera).register('look', look);
director.setCollision(createCameraCollision({raycast: (start, end) => host.raycast(start, end)?.distance ?? Infinity}));
const probeTop = new THREE.Vector3(), probeBottom = new THREE.Vector3();
function groundAt(foot, normal) {
 const found = host.raycast(probeTop.set(foot.x, foot.y + FOOT.reach, foot.z), probeBottom.set(foot.x, foot.y - FOOT.reach * FOOT.below, foot.z));
 if (!found || found.normal.y < FOOT.slopeNormal) return NaN;
 normal.copy(found.normal);
 return found.point.y;
}

const keys = new Set(), move = new THREE.Vector2(), target = new THREE.Vector3(), clock = createFixedStep();
let grounded = false, jumped = false;
function reset() {
 controller.teleport(0, 0, 0, 0);
 grounded = jumped = false;
 character?.reset();
 clock.reset();
 director.reset();
}
function simulate(dt) {
 move.set(0, 0);
 for (const key of keys) { const axis = MOVE[key]; if (axis) { move.x += axis[0]; move.y += axis[1]; } }
 if (move.lengthSq() > 1) move.normalize();
 // Keys are relative to the camera: forward is the way it looks, left is its left.
 const sin = Math.sin(look.yaw), cos = Math.cos(look.yaw);
 controller.update(dt, {moveX: sin * move.y + cos * move.x, moveZ: cos * move.y - sin * move.x,
  run: RUN_KEYS.some(key => keys.has(key)), jump: keys.has('Space')});
 grounded = controller.grounded;
 jumped ||= controller.jumped;
 host.step(dt);
}
function keydown(event) {
 if (!MOVE[event.code] && !RUN_KEYS.includes(event.code) && !OTHER_KEYS.includes(event.code)) return;
 event.preventDefault();
 keys.add(event.code);
 if (!event.repeat && event.code === 'KeyR') reset();
}
function keyup(event) { keys.delete(event.code); }
function blur() { keys.clear(); }
function capturePointer() { renderer.domElement.requestPointerLock(); }
function mousemove(event) {
 if (document.pointerLockElement === renderer.domElement) look.look(-event.movementX * VIEW.sensitivity, event.movementY * VIEW.sensitivity);
}
window.addEventListener('keydown', keydown);
window.addEventListener('keyup', keyup);
window.addEventListener('blur', blur);
window.addEventListener('mousemove', mousemove);
renderer.domElement.addEventListener('click', capturePointer);
reset();

startFrameLoop(renderer, dt => {
 clock.advance(dt, simulate);
 const {position} = controller;
 if (position.y < -COURSE.thickness || Math.max(Math.abs(position.x), Math.abs(position.z)) >= half) reset();
 walker.position.copy(position);
 walker.rotation.y = controller.heading;
 character?.update(dt, {moving: move.lengthSq() > 0, speed: controller.speed, grounded, jumped, preview: false, groundAt});
 jumped = false;
 blocks.update();
 target.copy(walker.position).y += VIEW.height;
 director.update(dt, {target});
 status.textContent = label + (last ? ' · last event: ' + last : '');
 stage.update(camera);
 renderer.render(scene, camera);
});
window.characterDemo = {controller, host, reset};
onLeave(() => {
 disposed = true;
 renderer.setAnimationLoop(null);
 window.removeEventListener('keydown', keydown);
 window.removeEventListener('keyup', keyup);
 window.removeEventListener('blur', blur);
 window.removeEventListener('mousemove', mousemove);
 renderer.domElement.removeEventListener('click', capturePointer);
 unbindResize();
 stopListening();
 controller.dispose();
 blocks.dispose();
 host.remove(floor);
 host.dispose();
 const resources = new Set();
 walker.traverse(node => {
  if (!node.isMesh) return;
  resources.add(node.geometry);
  for (const material of [].concat(node.material)) { resources.add(material); if (material.map) resources.add(material.map); }
 });
 for (const resource of resources) resource.dispose();
 stage.dispose();
 renderer.dispose();
});
