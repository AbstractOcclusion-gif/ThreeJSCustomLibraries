// Bench-only helpers (not part of the library): weather + sky setup, private asset probe, preset menus.
import * as THREE from 'three';
import './ui-demo.js';
import {createWeatherSystem, hourLabel} from '../src/weather/index.js';
import {createThreeWeather} from '../src/weather/three/index.js';
import {bundledWeatherAssets} from '../src/weather/three/bundled-assets.js';
import {downloadJson, readJsonFile} from '../src/core/presets.js';
import {createWeatherDevPanel} from '../src/weather/three/dev-panel.js';

export async function detectAssets(probeUrl, base) {
  try { const r = await fetch(probeUrl, {method: 'HEAD'}); return r.ok && (r.headers.get('content-type') || '').startsWith('image') ? base : undefined; } catch { return undefined; }
}

export async function createBenchWeather({scene, renderer, camera, lightTarget, initial = 'cloudy 1', hour = 15, precipitation = {count: 360, radius: 32, height: 34, floorHeight: 0}}) {
  // Private Enviro-derived set when dropped in, otherwise the free bundled textures.
  const privateBase = await detectAssets(import.meta.env.BASE_URL + 'weather/cirrus.png', import.meta.env.BASE_URL + 'weather/');
  const assets = privateBase ? {assetBaseUrl: privateBase} : bundledWeatherAssets();
  const system = createWeatherSystem({weather: {initial, seed: 17}, day: {hour, moonLight: true}});
  const view = createThreeWeather({system, scene, renderer, camera, lightTarget, ...assets, sky: {quality: 'mobile'}, precipitation});
  const assetBaseUrl = privateBase ?? 'bundled';
  view.ready.catch(console.error);
  return {system, view, renderer, assetBaseUrl, hourLabel};
}

export function mountWeatherControls(weather, parent = document.querySelector('aside')) {
  const container = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Weather';
  container.append(summary);
  parent.append(container);
  const panel = createWeatherDevPanel({...weather, container});
  let last = -Infinity;
  container.addEventListener('toggle', () => { if (container.open) panel.refresh(); });
  return {sync() {
    if (!container.open) return;
    const now = performance.now();
    if (now - last < 200) return;
    last = now;
    panel.refresh();
  }, dispose() { panel.dispose(); container.remove(); }};
}

// Presets folder: bundled JSON (import.meta.glob result), save file, load file. getState() -> plain object, apply(obj).
export function presetsFolder(gui, {bundled, name, getState, apply}) {
  const f = gui.addFolder('Presets');
  const names = Object.keys(bundled).map(p => p.split('/').pop().replace('.json', ''));
  const s = {bundled: names[0] ?? '', save: () => downloadJson(`${name}-preset.json`, getState()), load: () => input.click()};
  if (names.length) f.add(s, 'bundled', names).onChange(async v => { const path = Object.keys(bundled).find(p => p.endsWith(`/${v}.json`)); apply((await bundled[path]()).default); });
  f.add(s, 'save').name('save preset (download)'); f.add(s, 'load').name('load preset file…');
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true; document.body.append(input);
  input.onchange = async () => { try { if (input.files[0]) apply(await readJsonFile(input.files[0])); } catch (e) { console.error(e); } finally { input.value = ''; } };
  return f;
}

export function benchRenderer() {
  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.prepend(renderer.domElement);
  const error = document.getElementById('error');
  renderer.debug.onShaderError = (gl, program, v, f) => { const msg = 'Shader error: ' + gl.getProgramInfoLog(program) + ' ' + gl.getShaderInfoLog(v) + ' ' + gl.getShaderInfoLog(f); if (error) { error.hidden = false; error.textContent = msg; } console.error(msg); };
  return renderer;
}

// Controls for a basic stage (src/stage): the standalone environment every module demo can react to.
export function stageControls(gui, stage, {wind = true, onChange = () => {}} = {}) {
  const folder = gui.addFolder('Stage · sun, light, wind');
  const state = {elevation: 50, azimuth: 35, light: 1, windSpeed: 0, windHeading: 0, gust: 0};
  const apply = () => { stage.setSun(state.elevation, state.azimuth).setLight(state.light).setWind(state.windSpeed, state.windHeading, state.gust); onChange(state); };
  folder.add(state, 'elevation', 2, 88, 1).name('sun elevation · °').onChange(apply);
  folder.add(state, 'azimuth', 0, 360, 5).name('sun azimuth · °').onChange(apply);
  folder.add(state, 'light', 0, 1, .01).name('light (1 = noon)').onChange(apply);
  if (wind) {
    folder.add(state, 'windSpeed', 0, 20, .5).name('wind · m/s').onChange(apply);
    folder.add(state, 'windHeading', 0, 360, 5).name('wind heading · °').onChange(apply);
    folder.add(state, 'gust', 0, 1, .01).name('gust').onChange(apply);
  }
  return {folder, state, apply};
}
