import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {createOceanSurface, skyFromWeather, OCEAN_PRESETS, OCEAN_DEFAULTS} from '../../src/water/index.js';
import {benchRenderer, createBenchWeather, weatherFolder, presetsFolder} from '../shared.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const renderer = benchRenderer();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(53, innerWidth / innerHeight, .15, 9500);
camera.position.set(18, 6.5, 24);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 4, -20); controls.enableDamping = true;
controls.minDistance = 12; controls.maxDistance = 165; controls.maxPolarAngle = Math.PI * .495; controls.enablePan = false; controls.update();
const weather = await createBenchWeather({scene, renderer, camera, initial: 'cloudy 1', hour: 15});
const ocean = createOceanSurface({sky: skyFromWeather(weather.view)});
scene.add(ocean.mesh);

const gui = new GUI({title: 'Ocean'});
const wf = weatherFolder(gui, weather);
const s = ocean.settings;
const sea = gui.addFolder('Sea state');
const preset = {name: 'rolling'};
sea.add(preset, 'name', Object.keys(OCEAN_PRESETS)).name('preset').onChange(v => { ocean.apply(OCEAN_PRESETS[v]); gui.controllersRecursive().forEach(c => c.updateDisplay()); });
sea.add(s, 'swell', 0, 2.5, .01).onChange(() => ocean.apply()); sea.add(s, 'swellLength', 20, 140, 1).onChange(() => ocean.apply());
sea.add(s, 'chop', 0, 3, .01).onChange(() => ocean.apply()); sea.add(s, 'choppiness', 0, 1, .01).name('crest shape').onChange(() => ocean.apply());
sea.add(s, 'whitecaps', 0, 1, .01).onChange(() => ocean.apply()); sea.add(s, 'waveSpeed', 0, 2, .01); sea.add(s, 'heading', 0, 360, 1).name('wind heading °').onChange(v => { weather.system.weather.windHeading = v; ocean.apply(); });
const look = gui.addFolder('Look');
look.addColor(s, 'waterTint').onChange(() => ocean.apply()); look.addColor(s, 'foamTint').onChange(() => ocean.apply());
look.add(s, 'reflection', 0, 1.5, .01).onChange(() => ocean.apply()); look.add(s, 'fresnelPower', 1, 10, .1).onChange(() => ocean.apply());
look.add(s, 'glint', 0, 3, .01).onChange(() => ocean.apply()); look.add(s, 'fineRipples', 0, 2, .01).onChange(() => ocean.apply());
look.add(s, 'foamOpacity', 0, 1, .01).onChange(() => ocean.apply()); look.add(s, 'foamFeather', .02, 1, .01).onChange(() => ocean.apply()); look.add(s, 'foamScale', .25, 4, .01).onChange(() => ocean.apply());
presetsFolder(gui, {bundled: import.meta.glob('../../presets/ocean/*.json'), name: 'ocean',
  getState: () => ({schema: 'three-kit.ocean', version: 1, settings: {...s}}),
  apply: p => { ocean.apply({...OCEAN_DEFAULTS, ...(p.settings ?? p)}); gui.controllersRecursive().forEach(c => c.updateDisplay()); }});

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
let last = null, lastUI = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  controls.update(); weather.system.update(dt); weather.view.update(dt);
  ocean.update(dt, weather.system.weather.wind);
  weather.view.render();
  if (now - lastUI > 250) { lastUI = now; wf.sync(); $('status').textContent = (weather.assetBaseUrl ? '' : 'Procedural sky (no private assets)\n') + weather.system.weather.dominant + ' · ' + weather.hourLabel(weather.system.day.hour) + '\nwind ' + weather.system.weather.wind.toFixed(1) + ' m/s'; }
});
document.body.dataset.ready = 'true';
window.oceanBench = {ocean, weather, scene, camera, renderer};
