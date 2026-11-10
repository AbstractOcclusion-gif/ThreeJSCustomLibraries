import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {BOAT_DEFAULTS, BUOYANCY_DEFAULTS, FoamTrail, createOceanSurface, createWaterlineComposite, JERLOV_NAMES, SurfaceProbes, skyFromWeather, OCEAN_PRESETS, OCEAN_DEFAULTS, OCEAN_REFLECTION_MODES, SEA_STATE_DEFAULTS} from '../../src/water/index.js';
import {OceanCoastTerrain, OCEAN_COAST_WET_DEFAULTS} from '../../src/terrain/index.js';
import {createLighting, syncLighting} from '../../src/core/lighting.js';
import {createParticleDepthBinding, createWaterSpray, Motes} from '../../src/particles/water/index.js';
import {createOceanFloat} from './float.js';
import {benchRenderer, createBenchWeather, detectAssets, weatherFolder, presetsFolder} from '../shared.js';
import {bindRippleGesture} from '../ripple-gesture.js';
import {trailControls} from './trail-controls.js';
import '../bench.css';

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
  ? await new THREE.TextureLoader().loadAsync(foamUrl).catch(() => undefined) : undefined;
const ocean = createOceanSurface({renderer, sky: skyFromWeather(weather.view), caustics: {}, wake: {}, exclusion: true, laceTexture});
const waterScene = new THREE.Scene();
waterScene.add(ocean.mesh);
const terrainLighting = createLighting();
const coast = new OceanCoastTerrain({scene, settings: {centerZ: -220}, water: ocean.shoreBinding, onHeightField: ocean.setShore, lighting: terrainLighting});
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
let boat, launching = false, disposed = false, boatAccumulator = 0, removeHullFootprint;
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
 boatAccumulator += dt;
 while (boatAccumulator >= 1 / 60) { boat.step(1 / 60); boatAccumulator -= 1 / 60; }
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
const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), impact = new THREE.Vector3();
const meanSea = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const rippleGesture = bindRippleGesture(renderer.domElement, controls, event => {
  if (view.waterline) return;
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.set(2 * (event.clientX - bounds.left) / bounds.width - 1, 1 - 2 * (event.clientY - bounds.top) / bounds.height);
  ray.setFromCamera(pointer, camera);
  if (!ray.ray.intersectPlane(meanSea, impact)) return;
  const {center, halfSize} = ocean.wake;
  if (Math.abs(impact.x - center.x) >= halfSize || Math.abs(impact.z - center.y) >= halfSize) return;
  if ((coast.collisionHeightAt(impact.x, impact.z) ?? -1) < 0) return impact;
}, ({x, z}, strength) => ocean.wake.addDrop(x, z, 3.2, .65 * strength), {spacing: 1.5});

const gui = new GUI({title: 'Ocean'});
const boatFolder = gui.addFolder('Boat');
boatFolder.add({launchBoat}, 'launchBoat').name('Launch motorboat');
boatFolder.add(boatSettings, 'drive').name('Cruise forward');
boatFolder.add(boatSettings, 'follow').name('Follow boat');
boatFolder.add(boatSettings, 'excludeHulls').name('Keep cockpit dry');
boatFolder.add(boatSettings, 'wakeMode', ['footprint', 'drops']).name('Hull wake');
const buoyControls = boatFolder.addFolder('Buoyancy').close();
const driveControls = boatFolder.addFolder('Speed & steering').close();
for (const [folder, ranges] of [[buoyControls, {
 buoyancy: [0,6,.05,'Float strength'], waterLinearDamping: [0,8,.05,'Linear damping'], waterAngularDamping: [0,8,.05,'Angular damping'],
 floatRadiusScale: [.5,3,.05,'Float radius'], waveDriftStrength: [0,4,.05,'Wave drift'], verticalSettleDamping: [0,4,.05,'Vertical settle'],
 surfaceGlueIntensity: [0,4,.05,'Surface glue'], maxBuoyancyForce: [0,60,.5,'Maximum lift'],
}], [driveControls, {
 enginePower: [0,30,.5,'Engine power'], reverseCoefficient: [0,1,.05,'Reverse'], turnAcceleration: [0,10,.1,'Turn acceleration'],
 fullAuthoritySpeed: [.5,10,.1,'Full rudder · m/s'], forwardDrag: [0,.5,.005,'Forward drag'], lateralDrag: [0,3,.05,'Lateral drag'],
 yawDamping: [0,10,.1,'Yaw damping'], propellerDepth: [.05,2,.05,'Propeller depth'], hullDepth: [.05,2,.05,'Hull depth'],
}]]) for (const [key, [min,max,step,label]] of Object.entries(ranges)) folder.add(boatSettings, key, min, max, step).name(label).onChange(applyBoatSettings);
buoyControls.add(boatSettings, 'surfaceRelativeDrag').name('Surface-relative drag').onChange(applyBoatSettings);
const disposeTrailTextures = trailControls(boatFolder.addFolder('Boat foam trail').close(), trail, ocean.uniforms.tWhitecap.value, sheetBase);
const wf = weatherFolder(gui, weather);
const atmosphere = weather.view.getConfig().appearance;
wf.folder.add(atmosphere, 'heightFog').name('3D height fog').onChange(heightFog => weather.view.configure({appearance: {heightFog}}));
wf.folder.add(atmosphere, 'sunShafts').name('Volumetric sunlight').onChange(sunShafts => weather.view.configure({appearance: {sunShafts}}));
const s = ocean.settings;
const sea = gui.addFolder('Sea state');
const spectrum = {...SEA_STATE_DEFAULTS};
const applySpectrum = () => ocean.fft.setSeaState(spectrum);
function applyLegacySea(values) {
  Object.assign(spectrum, SEA_STATE_DEFAULTS, {
    significantWaveHeight: values.chop * 1.875, swellHeight: values.swell,
    swellWavelength: values.swellLength, choppiness: values.choppiness,
  });
  applySpectrum();
}
const preset = {name: 'rolling'};
sea.add(preset, 'name', Object.keys(OCEAN_PRESETS)).name('preset').onChange(v => {
  ocean.apply(OCEAN_PRESETS[v]); applyLegacySea(s); gui.controllersRecursive().forEach(c => c.updateDisplay());
});
sea.add(spectrum, 'significantWaveHeight', 0, 6, .05).name('Significant wave height · m').onChange(applySpectrum);
sea.add(spectrum, 'peakWavelength', 5, 160, 1).name('Peak wavelength · m').onChange(applySpectrum);
sea.add(spectrum, 'swellHeight', 0, 4, .05).name('Swell height · m').onChange(applySpectrum);
sea.add(spectrum, 'swellWavelength', 20, 250, 1).name('Swell wavelength · m').onChange(applySpectrum);
sea.add(spectrum, 'choppiness', 0, 2, .01).name('Crest shape').onChange(applySpectrum);
sea.add(spectrum, 'aperiodic').name('Reduce tile repetition').onChange(applySpectrum);
sea.add({drop: () => float.drop(camera)}, 'drop').name('Drop floating block');
sea.add({mode: 'sphere'}, 'mode', ['sphere', 'footprint']).name('Block wake mode').onChange(mode => float.setMode(mode));
sea.add(s, 'whitecaps', 0, 1, .01).onChange(() => ocean.apply()); sea.add(s, 'waveSpeed', 0, 2, .01); sea.add(s, 'heading', 0, 360, 1).name('wind heading °').onChange(v => { weather.system.weather.windHeading = v; ocean.apply(); });
const look = gui.addFolder('Look');
look.addColor(s, 'waterTint').onChange(() => ocean.apply()); look.addColor(s, 'foamTint').onChange(() => ocean.apply());
look.add(s, 'reflection', 0, 1.5, .01).onChange(() => ocean.apply()); look.add(s, 'fresnelPower', 1, 10, .1).onChange(() => ocean.apply());
const reflections = look.addFolder('Scene reflection');
reflections.add(s, 'reflectionSource', OCEAN_REFLECTION_MODES).name('Source').onChange(() => ocean.apply());
reflections.add(s, 'reflectionMix', 0, 1, .05).name('Scene mix').onChange(() => ocean.apply());
reflections.add(s, 'planarResolution', [128, 256, 512]).name('Planar resolution');
reflections.add(s, 'planarHz', 5, 60, 1).name('Planar refresh · Hz');
reflections.add(s, 'reflectionSteps', 4, 32, 1).name('Screen-space steps').onChange(() => ocean.apply());
reflections.close();
look.add(s, 'glint', 0, 3, .01).onChange(() => ocean.apply()); look.add(s, 'fineRipples', 0, 2, .01).onChange(() => ocean.apply());
look.add(s, 'foamOpacity', 0, 1, .01).onChange(() => ocean.apply()); look.add(s, 'foamFeather', .02, 1, .01).onChange(() => ocean.apply()); look.add(s, 'foamScale', .25, 4, .01).onChange(() => ocean.apply());
const view = {waterline: false, eyeHeight: 0, waterType: 'Open ocean II', godRays: 1};
const orbitPosition = new THREE.Vector3();
const optics = gui.addFolder('Underwater optics');
optics.add(view, 'waterline').name('Waterline view').onChange(enabled => {
  rippleGesture.cancel();
  controls.enabled = !enabled;
  if (enabled) orbitPosition.copy(camera.position);
  else camera.position.copy(orbitPosition);
});
optics.add(view, 'eyeHeight', -3, 2, .01).name('Eye above mean sea · m');
optics.add(view, 'waterType', JERLOV_NAMES).name('Water type');
optics.add(s, 'refractionStrength', 0, 1, .01).name('Refraction').onChange(() => ocean.apply());
optics.add(s, 'clarity', .2, 3, .05).name('Depth clarity').onChange(() => ocean.apply());
optics.add(s, 'tirStrength', 0, 1, .01).name('Internal reflection').onChange(() => ocean.apply());
optics.add(view, 'godRays', 0, 1, .05).name('Underwater sun shafts');
optics.add(motes.s, 'on').name('Suspended particles');
look.add(s, 'crestGlow', 0, 6, .05).name('Crest glow').onChange(() => ocean.apply());
const shore = gui.addFolder('Coast');
const wet = {...OCEAN_COAST_WET_DEFAULTS};
shore.add(coast.s, 'on').name('Show island and seabed').onChange(on => coast.applySettings({on}));
shore.add(wet, 'strength', 0, 1, .05).name('Wet sand').onChange(() => coast.applyWet(wet));
shore.add(ocean.caustics.settings, 'strength', 0, 2, .05).name('Bed caustics');
shore.close();
presetsFolder(gui, {bundled: import.meta.glob('../../presets/ocean/*.json'), name: 'ocean',
  getState: () => ({schema: 'three-kit.ocean', version: 1, settings: {...s}, spectrum: {...spectrum}}),
  apply: p => {
    ocean.apply({...OCEAN_DEFAULTS, ...(p.settings ?? p)});
    if (p.spectrum) { Object.assign(spectrum, SEA_STATE_DEFAULTS, p.spectrum); applySpectrum(); }
    else applyLegacySea(s);
    gui.controllersRecursive().forEach(c => c.updateDisplay());
  }});

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
let last = null, lastUI = 0, time = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  probes.collect();
  if (view.waterline) {
    camera.position.set(orbitPosition.x, view.eyeHeight, orbitPosition.z);
    camera.lookAt(controls.target.x, view.eyeHeight, controls.target.z);
  } else controls.update();
  weather.system.update(dt); weather.view.update(dt);
  const light = weather.view.uniforms;
  syncLighting(terrainLighting.uniforms, {sun: weather.view.sun, hemi: weather.view.hemi, fog: scene.fog});   // island lit and fogged like the rest
  const wind = weather.system.weather;
  float.step(dt);
  stepBoat(dt);
  rippleGesture.update(dt);
  ocean.update(dt, wind.wind, camera.position, wind.windHeading);
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
window.oceanBench = {ocean, weather, scene, camera, renderer, probes};
addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true;
  renderer.setAnimationLoop(null);
  removeEventListener('resize', resize);
  rippleGesture.dispose();
  probes.dispose();
  float.dispose();
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
  renderer.dispose();
});
