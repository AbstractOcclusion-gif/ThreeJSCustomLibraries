import * as THREE from 'three';
import {createCameraCollision, createCameraDirector, createOrbitRig, createThirdPersonRig} from '../../src/camera/index.js';
import {createLookInput} from '../demo-traversal/look-input.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchWeather, mountWeatherControls} from '../kit/weather.js';
import {createTouchControls} from '../kit/touch-controls.js';
import {createMeadowGround} from './ground.js';
import {createMeadowPlants} from './plants.js';
import {createMeadowPond} from './pond.js';
import {createMeadowWalker, MOVE_KEYS} from './walker.js';
import {hasLocalLara} from './avatars.js';
import {createFootprints} from './footprints.js';
import {createMeadowSnowEffects} from './snow-effects.js';
import {mountMeadowControls} from './controls.js';
import {createQualityDefaults, QUALITY} from './quality.js';
import {SITE} from './layout.js';
import '../bench.css';

const VIEW = {
 near: .1, far: 520, fov: 55, distance: 5.3, pitch: .38, targetHeight: 1.1, sensitivity: .0025,
 zoomRate: .001, zoomMin: .7, zoomMax: 1.6, orbit: {radius: 34, height: 18, speed: .13},
};
const WEATHER = {
 clear: {state: 'clear', temperature: null},
 rain: {state: 'rainy', temperature: null},
 snow: {state: 'rainy', temperature: -4},
};
const WEATHER_TRANSITION = 3; // seconds to blend into the selected conditions
const SHADOW = {reach: SITE.span * .64, near: 1, far: 230, bias: -.00015};
const FOG_BANK = {bankLevel: SITE.pond.level, bankHeight: 3, bankScale: 21, bankDensity: .036, bankCoverage: .72};
const TOUCH_BUTTONS = [{id: 'jump', label: 'Jump', code: 'Space'}];
const inspection = new THREE.Vector3(SITE.pond.x / 2, SITE.pond.level, SITE.pond.z);
const $ = selector => document.querySelector(selector);
const status = $('#status'), errorOutput = $('#error');
function report(error) {
 console.error(error);
 errorOutput.hidden = false;
 errorOutput.textContent = error.message;
}

async function start() {
 const params = new URLSearchParams(location.search), requestedQuality = params.get('quality');
 const forceTouch = params.has('touch'), settingsPanel = $('#meadow-settings'), qualitySelect = $('#quality');
 const touchScreen = forceTouch || matchMedia('(pointer: coarse)').matches;
 settingsPanel.open = !touchScreen;
 qualitySelect.value = Object.hasOwn(QUALITY, requestedQuality) ? requestedQuality : touchScreen ? 'low' : 'balanced';
 let quality = QUALITY[qualitySelect.value];
 const renderer = benchRenderer();
 renderer.setPixelRatio(quality.scale);
 renderer.shadowMap.enabled = true;
 renderer.shadowMap.autoUpdate = false;
 const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, innerWidth / innerHeight, VIEW.near, VIEW.far);
 const unbindResize = bindResize(renderer, camera);
 const [ground, weather] = await Promise.all([createMeadowGround({renderer, scene}),
  createBenchWeather({scene, renderer, camera, lightTarget: new THREE.Vector3(), initial: WEATHER.clear.state, hour: 15})]);
 const sun = weather.view.sun;
 weather.view.configure({appearance: FOG_BANK});
 sun.castShadow = true;
 sun.shadow.mapSize.setScalar(quality.shadow);
 sun.shadow.bias = SHADOW.bias;
 Object.assign(sun.shadow.camera, {left: -SHADOW.reach, right: SHADOW.reach, top: SHADOW.reach,
  bottom: -SHADOW.reach, near: SHADOW.near, far: SHADOW.far});
 sun.shadow.camera.updateProjectionMatrix();
 const environment = weather.view.environment, field = ground.field;
 const snowEffects = await createMeadowSnowEffects({scene, field, environment});
 const pond = createMeadowPond({renderer, scene, camera, field, weather: weather.view});
 const plants = createMeadowPlants({renderer, scene, field, environment, report});
 const applyQualityDefaults = createQualityDefaults({plants, pond, weather});
 applyQualityDefaults(quality);
 const walker = await createMeadowWalker({scene, field, heights: ground.heights, levelAt: pond.levelAt, report, onContact(event) {
  if (event.type !== 'character:jump' && event.water > 0) pond.contact(event);
 }});
 const footprints = createFootprints({field, snowSurface: ground.snowSurface, tracks: ground.tracks,
  onSnowLaid: walker.laySnowSupport, onSample(column, row, height) {
  walker.updateHeightSample(column, row, height);
  pond.noteHeightSample(column, row);
 }});
 const dryGroundAt = ({x, z}) => !Number.isFinite(pond.levelAt(x, z));
 const inDeepSnow = controller => dryGroundAt(controller.position) && footprints.deepSnowAt(controller);
 function plantFoot(point, heading) {
  if (!dryGroundAt(point)) return;
  footprints.mark(point, heading);
  snowEffects.plant(point, heading);
  plants.contact(point);
 }

 const follow = createThirdPersonRig({...VIEW, yaw: SITE.heading});
 const director = createCameraDirector(camera).register('follow', follow).register('orbit', createOrbitRig(VIEW.orbit));
 director.setCollision(createCameraCollision({raycast: walker.raycast}));
 const keyboard = new Set(), target = new THREE.Vector3(), listeners = new AbortController();
 const options = {signal: listeners.signal};
 const cameraSettings = {zoom: 1, minZoom: VIEW.zoomMin, maxZoom: VIEW.zoomMax};
 const input = createLookInput({canvas: renderer.domElement, sensitivity: VIEW.sensitivity, follow: {
  look: follow.look,
  zoom(delta) { cameraSettings.zoom = THREE.MathUtils.clamp(cameraSettings.zoom * Math.exp(delta * VIEW.zoomRate), VIEW.zoomMin, VIEW.zoomMax); },
 }});
 const weatherUI = mountWeatherControls(weather, $('#meadow-weather'));
 function setSnow(enabled) {
  footprints.setSnow(enabled);
  if (!enabled) snowEffects.clear();
 }
 const tuning = mountMeadowControls({container: $('#meadow-tuning'), ground, plants, pond, footprints, camera: cameraSettings,
  setTreeCount: walker.setTreeCount, setSnow});
 if (forceTouch) tuning.domElement.classList.add('force-touch-styles');
 const view = $('#view'), weatherSelect = $('#conditions');
 const avatarSelect = $('#avatar'), avatarStatus = $('#avatar-status');
 hasLocalLara().then(available => { avatarSelect.querySelector('[value="lara"]').hidden = !available; });
 let avatar = avatarSelect.value;
 avatarSelect.addEventListener('change', async () => {
  const next = avatarSelect.value;
  avatarSelect.disabled = true;
  avatarStatus.textContent = next === 'lara' ? 'Loading Lara…' : 'Loading bot…';
  keyboard.clear();
  try {
   await walker.selectAvatar(next);
   avatar = next;
   avatarStatus.textContent = '';
  } catch (error) {
   avatarSelect.value = avatar;
   avatarStatus.textContent = 'Could not load the selected character.';
   console.warn(error);
  } finally {
   avatarSelect.disabled = false;
   avatarSelect.blur();
  }
 }, options);
 qualitySelect.addEventListener('change', () => {
  const previous = quality;
  quality = QUALITY[qualitySelect.value];
  const {scale, shadow} = quality;
  applyQualityDefaults(quality, previous);
  for (const control of tuning.controllersRecursive()) control.updateDisplay();
  renderer.setPixelRatio(scale);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  sun.shadow.mapSize.setScalar(shadow);
  renderer.shadowMap.needsUpdate = true;
  qualitySelect.blur();
 }, options);
 view.addEventListener('change', () => {
  keyboard.clear();
  director.select(view.value);
 }, options);
 weatherSelect.addEventListener('change', () => {
  const {state, temperature} = WEATHER[weatherSelect.value];
  weather.system.weather.setTemperatureOverride(temperature);
  weather.system.weather.transitionTo(state, {seconds: WEATHER_TRANSITION});
  setSnow(weatherSelect.value === 'snow');
 }, options);
 const reset = () => {
  keyboard.clear();
  footprints.clear(); snowEffects.clear(); plants.clear(); pond.clear();
  walker.reset();
  director.reset();
 };
 $('#reset').addEventListener('click', reset, options);
 function press(code, repeat = false) {
  if (code === 'KeyR') { if (!repeat) reset(); }
  else keyboard.add(code);
 }
 const touch = createTouchControls({buttons: TOUCH_BUTTONS, onPress: press, onRelease: code => keyboard.delete(code), force: forceTouch});
 addEventListener('keydown', event => {
  if (event.target.closest?.('button, input, select, textarea, [contenteditable]')) return;
  if (!MOVE_KEYS.has(event.code) && event.code !== 'KeyR') return;
  event.preventDefault();
  press(event.code, event.repeat);
 }, options);
 addEventListener('keyup', event => keyboard.delete(event.code), options);
 addEventListener('blur', () => keyboard.clear(), options);
 const frozenKeys = new Set();
 let lastStatus = -Infinity, lastShadow = -Infinity;
 startFrameLoop(renderer, (dt, now) => {
  const following = director.selected === 'follow';
  if (footprints.update(dt)) { walker.refreshGround(); pond.refreshBed(); }
  const walking = walker.update(dt, following ? keyboard : frozenKeys, follow.yaw, plantFoot, inDeepSnow, following ? touch : null);
  if (dryGroundAt(walker.controller.position)) footprints.packPath(walker.controller, walking);
  target.copy(walker.model.position).y += VIEW.targetHeight;
  director.update(dt, {target: following ? target : inspection, distance: cameraSettings.zoom});
  camera.updateMatrixWorld();
  weather.system.update(dt);
  weather.view.update(dt);
  ground.update(dt, weather.system.weather, following ? walker.controller.position : inspection, quality.terrainRings);
  snowEffects.update(dt);
  plants.update(dt, camera, walker.controller);
  if (now - lastShadow >= quality.shadowInterval) { renderer.shadowMap.needsUpdate = true; lastShadow = now; }
  pond.draw(dt);
  weather.view.render();
  weatherUI.sync();
  if (now - lastStatus >= STATUS_REFRESH_MS) {
   lastStatus = now;
   const {position} = walker.controller;
   const depth = pond.levelAt(position.x, position.z) - position.y;
   status.textContent = depth > 0 ? `Wading · ${Math.round(depth * 100)} cm` : 'Ready to explore';
  }
 });
 onLeave(() => {
  renderer.setAnimationLoop(null);
  listeners.abort(); touch.dispose(); input.dispose(); unbindResize();
  weatherUI.dispose(); tuning.destroy();
  walker.dispose(); snowEffects.dispose(); plants.dispose(); pond.dispose(); ground.dispose(); weather.view.dispose(); renderer.dispose();
 });
}

start().catch(report);
