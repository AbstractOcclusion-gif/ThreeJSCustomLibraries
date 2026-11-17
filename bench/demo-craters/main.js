// Crater demo: the terrain field's craters wired to other modules through its 'terrain:crater' event. The terrain
// digs, paints and reports; particles throw the shards and dust; the destruction module's Jolt driver flies the clods
// and carries the launched objects, whose mass, speed and outline make the crater they land in. This page only wires them.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import initJolt from 'jolt-physics';
import {Body, Box, Sphere, Vec3, World} from 'cannon-es';
import {createBenchPanel} from '../panel.js';
import {cloneBiome, craterFootprint, craterFromImpact, createTerrainAppearance, createTerrainField, createTerrainMaterial, createTerrainWorld, CRATER_DEFAULTS} from '../../src/terrain/index.js';
import {createSurfaceWeather} from '../../src/surface/index.js';
import {createChips, createPuffs} from '../../src/particles/index.js';
import {createFreeVegetation, createGrassField} from '../../src/vegetation/index.js';
import {LeavedTrees, meanLeafLuminance} from '../../src/trees/index.js';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {createFixedStep, FREE_ATLAS_RECTS, hash2, seededRandom} from '../../src/core/index.js';
import {createSunShadows} from '../../src/lighting/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchWeather, mountWeatherControls} from '../kit/weather.js';
import {createShadowReceivers} from '../kit/shadow-receivers.js';
import {aimRay} from '../kit/input.js';
import {loadTerrainPalette} from '../terrain/textures.js';
import {createTerrainCollider} from '../../src/terrain/physics.js';
import {craterControls, craterLook, craterTool} from '../terrain/controls.js';
import {createCraterEffects, CRATER_DUST as DUST, CRATER_SHARDS as SHARDS, STRATA_TINT} from '../kit/crater-effects.js';
import '../bench.css';

// Ground: a square `span` m wide, `resolution` samples a side (25 cm cells), of the world of one `biome`.
const TERRAIN = {span: 64, resolution: 257, biome: 'plains', seed: 11};
// Clods (Jolt bodies): count from the thrown volume (m³ x perCubicMetre, at most perBlast, `hardShare` more of
// them on hard ground). Edge size in m: a share of the crater reach, within [minSize, maxSize]. Thrown from the rim
// at `speed` x sqrt(g x reach) m/s (each between `spread` shares of it), `rise` of it upward, so they land from
// the rim out to a few crater widths. `stayShare` of them stay where they come to rest, the others are removed after
// `life` s; at most `max` are alive, the oldest making room.
const CLODS = {perCubicMetre: 1.1, perBlast: 22, hardShare: .6, max: 90, life: 14, stayShare: .45, sizeShare: .1, minSize: .12, maxSize: .6,
  speed: 1, spread: [.55, 1.5], rise: .72, density: 1600, spin: 6};
const GRAVITY = 9.82;
const TREE_VARIANT_SEED = 9;   // the hash seed leaved trees draw a silhouette variant with (leaved-trees.js)
// Plants on the ground: `grass` clumps and `trees` (height range in m; the crown radius is `crown` x the height),
// kept `edge` m inside the field. A crater removes the grass inside its outline, thins it under the thrown soil out
// to `grassThinTo` (normalised distance) and lays the rest back on the new ground. A tree inside the outline is
// blown to `chips` wood chips; one within `fellTo` tips over away from the crater in `fallSeconds`, to `fallAngle`
// degrees; at most `felled` lie on the ground, the oldest making room.
const PLANTS = {seed: 23, grass: 9000, trees: 16, edge: 2, treeHeight: [4.5, 7.5], crown: .34, grassThinTo: 2, grassSink: .02,
  fellTo: 2.4, fallSeconds: 1.6, fallAngle: 84, felled: 10, chips: 30, woodColor: 0x6b4a2b};
// Launched objects. Each: its collider (a sphere `radius` or a box `half` extents, m, at size 1), the outline it
// lands on (`squareness` of craterFootprint; a box lands on its X and Z extents, `footprint` overrides them: the
// plane's wings), its density (kg/m³ of its collider) and its default launch. A plane is a fuselage collider drawn
// with wings and a tail.
const OBJECTS = {
  rock: {label: 'Small rock', radius: .35, density: 2600, launch: {speed: 30, angle: 10}},
  boulder: {label: 'Boulder', radius: 1.1, density: 2400, launch: {speed: 22, angle: 0}},
  crate: {label: 'Crate', half: [1.4, .8, .9], squareness: 1, density: 700, launch: {speed: 20, angle: 0}},
  beam: {label: 'Steel beam', half: [2.6, .18, .18], squareness: 1, density: 7800, launch: {speed: 25, angle: 30}},
  slab: {label: 'Concrete slab', half: [1.7, .14, 1.2], squareness: 1, density: 2400, launch: {speed: 18, angle: 0}},
  plane: {label: 'Plane', half: [3.2, .5, .5], footprint: [3.2, 2.6], squareness: .3, density: 350, launch: {speed: 55, angle: 72},
    wings: {half: [.55, .06, 2.6], offset: [.3, 0, 0]}, tail: {half: [.35, .5, .05], offset: [-2.8, .6, 0]}},
};
// Launch: the object starts `distance` m back along its path from the clicked point. It craters on a ground contact
// (craterFromImpact, from its mass, its velocity before the contact and its outline as it lies), at most `craters`
// times, `cooldown` s apart: a sliding plane ploughs more than once. Removed after `life` s.
const LAUNCH = {distance: 34, craters: 3, cooldown: .3, life: 30, speed: [2, 80], angle: [0, 82], size: [.4, 2.5], density: [.2, 4]};
const STEP = 1 / 60;   // the Jolt driver's rigid step
const RECEIVER_SCAN_SECONDS = 2;   // how often new lit materials (clods, drops) are given the sun shadows
const ACTIONS = {None: 'none', 'Blast a crater': 'blast', 'Launch the object': 'launch'};

const $ = id => document.getElementById(id);
const renderer = benchRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .2, 900);
camera.position.set(30, 20, 32);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 3, 0); orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * .48; orbit.update();
const weather = await createBenchWeather({scene, renderer, camera, lightTarget: new THREE.Vector3(), initial: 'clear', hour: 15, precipitation: false});
const sunShadows = createSunShadows({renderer, distance: TERRAIN.span * 1.5});
const shadowReceivers = createShadowReceivers(scene, sunShadows, weather.view);

// Terrain: a field cut from a one-biome world, which paints it with the biome's own texture sets (grass, soil,
// scree, rock), so a crater shows real subsoil and rubble.
const {span, resolution, biome, seed} = TERRAIN, half = span / 2, spacing = span / (resolution - 1);
const world = createTerrainWorld({seed, biomes: [cloneBiome(biome)]});
const heights = Float32Array.from({length: resolution ** 2}, (_, i) => world.heightAt((i % resolution) * spacing - half, Math.floor(i / resolution) * spacing - half, spacing));
const field = createTerrainField({origin: [-half, -half], size: [span, span], resolution: [resolution, resolution], heights, seed,
  paintAt: sample => world.paintAt(sample), paletteSize: world.palette.size});
const {textures} = await loadTerrainPalette(renderer, world.palette);
const surfaceWeather = createSurfaceWeather();
const groundMaterial = createTerrainMaterial({}, {field, palette: {...world.palette, means: textures.means}, layerArray: textures.layerArray, layerDetailArray: textures.layerDetailArray,
  detailNormal: textures.detail, appearance: createTerrainAppearance(), weather: surfaceWeather});
const ground = new THREE.Mesh(field.geometry, groundMaterial);
ground.receiveShadow = true;
scene.add(ground);

// Physics: Cannon bodies as the model, Jolt solving them (the destruction module's driver).
const J = await initJolt();
const physics = new World({gravity: new Vec3(0, -GRAVITY, 0), allowSleep: true});
const driver = createJoltDriver(J);
const groundBody = createTerrainCollider(field);
const [groundShape] = groundBody.shapes;
physics.addBody(groundBody);
driver.attach(physics);
const fixedStep = createFixedStep({step: STEP});
// The terrain writes every edited height into the collider; the Jolt copy is rebuilt once a crater is done.
const onHeightSample = (x, z, value) => groundShape.setHeightValueAtIndex(z, x, value);
let groundChanged = false;

// Particles.
const chips = createChips(scene, {pool: SHARDS.pool});
chips.setGround(field.heightAt);
const puffs = await createPuffs(scene, {pool: DUST.pool, environment: weather.view.environment});

// Plants: the vegetation module's grass and the trees module's leaved trees. Neither knows about craters: this page
// takes them out, lays them back or tips them over when the terrain reports one.
const plantRandom = seededRandom(PLANTS.seed), spot = () => (plantRandom() * 2 - 1) * (half - PLANTS.edge);
const meadow = createFreeVegetation({meadowBlades: true});
const grassSites = Array.from({length: PLANTS.grass}, () => {
  const x = spot(), z = spot();
  return {x, y: field.heightAt(x, z) - PLANTS.grassSink, z, yaw: plantRandom() * Math.PI * 2, scale: .7 + plantRandom() * .9};
});
const treeSites = Array.from({length: PLANTS.trees}, () => {
  const h = THREE.MathUtils.lerp(...PLANTS.treeHeight, plantRandom());
  return {x: spot(), z: spot(), yaw: plantRandom() * Math.PI * 2, h, r: h * PLANTS.crown};
});
const layGrass = placements => createGrassField({scene, geometries: meadow.grassGeometries, map: meadow.atlas, color: 0xffffff, tileSize: 8, flatColorMix: .75, placements});
let grassPlacements = grassSites.map(site => ({...site})), grass = layGrass(grassPlacements);
const trees = new LeavedTrees({scene, profile: 'tree', sampleGround: (x, z) => field.heightAt(x, z) ?? 0});
trees.setEnvironment(weather.view.environment);
let standing = [...treeSites];
trees.place(standing);
// A felled tree is drawn by leaved trees of its own, on the standing trees' atlas, so it can be turned about its foot.
const leafLuminance = meanLeafLuminance(trees.leafTexture, FREE_ATLAS_RECTS.leaf), felled = [];
const fallAxis = new THREE.Vector3();
function fell(site, awayX, awayZ) {
  if (felled.length >= PLANTS.felled) felled.shift().tree.dispose();
  const tree = new LeavedTrees({scene, profile: 'tree', leafTexture: trees.leafTexture, leafRect: FREE_ATLAS_RECTS.leaf, barkTexture: trees.leafTexture, barkRect: FREE_ATLAS_RECTS.bark, leafLuminance});
  tree.setEnvironment(weather.view.environment);
  // The same silhouette it stood with: leaved trees draw the variant from the position.
  const variants = trees.profile.variants;
  tree.place([{...site, x: 0, z: 0, variant: Math.floor(hash2(site.x, site.z, TREE_VARIANT_SEED) * variants) % variants}]);
  tree.group.position.set(site.x, field.heightAt(site.x, site.z) ?? 0, site.z);
  const length = Math.hypot(awayX, awayZ) || 1;
  // Turning about this axis lowers the crown away from the crater.
  felled.push({tree, axis: new THREE.Vector3(awayZ / length, 0, -awayX / length), age: 0});
}
function plantsReact(event, y) {
  const footprint = craterFootprint(event.shape), sink = PLANTS.grassSink;
  grassPlacements = grassPlacements.filter(site => {
    const dx = site.x - event.x, dz = site.z - event.z;
    if (Math.abs(dx) > event.outer || Math.abs(dz) > event.outer) return true;
    const t = footprint.distance(dx, dz);
    if (t < 1 || Math.random() < 1 - (t - 1) / (PLANTS.grassThinTo - 1)) return false;
    site.y = (field.heightAt(site.x, site.z) ?? site.y + sink) - sink;
    return true;
  });
  grass.dispose();
  grass = layGrass(grassPlacements);
  const before = standing.length;
  standing = standing.filter(site => {
    const dx = site.x - event.x, dz = site.z - event.z, t = footprint.distance(dx, dz);
    if (t >= PLANTS.fellTo) return true;
    if (t < 1) chips.emit(origin.set(site.x, y + site.h / 2, site.z), {color: PLANTS.woodColor, chips: PLANTS.chips, size: SHARDS.size}, SHARDS.maxShock);
    else fell(site, dx, dz);
    return false;
  });
  if (standing.length !== before) trees.place(standing);
}
function updatePlants(dt) {
  grass.update(dt, {camera, environment: weather.view.environment});
  trees.update(dt);
  for (const entry of felled) {
    entry.tree.update(dt);
    if (entry.age >= PLANTS.fallSeconds) continue;
    entry.age = Math.min(PLANTS.fallSeconds, entry.age + dt);
    // Slow to start, fast to land, as a trunk falls.
    entry.tree.group.quaternion.setFromAxisAngle(fallAxis.copy(entry.axis), THREE.MathUtils.degToRad(PLANTS.fallAngle) * (entry.age / PLANTS.fallSeconds) ** 2);
  }
}
function resetPlants() {
  for (const {tree} of felled) tree.dispose();
  felled.length = 0;
  standing = [...treeSites];
  trees.place(standing);
  grassPlacements = grassSites.map(site => ({...site}));
  grass.dispose();
  grass = layGrass(grassPlacements);
}

// Clods and dropped objects: Jolt bodies with a mesh each.
const clodGeometry = new THREE.DodecahedronGeometry(.5 * Math.sqrt(3) / 1.2, 0);   // about a unit box, rounded
const strataMaterials = Object.fromEntries(Object.entries(STRATA_TINT).map(([name, tint]) => [name, new THREE.MeshStandardMaterial({color: tint, roughness: .95, flatShading: true})]));
const objectMaterial = new THREE.MeshStandardMaterial({color: '#8d8a84', roughness: .8});
const unitSphere = new THREE.SphereGeometry(1, 24, 16), unitBox = new THREE.BoxGeometry(2, 2, 2);   // scaled per object
const moving = [];   // {body, mesh, age, life, owned geometry?}
function addMoving(body, mesh, life) {
  physics.addBody(body);
  scene.add(mesh);
  moving.push({body, mesh, age: 0, life});
}
function removeMoving(index) {
  const [entry] = moving.splice(index, 1);
  physics.removeBody(entry.body);
  scene.remove(entry.mesh);
}
const clodCount = () => moving.reduce((count, entry) => count + (entry.clod ? 1 : 0), 0);

// The wiring: what a crater throws out, by the strata it cut.
const effects = {shards: true, dust: true, clods: true, plants: true};
const {throwShards, throwDust, aroundCrater, escapeSpeed, origin, rimPoint, outward} = createCraterEffects({chips, puffs, heightAt: (x, z) => field.heightAt(x, z)});
function throwClods(event, y) {
  const strata = Object.entries(event.strata).filter(([, share]) => share > 0);
  const count = Math.min(CLODS.perBlast, Math.round(event.ejecta * CLODS.perCubicMetre * (1 + CLODS.hardShare * event.hardness)));
  const launch = CLODS.speed * escapeSpeed(event), size = THREE.MathUtils.clamp(event.reach * CLODS.sizeShare, CLODS.minSize, CLODS.maxSize);
  for (let i = 0; i < count; i++) {
    // The oldest clod makes room for a new one.
    if (clodCount() >= CLODS.max) removeMoving(moving.findIndex(entry => entry.clod));
    // Each clod is drawn from a stratum by its share of the dug volume.
    let pick = Math.random(), stratum = strata.at(-1)[0];
    for (const [name, share] of strata) if ((pick -= share) < 0) { stratum = name; break; }
    const edge = size * (.6 + .8 * Math.random());
    aroundCrater(event, i, count, 1.05, y);
    const body = new Body({mass: CLODS.density * edge ** 3, shape: new Box(new Vec3(edge / 2, edge / 2, edge / 2)), position: new Vec3(rimPoint.x, rimPoint.y + edge, rimPoint.z), angularDamping: .3});
    const speed = launch * THREE.MathUtils.lerp(...CLODS.spread, Math.random()), out = speed * Math.sqrt(1 - CLODS.rise ** 2);
    body.velocity.set(outward.x * out, speed * CLODS.rise, outward.z * out);
    body.angularVelocity.set((Math.random() - .5) * CLODS.spin, (Math.random() - .5) * CLODS.spin, (Math.random() - .5) * CLODS.spin);
    const mesh = new THREE.Mesh(clodGeometry, strataMaterials[stratum]);
    mesh.scale.setScalar(edge);
    mesh.castShadow = mesh.receiveShadow = true;
    addMoving(body, mesh, Math.random() < CLODS.stayShare ? Infinity : CLODS.life);
    moving.at(-1).clod = true;
  }
}
field.subscribe(event => {
  groundChanged = true;
  const y = event.height ?? field.heightAt(event.x, event.z);
  if (effects.shards) throwShards(event, y);
  if (effects.dust) throwDust(event, y);
  if (effects.clods) throwClods(event, y);
  if (effects.plants) plantsReact(event, y);
});

// A launched object makes its own crater: the terrain's craterFromImpact turns its mass, velocity and outline into
// the crater's shape, depth and travel.
const launch = {object: 'boulder', size: 1, density: 1, ...OBJECTS.boulder.launch};
const pendingImpacts = [];
function boxMesh(half, offset = [0, 0, 0]) {
  const mesh = new THREE.Mesh(unitBox, objectMaterial);
  mesh.scale.set(...half); mesh.position.set(...offset);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function launchObject(point) {
  const spec = OBJECTS[launch.object], size = launch.size;
  const half = spec.half?.map(h => h * size), radius = spec.radius && spec.radius * size;
  const volume = radius ? 4 / 3 * Math.PI * radius ** 3 : half.reduce((a, b) => a * b * 2, 1);
  // Flies away from the camera, `angle` degrees off the vertical, to arrive at the clicked point.
  const away = Math.atan2(point.z - camera.position.z, point.x - camera.position.x), tilt = THREE.MathUtils.degToRad(launch.angle);
  const direction = new Vec3(Math.cos(away) * Math.sin(tilt), -Math.cos(tilt), Math.sin(away) * Math.sin(tilt));
  const body = new Body({mass: spec.density * launch.density * volume, shape: radius ? new Sphere(radius) : new Box(new Vec3(...half)), angularDamping: .2,
    position: new Vec3(point.x - direction.x * LAUNCH.distance, point.y - direction.y * LAUNCH.distance, point.z - direction.z * LAUNCH.distance)});
  body.velocity.copy(direction.scale(launch.speed));
  if (half) body.quaternion.setFromEuler(0, -away, 0);   // its length along its path
  let mesh;
  if (radius) { mesh = new THREE.Mesh(unitSphere, objectMaterial); mesh.scale.setScalar(radius); mesh.castShadow = mesh.receiveShadow = true; }
  else {
    mesh = new THREE.Group();
    mesh.add(boxMesh(half));
    for (const part of [spec.wings, spec.tail]) if (part) mesh.add(boxMesh(part.half.map(h => h * size), part.offset.map(o => o * size)));
  }
  addMoving(body, mesh, LAUNCH.life);
  const entry = Object.assign(moving.at(-1), {spec, size, radius, half, craters: 0, nextCrater: 0, before: new Vec3()});
  body.addEventListener('collide', ({body: other}) => {
    if (other !== groundBody || entry.craters >= LAUNCH.craters || physics.time < entry.nextCrater) return;
    entry.craters++; entry.nextCrater = physics.time + LAUNCH.cooldown;
    pendingImpacts.push(entry);   // the physics callback only records it; the ground changes between steps
  });
}
const lengthAxis = new THREE.Vector3(), turned = new THREE.Quaternion();
// The outline an object lies on: a sphere's circle; a box's X and Z extents turned by the heading of its length.
function footprintOf({spec, size, radius, half, body}) {
  if (radius) return radius;
  lengthAxis.set(1, 0, 0).applyQuaternion(turned.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w));
  const [halfX, halfZ] = spec.footprint ? spec.footprint.map(h => h * size) : [half[0], half[2]];
  return {halfX, halfZ, yaw: Math.atan2(lengthAxis.z, lengthAxis.x), squareness: spec.squareness};
}
function landImpacts() {
  for (const entry of pendingImpacts) {
    const {before, body} = entry;
    const impact = craterFromImpact({footprint: footprintOf(entry), mass: body.mass, velocity: [before.x, before.y, before.z]});
    if (impact) field.crater(body.position.x, body.position.z, impact.shape, impact.depth, onHeightSample, {...craterLook(crater), travel: impact.travel});
  }
  pendingImpacts.length = 0;
}

// Panel.
const gui = createBenchPanel('Craters');
const action = {mode: 'blast'};
const crater = {blast: true, shape: 'round', radius: 3, width: .5, yaw: 0, depth: 2.5, rimShare: CRATER_DEFAULTS.rimShare, ragged: CRATER_DEFAULTS.ragged, rays: CRATER_DEFAULTS.rays, hardness: CRATER_DEFAULTS.hardness};
const clickFolder = gui.addFolder('Click action');
clickFolder.add(action, 'mode', ACTIONS).name('Click does').onChange(mode => { orbit.enabled = mode === 'none'; crater.blast = mode === 'blast'; });
orbit.enabled = false;
const launchFolder = gui.addFolder('Launched object');
launchFolder.add(launch, 'object', Object.fromEntries(Object.entries(OBJECTS).map(([id, {label}]) => [label, id]))).name('Object').onChange(id => {
  Object.assign(launch, OBJECTS[id].launch);
  launchFolder.controllers.forEach(controller => controller.updateDisplay());
});
launchFolder.add(launch, 'size', ...LAUNCH.size, .05).name('Size ×');
launchFolder.add(launch, 'density', ...LAUNCH.density, .05).name('Weight ×');
launchFolder.add(launch, 'speed', ...LAUNCH.speed, 1).name('Speed · m/s');
launchFolder.add(launch, 'angle', ...LAUNCH.angle, 1).name('Angle from vertical · °');
craterControls(gui, crater, {onBlast(on) { action.mode = on ? 'blast' : 'none'; orbit.enabled = !on; gui.controllersRecursive().forEach(c => c.updateDisplay()); }});
const effectsFolder = gui.addFolder('Wired effects');
effectsFolder.add(effects, 'shards').name('Shards (particles)');
effectsFolder.add(effects, 'dust').name('Dust (particles)');
effectsFolder.add(effects, 'clods').name('Clods (Jolt bodies)');
effectsFolder.add(effects, 'plants').name('Grass and trees react');
effectsFolder.add(CLODS, 'perBlast', 0, 40, 1).name('Clods per crater, at most');
effectsFolder.add(CLODS, 'stayShare', 0, 1, .05).name('Clods that stay');
gui.add({reset() {
  for (let i = moving.length - 1; i >= 0; i--) removeMoving(i);
  pendingImpacts.length = 0;
  chips.clear();
  field.resetDeformation(onHeightSample);
  resetPlants();
  groundChanged = true;
}}, 'reset').name('Reset ground and bodies');
const weatherUI = mountWeatherControls(weather);

const raycaster = new THREE.Raycaster(), pointerEvents = new AbortController();
renderer.domElement.addEventListener('pointerdown', event => {
  if (action.mode === 'none' || !(event.buttons & 1)) return;
  const hit = aimRay(raycaster, event, renderer.domElement, camera).intersectObject(ground)[0]?.point;
  if (!hit) return;
  try {
    if (action.mode === 'blast') field.crater(hit.x, hit.z, craterTool(crater), crater.depth, onHeightSample, craterLook(crater));
    else launchObject(hit);
    $('error').hidden = true;
  } catch (error) { $('error').hidden = false; $('error').textContent = error.message; }
}, {signal: pointerEvents.signal});

const unbindResize = bindResize(renderer, camera);
let lastStatus = 0, receiverScan = RECEIVER_SCAN_SECONDS;
startFrameLoop(renderer, (dt, now) => {
  orbit.update();
  fixedStep.advance(dt, step => {
    for (const entry of moving) entry.before?.copy(entry.body.velocity);   // the velocity an impact arrives with
    physics.step(step);
    landImpacts();
  });
  if (field.flushDeformation() || groundChanged) {
    driver.reshape(groundBody);
    groundChanged = false;
  }
  for (let i = moving.length - 1; i >= 0; i--) {
    const entry = moving[i];
    entry.age += dt;
    if (entry.age > entry.life || entry.body.position.y < -half) { removeMoving(i); continue; }
    entry.mesh.position.copy(entry.body.position);
    entry.mesh.quaternion.copy(entry.body.quaternion);
  }
  chips.update(dt);
  puffs.update(dt);
  updatePlants(dt);
  weather.system.update(dt);
  weather.view.update(dt);
  weatherUI.sync();
  surfaceWeather.update(dt, weather.system.weather);
  receiverScan += dt;
  if (receiverScan >= RECEIVER_SCAN_SECONDS) { receiverScan = 0; shadowReceivers.update(); }
  sunShadows.render(scene, camera, weather.view.environment.sun.direction);
  weather.view.render();
  if (now - lastStatus > STATUS_REFRESH_MS) {
    lastStatus = now;
    $('status').textContent = `${clodCount()} clods · ${moving.length - clodCount()} launched objects · ${chips.active} shards`;
  }
});
document.body.dataset.ready = 'true';
window.craterDemo = {field, world, physics, driver, chips, puffs, weather, scene, camera, renderer};
onLeave(() => {
  renderer.setAnimationLoop(null);
  unbindResize(); pointerEvents.abort();
  for (let i = moving.length - 1; i >= 0; i--) removeMoving(i);
  driver.dispose?.();
  chips.dispose(); puffs.dispose();
  for (const {tree} of felled) tree.dispose();
  trees.dispose(); grass.dispose();
  for (const geometry of Object.values(meadow.grassGeometries ?? {})) geometry.dispose?.();
  meadow.atlas?.dispose?.();
  clodGeometry.dispose(); unitSphere.dispose(); unitBox.dispose();
  Object.values(strataMaterials).forEach(material => material.dispose()); objectMaterial.dispose();
  shadowReceivers.dispose(); weather.view.dispose(); weatherUI.dispose();
  field.dispose(); groundMaterial.dispose();
  orbit.dispose(); gui.destroy(); renderer.dispose();
});
