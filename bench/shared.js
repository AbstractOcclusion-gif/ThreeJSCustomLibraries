// Bench-only helpers (not part of the library): weather + sky setup, private asset probe, preset menus.
import * as THREE from 'three';
import {createWeatherSystem, hourLabel} from '../src/weather/index.js';
import {createThreeWeather} from '../src/weather/three/index.js';
import {downloadJson, readJsonFile} from '../src/core/presets.js';

export async function detectAssets(probeUrl, base) {
  try { const r = await fetch(probeUrl, {method: 'HEAD'}); return r.ok && (r.headers.get('content-type') || '').startsWith('image') ? base : undefined; } catch { return undefined; }
}

export async function createBenchWeather({scene, renderer, camera, initial = 'cloudy 1', hour = 15, precipitation = {count: 360, radius: 32, height: 34, floorHeight: 0}}) {
  const assetBaseUrl = await detectAssets('/weather/cirrus.png', '/weather/');
  const system = createWeatherSystem({weather: {initial, seed: 17}, day: {hour, moonLight: true}});
  const view = createThreeWeather({system, scene, renderer, camera, assetBaseUrl, sky: {quality: 'mobile'}, precipitation});
  view.ready.catch(console.error);
  return {system, view, assetBaseUrl, hourLabel};
}

// A "Weather" folder: state select, hour, auto day.
export function weatherFolder(gui, {system}) {
  const f = gui.addFolder('Weather');
  const s = {weather: system.weather.target, hour: system.day.hour, runDay: false};
  f.add(s, 'weather', system.weather.names).onChange(v => system.weather.transitionTo(v, {seconds: 4}));
  f.add(s, 'hour', 0, 23.95, .05).onChange(v => system.day.setHour(v)).listen();
  f.add(s, 'runDay').name('run day cycle').onChange(v => system.day.configure({auto: v}));
  f.close();
  return {folder: f, sync() { s.hour = system.day.hour; }};
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
