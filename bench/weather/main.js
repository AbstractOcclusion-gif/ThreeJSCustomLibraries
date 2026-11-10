import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createWeatherSystem, DEFAULT_WEATHER_STATES, hourLabel} from '../../src/weather/index.js';
import {createThreeWeather} from '../../src/weather/three/index.js';
import {createWeatherDevPanel} from '../../src/weather/three/dev-panel.js';
import {bundledWeatherAssets} from '../../src/weather/three/bundled-assets.js';
import {createSurfaceWeather, createTrackMask, createWeatherSurfaceMaterial} from '../../src/surface/index.js';
import {downloadJson, readJsonFile} from '../../src/core/presets.js';
import '../bench.css';
import '../ui-demo.js';
import {detectAssets} from '../kit/assets.js';
import {bindResize} from '../kit/page.js';
import {aimRay} from '../kit/input.js';

const $ = id => document.getElementById(id), errors = [], events = [];
function showError(error) { errors.push(String(error)); $('error').hidden = false; $('error').textContent = String(error); console.error(error); }


const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
renderer.debug.onShaderError = (gl, program, vertex, fragment) => showError('Shader error: ' + gl.getProgramInfoLog(program) + ' ' + gl.getShaderInfoLog(vertex) + ' ' + gl.getShaderInfoLog(fragment));
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .2, 6000);
camera.position.set(105, 22, -37);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 9, 0); controls.enableDamping = true; controls.minDistance = 12; controls.maxDistance = 350; controls.maxPolarAngle = Math.PI * .49;

const cloudShapes = {
  'cloudy 1': [.35, .52, .95, 1.25, .15],
  'cloudy 2': [.53, .72, 1.35, 1.1, .3],
  overcast: [1, 1.35, .55, .45, .25],
  stormy: [.94, .92, 2.15, .9, .6],
};
const valleyStates = DEFAULT_WEATHER_STATES.map(state => ({...state, cloud: cloudShapes[state.name] ?? state.cloud}));
const snowy = {...valleyStates.find(s => s.name === 'overcast'), name: 'snowy', temperature: -4, snow: 1, rain: 0, wind: 5, visibility: 900, density: .6, sunlight: .3, next: {overcast: 2, clear: 1}};
const system = createWeatherSystem({
  weather: {states: [...valleyStates, snowy], initial: 'cloudy 2', seed: 17, windHeading: 20, transitionSeconds: 4, holdSeconds: [20, 45], autoTransitionSeconds: [8, 15]},
  day: {hour: 17.2, cycleSeconds: 120, moonLight: true},
  onEvent: event => { events.unshift(event); events.length = Math.min(events.length, 8); $('events').textContent = events.map(e => JSON.stringify(e)).join('\n'); },
});

// Optional licensed textures live in private-assets/weather/ (served at /weather/). Probe once; fall back to the bundled set.
const weatherUrl = import.meta.env.BASE_URL + 'weather/';
const privateBase = await detectAssets(weatherUrl + 'cirrus.png', weatherUrl);
const assetBaseUrl = privateBase ?? 'bundled';
const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0), rayOrigin = new THREE.Vector3();
function surfaceAt(x, z, objects) {
  raycaster.set(rayOrigin.set(x, 300, z), down);
  return raycaster.intersectObjects(objects, false)[0]?.point;
}
const view = createThreeWeather({system, scene, renderer, camera, ...(privateBase ? {assetBaseUrl: privateBase} : bundledWeatherAssets()),
  resolveLightningHit(x, z) {
    const scale = Math.min(1, 160 / Math.hypot(x, z));
    return surfaceAt(x * scale, z * scale, [terrain]);
  },
  sky: {quality: 'low', bottom: 460, thickness: 540, scale: 5600, mapScale: 12000, mapVariation: .48, detail: .32, aurora: true, auroraHeading: 160},
  appearance: {sunShafts: true, shaftStrength: 1.4, heightFog: true}, precipitation: {count: 800, radius: 30, height: 30}});
view.sun.castShadow = true; view.sun.shadow.mapSize.set(1024, 1024); Object.assign(view.sun.shadow.camera, {left: -180, right: 180, top: 180, bottom: -180, near: 1, far: 400});

// Neutral test valley: ground, hills, trees, blocks, three roughness spheres.
const materials = [], geometries = [];
const surfaceWeather = createSurfaceWeather();
const tracks = createTrackMask({origin: [-48, -48], size: [96, 96], resolution: 512});
function mesh(geometry, color, x, y, z, surface) {
  const parameters = {color, roughness: .85, map: surface?.map ?? null};
  const material = surface ? createWeatherSurfaceMaterial(parameters, {weather: surfaceWeather, ...surface}) : new THREE.MeshStandardMaterial(parameters);
  view.addCloudShadowReceiver(material);
  materials.push(material); geometries.push(geometry);
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; scene.add(object);
  return object;
}
const soilSize = 32, soil = new Uint8Array(soilSize * soilSize * 4);
for (let z = 0; z < soilSize; z++) for (let x = 0; x < soilSize; x++) {
  const pattern = Math.sin(x * Math.PI / 8) * Math.cos(z * Math.PI / 8);
  const grain = (x * 173 + z * 291 + x * z * 51) % 53;
  const value = 191 + grain + 11 * pattern;
  soil.set([value, value, value, 255], (z * soilSize + x) * 4);
}
const soilMap = new THREE.DataTexture(soil, soilSize, soilSize);
soilMap.wrapS = soilMap.wrapT = THREE.RepeatWrapping;
soilMap.magFilter = THREE.LinearFilter; soilMap.minFilter = THREE.LinearMipmapLinearFilter;
soilMap.generateMipmaps = true; soilMap.repeat.setScalar(170); soilMap.needsUpdate = true;
const ground = new THREE.PlaneGeometry(900, 900, 60, 60); ground.rotateX(-Math.PI / 2);
const p = ground.attributes.position;
for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); p.setY(i, Math.sin(x * .025) * Math.cos(z * .021) * Math.max(0, r - 28) * .035 - 1); }
ground.computeVertexNormals(); const terrain = mesh(ground, 0x718469, 0, 0, 0, {map: soilMap, tracks, antiTiling: 1});
for (let i = 0; i < 15; i++) { const a = i * 2.399, r = 170 + (i % 3) * 45; mesh(new THREE.ConeGeometry(23 + i % 4 * 7, 40 + i % 5 * 12, 5), 0x657767, Math.cos(a) * r, 12, Math.sin(a) * r); }
for (let i = 0; i < 17; i++) { const a = i * 2.399, r = 30 + i % 6 * 13, x = Math.cos(a) * r, z = Math.sin(a) * r; mesh(new THREE.CylinderGeometry(.45, .7, 5, 6), 0x6a5847, x, 1.5, z); mesh(new THREE.ConeGeometry(3, 10, 7), 0x37584a, x, 7, z); }
const blocks = [];
for (let i = 0; i < 7; i++) blocks.push(mesh(new THREE.BoxGeometry(4, 2 + i, 4), [0xc48e62, 0x8ca4aa, 0xd1c09a][i % 3], (i - 3) * 7, (2 + i) / 2, -12, {puddles: 0}));
for (let i = 0; i < 3; i++) { const m = mesh(new THREE.SphereGeometry(2.5, 32, 20), 0xb9c7ca, (i - 1) * 9, 2, 6); m.material.metalness = 1; m.material.roughness = [.08, .35, .75][i]; }
const wakeProbe = mesh(new THREE.SphereGeometry(2.3, 20, 12), 0xa78256, 0, 2, 22);
const wakeTail = new THREE.Vector3();
let wakeTime = 0;
wakeProbe.visible = false;
function strikeAt(x, z, objects) {
  const hit = surfaceAt(x, z, objects);
  if (hit) view.strikeLightning(hit);
}
$('strike-block').onclick = () => strikeAt(0, -12, [blocks[3]]);
$('strike-ground').onclick = () => strikeAt(12, 18, [terrain]);
const canvas = renderer.domElement, trackEvents = new AbortController();
let lastTrackPoint;
function paintTrack(event) {
  if (!$('paint-tracks').checked || !(event.buttons & 1)) { lastTrackPoint = undefined; return; }
  aimRay(raycaster, event, canvas, camera);
  const hit = raycaster.intersectObject(terrain)[0]?.point;
  if (hit) tracks.stamp(lastTrackPoint ?? hit, hit, .65);
  lastTrackPoint = hit;
}
for (const type of ['pointerdown', 'pointermove']) canvas.addEventListener(type, paintTrack, {signal: trackEvents.signal});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) canvas.addEventListener(type, () => { lastTrackPoint = undefined; }, {signal: trackEvents.signal});
$('paint-tracks').onchange = () => { controls.enabled = !$('paint-tracks').checked; lastTrackPoint = undefined; };
$('clear-tracks').onclick = () => tracks.clear();
$('preview-surfaces').onclick = () => {
  camera.position.set(16, 13, 17);
  controls.target.set(0, 0, -6);
  controls.update();
};
$('surface-state').onchange = () => {
  const state = $('surface-state').value;
  if (state !== 'weather') surfaceWeather.set({wetness: Number(state === 'wet'), snow: Number(state === 'snow')});
};

let assetsReady = false;
view.ready.then(() => { assetsReady = true; document.body.dataset.ready = 'true'; }).catch(showError);

for (const state of system.weather.states) { const o = document.createElement('option'); o.value = state.name; o.textContent = state.name; $('weather').append(o); }
$('weather').value = system.weather.target;
$('weather').onchange = () => system.weather.transitionTo($('weather').value, {seconds: Number($('transition').value)});
$('transition').oninput = () => { system.weather.defaultDuration = Number($('transition').value); $('transition-value').textContent = $('transition').value + ' s'; };
$('auto-weather').onchange = () => system.weather.setAuto($('auto-weather').checked);
$('hour').oninput = () => system.day.setHour(Number($('hour').value));
$('run-day').onchange = () => system.day.configure({auto: $('run-day').checked});
$('aurora').onchange = () => view.configure({sky: {aurora: $('aurora').checked}});
$('preview-aurora').onclick = () => {
  system.paused = false;
  system.day.configure({hour: 0, auto: false});
  system.weather.setAuto(false);
  system.weather.transitionTo('clear', {seconds: 0});
  view.configure({sky: {aurora: true, auroraHeading: 160}});
  camera.position.set(105, 22, -37);
  controls.target.set(0, 9, 0);
  controls.update();
  syncControls();
};
$('quality').onchange = () => view.configure({sky: {quality: $('quality').value}});
$('clouds').onchange = () => view.configure({sky: {clouds: $('clouds').checked}});
$('cloud-shadows').onchange = () => view.configure({appearance: {cloudShadowStrength: Number($('cloud-shadows').checked)}});
$('shafts').onchange = () => view.configure({appearance: {sunShafts: $('shafts').checked}});
$('height-fog').onchange = () => view.configure({appearance: {heightFog: $('height-fog').checked}});
$('heading').oninput = () => { system.weather.windHeading = Number($('heading').value); $('heading-value').textContent = $('heading').value + '°'; };
$('pause').onclick = () => { system.paused = !system.paused; $('pause').textContent = system.paused ? 'Resume' : 'Pause'; };
function syncControls() {
  $('weather').value = system.weather.target; $('auto-weather').checked = system.weather.auto.enabled; $('run-day').checked = system.day.settings.auto;
  $('heading').value = system.weather.windHeading; $('heading-value').textContent = system.weather.windHeading + '°';
  const {appearance} = view.getConfig();
  $('cloud-shadows').checked = appearance.cloudShadowStrength > 0;
  $('aurora').checked = view.settings.aurora;
  $('shafts').checked = appearance.sunShafts; $('height-fog').checked = appearance.heightFog;
  $('quality').value = view.settings.quality; $('clouds').checked = view.settings.clouds; $('pause').textContent = system.paused ? 'Resume' : 'Pause';
  $('transition').max = Math.max(20, system.weather.defaultDuration); $('transition').value = system.weather.defaultDuration; $('transition-value').textContent = system.weather.defaultDuration + ' s';
  $('hour').value = system.day.hour; $('hour-value').textContent = hourLabel(system.day.hour);
}
const devPanel = createWeatherDevPanel({system, view, renderer, container: $('dev-panel'), onChange: syncControls});
$('tune-aurora').onclick = () => {
  $('developer').open = true;
  const search = devPanel.element.querySelector('input[type="search"]');
  search.value = 'aurora';
  search.dispatchEvent(new Event('input'));
  search.focus();
};

// Presets: bundled ones from presets/weather/*.json, plus save / load of files.
const bundled = import.meta.glob('../../presets/weather/*.json');
for (const path of Object.keys(bundled)) { const o = document.createElement('option'); o.value = path; o.textContent = path.split('/').pop().replace('.json', ''); $('preset').append(o); }
$('preset').onchange = async () => { const path = $('preset').value; if (!path) return; try { devPanel.loadPreset((await bundled[path]()).default); } catch (error) { showError(error); } };
$('save').onclick = () => downloadJson('weather-preset.json', devPanel.getPreset());
$('load').onchange = async () => { try { const file = $('load').files[0]; if (file) devPanel.loadPreset(await readJsonFile(file)); } catch (error) { showError(error); } finally { $('load').value = ''; } };

const unbindResize = bindResize(renderer, camera);
let last = null, lastUI = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.max(0, Math.min(.05, (now - last) / 1000)); last = now; controls.update(); system.update(dt);
  if (!system.paused) surfaceWeather.update(dt, $('surface-state').value === 'weather' ? system.weather : null);
  wakeProbe.visible = $('fog-wake').checked;
  if (wakeProbe.visible) {
    if (!system.paused) wakeTime += dt;
    wakeProbe.position.x = 34 * Math.sin(wakeTime * .55);
    wakeTail.copy(wakeProbe.position);
    wakeTail.x = 34 * Math.sin(Math.max(0, wakeTime - 1.8) * .55);
    view.setFogWake(wakeProbe.position, wakeTail, 7);
  } else {
    wakeTime = 0;
    view.setFogWake();
  }
  try { view.update(dt); view.render(); } catch (error) { showError(error); renderer.setAnimationLoop(null); }
  if (now - lastUI > 250) {
    $('status').textContent = (assetsReady ? '' : 'Loading sky assets…\n') + (privateBase ? '' : 'Bundled free sky textures\n') + system.weather.dominant + ' · ' + hourLabel(system.day.hour) + ' · ' + system.weather.temperature.toFixed(1) + ' °C\nWind ' + system.weather.wind.toFixed(1) + ' m/s · rain ' + Math.round(system.weather.rain * 100) + '% · snow ' + Math.round(system.weather.snow * 100) + '%';
    syncControls(); if ($('developer').open) devPanel.refresh(); lastUI = now;
  }
});
addEventListener('pagehide', () => { renderer.setAnimationLoop(null); unbindResize(); trackEvents.abort(); devPanel.dispose(); view.dispose(); controls.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); tracks.dispose(); soilMap.dispose(); renderer.dispose(); }, {once: true});
window.weatherBench = {system, view, devPanel, renderer, scene, camera, events, errors};
