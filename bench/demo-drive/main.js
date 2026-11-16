// Mixed demo: a valley to walk and drive in. The terrain tool draws the ground, Jolt (through the destruction module's
// driver, with Cannon bodies as the model) carries the SUV from the vehicle module and the bot on the character
// controller; E swaps between the two. Wheels and feet stamp one track mask: the ground shows the marks and the grass
// lies down along them. The pond and the stream are the water module's inland surface: wheels and feet ripple and
// splash it, deep water drags the car and drowns its engine, and the walker wades.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import initJolt from 'jolt-physics';
import {createFixedStep} from '../../src/core/fixed-step.js';
import {createBasicStage} from '../../src/stage/index.js';
import {seededRandom} from '../../src/core/hash.js';
import {valueNoise} from '../../src/core/value-noise.js';
import {createTerrainAppearance, createTerrainField, createTerrainMaterial, TERRAIN_LAYERS} from '../../src/terrain/index.js';
import {createFreeVegetation, createGrassField} from '../../src/vegetation/index.js';
import {CHANNEL_OBSTACLE_COUNT, createChannelSurface, createFlowBake, createRipples, proceduralSky} from '../../src/water/index.js';
import {createImpactSplash, createParticleDepthBinding} from '../../src/particles/water/index.js';
import {createSurfaceWeather, createTrackMask} from '../../src/surface/index.js';
import {createCameraCollision, createCameraDirector, createThirdPersonRig} from '../../src/camera/index.js';
import {createCharacterController} from '../../src/character/index.js';
import {createVehicle} from '../../src/vehicle/index.js';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {createTerrainCollider} from '../terrain/heightfield.js';
import {grassCoverageAt} from '../terrain/controls.js';
import {loadTerrainTextures} from '../terrain/textures.js';
import {createBenchPondSettings} from '../water/controls.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop} from '../kit/page.js';
import {loadSuv} from '../demo-vehicle/suv.js';
import {loadCharacter} from '../outdoor/character.js';
import {createMarks} from './marks.js';
import {VALLEY, WATER_LEVEL, valleyHeights} from './valley.js';
import {carInWater, createWaterContacts, walkerInWater} from './wading.js';

// Ground paint: rock on steep slopes, mud up to mudBelow m (the banks), no snow or forest floor in this valley.
const RULES = {rockSlope: .8, snowLine: 60, mudBelow: .7, mudBlend: .9, forestCover: 0};
// One track mask over the whole valley; px per side.
const TRACK = {maskResolution: 2048, contrast: .5};
// Meadow: clumps tried over the valley floor (kept where the ground is grass and dry), the all-tools demo's look.
// cover: share of each ground layer that grows grass (%), patchiness and patch size (m) of the bare spots.
const GRASS = {
 tries: 90000, seed: 41, patchSeed: 23, shoreMargin: .06, sink: .02, tileSize: 6, flatColorMix: .75,
 color: '#50762e', dryColor: '#c2aa61', sizeRange: [.4, 1.75],
 cover: {grass: 100, rock: 0, snow: 0, mud: 0, forest: 24, patchiness: .85, patchSize: 5},
};
// Chassis: a low, flat physics box as wide and long as the model, so the car resists tipping.
const CHASSIS = {halfHeight: .25, mass: 1500};
// Suspension (m): mounts above the chassis centre, travel, and the length it settles at under this mass (measured).
const SUSPENSION = {mount: .15, min: .15, max: .4, rest: .33};
// Walker capsule and speeds (m/s) that sit on the locomotion clips; no steering in the air.
const PLAYER = {radius: .3, height: 1.7, walkSpeed: 1, runSpeed: 3.6, airControl: 0};
// Foot placement probes: reach above and below a foot (m) and the flattest normal a foot rests on.
const FOOT = {reach: .2, slopeNormal: .65};
// Getting in and out: how close to the car's centre the walker must be (m), how slow the car must be (m/s), and how
// far beside the body the walker is set down (m).
const DOOR = {reach: 3.2, maxSpeed: 1.5, gap: .9};
// Cameras: arm (m), angle above the target (rad), look-at height (m); the drive camera swings behind the car (1/s).
const VIEW = {
 walk: {distance: 6, pitch: .38, yaw: 0, fov: 42, height: 1.05},
 drive: {distance: 9, pitch: .32, yaw: 0, fov: 50, height: 1.2, follow: 2.5},
 sensitivity: .0025,   // mouse turn, rad per pixel
};
const DROP_HEIGHT = 1.2;       // m above the ground the car is set down from
// Water. The surface is cut from the terrain cells whose ground comes within `shore` m of the water level. The ripple
// field is one grid (cell m) from the stream's south bank to the pond's north bank (z from..to), across the valley.
const WATER = {shore: .65, rippleCell: .5, rippleZ: [-60, 60], softParticles: .25};
// Unseen walls just inside the valley's edge (m): a car at speed has the momentum to clear the rim.
const WALL = {inset: 3, height: 90, thickness: 2};
const MOVE = {KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [1, 0], ArrowLeft: [1, 0], KeyD: [-1, 0], ArrowRight: [-1, 0]};
const RUN_KEYS = ['ShiftLeft', 'ShiftRight'], OTHER_KEYS = ['Space', 'KeyE', 'KeyR'];
const TURN = Math.PI * 2, MS_TO_KMH = 3.6, GROUND_GROUP = 1;

const renderer = benchRenderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.walk.fov, 1, .1, 700);
renderer.shadowMap.enabled = true;
const unbindResize = bindResize(renderer, camera);
const half = VALLEY.span / 2;
const stage = createBasicStage({scene, ground: false, shadows: true, shadowExtent: half});
const status = document.querySelector('#status');

// Terrain: the terrain tool's material over the valley, with the track mask already bound for the tracks to come.
const field = createTerrainField({origin: [-half, -half], size: [VALLEY.span, VALLEY.span],
 resolution: [VALLEY.resolution, VALLEY.resolution], heights: valleyHeights(), rules: RULES});
const textures = await loadTerrainTextures(renderer, {layerDetail: true});
const appearance = createTerrainAppearance(), surfaceWeather = createSurfaceWeather();
const tracks = createTrackMask({origin: [-half, -half], size: [VALLEY.span, VALLEY.span], resolution: TRACK.maskResolution, directional: true});
const groundMaterial = createTerrainMaterial({}, {field, layerArray: textures.layerArray, layerDetailArray: textures.layerDetailArray,
 detailNormal: textures.detail, appearance, weather: surfaceWeather, tracks, trackContrast: TRACK.contrast, puddleSky: stage.skyUniforms});
const ground = new THREE.Mesh(field.geometry, groundMaterial);
ground.receiveShadow = true;
scene.add(ground);
// Grass over the valley floor, inside the rim. It reads the track mask, so it lies down where wheels and feet passed.
const meadow = createFreeVegetation({meadowBlades: true});
const placements = [], random = seededRandom(GRASS.seed), patchNoise = valueNoise(GRASS.patchSeed);
const green = new THREE.Color(GRASS.color), dryGrass = new THREE.Color(GRASS.dryColor), tint = new THREE.Color(), mudLayer = TERRAIN_LAYERS.indexOf('mud');
for (let i = 0; i < GRASS.tries; i++) {
 const x = (random() - .5) * VALLEY.rim[1] * 2, z = (random() - .5) * VALLEY.rim[1] * 2, chance = random(), yaw = random() * TURN, variation = random();
 const y = field.heightAt(x, z);
 if (Math.hypot(x, z) > VALLEY.rim[1] || y < WATER_LEVEL + GRASS.shoreMargin) continue;
 const patch = THREE.MathUtils.smoothstep(patchNoise(x / GRASS.cover.patchSize, z / GRASS.cover.patchSize), -.5, .5);
 if (chance >= grassCoverageAt(field, x, z, GRASS.cover, patch)) continue;
 const dry = Math.max(patch, field.layerWeightAt(x, z, mudLayer));
 tint.lerpColors(green, dryGrass, dry);
 placements.push({x, y: y - GRASS.sink, z, yaw, scale: THREE.MathUtils.lerp(...GRASS.sizeRange, .7 * (1 - dry) + .3 * variation), tint: tint.toArray()});
}
const grass = createGrassField({scene, geometries: meadow.grassGeometries, map: meadow.atlas, color: 0xffffff, placements,
 tileSize: GRASS.tileSize, flatColorMix: GRASS.flatColorMix, contactTracks: tracks, followTracks: true});
// Water: the inland surface over every terrain cell that can be wet, sharing the ground's heights as its bed.
const sky = proceduralSky();
sky.setEnvironment(stage.environment);
const ripples = createRipples({origin: [-half, WATER.rippleZ[0]],
 size: [Math.round(VALLEY.span / WATER.rippleCell), Math.round((WATER.rippleZ[1] - WATER.rippleZ[0]) / WATER.rippleCell)], cell: WATER.rippleCell});
ripples.mask((x, z) => field.heightAt(x, z) < WATER_LEVEL);
const obstacles = Array.from({length: CHANNEL_OBSTACLE_COUNT}, () => new THREE.Vector4());
const flowBake = createFlowBake();
const water = createChannelSurface({renderer, scene, camera, sky, ripples, obstacles, flow: flowBake, clipToBed: true, pondOptics: true});
const waterGeometry = field.geometry.clone(), waterPositions = waterGeometry.getAttribute('position'), bed = field.heightMap.image.data;
waterGeometry.setAttribute('bedHeight', new THREE.BufferAttribute(bed, 1));
for (let i = 0; i < waterPositions.count; i++) waterPositions.setY(i, 0);
const cells = field.geometry.index.array, wetCells = [];
for (let i = 0; i < cells.length; i += 3) {
 if (Math.min(bed[cells[i]], bed[cells[i + 1]], bed[cells[i + 2]]) < WATER_LEVEL + WATER.shore) wetCells.push(cells[i], cells[i + 1], cells[i + 2]);
}
waterGeometry.setIndex(wetCells);
waterGeometry.computeVertexNormals();
water.surface.geometry.dispose();
water.surface.geometry = waterGeometry;
water.surface.position.y = WATER_LEVEL;
const waterSettings = createBenchPondSettings();
// Splashes are drawn in their own pass over the frame, faded against the water's depth capture.
const fxScene = new THREE.Scene(), splashPoint = new THREE.Vector3();
const splashDepth = createParticleDepthBinding({THREE, camera, depthTexture: water.depthTexture, viewport: water.viewport,
 waterPlane: new THREE.Vector4(0, 1, 0, -WATER_LEVEL), softDistance: WATER.softParticles});
const splash = createImpactSplash({THREE, scene: fxScene, depth: splashDepth, lighting: {
 uniforms: {uSunCol: sky.uniforms.uSunCol, uFxAmbient: sky.uniforms.uAmb}, direction: sky.uniforms.uSkySunDir.value}});
splash.ready.catch(console.error);
const contacts = createWaterContacts({ripples, splash: (x, z, strength, radius) => splash.emit(splashPoint.set(x, WATER_LEVEL, z), strength, radius)});

// Physics.
const J = await initJolt();
const world = new CANNON.World({gravity: new CANNON.Vec3(0, -9.82, 0)});
const driver = createJoltDriver(J, {settleFreeze: false});
world.addBody(createTerrainCollider(field));
for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
 const along = half, across = WALL.thickness / 2, reach = half - WALL.inset;
 world.addBody(new CANNON.Body({mass: 0, position: new CANNON.Vec3(x * reach, 0, z * reach),
  shape: new CANNON.Box(new CANNON.Vec3(x ? across : along, WALL.height / 2, z ? across : along))}));
}
const [suv, character] = await Promise.all([loadSuv(), loadCharacter('bot')]);
const chassis = new CANNON.Body({mass: CHASSIS.mass, shape: new CANNON.Box(new CANNON.Vec3(suv.size.x / 2, CHASSIS.halfHeight, suv.size.z / 2))});
world.addBody(chassis);
driver.attach(world);
const vehicle = createVehicle({J, jolt: driver.native, body: driver.nativeBody(chassis), layer: driver.layers.moving,
 ...suv.layout, suspensionMount: SUSPENSION.mount, suspensionMin: SUSPENSION.min, suspensionMax: SUSPENSION.max});
const controller = createCharacterController({J, jolt: driver.native, layer: driver.layers.moving, ...PLAYER});
const marks = createMarks({tracks, heightAt: field.heightAt, waterLevel: WATER_LEVEL, wheelWidth: suv.layout.wheelWidth});

// The car model stands on y = 0 at its own origin: it hangs under the chassis centre so its arches meet the wheels.
const car = new THREE.Group(), {wheels} = suv;
suv.body.position.set(0, SUSPENSION.mount - SUSPENSION.rest - suv.layout.wheelRadius, -suv.centreZ);
car.add(suv.body);
const walker = new THREE.Group();
walker.add(character.model);
scene.add(car, ...wheels, walker);

const rigs = {walk: createThirdPersonRig(VIEW.walk), drive: createThirdPersonRig(VIEW.drive)};
const director = createCameraDirector(camera).register('walk', rigs.walk).register('drive', rigs.drive);
const rayStart = new CANNON.Vec3(), rayEnd = new CANNON.Vec3(), hit = new CANNON.RaycastResult();
const groundFilter = {collisionFilterMask: GROUND_GROUP, skipBackfaces: true};
function raycast(start, end) {
 hit.reset();
 world.raycastClosest(rayStart.set(start.x, start.y, start.z), rayEnd.set(end.x, end.y, end.z), groundFilter, hit);
 return hit.hasHit && hit.body !== chassis ? hit : null;
}
director.setCollision(createCameraCollision({raycast: (start, end) => raycast(start, end)?.distance ?? Infinity}));
const probeTop = new THREE.Vector3(), probeBottom = new THREE.Vector3();
function groundAt(foot, normal) {
 const found = raycast(probeTop.set(foot.x, foot.y + FOOT.reach, foot.z), probeBottom.set(foot.x, foot.y - FOOT.reach * 2, foot.z));
 if (!found || found.hitNormalWorld.y < FOOT.slopeNormal) return NaN;
 normal.copy(found.hitNormalWorld);
 return found.hitPointWorld.y;
}

const keys = new Set(), move = new THREE.Vector2(), drive = {throttle: 0, steer: 0, handBrake: false};
const target = new THREE.Vector3(), forward = new THREE.Vector3(), left = new THREE.Vector3(), clock = createFixedStep();
let mode = 'walk', grounded = false, jumped = false, swap = false;
// Height of the chassis centre over the wheel bottoms: what the water level is measured against on the car.
const rideHeight = suv.layout.wheelRadius + SUSPENSION.rest - SUSPENSION.mount;
let time = 0, engine = 1;   // engine: share of the throttle the engine answers (1 = dry, 0 = drowned)
const carHeading = () => { forward.set(0, 0, 1).applyQuaternion(chassis.quaternion); return Math.atan2(forward.x, forward.z); };
const doorDistance = () => Math.hypot(controller.position.x - chassis.position.x, controller.position.z - chassis.position.z);

function reset() {
 const [carX, carZ] = VALLEY.spawn.car, [walkX, walkZ] = VALLEY.spawn.walker;
 vehicle.teleport(carX, field.heightAt(carX, carZ) + DROP_HEIGHT, carZ, 0);
 controller.teleport(walkX, field.heightAt(walkX, walkZ), walkZ, 0);
 mode = 'walk';
 walker.visible = true;
 grounded = jumped = swap = false;
 character.reset();
 marks.reset();
 contacts.reset();
 ripples.clear();
 splash.clear();
 chassis.force.setZero();
 clock.reset();
 director.select('walk', {duration: 0});
 director.reset();
}
// E: into the car when standing next to it, out of it once it is nearly stopped, set down beside the left door.
function swapSeats() {
 if (mode === 'walk') {
  if (doorDistance() > DOOR.reach) return;
  mode = 'drive';
  walker.visible = false;
  // The drive camera starts where the walk camera was looking.
  rigs.drive.look(rigs.walk.yaw - rigs.drive.yaw, 0);
 } else {
  if (Math.abs(vehicle.speed) > DOOR.maxSpeed) return;
  const heading = carHeading();
  left.set(1, 0, 0).applyQuaternion(chassis.quaternion).setY(0).normalize().multiplyScalar(suv.size.x / 2 + DOOR.gap);
  const x = chassis.position.x + left.x, z = chassis.position.z + left.z;
  const floor = field.heightAt(x, z);
  controller.teleport(x, Number.isFinite(floor) ? floor : chassis.position.y, z, heading);
  mode = 'walk';
  walker.visible = true;
  character.reset();
  rigs.walk.look(rigs.drive.yaw - rigs.walk.yaw, 0);
 }
 director.select(mode);
}

function simulate(dt) {
 if (swap) { swap = false; swapSeats(); }
 move.set(0, 0);
 for (const key of keys) { const axis = MOVE[key]; if (axis) { move.x += axis[0]; move.y += axis[1]; } }
 // Water on the car: drag against its velocity, and an engine that drowns as the water climbs over it.
 const flooded = carInWater(WATER_LEVEL - (chassis.position.y - rideHeight)), drift = chassis.velocity, driftSpeed = drift.length();
 chassis.force.set(-drift.x * driftSpeed * flooded.drag, -drift.y * driftSpeed * flooded.drag, -drift.z * driftSpeed * flooded.drag);
 engine = flooded.throttle;
 if (mode === 'drive') {
  // A / D give +1 / -1 on move.x (left is +X); the vehicle wants steer right positive.
  drive.throttle = move.y * flooded.throttle; drive.steer = -move.x; drive.handBrake = keys.has('Space');
  vehicle.update(drive);
 } else {
  // The parked car holds its handbrake. Keys are relative to the camera: forward is the way it looks.
  drive.throttle = drive.steer = 0; drive.handBrake = true;
  vehicle.update(drive);
  if (move.lengthSq() > 1) move.normalize();
  move.multiplyScalar(walkerInWater(WATER_LEVEL - controller.position.y));
  const sin = Math.sin(rigs.walk.yaw), cos = Math.cos(rigs.walk.yaw);
  controller.update(dt, {moveX: sin * move.y + cos * move.x, moveZ: cos * move.y - sin * move.x,
   run: RUN_KEYS.some(key => keys.has(key)), jump: keys.has('Space')});
  grounded = controller.grounded;
  jumped ||= controller.jumped;
 }
 world.step(dt);
}

function keydown(event) {
 if (!MOVE[event.code] && !RUN_KEYS.includes(event.code) && !OTHER_KEYS.includes(event.code)) return;
 event.preventDefault();
 keys.add(event.code);
 if (event.repeat) return;
 if (event.code === 'KeyE') swap = true;
 if (event.code === 'KeyR') reset();
}
function keyup(event) { keys.delete(event.code); }
function blur() { keys.clear(); }
function capturePointer() { renderer.domElement.requestPointerLock(); }
function mousemove(event) {
 if (document.pointerLockElement === renderer.domElement) rigs[mode].look(-event.movementX * VIEW.sensitivity, event.movementY * VIEW.sensitivity);
}
window.addEventListener('keydown', keydown);
window.addEventListener('keyup', keyup);
window.addEventListener('blur', blur);
window.addEventListener('mousemove', mousemove);
renderer.domElement.addEventListener('click', capturePointer);
reset();

startFrameLoop(renderer, dt => {
 clock.advance(dt, simulate);
 const outside = body => Math.max(Math.abs(body.x), Math.abs(body.z)) >= half || body.y < field.geometry.boundingBox.min.y - VALLEY.rim[0];
 if (outside(chassis.position) || outside(controller.position)) reset();
 car.position.copy(chassis.position);
 car.quaternion.copy(chassis.quaternion);
 vehicle.readWheels().forEach((wheel, i) => { wheels[i].position.copy(wheel.position); wheels[i].quaternion.copy(wheel.quaternion); });
 marks.wheels(dt, vehicle.wheels);
 const carSpeed = Math.abs(vehicle.speed);
 for (const wheel of vehicle.wheels) contacts.touch(dt, wheel.name, {x: wheel.position.x, z: wheel.position.z,
  depth: WATER_LEVEL - (wheel.position.y - suv.layout.wheelRadius), speed: carSpeed, size: 1});
 if (mode === 'walk') {
  marks.feet(dt, {x: controller.position.x, z: controller.position.z, heading: controller.heading, speed: controller.speed, grounded});
  contacts.touch(dt, 'walker', {x: controller.position.x, z: controller.position.z, depth: WATER_LEVEL - controller.position.y, speed: controller.speed});
  walker.position.copy(controller.position);
  walker.rotation.y = controller.heading;
  character.update(dt, {moving: move.lengthSq() > 0, speed: controller.speed, grounded, jumped, preview: false, groundAt});
  jumped = false;
  target.copy(walker.position).y += VIEW.walk.height;
  status.textContent = doorDistance() <= DOOR.reach ? 'E · get in the car' : 'On foot';
 } else {
  // The camera swings round behind the car, the shortest way; the mouse can still look around it.
  const behind = ((carHeading() - rigs.drive.yaw) % TURN + TURN * 1.5) % TURN - Math.PI;
  rigs.drive.look(behind * (1 - Math.exp(-dt * VIEW.drive.follow)), 0);
  target.copy(car.position).y += VIEW.drive.height;
  const speed = Math.abs(vehicle.speed);
  status.textContent = Math.round(speed * MS_TO_KMH) + ' km/h' + (engine < 1 ? engine > 0 ? ' · engine taking water' : ' · engine drowned (R resets)' : '')
   + (speed <= DOOR.maxSpeed ? ' · E · get out' : '');
 }
 director.update(dt, {target});
 grass.update(dt, {camera});
 stage.update(camera);
 time += dt;
 ripples.update(dt);
 splash.update(dt);
 // The water captures its bed first, then the frame is drawn, then the splashes over it.
 water.render(time, {...waterSettings, waveTime: time});
 renderer.render(scene, camera);
 if (splash.active > 0) {
  renderer.autoClear = false;
  try { renderer.render(fxScene, camera); }
  finally { renderer.autoClear = true; }
 }
});
window.driveDemo = {vehicle, controller, chassis, world, field, tracks, ripples, water, reset};
onLeave(() => {
 renderer.setAnimationLoop(null);
 window.removeEventListener('keydown', keydown);
 window.removeEventListener('keyup', keyup);
 window.removeEventListener('blur', blur);
 window.removeEventListener('mousemove', mousemove);
 renderer.domElement.removeEventListener('click', capturePointer);
 unbindResize();
 vehicle.dispose();
 controller.dispose();
 driver.dispose();
 suv.dispose();
 splash.dispose();
 water.dispose();
 flowBake.dispose?.();
 ripples.dispose();
 waterGeometry.dispose();
 grass.dispose();
 meadow.dispose();
 tracks.dispose();
 stage.dispose();
 field.dispose();
 const resources = new Set([groundMaterial, textures.layerArray, textures.layerDetailArray, textures.detail, textures.rock]);
 walker.traverse(node => {
  if (!node.isMesh) return;
  resources.add(node.geometry);
  for (const material of [].concat(node.material)) { resources.add(material); if (material.map) resources.add(material.map); }
 });
 for (const resource of resources) resource?.dispose?.();
 renderer.dispose();
});
