// The vehicle tool on its own: a 4x4 (Kenney's SUV) on the core Jolt host, over the stage's flat ground with a few
// ramps and bumps. No other tool is needed: the ground is the stage's, the physics world is core's. Its hooks are
// shown, not wired: the status line counts the 'vehicle:track' events a mixed demo would hand to its ground.
import * as THREE from 'three';
import initJolt from 'jolt-physics';
import {createFixedStep, createJoltHost} from '../../src/core/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {createCameraCollision, createCameraDirector, createThirdPersonRig} from '../../src/camera/index.js';
import {createVehicle} from '../../src/vehicle/index.js';
import {addJoltBlocks} from '../kit/jolt-blocks.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop} from '../kit/page.js';
import {loadSuv} from './suv.js';

// The course: a flat square (m a side, its physics slab thick m) and blocks on it. A block with a pitch is a ramp.
const COURSE = {size: 300, thickness: 1, color: 0xb9a27c, blocks: [
 {halfExtents: [4, .15, 6], position: [0, .75, 40], pitch: -.12},
 {halfExtents: [4, .15, 6], position: [0, .75, 52], pitch: .12},
 {halfExtents: [6, .12, .5], position: [14, .02, 20]}, {halfExtents: [6, .12, .5], position: [14, .02, 24]}, {halfExtents: [6, .12, .5], position: [14, .02, 28]},
 {halfExtents: [.5, .5, .5], position: [-12, .5, 25], mass: 40, color: 0x8a5a36}, {halfExtents: [.5, .5, .5], position: [-12, .5, 27], mass: 40, color: 0x8a5a36},
]};
// Chassis: a low, flat physics box as wide and long as the model (halfHeight m, mass kg), so the car resists tipping.
const CHASSIS = {halfHeight: .25, mass: 1500};
// Suspension (m): mounts above the chassis centre, travel, and the length it settles at under this mass (measured).
const SUSPENSION = {mount: .15, min: .15, max: .4, rest: .33};
// Chase camera: arm (m), angle above the car (rad), look-at height (m), how fast it swings behind the car (1/s),
// mouse turn (rad per pixel).
const VIEW = {distance: 9, pitch: .32, height: 1.2, fov: 50, follow: 2.5, sensitivity: .0025};
const DROP_HEIGHT = 1.2;   // m above the ground the car is set down from
const KEYS = {KeyW: ['throttle', 1], ArrowUp: ['throttle', 1], KeyS: ['throttle', -1], ArrowDown: ['throttle', -1],
 KeyA: ['steer', -1], ArrowLeft: ['steer', -1], KeyD: ['steer', 1], ArrowRight: ['steer', 1]};
const TURN = Math.PI * 2, MS_TO_KMH = 3.6;

const renderer = benchRenderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, 1, .1, 600);
renderer.shadowMap.enabled = true;
const unbindResize = bindResize(renderer, camera);
const half = COURSE.size / 2;
const stage = createBasicStage({scene, shadows: true, groundSize: COURSE.size});

const [J, suv] = await Promise.all([initJolt(), loadSuv()]);
const host = createJoltHost(J);
const floor = host.addBox({halfExtents: [half, COURSE.thickness / 2, half], position: [0, -COURSE.thickness / 2, 0]});
const blocks = addJoltBlocks({host, scene, blocks: COURSE.blocks, color: COURSE.color});
const chassis = host.addBox({halfExtents: [suv.size.x / 2, CHASSIS.halfHeight, suv.size.z / 2], position: [0, DROP_HEIGHT, 0], mass: CHASSIS.mass});
const vehicle = createVehicle({J, jolt: host.jolt, body: chassis, layer: host.layers.moving,
 ...suv.layout, suspensionMount: SUSPENSION.mount, suspensionMin: SUSPENSION.min, suspensionMax: SUSPENSION.max});
let tracks = 0;
const stopCounting = vehicle.subscribe(() => { tracks++; });

// The model stands on y = 0 at its own origin: it is hung under the chassis centre so its wheel arches meet the wheels.
const car = new THREE.Group(), {wheels} = suv;
suv.body.position.set(0, SUSPENSION.mount - SUSPENSION.rest - suv.layout.wheelRadius, -suv.centreZ);
car.add(suv.body);
scene.add(car, ...wheels);

const look = createThirdPersonRig(VIEW), director = createCameraDirector(camera).register('chase', look);
director.setCollision(createCameraCollision({raycast: (start, end) => host.raycast(start, end)?.distance ?? Infinity}));

const keys = new Set(), input = {throttle: 0, steer: 0, handBrake: false}, target = new THREE.Vector3(), forward = new THREE.Vector3();
const clock = createFixedStep(), status = document.querySelector('#status');
function reset() {
 vehicle.teleport(0, DROP_HEIGHT, 0, 0);
 tracks = 0;
 clock.reset();
 director.reset();
}
function simulate(dt) {
 input.throttle = input.steer = 0;
 for (const key of keys) { const axis = KEYS[key]; if (axis) input[axis[0]] += axis[1]; }
 input.handBrake = keys.has('Space');
 vehicle.update(input);
 host.step(dt);
}
function keydown(event) {
 if (!KEYS[event.code] && !['Space', 'KeyR'].includes(event.code)) return;
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

startFrameLoop(renderer, dt => {
 clock.advance(dt, simulate);
 host.readPose(chassis, car.position, car.quaternion);
 if (car.position.y < -COURSE.thickness || Math.max(Math.abs(car.position.x), Math.abs(car.position.z)) >= half) reset();
 vehicle.readWheels().forEach((wheel, i) => { wheels[i].position.copy(wheel.position); wheels[i].quaternion.copy(wheel.quaternion); });
 blocks.update();
 // The camera swings round behind the car, the shortest way; the mouse can still look around it.
 forward.set(0, 0, 1).applyQuaternion(car.quaternion);
 const behind = ((Math.atan2(forward.x, forward.z) - look.yaw) % TURN + TURN * 1.5) % TURN - Math.PI;
 look.look(behind * (1 - Math.exp(-dt * VIEW.follow)), 0);
 target.copy(car.position).y += VIEW.height;
 director.update(dt, {target});
 status.textContent = Math.round(Math.abs(vehicle.speed) * MS_TO_KMH) + ' km/h · ' + tracks + ' track events';
 stage.update(camera);
 renderer.render(scene, camera);
});
window.vehicleDemo = {vehicle, host, chassis, reset};
onLeave(() => {
 renderer.setAnimationLoop(null);
 window.removeEventListener('keydown', keydown);
 window.removeEventListener('keyup', keyup);
 window.removeEventListener('blur', blur);
 window.removeEventListener('mousemove', mousemove);
 renderer.domElement.removeEventListener('click', capturePointer);
 unbindResize();
 stopCounting();
 vehicle.dispose();
 blocks.dispose();
 host.remove(chassis); host.remove(floor);
 host.dispose();
 suv.dispose();
 stage.dispose();
 renderer.dispose();
});
