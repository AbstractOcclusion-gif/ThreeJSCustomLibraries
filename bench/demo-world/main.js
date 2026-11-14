// World demo: the kit's modules together on one terrain world. A finite corridor through four biomes (terrain world,
// rings and palette material) under the weather module, which lights the scene and wets or snows the ground.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {CLIPMAP_DEFAULTS, cloneBiome, createSandLook, createTerrainAppearance, createTerrainClipmap, createTerrainMaterial, createTerrainWorld, SNOW_DEFAULTS} from '../../src/terrain/index.js';
import {createSurfaceWeather} from '../../src/surface/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchWeather, mountWeatherControls} from '../kit/weather.js';
import {loadTerrainPalette} from '../terrain/textures.js';
import {createWorldDressing} from './dressing.js';
import '../bench.css';

const query = new URLSearchParams(location.search);
// ?cells= and ?levels= size the rings down for a slow machine or a test.
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
};
const WEATHER = {initial: 'cloudy 1', hour: 14, rain: {count: 360, radius: 32, height: 34, floorHeight: 0}};

const $error = document.getElementById('error'), $status = document.getElementById('status');
const report = error => { $error.hidden = !error; $error.textContent = error?.message ?? ''; if (error) console.error(error); };
const renderer = benchRenderer();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, innerWidth / innerHeight, VIEW.near, VIEW.far);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
const focus = new THREE.Vector3();
const settings = {fly: false, speed: VIEW.speed, followWeather: true, wetness: 0, snow: 0};

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
const clipmap = createTerrainClipmap({world, ...CLIP, createMaterial: field => {
  const material = createTerrainMaterial({}, {field, palette: {...world.palette, means: textures.means}, layerArray: textures.layerArray,
    layerDetailArray: textures.layerDetailArray, detailNormal: textures.detail, appearance, sandLook, weather: surfaceWeather});
  weather.view.addCloudShadowReceiver(material);
  return material;
}});
scene.add(clipmap.group);
clipmap.update(focus.x, focus.z);
const waterSheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({color: WATER.color, transparent: true, opacity: WATER.opacity, roughness: WATER.roughness, depthWrite: false}));
waterSheet.renderOrder = 1;
waterSheet.scale.setScalar(clipmap.extent);
waterSheet.position.y = world.waterLevel;
scene.add(waterSheet);

const dressing = createWorldDressing({scene, world, renderer, environment: weather.view.environment, report});

// Fly-along: low over the route, back and forth between the two ends.
let flyZ = VIEW.start, flyHeading = 1;
function fly(dt) {
  flyZ += dt * settings.speed * flyHeading;
  if (flyZ > route.length - VIEW.turnBack) flyHeading = -1; else if (flyZ < VIEW.turnBack) flyHeading = 1;
  const x = route.routeX(flyZ), aheadZ = flyZ + VIEW.lookAhead * flyHeading, aheadX = route.routeX(aheadZ);
  // Clear the ground ahead as well as below, or a rise would swallow the camera.
  const ahead = world.heightAt(aheadX, aheadZ);
  camera.position.set(x, Math.max(world.heightAt(x, flyZ), ahead) + VIEW.low, flyZ);
  camera.lookAt(aheadX, ahead + VIEW.low, aheadZ);
}

const gui = createBenchPanel('World demo');
const viewFolder = gui.addFolder('View');
viewFolder.add(settings, 'fly').name('Fly along the corridor').onChange(on => {
  orbit.enabled = !on;
  if (on) flyZ = THREE.MathUtils.clamp(focus.z, VIEW.turnBack, route.length - VIEW.turnBack);
  else { orbit.target.set(route.routeX(flyZ), world.heightAt(route.routeX(flyZ), flyZ), flyZ); camera.position.copy(orbit.target).add(new THREE.Vector3(...VIEW.offset)); orbit.update(); }
});
viewFolder.add(settings, 'speed', 2, 60, 1).name('Flight speed · m/s');
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
let lastStatus = -Infinity;
startFrameLoop(renderer, (dt, now) => {
  if (settings.fly) fly(dt); else orbit.update();
  focus.copy(settings.fly ? camera.position : orbit.target);
  weather.system.update(dt);
  weather.view.update(dt);
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
  weather.view.render();
  weatherUI.sync();
  if (now - lastStatus >= STATUS_REFRESH_MS) {
    lastStatus = now;
    const z = THREE.MathUtils.clamp(focus.z, 0, route.length), section = route.sectionAt(z);
    $status.textContent = `${world.biomes[section.biome].label} · ${Math.round(z)} m of ${route.length} m`
      + `\nwetness ${settings.wetness.toFixed(2)} · snow ${settings.snow.toFixed(2)} · terrain ${terrainMs.toFixed(1)} ms`
      + `\n${dressing.stats.rockTiles} rock tiles · ${dressing.stats.grassClumps} grass clumps · ${dressing.stats.trees} trees`
      + (dressing.stats.treesLoading ? ` (${dressing.stats.treesLoading} species loading)` : '')
      + (missing.length ? '\nTexture sets not bundled, default used · ' + missing.join(', ') + ' · run npm run textures:fetch' : '');
  }
});
document.body.dataset.ready = 'true';
onLeave(() => {
  renderer.setAnimationLoop(null); unbindResize(); dressing.dispose(); weatherUI.dispose(); weather.view.dispose(); orbit.dispose(); gui.destroy();
  scene.remove(clipmap.group, waterSheet); clipmap.dispose(); waterSheet.geometry.dispose(); waterSheet.material.dispose();
  for (const texture of Object.values(textures)) texture?.dispose?.();
  renderer.dispose();
});
window.worldDemo = {world, clipmap, dressing, weather, surfaceWeather, settings, focus, camera, orbit, scene};
