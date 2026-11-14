// World demo: the kit's modules together on one terrain world. A finite corridor through four biomes (terrain world,
// rings and palette material) under the weather module, which lights the scene and wets or snows the ground; rocks,
// grass and trees on it (dressing.js); the lighting module's sun shadows, light probes, light rig and volumetric
// light; a camp by the river (the shared demo life and structures: leaved trees, a fire, fish, a fence and a hedge,
// a rope, a bridge to shoot down); a play area for test balls; ambience from the sound module; and the camera
// module's director for the shots.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {CLIPMAP_DEFAULTS, cloneBiome, createSandLook, createTerrainAppearance, createTerrainClipmap, createTerrainMaterial, createTerrainWorld, SNOW_DEFAULTS, terrainLightGround} from '../../src/terrain/index.js';
import {createLighting, syncLighting} from '../../src/core/lighting.js';
import {createLightProbes, createLightRig, createSunShadows, createVolumetricLight} from '../../src/lighting/index.js';
import {createAmbience, createSound} from '../../src/sound/index.js';
import {createCameraDirector, createOrbitRig} from '../../src/camera/director.js';
import {createShadowReceivers} from '../kit/shadow-receivers.js';
import {createDemoLife} from '../kit/life.js';
import {createDemoStructures} from '../kit/structures.js';
import {createTerrainPlay, PLAY} from '../terrain/play.js';
import {DEMO as SOUND_DEMO} from '../sound/presets.js';
import {createSurfaceWeather} from '../../src/surface/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchWeather, mountWeatherControls} from '../kit/weather.js';
import {loadTerrainPalette} from '../terrain/textures.js';
import {createWorldDressing} from './dressing.js';
import '../bench.css';

const query = new URLSearchParams(location.search);
// ?cells= and ?levels= size the rings down for a slow machine or a test; ?trees=0 leaves the tree models out.
const CLIP = {...CLIPMAP_DEFAULTS, ...Object.fromEntries(['cells', 'levels'].filter(key => query.has(key)).map(key => [key, Number(query.get(key))]))};
const RINGS_PER_FRAME = 1;
const SEED = 17;
// The corridor: stretches of biome in this order from its start, each `stretch` m long, between walls.
const BIOMES = ['valley', 'dry', 'alpine', 'mountains'];
// Wide, gentle sides and a floor a few metres above the water leave room for grass and woods on the way through.
const CORRIDOR = {stretch: 620, width: 44, shoulder: 150, wall: 26, floor: 4, floorRelief: .4, bend: 34, bendScale: 170, endRamp: 90, sectionBlend: 90};
const WATER = {color: 0x2f5d62, opacity: .8, roughness: .12, shoreWidth: .8};
// As the terrain tool: soft junctions and rock drawn large, for a landscape rather than a close-up.
const APPEARANCE = {edgeSharpness: .25, rockScale: .18};
const VIEW = {
  fov: 50, near: .5, far: 6000, start: 140,                // m along the corridor the view opens on
  offset: [-38, 26, -64],                                   // camera from its target, when the page opens
  speed: 14, low: 6, lookAhead: 24, turnBack: 60,          // fly-along: m/s, m above the ground, m looked ahead, m kept from each end
  circle: {radius: 70, height: 26, speed: .1},             // the circling shot, around the ground under the view
  blend: 1.5,                                               // s to ease from one shot into another
};
const SHOTS = {free: 'Free (drag to look)', fly: 'Fly along the corridor', circle: 'Circle', camp: 'Camp', bridge: 'Bridge'};
// The camp, in the first stretch: `along` m from the start and `beside` m from the route, on dry ground above the
// river. A few leaved trees and bushes grow within `radius` m of it. The bridge crosses the river `bridgeAlong` m in;
// the fish keep to a pool `pool` m long and `poolHalf` m to each side of the route, `fishDepth` m under the surface.
const CAMP = {
  along: 260, beside: 38, radius: 26, trees: 6, bushes: 10, dryAbove: 1.5,
  bridgeAlong: 340, pool: [235, 295], poolHalf: 5, fishDepth: .15, fish: {roach: 10, rudd: 6, perch: 3}, fishSize: .3,
  shot: {radius: 19, height: 8, speed: .2}, bridgeShot: {radius: 46, height: 14, speed: .14},
};
// Ambience: the rain and wind recordings of the sound bench, at the level of the weather. fullWind: m/s of full volume.
const SOUND = {fullWind: 18, gain: {rain: .9, wind: .6}};
const PLAY_SNOW_FROM = .5;   // snow cover of the ground from which the play area lies under real snow
// The light, as the All tools demo: the kit's cascaded sun shadows, and thin air lit by the sun through them and
// through the weather's clouds. The weather's own pass then draws its fog bank and rainbow over that frame.
const LIGHT = {shadowDistance: 220, airDensity: .0012, sunInAir: 1.5, scanSeconds: 2};   // scan: how often new materials are looked for
const WEATHER = {initial: 'cloudy 1', hour: 14, rain: {count: 360, radius: 32, height: 34, floorHeight: 0}};

const $error = document.getElementById('error'), $status = document.getElementById('status');
const report = error => { $error.hidden = !error; $error.textContent = error?.message ?? ''; if (error) console.error(error); };
const renderer = benchRenderer();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, innerWidth / innerHeight, VIEW.near, VIEW.far);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
const focus = new THREE.Vector3();
const settings = {shot: 'free', speed: VIEW.speed, followWeather: true, wetness: 0, snow: 0, volumetric: true, ballRadius: PLAY.ball.radius};

const {stretch, ...corridorShape} = CORRIDOR;
const world = createTerrainWorld({seed: SEED, biomes: BIOMES.map(cloneBiome), water: true, corridor: {
  ...corridorShape, length: stretch * BIOMES.length, sectionMin: stretch, sectionMax: stretch,
  sections: BIOMES.map((_, biome) => ({biome, length: stretch})),
}});
const route = world.corridor;
{
  const z = VIEW.start, x = route.routeX(z);
  orbit.target.set(x, world.heightAt(x, z), z);
  camera.position.copy(orbit.target).add(new THREE.Vector3(...VIEW.offset));
  orbit.update();
  focus.copy(orbit.target);
}

const weather = await createBenchWeather({scene, renderer, camera, lightTarget: focus, initial: WEATHER.initial, hour: WEATHER.hour, precipitation: WEATHER.rain});
const {textures, missing} = await loadTerrainPalette(renderer, world.palette);
const appearance = createTerrainAppearance(), sandLook = createSandLook(), surfaceWeather = createSurfaceWeather();
for (const [key, value] of Object.entries(APPEARANCE)) appearance[key].value = value;
appearance.shoreWidth.value = WATER.shoreWidth;
appearance.waterLevel.value = world.waterLevel;
const cutout = {value: new THREE.Vector4()};   // the square of ground the play area draws in place of the rings
const clipmap = createTerrainClipmap({world, ...CLIP, createMaterial: field => {
  // The shadows of the sun and of the clouds reach the rings with every other receiver (shadowReceivers).
  return createTerrainMaterial({}, {field, palette: {...world.palette, means: textures.means}, layerArray: textures.layerArray,
    layerDetailArray: textures.layerDetailArray, detailNormal: textures.detail, appearance, sandLook, weather: surfaceWeather, cutout});
}});
scene.add(clipmap.group);
clipmap.update(focus.x, focus.z);
const waterSheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({color: WATER.color, transparent: true, opacity: WATER.opacity, roughness: WATER.roughness, depthWrite: false}));
waterSheet.renderOrder = 1;
waterSheet.scale.setScalar(clipmap.extent);
waterSheet.position.y = world.waterLevel;
scene.add(waterSheet);

const environment = weather.view.environment;
const dressing = createWorldDressing({scene, world, renderer, environment, trees: query.get('trees') !== '0', report});

// Light. Sun shadows and cloud shadows go to every lit material that receives shadows. The light probes give what
// stands on the ground (rocks, trees) the sky its valley leaves it and the colour of its own ground from below; the
// terrain itself keeps its own, finer sky map.
const sunShadows = createSunShadows({renderer, distance: LIGHT.shadowDistance});
const sunCover = [sunShadows.sun, weather.view.sunCover];
const lightRig = createLightRig({shadows: {renderer, casters: 1}});   // the camp fire, with one shadow
const volumetric = createVolumetricLight({renderer, sun: sunCover, rig: lightRig, density: LIGHT.airDensity});
volumetric.set('sun', LIGHT.sunInAir);
const shadowReceivers = createShadowReceivers(scene, sunShadows, weather.view, lightRig);
const probes = createLightProbes({ground: terrainLightGround({world, palette: {...world.palette, means: textures.means}, appearance, sandColor: sandLook.color.value})});
// The hook of the custom shaders (the leaved trees and the hedge of the camp): same sun covers, lights and probes.
const lighting = createLighting({ambient: probes.ambient, sun: sunCover, lights: lightRig.lights});
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

// The camp. Its trees and hedge are the kit's leaved trees, on the lighting hook; the fire lights the rig.
const campZ = CAMP.along, campX = route.routeX(campZ) + CAMP.beside, bridgeX = route.routeX(CAMP.bridgeAlong);
const poolX = route.routeX((CAMP.pool[0] + CAMP.pool[1]) / 2), ground = (x, z) => world.heightAt(x, z);
const life = await createDemoLife({scene, ground, centre: [campX, campZ], environment, lighting, lightRig,
  plants: {radius: CAMP.radius, treeLine: world.waterLevel + CAMP.dryAbove, bushLine: world.waterLevel + CAMP.dryAbove, trees: CAMP.trees, bushes: CAMP.bushes, grass: 0},
  camp: [campX, campZ],
  fish: {bounds: new THREE.Box3(new THREE.Vector3(poolX - CAMP.poolHalf, world.heightAt(poolX, CAMP.pool[0]), CAMP.pool[0]), new THREE.Vector3(poolX + CAMP.poolHalf, world.waterLevel - CAMP.fishDepth, CAMP.pool[1])),
    counts: CAMP.fish, size: CAMP.fishSize, surfaceHeight: () => world.waterLevel - CAMP.fishDepth}});
// The bridge stands on the river bed, its deck across the river.
const structures = createDemoStructures({scene, ground, camp: life.camp, bridge: [bridgeX, world.heightAt(bridgeX, CAMP.bridgeAlong), CAMP.bridgeAlong, 0], environment, lighting});
const campTarget = new THREE.Vector3(campX, world.heightAt(campX, campZ) + 1, campZ);

// The play area: test balls leave ruts in the ground and pack the snow (the terrain pages' play.js).
const play = createTerrainPlay({scene, appearance, sandLook, weather: surfaceWeather, cutout, world: () => world, textures: () => textures,
  seed: () => SEED, rules: () => world.biomes[0].paint});

// Ambience (sound module). A browser only plays sound after a click: the Sound button starts it.
let sound = null, ambience = null;
async function startSound() {
  if (sound) return;
  const started = createSound();
  try {
    await started.unlock();
    for (const id of ['rain', 'wind']) started.define(id, {bus: 'ambience', buffer: await started.load(SOUND_DEMO.recordings[id])});
    ambience = createAmbience(started, {layers: ['rain', 'wind'].map(id => ({id, sound: id, gain: 0}))});
    ambience.start();
    sound = started;
  } catch (error) { await started.dispose(); throw error; }
}

// The shots, on the camera module's director, which eases from one into the next.
// Fly-along: low over the route, back and forth between the two ends.
let flyZ = VIEW.start, flyHeading = 1;
const flyPose = new THREE.PerspectiveCamera(VIEW.fov);
function flyRig({dt}) {
  flyZ += dt * settings.speed * flyHeading;
  if (flyZ > route.length - VIEW.turnBack) flyHeading = -1; else if (flyZ < VIEW.turnBack) flyHeading = 1;
  const x = route.routeX(flyZ), aheadZ = flyZ + VIEW.lookAhead * flyHeading, aheadX = route.routeX(aheadZ);
  // Clear the ground ahead as well as below, or a rise would swallow the camera.
  const ahead = world.heightAt(aheadX, aheadZ);
  flyPose.position.set(x, Math.max(world.heightAt(x, flyZ), ahead) + VIEW.low, flyZ);
  flyPose.lookAt(aheadX, ahead + VIEW.low, aheadZ);
  return flyPose;
}
const director = createCameraDirector(camera).register('fly', flyRig).register('circle', createOrbitRig(VIEW.circle))
  .register('camp', createOrbitRig(CAMP.shot)).register('bridge', createOrbitRig(CAMP.bridgeShot));
const shotTarget = new THREE.Vector3();
function selectShot(shot) {
  const z = THREE.MathUtils.clamp(focus.z, VIEW.turnBack, route.length - VIEW.turnBack), x = route.routeX(z);
  shotTarget.set(x, world.heightAt(x, z), z);
  if (shot === 'camp') shotTarget.copy(campTarget); else if (shot === 'bridge') shotTarget.copy(structures.bridgeCentre);
  orbit.enabled = shot === 'free';
  if (shot === 'free') { orbit.target.copy(shotTarget); orbit.update(); return; }
  if (shot === 'fly') flyZ = z;
  director.select(shot, {duration: VIEW.blend});
}

const gui = createBenchPanel('World demo');
const viewFolder = gui.addFolder('View');
viewFolder.add(settings, 'shot', Object.fromEntries(Object.entries(SHOTS).map(([id, label]) => [label, id]))).name('Camera').onChange(selectShot);
viewFolder.add(settings, 'speed', 2, 60, 1).name('Flight speed · m/s');
const attempt = action => async () => { try { await action(); report(); } catch (error) { report(error); } };
const campFolder = gui.addFolder('Camp, bridge, balls');
campFolder.add({run: attempt(() => life.ignite())}, 'run').name('Light the camp fire');
campFolder.add({run: attempt(() => life.resetFire())}, 'run').name('Put the fire out');
campFolder.add({run: attempt(() => structures.cutRope())}, 'run').name('Cut the rope');
campFolder.add({run: attempt(() => structures.hangRope())}, 'run').name('Hang the rope again');
campFolder.add({run: attempt(() => structures.fireAtBridge())}, 'run').name('Fire at the bridge');
campFolder.add({run: attempt(() => structures.buildBridge())}, 'run').name('Rebuild the bridge');
campFolder.add(settings, 'ballRadius', PLAY.ball.minRadius, PLAY.ball.maxRadius, .1).name('Ball radius · m');
campFolder.add({run: attempt(() => play.roll({focus, camera, radius: settings.ballRadius}))}, 'run').name('Roll a ball from the view');
campFolder.add({run: attempt(() => play.reset())}, 'run').name('Clear balls, ruts and marks');
campFolder.add({run: attempt(startSound)}, 'run').name('Sound: start the ambience');
const lightFolder = gui.addFolder('Light');
lightFolder.add(sunShadows.settings, 'strength', 0, 1, .01).name('Sun shadows');
lightFolder.add(sunShadows.settings, 'distance', 40, 600, 5).name('Sun shadows reach · m');
lightFolder.add(sunShadows.settings, 'softness', 0, 4, .1).name('Shadow soft edge');
lightFolder.add(settings, 'volumetric').name('Volumetric light');
lightFolder.add(volumetric.settings, 'density', 0, .02, .0005).name('Air density · 1/m');
lightFolder.add(probes.strength, 'value', 0, 1, .01).name('Light probes on rocks and trees');
lightFolder.add(appearance.skyOcclusion, 'value', 0, 1, .01).name('Sky occlusion on the ground');
// The ground follows the weather (rain wets it, snow covers it, both fade); or set by hand.
const groundFolder = gui.addFolder('Ground');
groundFolder.add(settings, 'followWeather').name('Follows the weather');
groundFolder.add(settings, 'wetness', 0, 1, .01).name('Wetness (by hand)').listen();
groundFolder.add(settings, 'snow', 0, 1, .01).name('Snow cover (by hand)').listen();
const dressingFolder = gui.addFolder('Rocks, grass, trees');
dressingFolder.add(dressing.settings, 'rocks').name('Rocks and cliffs');
dressingFolder.add(dressing.settings, 'grass').name('Grass');
dressingFolder.add(dressing.settings, 'trees').name('Trees');
dressingFolder.add(dressing.settings, 'treeLod', 20, 200, 1).name('Trees: far model from · m');
dressingFolder.add(dressing.settings, 'treeImpostor', 40, 400, 1).name('Trees: flat cards from · m');
const weatherUI = mountWeatherControls(weather);

const unbindResize = bindResize(renderer, camera);
let lastStatus = -Infinity, lastScan = -Infinity;
startFrameLoop(renderer, (dt, now) => {
  if (settings.shot === 'free') { orbit.update(); focus.copy(orbit.target); }
  else { director.update(dt, {target: shotTarget}); focus.copy(settings.shot === 'fly' ? camera.position : shotTarget); }
  camera.updateProjectionMatrix();   // a shot may change the field of view
  weather.system.update(dt);
  weather.view.update(dt);
  syncLighting(lighting.uniforms, {sun: weather.view.sun, hemi: weather.view.hemi, fog: scene.fog});
  probes.update(focus.x, focus.z);
  if (now - lastScan >= LIGHT.scanSeconds * 1000) { lastScan = now; findReceivers(); }
  if (settings.followWeather) {
    surfaceWeather.update(dt, weather.system.weather);
    settings.wetness = surfaceWeather.levels.value.x; settings.snow = surfaceWeather.levels.value.y;
  } else { surfaceWeather.set({wetness: settings.wetness, snow: settings.snow}); surfaceWeather.update(dt, null); }
  // The rings only show the snow: they are lifted by the depth it lies at, as the terrain tool does.
  clipmap.group.position.y = SNOW_DEFAULTS.driftDepth * surfaceWeather.levels.value.y;
  const started = performance.now();
  clipmap.update(focus.x, focus.z, RINGS_PER_FRAME);
  const terrainMs = performance.now() - started;
  waterSheet.position.x = focus.x; waterSheet.position.z = focus.z;
  dressing.update(dt, camera, focus);
  life.update(dt, camera);
  structures.update(dt, camera);
  // Real snow on the play area once the ground is mostly covered.
  play.setSnow(surfaceWeather.levels.value.y > PLAY_SNOW_FROM);
  play.update(dt);
  if (ambience) {
    ambience.setLevel('rain', SOUND.gain.rain * weather.system.weather.rain);
    ambience.setLevel('wind', SOUND.gain.wind * Math.min(1, environment.wind.speed / SOUND.fullWind));
  }
  camera.updateMatrixWorld();
  lightRig.update(camera.position);
  lightRig.renderShadows(scene);
  sunShadows.render(scene, camera, environment.sun.direction);
  weather.view.render(settings.volumetric ? volumetric.capture(scene, camera, environment) : undefined);
  weatherUI.sync();
  if (now - lastStatus >= STATUS_REFRESH_MS) {
    lastStatus = now;
    const z = THREE.MathUtils.clamp(focus.z, 0, route.length), section = route.sectionAt(z);
    $status.textContent = `${world.biomes[section.biome].label} · ${Math.round(z)} m of ${route.length} m`
      + `\nwetness ${settings.wetness.toFixed(2)} · snow ${settings.snow.toFixed(2)} · terrain ${terrainMs.toFixed(1)} ms`
      + `\n${dressing.stats.rockTiles} rock tiles · ${dressing.stats.grassClumps} grass clumps · ${dressing.stats.trees} trees`
      + (dressing.stats.treesLoading ? ` (${dressing.stats.treesLoading} species loading)` : '')
      + (probes.pending ? `\n${probes.pending} light probe columns to measure` : '')
      + (missing.length ? '\nTexture sets not bundled, default used · ' + missing.join(', ') + ' · run npm run textures:fetch' : '');
  }
});
document.body.dataset.ready = 'true';
onLeave(() => {
  renderer.setAnimationLoop(null); unbindResize(); shadowReceivers.dispose(); play.dispose(); life.dispose(); structures.dispose(); dressing.dispose(); weatherUI.dispose();
  ambience?.stop(0); sound?.dispose();
  sunShadows.dispose(); volumetric.dispose(); lightRig.dispose(); probes.dispose(); weather.view.dispose(); orbit.dispose(); gui.destroy();
  scene.remove(clipmap.group, waterSheet); clipmap.dispose(); waterSheet.geometry.dispose(); waterSheet.material.dispose();
  for (const texture of Object.values(textures)) texture?.dispose?.();
  renderer.dispose();
});
window.worldDemo = {world, clipmap, dressing, life, structures, play, lightRig, sunShadows, volumetric, probes, selectShot, weather, surfaceWeather, settings, focus, camera, orbit, scene};
