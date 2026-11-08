import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createWeatherSystem, DEFAULT_WEATHER_STATES, hourLabel} from '../../src/weather/index.js';
import {createThreeWeather} from '../../src/weather/three/index.js';
import {createWeatherDevPanel} from '../../src/weather/three/dev-panel.js';
import {bundledWeatherAssets} from '../../src/weather/three/bundled-assets.js';
import {downloadJson, readJsonFile} from '../../src/core/presets.js';
import '../bench.css';

const $ = id => document.getElementById(id), errors = [], events = [];
function showError(error) { errors.push(String(error)); $('error').hidden = false; $('error').textContent = String(error); console.error(error); }

// Optional licensed textures live in private-assets/weather/ (served at /weather/). Probe once; fall back to the procedural sky.
async function detectAssets() {
  try { const r = await fetch(import.meta.env.BASE_URL + 'weather/cirrus.png', {method: 'HEAD'}); return r.ok && (r.headers.get('content-type') || '').startsWith('image') ? import.meta.env.BASE_URL + 'weather/' : undefined; }
  catch { return undefined; }
}

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

const snowy = {...DEFAULT_WEATHER_STATES.find(s => s.name === 'overcast'), name: 'snowy', snow: 1, rain: 0, wind: 5, visibility: 900, density: .6, sunlight: .3, next: {overcast: 2, clear: 1}};
const system = createWeatherSystem({
  weather: {states: [...DEFAULT_WEATHER_STATES, snowy], initial: 'cloudy 2', seed: 17, windHeading: 20, transitionSeconds: 4, holdSeconds: [20, 45], autoTransitionSeconds: [8, 15]},
  day: {hour: 17.2, cycleSeconds: 120, moonLight: true},
  onEvent: event => { events.unshift(event); events.length = Math.min(events.length, 8); $('events').textContent = events.map(e => JSON.stringify(e)).join('\n'); },
});

const privateBase = await detectAssets();
const assetBaseUrl = privateBase ?? 'bundled';
const view = createThreeWeather({system, scene, renderer, camera, ...(privateBase ? {assetBaseUrl: privateBase} : bundledWeatherAssets()),
  sky: {quality: 'low', bottom: 460, thickness: 540, scale: 5600, mapScale: 12000, mapVariation: .48, detail: .32},
  appearance: {sunShafts: true, shaftStrength: 1.4, heightFog: true}, precipitation: {count: 800, radius: 30, height: 30}});
view.sun.castShadow = true; view.sun.shadow.mapSize.set(1024, 1024); Object.assign(view.sun.shadow.camera, {left: -180, right: 180, top: 180, bottom: -180, near: 1, far: 400});

// Neutral test valley: ground, hills, trees, blocks, three roughness spheres.
const materials = [], geometries = [];
function mesh(geometry, color, x, y, z) { const material = new THREE.MeshStandardMaterial({color, roughness: .85}); materials.push(material); geometries.push(geometry); const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; }
const ground = new THREE.PlaneGeometry(900, 900, 60, 60); ground.rotateX(-Math.PI / 2);
const p = ground.attributes.position;
for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); p.setY(i, Math.sin(x * .025) * Math.cos(z * .021) * Math.max(0, r - 28) * .035 - 1); }
ground.computeVertexNormals(); mesh(ground, 0x718469, 0, 0, 0);
for (let i = 0; i < 15; i++) { const a = i * 2.399, r = 170 + (i % 3) * 45; mesh(new THREE.ConeGeometry(23 + i % 4 * 7, 40 + i % 5 * 12, 5), 0x657767, Math.cos(a) * r, 12, Math.sin(a) * r); }
for (let i = 0; i < 17; i++) { const a = i * 2.399, r = 30 + i % 6 * 13, x = Math.cos(a) * r, z = Math.sin(a) * r; mesh(new THREE.CylinderGeometry(.45, .7, 5, 6), 0x6a5847, x, 1.5, z); mesh(new THREE.ConeGeometry(3, 10, 7), 0x37584a, x, 7, z); }
for (let i = 0; i < 7; i++) mesh(new THREE.BoxGeometry(4, 2 + i, 4), [0xc48e62, 0x8ca4aa, 0xd1c09a][i % 3], (i - 3) * 7, (2 + i) / 2, -12);
for (let i = 0; i < 3; i++) { const m = mesh(new THREE.SphereGeometry(2.5, 32, 20), 0xb9c7ca, (i - 1) * 9, 2, 6); m.material.metalness = 1; m.material.roughness = [.08, .35, .75][i]; }

let assetsReady = false;
view.ready.then(() => { assetsReady = true; document.body.dataset.ready = 'true'; }).catch(showError);

for (const state of system.weather.states) { const o = document.createElement('option'); o.value = state.name; o.textContent = state.name; $('weather').append(o); }
$('weather').value = system.weather.target;
$('weather').onchange = () => system.weather.transitionTo($('weather').value, {seconds: Number($('transition').value)});
$('transition').oninput = () => { system.weather.defaultDuration = Number($('transition').value); $('transition-value').textContent = $('transition').value + ' s'; };
$('auto-weather').onchange = () => system.weather.setAuto($('auto-weather').checked);
$('hour').oninput = () => system.day.setHour(Number($('hour').value));
$('run-day').onchange = () => system.day.configure({auto: $('run-day').checked});
$('quality').onchange = () => view.configure({sky: {quality: $('quality').value}});
$('clouds').onchange = () => view.configure({sky: {clouds: $('clouds').checked}});
$('shafts').onchange = () => view.configure({appearance: {sunShafts: $('shafts').checked}});
$('height-fog').onchange = () => view.configure({appearance: {heightFog: $('height-fog').checked}});
$('heading').oninput = () => { system.weather.windHeading = Number($('heading').value); $('heading-value').textContent = $('heading').value + '°'; };
$('pause').onclick = () => { system.paused = !system.paused; $('pause').textContent = system.paused ? 'Resume' : 'Pause'; };
function syncControls() {
  $('weather').value = system.weather.target; $('auto-weather').checked = system.weather.auto.enabled; $('run-day').checked = system.day.settings.auto;
  $('heading').value = system.weather.windHeading; $('heading-value').textContent = system.weather.windHeading + '°';
  const {appearance} = view.getConfig();
  $('shafts').checked = appearance.sunShafts; $('height-fog').checked = appearance.heightFog;
  $('quality').value = view.settings.quality; $('clouds').checked = view.settings.clouds; $('pause').textContent = system.paused ? 'Resume' : 'Pause';
  $('transition').max = Math.max(20, system.weather.defaultDuration); $('transition').value = system.weather.defaultDuration; $('transition-value').textContent = system.weather.defaultDuration + ' s';
  $('hour').value = system.day.hour; $('hour-value').textContent = hourLabel(system.day.hour);
}
const devPanel = createWeatherDevPanel({system, view, renderer, container: $('dev-panel'), onChange: syncControls});

// Presets: bundled ones from presets/weather/*.json, plus save / load of files.
const bundled = import.meta.glob('../../presets/weather/*.json');
for (const path of Object.keys(bundled)) { const o = document.createElement('option'); o.value = path; o.textContent = path.split('/').pop().replace('.json', ''); $('preset').append(o); }
$('preset').onchange = async () => { const path = $('preset').value; if (!path) return; try { devPanel.loadPreset((await bundled[path]()).default); } catch (error) { showError(error); } };
$('save').onclick = () => downloadJson('weather-preset.json', devPanel.getPreset());
$('load').onchange = async () => { try { const file = $('load').files[0]; if (file) devPanel.loadPreset(await readJsonFile(file)); } catch (error) { showError(error); } finally { $('load').value = ''; } };

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
let last = null, lastUI = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.max(0, Math.min(.05, (now - last) / 1000)); last = now; controls.update(); system.update(dt);
  try { view.update(dt); view.render(); } catch (error) { showError(error); renderer.setAnimationLoop(null); }
  if (now - lastUI > 250) {
    $('status').textContent = (assetsReady ? '' : 'Loading sky assets…\n') + (privateBase ? '' : 'Bundled free sky textures\n') + system.weather.dominant + ' · ' + hourLabel(system.day.hour) + '\nWind ' + system.weather.wind.toFixed(1) + ' m/s · rain ' + Math.round(system.weather.rain * 100) + '% · snow ' + Math.round(system.weather.snow * 100) + '%';
    syncControls(); if ($('developer').open) devPanel.refresh(); lastUI = now;
  }
});
addEventListener('pagehide', () => { renderer.setAnimationLoop(null); removeEventListener('resize', resize); devPanel.dispose(); view.dispose(); controls.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); renderer.dispose(); }, {once: true});
window.weatherBench = {system, view, devPanel, renderer, scene, camera, events, errors};
