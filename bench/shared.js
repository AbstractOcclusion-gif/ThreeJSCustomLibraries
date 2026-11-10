// Bench-only helpers (not part of the library): weather + sky setup, private asset probe, preset menus.
import * as THREE from 'three';
import {createWeatherSystem, hourLabel} from '../src/weather/index.js';
import {createThreeWeather} from '../src/weather/three/index.js';
import {bundledWeatherAssets} from '../src/weather/three/bundled-assets.js';
import {downloadJson, readJsonFile} from '../src/core/presets.js';
import {POND_REFLECTION_DEFAULTS} from '../src/water/surface.js';

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
  return {system, view, assetBaseUrl, hourLabel};
}

// A "Weather" folder: state select, hour, auto day.
export function weatherFolder(gui, {system}) {
  const f = gui.addFolder('Weather');
  const s = {weather: system.weather.target, hour: system.day.hour, runDay: false,
    manualTemperature: system.weather.temperatureOverride !== null, temperature: system.weather.temperature};
  f.add(s, 'weather', system.weather.names).onChange(v => system.weather.transitionTo(v, {seconds: 4}));
  f.add(s, 'hour', 0, 23.95, .05).onChange(v => system.day.setHour(v)).listen();
  f.add(s, 'runDay').name('run day cycle').onChange(v => system.day.configure({auto: v}));
  f.add(s, 'manualTemperature').name('Override temperature').listen().onChange(value => system.weather.setTemperatureOverride(value ? s.temperature : null));
  f.add(s, 'temperature', -30, 45, .5).name('Air temperature · °C').listen().onChange(value => system.weather.setTemperatureOverride(value));
  f.close();
  return {folder: f, sync() {
    s.hour = system.day.hour;
    s.temperature = Math.round(system.weather.temperature * 10) / 10;
    s.manualTemperature = system.weather.temperatureOverride !== null;
  }};
}

export function waterFreezeControls(folder, freeze) {
  const {settings} = freeze;
  folder.add(settings, 'phase', ['Weather', 'Liquid', 'Frozen']).name('Pond phase');
  folder.add(settings, 'freezeSeconds', 1, 30, .5).name('Freeze time · s');
  folder.add(settings, 'thawSeconds', 1, 30, .5).name('Thaw time · s');
  const progress = {get ice() { return Math.round(freeze.progress * 100); }};
  folder.add(progress, 'ice', 0, 100).name('Freeze progress · %').disable().listen();
}

export function createBenchPondSettings() {
  return {
    // WebAquarium's Fishing pond waves and absorption, scaled to the bench basin.
    windWaves: {waveLengthMeters: .4875, waveHeightMeters: .001625, animationSpeed: .2,
      directionSpread: 1, grouping: .36, crestSharpness: .21, waveCount: 16, windFromDegrees: 0},
    foam: .65, rippleStrength: 1, microRipples: 0, refraction: .8, reflection: 1,
    clarity: 1.86, pondColor: '#377e68', haze: .125, depthDark: .6, f0: .02, fresnelPower: 5, sunGlint: 1,
    planarReflection: {...POND_REFLECTION_DEFAULTS},
    caustics: 1.7, causticDepth: 2.4, causticFocus: .3, causticFalloff: .1, causticNormalScale: 3,
    godRays: .35, shaftLength: 4, godColor: '#bfeaff', godFalloff: .9, godSteps: 24, godHalf: true,
    shadowStrength: .7, shaftSoftness: 4, shadowEvery: 2,
  };
}

export function pondWindControls(folder, windWaves) {
  folder.add(windWaves, 'waveHeightMeters', 0, .04, .0001).name('Height · m');
  folder.add(windWaves, 'waveLengthMeters', .2, 2.5, .01).name('Wavelength · m');
  folder.add(windWaves, 'animationSpeed', 0, 2, .01).name('Speed');
  folder.add(windWaves, 'directionSpread', 1, 6, .05).name('Directional spread');
  folder.add(windWaves, 'grouping', 0, 1, .01);
  folder.add(windWaves, 'crestSharpness', 0, 1, .01);
  folder.add(windWaves, 'waveCount', 1, 16, 1);
  folder.close();
}

export function waterMaterialControls(folder, settings) {
  const surface = folder.addFolder('Surface detail');
  surface.add(settings, 'rippleStrength', 0, 3, .05).name('Ripple visibility');
  surface.add(settings, 'microRipples', 0, .2, .005).name('Micro ripples');
  const optics = folder.addFolder('Optics');
  optics.add(settings, 'refraction', 0, 2, .05).name('Refraction');
  optics.add(settings, 'reflection', 0, 2, .05).name('Reflections');
  optics.add(settings, 'clarity', .2, 3, .05).name('Depth clarity');
  if ('tint' in settings) optics.addColor(settings, 'tint').name('Depth tint');
  if ('pondColor' in settings) optics.addColor(settings, 'pondColor').name('Water color');
  if ('haze' in settings) optics.add(settings, 'haze', 0, 2, .01).name('Haze');
  if ('depthDark' in settings) optics.add(settings, 'depthDark', 0, 3, .05).name('Depth darkening');
  if ('f0' in settings) optics.add(settings, 'f0', 0, .3, .005).name('Fresnel base');
  if ('fresnelPower' in settings) optics.add(settings, 'fresnelPower', 1, 10, .1).name('Fresnel power');
  if ('sunGlint' in settings) optics.add(settings, 'sunGlint', 0, 2, .05).name('Sun glint');
  if (settings.planarReflection) {
    const planar = optics.addFolder('Planar reflection');
    const reflection = settings.planarReflection;
    planar.add(reflection, 'on').name('Enabled');
    planar.add(reflection, 'mix', 0, 1, .05);
    planar.add(reflection, 'distort', 0, .5, .01);
    planar.add(reflection, 'floor', 0, .6, .01).name('Reflectance floor');
    planar.add(reflection, 'resolution', [256, 512, 1024]);
    planar.add(reflection, 'hz', 5, 60, 1).name('Refresh rate · Hz');
    planar.close();
  }
  const light = folder.addFolder('Underwater light');
  light.add(settings, 'godRays', 0, 2, .05).name('God rays');
  light.add(settings, 'caustics', 0, 2, .05).name('Bed caustics');
  if ('causticDepth' in settings) light.add(settings, 'causticDepth', .25, 6, .05).name('Projection depth · m');
  if ('causticFocus' in settings) light.add(settings, 'causticFocus', 0, 1, .01).name('Caustic focus · m');
  if ('causticNormalScale' in settings) light.add(settings, 'causticNormalScale', 0, 4, .05).name('Caustic normal scale');
  if ('causticFalloff' in settings) light.add(settings, 'causticFalloff', 0, 2, .05).name('Caustic depth falloff');
  if ('shaftLength' in settings) light.add(settings, 'shaftLength', .25, 12, .05).name('Shaft reach · m');
  if ('godColor' in settings) light.addColor(settings, 'godColor').name('Shaft color');
  if ('godFalloff' in settings) light.add(settings, 'godFalloff', 0, 3, .05).name('Shaft falloff');
  if ('godSteps' in settings) light.add(settings, 'godSteps', 4, 40, 1).name('Shaft samples');
  if ('godHalf' in settings) light.add(settings, 'godHalf').name('Half-resolution shafts');
  if ('shadowStrength' in settings) light.add(settings, 'shadowStrength', 0, 1, .05).name('Underwater shadows');
  if ('shaftSoftness' in settings) light.add(settings, 'shaftSoftness', 0, 12, .5).name('Shaft shadow softness');
  if ('shadowEvery' in settings) light.add(settings, 'shadowEvery', 1, 8, 1).name('Shadow update interval');
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
