// Mixed demo: a 4x4 (Kenney's SUV) on the vehicle module driving a terrain field. Cannon bodies are the model, Jolt solves them
// (the destruction module's driver); the vehicle module adds wheels, engine and steering to the chassis body.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import initJolt from 'jolt-physics';
import {createFixedStep} from '../../src/core/fixed-step.js';
import {createBasicStage} from '../../src/stage/index.js';
import {createTerrainField} from '../../src/terrain/index.js';
import {createCameraCollision, createCameraDirector, createThirdPersonRig} from '../../src/camera/index.js';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {createVehicle} from '../../src/vehicle/index.js';
import {createTerrainCollider} from '../terrain/heightfield.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop} from '../kit/page.js';
import {loadSuv} from './suv.js';

// Rolling ground: span (m), samples per side, long hills and short bumps as [height m, wavelength m].
const GROUND = {span: 320, resolution: 161, hills: [3.5, 90], bumps: [.35, 14]};
// Chassis: a low, flat physics box as wide and long as the model (halfHeight m, mass kg), so the weight sits low and
// the car resists tipping.
const CHASSIS = {halfHeight: .25, mass: 1500};
// Suspension (m): mounts above the chassis centre, travel from min to max, and `rest`, the length it settles at under
// this mass (measured), which places the drawn body over the wheels.
const SUSPENSION = {mount: .15, min: .15, max: .4, rest: .33};
// Chase camera: arm (m), angle above the car (rad), look-at height (m), how fast it swings behind the car (1/s),
// mouse turn (rad per pixel).
const VIEW = {distance: 9, pitch: .32, height: 1.2, fov: 50, follow: 2.5, sensitivity: .0025};
const DROP_HEIGHT = 1.5;   // m above the ground the car is set down from
const KEYS = {KeyW: ['throttle', 1], ArrowUp: ['throttle', 1], KeyS: ['throttle', -1], ArrowDown: ['throttle', -1],
 KeyA: ['steer', -1], ArrowLeft: ['steer', -1], KeyD: ['steer', 1], ArrowRight: ['steer', 1]};
const TURN = Math.PI * 2, MS_TO_KMH = 3.6;

const renderer = benchRenderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, 1, .1, 600);
renderer.shadowMap.enabled = true;
const unbindResize = bindResize(renderer, camera);
const stage = createBasicStage({scene, ground: false, shadows: true});
const half = GROUND.span / 2, wave = ([height, length], a, b) => height * Math.sin(a * TURN / length) * Math.cos(b * TURN / length);
const heights = Float32Array.from({length: GROUND.resolution ** 2}, (_, i) => {
 const x = i % GROUND.resolution / (GROUND.resolution - 1) * GROUND.span - half;
 const z = Math.floor(i / GROUND.resolution) / (GROUND.resolution - 1) * GROUND.span - half;
 return wave(GROUND.hills, x, z) + wave(GROUND.bumps, x + z, x - z);
});
const field = createTerrainField({origin: [-half, -half], size: [GROUND.span, GROUND.span],
 resolution: [GROUND.resolution, GROUND.resolution], heights});
const terrain = new THREE.Mesh(field.geometry, new THREE.MeshStandardMaterial({color: 0x659261, roughness: .95}));
terrain.receiveShadow = true;
scene.add(terrain);

const J = await initJolt();
const world = new CANNON.World({gravity: new CANNON.Vec3(0, -9.82, 0)});
const driver = createJoltDriver(J, {settleFreeze: false});
world.addBody(createTerrainCollider(field));
const suv = await loadSuv();
const chassis = new CANNON.Body({mass: CHASSIS.mass, shape: new CANNON.Box(new CANNON.Vec3(suv.size.x / 2, CHASSIS.halfHeight, suv.size.z / 2))});
world.addBody(chassis);
driver.attach(world);
const vehicle = createVehicle({J, jolt: driver.native, body: driver.nativeBody(chassis), layer: driver.layers.moving,
 ...suv.layout, suspensionMount: SUSPENSION.mount, suspensionMin: SUSPENSION.min, suspensionMax: SUSPENSION.max});

// The model stands on y = 0 at its own origin: it is hung under the chassis centre so its wheel arches meet the wheels.
const car = new THREE.Group(), {wheels} = suv;
suv.body.position.set(0, SUSPENSION.mount - SUSPENSION.rest - suv.layout.wheelRadius, -suv.centreZ);
car.add(suv.body);
scene.add(car, ...wheels);

const look = createThirdPersonRig(VIEW), director = createCameraDirector(camera).register('chase', look);
const rayStart = new CANNON.Vec3(), rayEnd = new CANNON.Vec3(), hit = new CANNON.RaycastResult(), ground = {skipBackfaces: true, collisionFilterMask: 1};
director.setCollision(createCameraCollision({raycast(start, end) {
 hit.reset();
 world.raycastClosest(rayStart.set(start.x, start.y, start.z), rayEnd.set(end.x, end.y, end.z), ground, hit);
 return hit.hasHit && hit.body !== chassis ? hit.distance : Infinity;
}}));

const keys = new Set(), input = {throttle: 0, steer: 0, handBrake: false}, target = new THREE.Vector3(), forward = new THREE.Vector3();
const clock = createFixedStep(), status = document.querySelector('#status');
function reset() {
 vehicle.teleport(0, field.heightAt(0, 0) + DROP_HEIGHT, 0, 0);
 clock.reset();
 director.reset();
}
reset();
function simulate(dt) {
 input.throttle = input.steer = 0;
 for (const key of keys) { const axis = KEYS[key]; if (axis) input[axis[0]] += axis[1]; }
 input.handBrake = keys.has('Space');
 vehicle.update(input);
 world.step(dt);
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
 const {position, quaternion} = chassis;
 if (position.y < field.geometry.boundingBox.min.y - GROUND.hills[0] || Math.max(Math.abs(position.x), Math.abs(position.z)) >= half) reset();
 car.position.copy(position);
 car.quaternion.copy(quaternion);
 vehicle.readWheels().forEach((wheel, i) => { wheels[i].position.copy(wheel.position); wheels[i].quaternion.copy(wheel.quaternion); });
 // The camera swings round behind the car, the shortest way; the mouse can still look around it.
 forward.set(0, 0, 1).applyQuaternion(car.quaternion);
 const behind = ((Math.atan2(forward.x, forward.z) - look.yaw) % TURN + TURN * 1.5) % TURN - Math.PI;
 look.look(behind * (1 - Math.exp(-dt * VIEW.follow)), 0);
 target.copy(car.position).y += VIEW.height;
 director.update(dt, {target});
 status.textContent = Math.round(Math.abs(vehicle.speed) * MS_TO_KMH) + ' km/h';
 stage.update(camera);
 renderer.render(scene, camera);
});
window.vehicleDemo = {vehicle, chassis, world, reset};
onLeave(() => {
 renderer.setAnimationLoop(null);
 window.removeEventListener('keydown', keydown);
 window.removeEventListener('keyup', keyup);
 window.removeEventListener('blur', blur);
 window.removeEventListener('mousemove', mousemove);
 renderer.domElement.removeEventListener('click', capturePointer);
 unbindResize();
 vehicle.dispose();
 driver.dispose();
 stage.dispose();
 field.dispose();
 suv.dispose();
 terrain.material.dispose();
 renderer.dispose();
});
