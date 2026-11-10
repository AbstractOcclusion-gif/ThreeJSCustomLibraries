import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {BOAT_DEFAULTS, BUOYANCY_DEFAULTS, FoamTrail, createOceanSurface, createWaterlineComposite, SurfaceProbes, skyFromWeather} from '../../src/water/index.js';
import {OceanCoastTerrain} from '../../src/terrain/index.js';
import {createLighting, syncLighting} from '../../src/core/lighting.js';
import {createParticleDepthBinding, createWaterSpray, Motes} from '../../src/particles/water/index.js';
import {createOceanFloat} from './float.js';
import {createDemoLife} from '../kit/life.js';
import {createDemoStructures} from '../kit/structures.js';
import {createCameraShots} from '../kit/shots.js';
import {createFixedStep} from '../../src/core/fixed-step.js';
import {benchRenderer, bindResize} from '../kit/page.js';
import {createBenchWeather, mountWeatherControls} from '../kit/weather.js';
import {detectAssets} from '../kit/assets.js';
import {bindRippleGesture} from '../ripple-gesture.js';
import {oceanDemoControls} from './controls.js';
import {sprayControls} from '../particles/controls.js';
import '../bench.css';
import {aimRay} from '../kit/input.js';

const $ = id => document.getElementById(id);
const renderer = benchRenderer();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(53, innerWidth / innerHeight, .15, 9500);
camera.position.set(18, 6.5, -108);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 2, -175); controls.enableDamping = true;
controls.minDistance = 12; controls.maxDistance = 165; controls.maxPolarAngle = Math.PI * .495; controls.enablePan = false; controls.update();
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
const weather = await createBenchWeather({scene, renderer, camera, initial: 'cloudy 1', hour: 15});
const aquariumAssets = new URL(import.meta.env.BASE_URL + 'webaquarium/', location.href);
const sheetsUrl = new URL('library/ocean/textures/', aquariumAssets).href;
const sheetBase = await detectAssets(sheetsUrl + 'foam_lace.png', sheetsUrl);
const foamUrl = sheetBase ? sheetBase + 'foam_lace.png' : import.meta.env.BASE_URL + 'webaquarium-water/foam_lace.png';
const laceTexture = await detectAssets(foamUrl, foamUrl)
  ? await new THREE.TextureLoader().loadAsync(foamUrl).catch(error => { console.warn('Foam lace texture failed to load; the ocean uses its generated one.', error); }) : undefined;
const ocean = createOceanSurface({renderer, sky: skyFromWeather(weather.view), caustics: {}, wake: {}, exclusion: true, laceTexture});
const waterScene = new THREE.Scene();
waterScene.add(ocean.mesh);
const terrainLighting = createLighting();
const ISLAND_CENTRE = [0, -220], PLANT_GUST = .4;
const coast = new OceanCoastTerrain({scene, settings: {centerX: ISLAND_CENTRE[0], centerZ: ISLAND_CENTRE[1]}, water: ocean.shoreBinding, onHeightField: ocean.setShore, lighting: terrainLighting});
// One environment for everything: the weather fills it, the ocean, plants, fire, smoke and spray read it.
const environment = weather.view.environment; environment.wind.gust = PLANT_GUST;
ocean.setEnvironment(environment);
const groundAt = (x, z) => coast.collisionHeightAt(x, z);
// Demo layout, metres. Plant lines are ground heights above mean sea: nothing grows on the wave-washed beach below them.
const [islandX, islandZ] = ISLAND_CENTRE, FISH_CEILING = -.6;
const island = await createDemoLife({scene, ground: groundAt, centre: ISLAND_CENTRE, environment, lighting: terrainLighting,
  plants: {radius: 64, treeLine: 6, bushLine: 3.6, grassLine: 2.4, trees: 38, bushes: 70, grass: 16000},
  camp: [islandX + 3, islandZ + 45],   // on the grass edge, toward the default camera
  fish: {bounds: new THREE.Box3(new THREE.Vector3(islandX - 22, -5, islandZ + 92), new THREE.Vector3(islandX + 22, FISH_CEILING, islandZ + 116)),
    counts: {roach: 24, rudd: 12, perch: 6}, size: 1, surfaceHeight: () => FISH_CEILING}});
// The bridge stands in the shallows; its physics ground is the seabed there, so wreckage sinks.
const structures = createDemoStructures({scene, ground: groundAt, camp: island.camp, bridge: [islandX - 78, -6, islandZ + 96], environment, lighting: terrainLighting});
const shots = createCameraShots({camera, controls, shots: {
  island: {radius: 135, height: 42, speed: .1, target: new THREE.Vector3(ISLAND_CENTRE[0], 8, ISLAND_CENTRE[1])},
  camp: {radius: 19, height: 7, speed: .22, target: new THREE.Vector3(island.camp.x + 2, groundAt(island.camp.x, island.camp.z) + 1, island.camp.z)},
  bridge: {radius: 62, height: 14, speed: .15, target: structures.bridgeCentre},
}});
const probes = new SurfaceProbes(ocean.fft, 3, {wake: ocean.wake}), probeStep = 2;
const waterline = createWaterlineComposite(renderer, {caustics: ocean.caustics});
const postColor = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthBuffer: false});
const waterPlane = new THREE.Vector4();
const fxScene = new THREE.Scene();
const fxDepth = createParticleDepthBinding({THREE, camera, depthTexture: ocean.depthTexture,
  waterDistanceTexture: ocean.waterDistanceTexture, viewport: ocean.viewport, waterPlane});
const skyLight = weather.view.uniforms;
const motes = new Motes({scene, sun: skyLight.uSunCol, ambient: skyLight.uAmb,
  optics: waterline.uniforms, caustics: ocean.caustics});
const spray = createWaterSpray({
  THREE, scene: fxScene, renderer, depth: fxDepth, surface: ocean.shoreBinding,
  lighting: {uniforms: {uSunCol: skyLight.uSunCol, uFxAmbient: skyLight.uAmb},
    direction: skyLight.uSkySun.value, ambient: skyLight.uAmb.value},
  assets: {assetBaseUrl: sheetBase},
});
const trail = new FoamTrail({renderer, scene: fxScene, surface: ocean.shoreBinding, depth: fxDepth, sheets: spray.sheets,
  skyUniforms: {uSunCol: skyLight.uSunCol, uFxAmbient: skyLight.uAmb}, sunDir: skyLight.uSkySun.value,
  foamTexture: ocean.uniforms.tWhitecap.value});
const boatSettings = {excludeHulls: true, wakeMode: 'footprint', drive: false, follow: true, ...BUOYANCY_DEFAULTS, ...BOAT_DEFAULTS};
let boat, launching = false, disposed = false, removeHullFootprint;
const boatClock = createFixedStep({step: 1 / 60, maxSteps: 3});   // the boat's own rate; at most the 0.05 s a frame may carry
const boatDelta = new THREE.Vector3(), boatFocus = new THREE.Vector3();
function applyBoatSettings() {
 if (!boat?.ready) return;
 boat.buoyancy.applySettings(boatSettings);
 Object.assign(boat.controller.s, boatSettings);
}
async function launchBoat() {
 if (boat || launching) return;
 if (!sheetBase) { $('error').hidden = false; $('error').textContent = 'Stage WebAquarium assets with npm run stage:webaquarium to load the original boat.'; return; }
 launching = true;
 try {
  const {Boat} = await import('../../src/water/ocean/boat.js');
  if (disposed) return;
  boat = new Boat({ocean, assetBaseUrl: aquariumAssets, input: window, emitSplash: spray.emitSplash,
   groundHeightAt: (x, z) => coast.collisionHeightAt(x, z)});
  await boat.load(renderer);
  if (!boat.ready) return;
  applyBoatSettings();
  boat.body.position.set(0, .12, -108);
  boat.body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  boat.body.applyTo(boat.group);
  scene.add(boat.group);
  boatFocus.set(boat.body.position.x, .2, boat.body.position.z);
  controls.target.copy(boatFocus);
  camera.position.copy(boatFocus).add(new THREE.Vector3(-12, 10, 9));
  controls.update();
 } catch (error) {
  boat?.dispose(); boat = undefined;
  $('error').hidden = false; $('error').textContent = error.message;
 } finally { launching = false; }
}
function stepBoat(dt) {
 if (!boat?.ready) return;
 boat.collectSamples();
 boat.controller.stick.y = boatSettings.drive ? .75 : 0;
 boatClock.advance(dt, step => boat.step(step));
 if (boatSettings.wakeMode === 'footprint') {
  removeHullFootprint ??= ocean.obstacles.add(boat.exclusionShell.geometry, boat.exclusionShell, () => boat.waterlineY);
 } else if (removeHullFootprint) { removeHullFootprint(); removeHullFootprint = undefined; }
 boat.updateWake(ocean.wake, dt, boatSettings.wakeMode);
 boat.updateSpray(dt);
 boatDelta.set(boat.body.position.x, .2, boat.body.position.z).sub(boatFocus);
 boatFocus.add(boatDelta);
 if (boatSettings.follow && !view.waterline) { camera.position.add(boatDelta); controls.target.add(boatDelta); }
}
const float = createOceanFloat(scene, ocean, spray.emitSplash);
const ray = new THREE.Raycaster(), impact = new THREE.Vector3();
const meanSea = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const rippleGesture = bindRippleGesture(renderer.domElement, controls, event => {
  if (view.waterline) return;
  aimRay(ray, event, renderer.domElement, camera);
  if (!ray.ray.intersectPlane(meanSea, impact)) return;
  const {center, halfSize} = ocean.wake;
  if (Math.abs(impact.x - center.x) >= halfSize || Math.abs(impact.z - center.y) >= halfSize) return;
  if ((coast.collisionHeightAt(impact.x, impact.z) ?? -1) < 0) return impact;
}, ({x, z}, strength) => ocean.wake.addDrop(x, z, 3.2, .65 * strength), {spacing: 1.5});

const gui = createBenchPanel('Ocean coast demo');
const islandActions = gui.addFolder('Island');
islandActions.add(island, 'ignite').name('Light the camp fire');
islandActions.add(island, 'resetFire').name('Reset the camp');
islandActions.add(structures, 'cutRope').name('Cut the rope');
islandActions.add(structures, 'hangRope').name('Hang a new rope');
islandActions.add(structures, 'fireAtBridge').name('Fire at the bridge');
islandActions.add(structures, 'buildBridge').name('Rebuild the bridge');
shots.addTo(islandActions);
sprayControls(gui, {spray, depth: fxDepth}).close();
const wf = mountWeatherControls(weather);
const {settings: s, view, orbitPosition, disposeTrailTextures} = oceanDemoControls(gui, {
  boatSettings, launchBoat, applyBoatSettings, trail, ocean, sheetBase, float, camera, controls, rippleGesture, motes, coast, weather,
  bundled: import.meta.glob('../../presets/ocean/*.json'),
});

const unbindResize = bindResize(renderer, camera);
let last = null, lastUI = 0, time = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  probes.collect();
  if (view.waterline) {
    camera.position.set(orbitPosition.x, view.eyeHeight, orbitPosition.z);
    camera.lookAt(controls.target.x, view.eyeHeight, controls.target.z);
  } else if (!shots.update(dt)) controls.update();
  weather.system.update(dt); weather.view.update(dt);
  const light = weather.view.uniforms;
  syncLighting(terrainLighting.uniforms, {sun: weather.view.sun, hemi: weather.view.hemi, fog: scene.fog});   // island lit and fogged like the rest
  const wind = weather.system.weather;
  island.update(dt, camera);
  structures.update(dt, camera);
  float.step(dt);
  stepBoat(dt);
  rippleGesture.update(dt);
  ocean.update(dt, undefined, camera.position);   // wind speed and heading come from the shared environment
  spray.update(dt, ocean.wake);
  trail.update(dt, boat);
  trail.inject(ocean.wake);
  time += dt;
  const {x, z} = camera.position;
  probes.points[0].set(x, 0, z);
  probes.points[1].set(x + probeStep, 0, z);
  probes.points[2].set(x, 0, z + probeStep);
  probes.issue(time, camera.position);
  float.issue(time, camera.position);
  boat?.issueSamples(time, camera.position);
  const [a, b, c] = probes.samples;
  const valid = a.valid && b.valid && c.valid;
  const slopeX = valid ? (b.height - a.height) / probeStep : 0;
  const slopeZ = valid ? (c.height - a.height) / probeStep : 0;
  const height = valid ? a.height + slopeX * (x - a.x) + slopeZ * (z - a.z) : 0;
  motes.update(dt, {cameraPosition: camera.position, height, viewportHeight: Math.max(1, ocean.viewport.y)});
  const opaque = ocean.captureScene(scene, camera, {waterType: view.waterType, excludeHulls: boatSettings.excludeHulls});
  const water = ocean.captureWater(waterScene, camera);
  const useWeatherPost = weather.view.postEnabled;
  if (useWeatherPost) {
    postColor.setSize(opaque.width, opaque.height);
    renderer.setRenderTarget(postColor);
  }
  try {
    waterline.renderLayers(opaque, water, camera, {height, slopeX, slopeZ, waterType: view.waterType, clarity: s.clarity, godRays: view.godRays,
      sunDirection: light.uSkySun.value, sunColor: light.uSunCol.value, ambientColor: light.uAmb.value});
  } finally {
    if (useWeatherPost) renderer.setRenderTarget(null);
  }
  const n = waterline.uniforms.uPlaneN.value;
  waterPlane.set(n.x, n.y, n.z, waterline.uniforms.uPlaneD.value);
  if (useWeatherPost) {
    weather.view.render({color: postColor.texture, depth: opaque.depthTexture, waterDistance: water.texture, waterPlane});
  }
  const autoClear = renderer.autoClear;
  try {
    renderer.autoClear = false;
    renderer.render(fxScene, camera);
  } finally {
    renderer.autoClear = autoClear;
  }
  if (now - lastUI > 250) {
    lastUI = now; wf.sync();
    const {fft, clipmap} = ocean;
    $('status').textContent = `${weather.system.weather.dominant} · ${weather.hourLabel(weather.system.day.hour)}
wind ${weather.system.weather.wind.toFixed(1)} m/s · waves ${fft.effective.significantHeight.toFixed(2)} m
FFT ${fft.resolution}² × ${fft.cascades} · clipmap ${clipmap.levelCount} levels
Wake window ${ocean.wake.resolution}² · ${ocean.wake.halfSize * 2} m
Surface at camera ${a.valid ? a.height.toFixed(2) + ' m' : 'sampling…'}${float.active ? '\nBlock submerged ' + Math.round(float.submergedFraction * 100) + '% · droplets ' + spray.active.droplets : ''}${boat?.ready ? '\nBoat ' + boat.speed.toFixed(1) + ' m/s · WASD or arrow keys' : ''}`;
  }
});
document.body.dataset.ready = 'true';
window.oceanBench = {ocean, weather, scene, camera, renderer, probes, island, structures, controls, shots};
addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true;
  renderer.setAnimationLoop(null);
  unbindResize();
  rippleGesture.dispose();
  probes.dispose();
  float.dispose();
  island.dispose();
  structures.dispose();
  removeHullFootprint?.();
  boat?.dispose();
  trail.dispose();
  disposeTrailTextures();
  spray.dispose();
  motes.dispose();
  waterline.dispose();
  postColor.dispose();
  coast.dispose();
  ocean.dispose();
  laceTexture?.dispose();
  weather.view.dispose();
  controls.dispose();
  gui.destroy();
  wf.dispose();
  renderer.dispose();
});
