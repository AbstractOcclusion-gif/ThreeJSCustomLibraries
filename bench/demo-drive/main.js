// Mixed demo: a valley to walk and drive in, assembled from the kit's tools the way the World demo is. The terrain tool
// makes the valley (a closed corridor of the 'valley' biome, with its river), draws it in rings and lays its deformable
// play area under the player; the World demo's dressing puts rocks, grass and woods on it; the weather kit lights it,
// wets it and covers it in snow. On it: the bot (character tool) and the SUV (vehicle tool), see players.js. What they
// do to the ground reaches the other tools through their hooks, see reactions.js. This page only assembles.
import * as THREE from 'three';
import initJolt from 'jolt-physics';
import {CLIPMAP_DEFAULTS, cloneBiome, createSandLook, createTerrainAppearance, createTerrainClipmap, createTerrainMaterial, createTerrainWorld, SNOW_DEFAULTS, terrainLightGround} from '../../src/terrain/index.js';
import {createFixedStep} from '../../src/core/fixed-step.js';
import {createChips, createPuffs} from '../../src/particles/index.js';
import {createLighting, syncLighting} from '../../src/core/lighting.js';
import {createLightProbes, createLightRig, createSunShadows, createVolumetricLight} from '../../src/lighting/index.js';
import {createSurfaceWeather} from '../../src/surface/index.js';
import {createCameraCollision, createCameraDirector, createThirdPersonRig} from '../../src/camera/index.js';
import {createSceneFogScope} from '../kit/scene-fog.js';
import {createShadowReceivers} from '../kit/shadow-receivers.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchWeather, mountWeatherControls} from '../kit/weather.js';
import {loadTerrainPalette} from '../terrain/textures.js';
import {createTerrainPlay} from '../terrain/play.js';
import {CONTACT_SURFACES} from '../terrain/impacts.js';
import {groundTrackControls} from '../terrain/controls.js';
import {createBenchPanel} from '../panel.js';
import {worldCostControls, worldDressingControls, worldGroundControls, worldLightControls} from '../kit/world-controls.js';
import {createCraterEffects, CRATER_DUST, CRATER_SHARDS} from '../kit/crater-effects.js';
import {createWorldDressing} from '../demo-world/dressing.js';
import {PLAY_SNOW_FROM, RINGS_PER_FRAME, SHORE_WIDTH, VALLEY_SHAPE, WORLD_APPEARANCE as APPEARANCE, WORLD_BAKE as BAKE, WORLD_COST as COST, WORLD_LIGHT as LIGHT, WORLD_RINGS, WORLD_WEATHER as WEATHER} from '../kit/world-settings.js';
import {loadSuv} from '../vehicle/suv.js';
import {loadCharacter} from '../character/character.js';
import {createPlayers, PLAYERS} from './players.js';
import {connectSolids} from './solids.js';
import {connectReactions} from './reactions.js';
import {createRiver} from './river.js';
import {addJoltBlocks} from '../kit/jolt-blocks.js';
import '../bench.css';

// Rings, light, cost and weather settings are the kit's (bench/kit/world-settings.js), shared with the World demo.
const CLIP = {...CLIPMAP_DEFAULTS, ...WORLD_RINGS};
const SEED = 17, BIOME = 'valley';
// The valley: the kit's corridor shape, `length` m long, closed by its walls and at both ends, which rise over `endRamp` m.
// Small, so one deformable ground covers all of it.
const VALLEY = {...VALLEY_SHAPE, length: 128, endRamp: 24};
// The deformable ground: one square as long as the valley, laid once around its middle, at the terrain page's
// definition (25 cm cells, a track mask texel every 12.5 cm) and track contrast.
const GROUND = {size: VALLEY.length, cells: 512, trackResolution: 1024, trackContrast: .5};
// Under a car the mud gives way more than under the terrain page's test ball: rolling rut depth (m) and the share of
// the pressed soil pushed up beside the rut. Both can be changed from the panel.
const MUD = {print: .1, rimShare: .6};
const CAR_SQUARENESS = .8;   // the outline the car lands on, between an ellipse (0) and its rectangle (1)
// The river's box: the route sampled every `step` m, `margin` m wider than the floor.
const WATER = {step: 10, margin: 8};
// Where the two start: m along the valley, and m beside its route (the river runs along the route).
const SPAWN = {along: 48, car: 14, walker: 18, walkerAhead: 3};   // the floor lies 8 to 20 m from the route
// Something to jump from and to fall off, on the valley floor: the kit's blocks, each a ramp rising up the valley by
// `pitch` rad, its low end on the ground `beside` m from the route at `along` m. halfExtents m.
const COURSE = {color: 0xb9a27c, ramps: [
 {along: 68, beside: 14, halfExtents: [3, .15, 5], pitch: .3},      // a kicker: a jump at speed
 {along: 50, beside: -14, halfExtents: [3, .15, 10], pitch: .25},   // a long ramp to a drop of about 5 m
]};
// Particles thrown by the wheels: pool sizes of the chips (clods) and of the dust puffs.
const PARTICLES = {chips: CRATER_SHARDS.pool, puffs: CRATER_DUST.pool};   // enough for a crater's shards and dust
// Cameras: arm (m), angle above the target (rad), look-at height (m); the drive camera swings behind the car (1/s).
const VIEW = {
 near: .5, far: 6000,
 walk: {distance: 6, pitch: .38, yaw: 0, fov: 42, height: 1.05},
 drive: {distance: 9, pitch: .32, yaw: 0, fov: 50, height: 1.2, follow: 2.5},
 sensitivity: .0025,   // mouse turn, rad per pixel
};
const MOVE = {KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [1, 0], ArrowLeft: [1, 0], KeyD: [-1, 0], ArrowRight: [-1, 0]};
const RUN_KEYS = ['ShiftLeft', 'ShiftRight'], OTHER_KEYS = ['Space', 'KeyE', 'KeyR'];
const TURN = Math.PI * 2, MS_TO_KMH = 3.6, MS = 1000;

const $error = document.getElementById('error'), $status = document.getElementById('status');
const report = error => { $error.hidden = !error; $error.textContent = error?.message ?? ''; if (error) console.error(error); };
const renderer = benchRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, COST.pixelRatio));
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.walk.fov, innerWidth / innerHeight, VIEW.near, VIEW.far);
// What the panel switches: the costly parts, and whether the ground follows the weather or is set by hand.
const settings = {followWeather: true, wetness: 0, snow: 0, volumetric: true, sunShadows: true, cloudShadows: true, pixelRatio: renderer.getPixelRatio()};
const surfaces = structuredClone(CONTACT_SURFACES);
Object.assign(surfaces.mud, MUD);
const focus = new THREE.Vector3();   // where the player is: the rings, the dressing, the probes and the weather follow it

// The valley.
const {length, ...valleyShape} = VALLEY;
const worldOptions = {seed: SEED, biomes: [cloneBiome(BIOME)], water: true, corridor: {
 ...valleyShape, length, sectionMin: length, sectionMax: length, sections: [{biome: 0, length}]}};
const land = createTerrainWorld(worldOptions);
const route = land.corridor;
const spawn = {car: [route.routeX(SPAWN.along) + SPAWN.car, SPAWN.along],
 walker: [route.routeX(SPAWN.along + SPAWN.walkerAhead) + SPAWN.walker, SPAWN.along + SPAWN.walkerAhead],
 // Along the valley: the route's heading at the spawn, over one metre of it.
 heading: Math.atan2(route.routeX(SPAWN.along + 1) - route.routeX(SPAWN.along), 1)};
focus.set(spawn.walker[0], land.heightAt(...spawn.walker), spawn.walker[1]);

const weather = await createBenchWeather({scene, renderer, camera, lightTarget: focus, initial: WEATHER.initial, hour: WEATHER.hour, precipitation: WEATHER.rain});
weather.view.configure({sky: {captureInterval: COST.skyCapture, lightingInterval: COST.skyLighting}});
const {textures, missing} = await loadTerrainPalette(renderer, land.palette);
const appearance = createTerrainAppearance(), sandLook = createSandLook(), surfaceWeather = createSurfaceWeather();
for (const [key, value] of Object.entries(APPEARANCE)) appearance[key].value = value;
appearance.shoreWidth.value = SHORE_WIDTH;
appearance.waterLevel.value = land.waterLevel;
const cutout = {value: new THREE.Vector4()};   // the square of ground the play area draws in place of the rings
const clipmap = createTerrainClipmap({world: land, ...CLIP, ...BAKE, createMaterial: field => createTerrainMaterial({}, {
 field, palette: {...land.palette, means: textures.means}, layerArray: textures.layerArray, layerDetailArray: textures.layerDetailArray,
 detailNormal: textures.detail, appearance, sandLook, weather: surfaceWeather, cutout})});
scene.add(clipmap.group);
clipmap.update(focus.x, focus.z);
const environment = weather.view.environment;
const dressing = createWorldDressing({scene, world: land, renderer, environment, report});

// Light, as the World demo: sun and cloud shadows on every lit receiver, thin lit air, and light probes for what
// stands on the ground.
const sunShadows = createSunShadows({renderer, distance: LIGHT.shadowDistance});
const sunCover = [sunShadows.sun, weather.view.sunCover];
const lightRig = createLightRig({shadows: {renderer, casters: 1}});
const volumetric = createVolumetricLight({renderer, sun: sunCover, rig: lightRig, density: LIGHT.airDensity});
volumetric.set('sun', LIGHT.sunInAir);
const shadowReceivers = createShadowReceivers(scene, sunShadows, weather.view);
for (const {material} of clipmap.rings) lightRig.applyTo(material);
const probes = createLightProbes({ground: terrainLightGround({world: land, palette: {...land.palette, means: textures.means}, appearance, sandColor: sandLook.color.value})});
const lighting = createLighting({ambient: probes.ambient, sun: sunCover, lights: lightRig.lights});
// The river: reactive water over the whole valley floor, in the box the route sweeps.
const routeXs = Array.from({length: Math.floor(route.length / WATER.step) + 1}, (_, i) => route.routeX(i * WATER.step)), reach = VALLEY.width / 2 + WATER.margin;
const river = createRiver({renderer, scene, camera, land, route, weatherView: weather.view, sunCover,
 bounds: {x: [Math.floor(Math.min(...routeXs) - reach), Math.ceil(Math.max(...routeXs) + reach)], z: [0, route.length]}});
const withSceneFog = createSceneFogScope(scene, camera, lighting);
const probed = new WeakSet();
function findReceivers() {
 shadowReceivers.update();
 for (const group of dressing.probed) group.traverse(object => {
  if (!object.isMesh) return;
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
   if (!material.isMeshStandardMaterial || probed.has(material)) continue;
   probes.applyTo(material, lighting);
   probed.add(material);
  }
 });
}

// The play area, as the World demo sets it up: the terrain page's deformable ground, sampled in the World demo's
// worker, laid under the player and laid again when the player nears its edge (its marks are then lost).
const playCompileTarget = new THREE.WebGLRenderTarget(1, 1);
const playWorker = new Worker(new URL('../demo-world/play-worker.js', import.meta.url), {type: 'module'});
const playRequests = new Map();
let playRequestId = 0, playWorkerError;
playWorker.onmessage = ({data: {id, result, error}}) => {
 const request = playRequests.get(id);
 if (!request) return;
 playRequests.delete(id);
 if (error) request.reject(new Error(error)); else request.resolve(result);
};
playWorker.onerror = event => {
 playWorkerError = new Error(event.message || 'Terrain play worker failed');
 for (const request of playRequests.values()) request.reject(playWorkerError);
 playRequests.clear();
};
playWorker.postMessage({world: worldOptions});
const play = createTerrainPlay({scene, appearance, sandLook, weather: surfaceWeather, cutout, world: () => land, textures: () => textures,
 seed: () => SEED, rules: () => land.biomes[0].paint, ...GROUND, surfaces,
 sampleArea(request) {
  if (playWorkerError) return Promise.reject(playWorkerError);
  return new Promise((resolve, reject) => {
   const id = ++playRequestId;
   playWorker.postMessage({id, request});
   playRequests.set(id, {resolve, reject});
  });
 },
 async prepare(mesh) {
  shadowReceivers.update();
  const previous = renderer.getRenderTarget();
  let compiling;
  try {
   renderer.setRenderTarget(playCompileTarget);
   compiling = renderer.compileAsync(mesh, camera, scene);
  } finally { renderer.setRenderTarget(previous); }
  await compiling;
 }});
// Laid once, around the middle of the valley: it never moves, so every mark stays.
// The grass then follows its track mask: blades stay down along every rut and footprint.
Promise.resolve(play.lay(route.routeX(VALLEY.length / 2), VALLEY.length / 2)).then(area => { if (area) dressing.followTracks(area.tracks); }).catch(report);

// The two players, and what they do to the valley.
const snowLift = () => SNOW_DEFAULTS.driftDepth * surfaceWeather.levels.value.y;
const [J, suv, character] = await Promise.all([initJolt(), loadSuv(), loadCharacter('bot')]);
const players = createPlayers({J, suv, character, spawn,
 // The ground the two stand on: the relief, dug wherever the play area was (a crater).
 ground: {heightAt: (x, z) => Math.min(land.heightAt(x, z), play.area?.field.heightAt(x, z) ?? Infinity), lift: snowLift, waterLevelAt: () => land.waterLevel}});
scene.add(players.car, ...players.wheels, players.walker);
const course = addJoltBlocks({host: players.scenery, scene, color: COURSE.color, blocks: COURSE.ramps.map(({along, beside, halfExtents, pitch}) => {
 const x = route.routeX(along) + beside;
 // Its centre stands half its rise above the ground under its low end.
 return {halfExtents, pitch: -pitch, position: [x, land.heightAt(x, along - Math.cos(pitch) * halfExtents[2]) + Math.sin(pitch) * halfExtents[2], along]};
})});
const chips = createChips(scene, {pool: PARTICLES.chips});
chips.setGround(land.heightAt);
const puffs = await createPuffs(scene, {pool: PARTICLES.puffs, environment});
const solids = connectSolids({dressing, scenery: players.scenery});
const reactions = connectReactions({vehicle: players.vehicle, controller: players.controller, play, dressing, chips, puffs,
 wetness: () => surfaceWeather.levels.value.x, velocity: () => players.chassis.velocity, river,
 // The car as it lands: its length lies along its heading.
 car: () => ({x: players.chassis.position.x, z: players.chassis.position.z, mass: PLAYERS.chassis.mass,
  footprint: {halfX: suv.size.z / 2, halfZ: suv.size.x / 2, yaw: Math.PI / 2 - players.carHeading, squareness: CAR_SQUARENESS}}),
 walkerRadius: PLAYERS.walker.radius,
 craterEffects: createCraterEffects({chips, puffs, heightAt: (x, z) => play.area?.field.heightAt(x, z)}),
 onGroundChange: () => players.refreshGround()});

// Cameras: one third-person rig per seat; the ground pushes the camera in.
const rigs = {walk: createThirdPersonRig(VIEW.walk), drive: createThirdPersonRig(VIEW.drive)};
const director = createCameraDirector(camera).register('walk', rigs.walk).register('drive', rigs.drive);
director.setCollision(createCameraCollision({raycast: (start, end) => players.raycast(start, end)?.distance ?? Infinity}));
function aimCameras(heading) {
 for (const rig of Object.values(rigs)) { rig.reset(); rig.look(heading, 0); }
}

const keys = new Set(), input = {left: 0, ahead: 0, run: false, action: false, yaw: 0}, target = new THREE.Vector3(), clock = createFixedStep();
let swap = false;
function reset() {
 players.reset();
 chips.clear();
 river.clear();
 clock.reset();
 aimCameras(spawn.heading);
 director.select('walk', {duration: 0});
 director.reset();
}
function simulate(dt) {
 if (swap) {
  swap = false;
  const from = rigs[players.mode];
  if (players.swap()) {
   // The new seat's camera starts where the old one was looking.
   rigs[players.mode].look(from.yaw - rigs[players.mode].yaw, 0);
   director.select(players.mode);
  }
 }
 input.left = input.ahead = 0;
 for (const key of keys) { const axis = MOVE[key]; if (axis) { input.left += axis[0]; input.ahead += axis[1]; } }
 input.run = RUN_KEYS.some(key => keys.has(key));
 input.action = keys.has('Space');
 input.yaw = rigs.walk.yaw;
 players.step(dt, input);
}

function keydown(event) {
 if (!MOVE[event.code] && !RUN_KEYS.includes(event.code) && !OTHER_KEYS.includes(event.code)) return;
 if (event.target.closest?.('button, input, textarea, select, [contenteditable]')) return;
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
 if (document.pointerLockElement === renderer.domElement) rigs[players.mode].look(-event.movementX * VIEW.sensitivity, event.movementY * VIEW.sensitivity);
}
window.addEventListener('keydown', keydown);
window.addEventListener('keyup', keyup);
window.addEventListener('blur', blur);
window.addEventListener('mousemove', mousemove);
renderer.domElement.addEventListener('click', capturePointer);
const weatherUI = mountWeatherControls(weather);
const gui = createBenchPanel('Drive demo');
worldLightControls(gui, {settings, sunShadows, volumetric, probes, appearance}).close();
worldCostControls(gui, {settings, cost: COST, renderer, sunShadows, weather, volumetric, appearance}).close();
worldGroundControls(gui, settings);
groundTrackControls(gui, surfaces).open();
worldDressingControls(gui, dressing);
const unbindResize = bindResize(renderer, camera);
aimCameras(spawn.heading);

function hint() {
 if (players.mode === 'walk') return players.canSwap ? 'E · get in the car' : 'On foot';
 const {engine} = players.vehicle;
 return Math.round(players.speed * MS_TO_KMH) + ' km/h' + (engine < 1 ? engine > 0 ? ' · engine taking water' : ' · engine drowned (R resets)' : '')
  + (players.canSwap ? ' · E · get out' : '');
}
let lastStatus = -Infinity, lastScan = -Infinity, lastFrame = 0, frameMs = 0;
startFrameLoop(renderer, (dt, now) => {
 if (lastFrame) frameMs += (now - lastFrame - frameMs) * (frameMs ? COST.fpsSmoothing : 1);
 lastFrame = now;
 clock.advance(dt, simulate);
 players.update(dt);
 focus.copy(players.position);
 if (players.mode === 'drive') {
  // The camera swings round behind the car, the shortest way; the mouse can still look around it.
  const behind = ((players.carHeading - rigs.drive.yaw) % TURN + TURN * 1.5) % TURN - Math.PI;
  rigs.drive.look(behind * (1 - Math.exp(-dt * VIEW.drive.follow)), 0);
 }
 target.copy(focus).y += VIEW[players.mode].height;
 director.update(dt, {target});
 // From here on, the World demo's frame: weather, light, ground and dressing follow the focus, then the weather draws.
 weather.system.update(dt);
 weather.view.update(dt);
 syncLighting(lighting.uniforms, {sun: weather.view.sun, hemi: weather.view.hemi, fog: scene.fog});
 probes.update(focus.x, focus.z);
 if (now - lastScan >= LIGHT.scanSeconds * MS) { lastScan = now; findReceivers(); }
 if (settings.followWeather) {
  surfaceWeather.update(dt, weather.system.weather);
  settings.wetness = surfaceWeather.levels.value.x; settings.snow = surfaceWeather.levels.value.y;
 } else { surfaceWeather.set({wetness: settings.wetness, snow: settings.snow}); surfaceWeather.update(dt, null); }
 clipmap.group.position.y = snowLift();
 clipmap.update(focus.x, focus.z, RINGS_PER_FRAME);
 dressing.update(dt, camera, focus);
 play.setSnow(surfaceWeather.levels.value.y > PLAY_SNOW_FROM);
 play.update(dt);
 chips.update(dt);
 puffs.update(dt);
 river.update(dt);
 camera.updateMatrixWorld();
 lightRig.update(camera.position);
 lightRig.renderShadows(scene);
 if (settings.sunShadows) sunShadows.render(scene, camera, environment.sun.direction);
 // The water captures its bed with the frame's shadows, the weather draws the frame, the splashes go over it.
 withSceneFog(false, () => river.render());
 weather.view.render(settings.volumetric ? volumetric.capture(scene, camera, environment) : undefined);
 river.renderSplashes();
 weatherUI.sync();
 if (now - lastStatus >= STATUS_REFRESH_MS) {
  lastStatus = now;
  $status.textContent = hint() + `\n${frameMs ? Math.round(MS / frameMs) : 0} fps · ${Math.round(focus.z)} m of ${route.length} m`
   + `\nwetness ${surfaceWeather.levels.value.x.toFixed(2)} · snow ${surfaceWeather.levels.value.y.toFixed(2)}`
   + (missing.length ? '\nTexture sets not bundled, default used · ' + missing.join(', ') + ' · run npm run textures:fetch' : '');
 }
});
document.body.dataset.ready = 'true';
window.driveDemo = {players, land, clipmap, play, dressing, weather, surfaceWeather, chips, puffs, river, reset};
onLeave(() => {
 renderer.setAnimationLoop(null);
 window.removeEventListener('keydown', keydown);
 window.removeEventListener('keyup', keyup);
 window.removeEventListener('blur', blur);
 window.removeEventListener('mousemove', mousemove);
 renderer.domElement.removeEventListener('click', capturePointer);
 unbindResize(); weatherUI.dispose();
 reactions.dispose(); solids.dispose(); course.dispose(); players.dispose(); suv.dispose(); chips.dispose(); puffs.dispose(); river.dispose();
 shadowReceivers.dispose(); play.dispose(); dressing.dispose(); gui.destroy();
 sunShadows.dispose(); volumetric.dispose(); lightRig.dispose(); probes.dispose(); weather.view.dispose();
 scene.remove(clipmap.group); clipmap.dispose();
 for (const texture of Object.values(textures)) texture?.dispose?.();
 playWorker.terminate(); playRequests.clear(); playCompileTarget.dispose();
 const resources = new Set();
 players.walker.traverse(node => {
  if (!node.isMesh) return;
  resources.add(node.geometry);
  for (const material of [].concat(node.material)) { resources.add(material); if (material.map) resources.add(material.map); }
 });
 for (const resource of resources) resource.dispose();
 renderer.dispose();
});
