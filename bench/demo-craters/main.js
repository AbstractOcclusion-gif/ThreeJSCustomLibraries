// Crater demo: the terrain field's craters wired to other modules through its 'terrain:crater' event. The terrain
// digs, paints and reports; particles throw the shards and dust; the destruction module's Jolt driver flies the clods
// and carries the boulders and crates whose own shape makes the crater they land in. This page only wires them.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import initJolt from 'jolt-physics';
import {Body, Box, Sphere, Vec3, World} from 'cannon-es';
import {createBenchPanel} from '../panel.js';
import {createTerrainAppearance, createTerrainField, createTerrainMaterial, CRATER_DEFAULTS, TERRAIN_ROLE_TINTS} from '../../src/terrain/index.js';
import {createSurfaceWeather} from '../../src/surface/index.js';
import {createChips, createPuffs} from '../../src/particles/index.js';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {createFixedStep, valueNoise} from '../../src/core/index.js';
import {createSunShadows} from '../../src/lighting/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchWeather, mountWeatherControls} from '../kit/weather.js';
import {createShadowReceivers} from '../kit/shadow-receivers.js';
import {aimRay} from '../kit/input.js';
import {loadTerrainTextures} from '../terrain/textures.js';
import {createTerrainCollider} from '../terrain/heightfield.js';
import {craterControls, craterTool} from '../terrain/controls.js';
import '../bench.css';

// Ground: a square `span` m wide, `resolution` samples a side (25 cm cells), rolling `relief` m over `reliefSize` m.
const TERRAIN = {span: 64, resolution: 257, relief: 1.6, reliefSize: 22, seed: 11};
const RULES = {rockSlope: 1.1, snowLine: 300, mudBelow: -3, forestCover: 0};
// What each stratum's debris looks like: the terrain's own role tints (topsoil is the dark top earth).
const STRATA_TINT = {topsoil: TERRAIN_ROLE_TINTS.mud, subsoil: TERRAIN_ROLE_TINTS.soil, scree: TERRAIN_ROLE_TINTS.scree, rock: TERRAIN_ROLE_TINTS.rock};
// Shards (particle chips): count from the thrown volume (m³ x perCubicMetre, at most max a crater), shock (pop speed)
// from the crater depth. Dust: puff size per metre of crater reach, at most maxSize.
const SHARDS = {pool: 640, perCubicMetre: 14, max: 160, shockPerMetre: 14, maxShock: 70, size: 1.4};
const DUST = {perMetre: .45, maxSize: 4};
// Clods (Jolt bodies): count from the thrown volume (m³ x perCubicMetre, at most perBlast), at most `max` alive, each
// living `life` s. Edge size in m (a share of the crater reach, within [min, max]); thrown from the rim at `speed`
// x sqrt(depth) m/s, `rise` of it upward; `density` kg/m³.
const CLODS = {perCubicMetre: .8, perBlast: 18, max: 64, life: 14, sizeShare: .09, minSize: .12, maxSize: .55, speed: 3.2, rise: .75, density: 1600, spin: 6};
// Dropped objects: from `height` m above the clicked point, at `speed` m/s down. They crater on their first ground
// contact over `minSpeed` m/s: depth = `depthPerRootJoule` x cbrt(impact energy), within [minDepth, maxDepth]; the
// footprint is `footprintShare` x the object's own outline. Removed after `life` s.
const DROPS = {height: 26, speed: 18, minSpeed: 4, depthPerRootJoule: .028, minDepth: .2, maxDepth: 4.5, footprintShare: 1.35, life: 30, density: 2400,
  sphere: {radius: 1.1}, box: {half: [1.4, .8, .9]}};
const STEP = 1 / 60;   // the Jolt driver's rigid step
const RECEIVER_SCAN_SECONDS = 2;   // how often new lit materials (clods, drops) are given the sun shadows
const ACTIONS = {None: 'none', 'Blast a crater': 'blast', 'Drop a boulder': 'sphere', 'Drop a crate': 'box'};

const $ = id => document.getElementById(id);
const renderer = benchRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .2, 900);
camera.position.set(30, 20, 32);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0, 0); orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * .48; orbit.update();
const weather = await createBenchWeather({scene, renderer, camera, lightTarget: new THREE.Vector3(), initial: 'clear', hour: 15, precipitation: false});
const sunShadows = createSunShadows({renderer, distance: TERRAIN.span * 1.5});
const shadowReceivers = createShadowReceivers(scene, sunShadows, weather.view);

// Terrain.
const {span, resolution, relief, reliefSize, seed} = TERRAIN, half = span / 2, spacing = span / (resolution - 1);
const noise = valueNoise(seed);
const heights = Float32Array.from({length: resolution ** 2}, (_, i) => {
  const x = (i % resolution) * spacing - half, z = Math.floor(i / resolution) * spacing - half;
  return relief * (noise(x / reliefSize, z / reliefSize) + .35 * noise(x / reliefSize * 2.7, z / reliefSize * 2.7));
});
const field = createTerrainField({origin: [-half, -half], size: [span, span], resolution: [resolution, resolution], heights, seed, rules: RULES});
const textures = await loadTerrainTextures(renderer);
const surfaceWeather = createSurfaceWeather();
const groundMaterial = createTerrainMaterial({}, {field, layerArray: textures.layerArray, detailNormal: textures.detail, appearance: createTerrainAppearance(), weather: surfaceWeather});
const ground = new THREE.Mesh(field.geometry, groundMaterial);
ground.receiveShadow = true;
scene.add(ground);

// Physics: Cannon bodies as the model, Jolt solving them (the destruction module's driver).
const J = await initJolt();
const world = new World({gravity: new Vec3(0, -9.82, 0), allowSleep: true});
const driver = createJoltDriver(J);
const groundBody = createTerrainCollider(field);
const [groundShape] = groundBody.shapes;
world.addBody(groundBody);
driver.attach(world);
const fixedStep = createFixedStep({step: STEP});
// The terrain writes every edited height into the collider; the Jolt copy is rebuilt once a crater is done.
const onHeightSample = (x, z, value) => groundShape.setHeightValueAtIndex(z, x, value);
let groundChanged = false;

// Particles.
const chips = createChips(scene, {pool: SHARDS.pool});
chips.setGround(field.heightAt);
const puffs = await createPuffs(scene, {pool: 48, environment: weather.view.environment});

// Clods and dropped objects: Jolt bodies with a mesh each.
const clodGeometry = new THREE.DodecahedronGeometry(.5 * Math.sqrt(3) / 1.2, 0);   // about a unit box, rounded
const strataMaterials = Object.fromEntries(Object.entries(STRATA_TINT).map(([name, tint]) => [name, new THREE.MeshStandardMaterial({color: tint, roughness: .95, flatShading: true})]));
const dropMaterial = new THREE.MeshStandardMaterial({color: '#8d8a84', roughness: .8});
const dropGeometries = {sphere: new THREE.SphereGeometry(DROPS.sphere.radius, 24, 16), box: new THREE.BoxGeometry(...DROPS.box.half.map(h => h * 2))};
const moving = [];   // {body, mesh, age, life, owned geometry?}
function addMoving(body, mesh, life) {
  world.addBody(body);
  scene.add(mesh);
  moving.push({body, mesh, age: 0, life});
}
function removeMoving(index) {
  const [entry] = moving.splice(index, 1);
  world.removeBody(entry.body);
  scene.remove(entry.mesh);
}
const clodCount = () => moving.reduce((count, entry) => count + (entry.clod ? 1 : 0), 0);

// The wiring: what a crater throws out, by the strata it cut.
const effects = {shards: true, dust: true, clods: true};
const origin = new THREE.Vector3();
function throwShards(event, y) {
  const shock = Math.min(SHARDS.maxShock, event.depth * SHARDS.shockPerMetre), total = Math.min(SHARDS.max, event.ejecta * SHARDS.perCubicMetre);
  origin.set(event.x, y, event.z);
  for (const [name, share] of Object.entries(event.strata)) {
    const count = Math.round(total * share);
    if (count > 0) chips.emit(origin, {color: new THREE.Color(STRATA_TINT[name]).getHex(), chips: count, size: SHARDS.size}, shock);
  }
}
function throwClods(event, y) {
  const strata = Object.entries(event.strata).filter(([, share]) => share > 0);
  const count = Math.min(CLODS.perBlast, CLODS.max - clodCount(), Math.round(event.ejecta * CLODS.perCubicMetre));
  const launch = CLODS.speed * Math.sqrt(event.depth), size = THREE.MathUtils.clamp(event.reach * CLODS.sizeShare, CLODS.minSize, CLODS.maxSize);
  for (let i = 0; i < count; i++) {
    // Each clod is drawn from a stratum by its share of the dug volume.
    let pick = Math.random(), stratum = strata.at(-1)[0];
    for (const [name, share] of strata) if ((pick -= share) < 0) { stratum = name; break; }
    const angle = Math.random() * Math.PI * 2, edge = size * (.6 + .8 * Math.random());
    const x = event.x + Math.cos(angle) * event.reach * .8, z = event.z + Math.sin(angle) * event.reach * .8;
    const body = new Body({mass: CLODS.density * edge ** 3, shape: new Box(new Vec3(edge / 2, edge / 2, edge / 2)), position: new Vec3(x, (field.heightAt(x, z) ?? y) + edge, z), angularDamping: .3});
    const out = launch * Math.sqrt(1 - CLODS.rise ** 2) * (.6 + .8 * Math.random());
    body.velocity.set(Math.cos(angle) * out, launch * CLODS.rise * (.7 + .6 * Math.random()), Math.sin(angle) * out);
    body.angularVelocity.set((Math.random() - .5) * CLODS.spin, (Math.random() - .5) * CLODS.spin, (Math.random() - .5) * CLODS.spin);
    const mesh = new THREE.Mesh(clodGeometry, strataMaterials[stratum]);
    mesh.scale.setScalar(edge);
    mesh.castShadow = mesh.receiveShadow = true;
    addMoving(body, mesh, CLODS.life);
    moving.at(-1).clod = true;
  }
}
field.subscribe(event => {
  groundChanged = true;
  const y = event.height ?? field.heightAt(event.x, event.z);
  if (effects.shards) throwShards(event, y);
  if (effects.dust) puffs.dust(origin.set(event.x, y, event.z), Math.min(DUST.maxSize, event.reach * DUST.perMetre));
  if (effects.clods) throwClods(event, y);
});

// Craters made by a dropped object take its outline at impact: a round boulder, or a crate turned as it landed.
const pendingImpacts = [];
function drop(kind, point) {
  const isSphere = kind === 'sphere';
  const shape = isSphere ? new Sphere(DROPS.sphere.radius) : new Box(new Vec3(...DROPS.box.half));
  const volume = isSphere ? 4 / 3 * Math.PI * DROPS.sphere.radius ** 3 : DROPS.box.half.reduce((a, b) => a * b * 2, 1);
  const body = new Body({mass: DROPS.density * volume, shape, position: new Vec3(point.x, point.y + DROPS.height, point.z), angularDamping: .2});
  body.velocity.set(0, -DROPS.speed, 0);
  if (!isSphere) body.quaternion.setFromEuler(Math.random() * .3, Math.random() * Math.PI, Math.random() * .3);
  const mesh = new THREE.Mesh(dropGeometries[kind], dropMaterial);
  mesh.castShadow = mesh.receiveShadow = true;
  addMoving(body, mesh, DROPS.life);
  const entry = moving.at(-1);
  body.addEventListener('collide', ({body: other, contact}) => {
    if (other !== groundBody || entry.cratered) return;
    const speed = Math.abs(contact.getImpactVelocityAlongNormal());
    if (speed < DROPS.minSpeed) return;
    entry.cratered = true;   // the physics callback only records it; the ground changes between steps
    pendingImpacts.push({entry, kind, energy: .5 * body.mass * speed * speed});
  });
}
const yawAxis = new THREE.Vector3(), turned = new THREE.Quaternion();
function footprintOf({entry, kind}) {
  if (kind === 'sphere') return DROPS.sphere.radius * DROPS.footprintShare;
  // The crate's footprint: its half extents along its own X and Z, turned by its heading (yaw of its X axis).
  turned.set(entry.body.quaternion.x, entry.body.quaternion.y, entry.body.quaternion.z, entry.body.quaternion.w);
  yawAxis.set(1, 0, 0).applyQuaternion(turned);
  const [hx, , hz] = DROPS.box.half;
  return {halfX: hx * DROPS.footprintShare, halfZ: hz * DROPS.footprintShare, yaw: Math.atan2(yawAxis.z, yawAxis.x), squareness: 1};
}
function landImpacts() {
  for (const impact of pendingImpacts) {
    const {x, z} = impact.entry.body.position;
    const depth = THREE.MathUtils.clamp(DROPS.depthPerRootJoule * Math.cbrt(impact.energy), DROPS.minDepth, DROPS.maxDepth);
    field.crater(x, z, footprintOf(impact), depth, onHeightSample);
  }
  pendingImpacts.length = 0;
}

// Panel.
const gui = createBenchPanel('Craters');
const action = {mode: 'blast'};
const crater = {blast: true, shape: 'round', radius: 3, width: .5, yaw: 0, depth: 2.5, rimShare: CRATER_DEFAULTS.rimShare};
const clickFolder = gui.addFolder('Click action');
clickFolder.add(action, 'mode', ACTIONS).name('Click does').onChange(mode => { orbit.enabled = mode === 'none'; crater.blast = mode === 'blast'; });
orbit.enabled = false;
craterControls(gui, crater, {onBlast(on) { action.mode = on ? 'blast' : 'none'; orbit.enabled = !on; gui.controllersRecursive().forEach(c => c.updateDisplay()); }});
const effectsFolder = gui.addFolder('Wired effects');
effectsFolder.add(effects, 'shards').name('Shards (particles)');
effectsFolder.add(effects, 'dust').name('Dust (particles)');
effectsFolder.add(effects, 'clods').name('Clods (Jolt bodies)');
effectsFolder.add(CLODS, 'perBlast', 0, 40, 1).name('Clods per crater, at most');
gui.add({reset() {
  for (let i = moving.length - 1; i >= 0; i--) removeMoving(i);
  pendingImpacts.length = 0;
  chips.clear();
  field.resetDeformation(onHeightSample);
  groundChanged = true;
}}, 'reset').name('Reset ground and bodies');
const weatherUI = mountWeatherControls(weather);

const raycaster = new THREE.Raycaster(), pointerEvents = new AbortController();
renderer.domElement.addEventListener('pointerdown', event => {
  if (action.mode === 'none' || !(event.buttons & 1)) return;
  const hit = aimRay(raycaster, event, renderer.domElement, camera).intersectObject(ground)[0]?.point;
  if (!hit) return;
  try {
    if (action.mode === 'blast') field.crater(hit.x, hit.z, craterTool(crater), crater.depth, onHeightSample, {rimShare: crater.rimShare});
    else drop(action.mode, hit);
    $('error').hidden = true;
  } catch (error) { $('error').hidden = false; $('error').textContent = error.message; }
}, {signal: pointerEvents.signal});

const unbindResize = bindResize(renderer, camera);
let lastStatus = 0, receiverScan = RECEIVER_SCAN_SECONDS;
startFrameLoop(renderer, (dt, now) => {
  orbit.update();
  fixedStep.advance(dt, step => {
    world.step(step);
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
    $('status').textContent = `${clodCount()} clods · ${moving.length - clodCount()} dropped objects · ${chips.active} shards`;
  }
});
document.body.dataset.ready = 'true';
window.craterDemo = {field, world, driver, chips, puffs, weather, scene, camera, renderer};
onLeave(() => {
  renderer.setAnimationLoop(null);
  unbindResize(); pointerEvents.abort();
  for (let i = moving.length - 1; i >= 0; i--) removeMoving(i);
  driver.dispose?.();
  chips.dispose(); puffs.dispose();
  clodGeometry.dispose(); Object.values(dropGeometries).forEach(geometry => geometry.dispose());
  Object.values(strataMaterials).forEach(material => material.dispose()); dropMaterial.dispose();
  shadowReceivers.dispose(); weather.view.dispose(); weatherUI.dispose();
  field.dispose(); groundMaterial.dispose();
  orbit.dispose(); gui.destroy(); renderer.dispose();
});
