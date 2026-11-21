// Particles · WebGPU experiment: the same puffs effect on today's WebGL sprites or on the WebGPU compute entry, chosen per
// page load with ?renderer=webgl | webgpu | fallback (the WebGPU renderer forced onto WebGL 2), with a frame-time meter.
import * as T from 'three';
import {WebGPURenderer} from 'three/webgpu';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS, BENCH_PIXEL_RATIO} from '../kit/page.js';
import {environmentControls} from '../kit/controls.js';
import {createPuffs as createWebGLPuffs} from '../../src/particles/index.js';
import {createPuffs as createGPUPuffs, MAX_POOL} from '../../src/particles/webgpu/index.js';
import {LIMITS} from '../../src/particles/puff-config.js';
import {createEnvironment, setEnvironmentWind} from '../../src/core/index.js';
import {createPlumeLoad, LOADS} from './plume-load.js';
import {createMeter} from './meter.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const say = (id, text) => { $(id).hidden = false; $(id).textContent = text; };
const MODES = Object.freeze({webgl: 'WebGL · sprites (current)', webgpu: 'WebGPU · compute', fallback: 'WebGPU renderer · WebGL 2 fallback'});
const mode = MODES[new URLSearchParams(location.search).get('renderer')] ? new URLSearchParams(location.search).get('renderer') : 'webgpu';
// Page layout: background, camera, lights and ground, as bench/particles.
const LAYOUT = Object.freeze({background: 0x213343, fov: 44, near: .1, far: 200, eye: [0, 7, 17], target: [0, 1.5, 0],
  hemi: [0xffffff, 0x718397, 1.6], sun: [0xfff1dc, 2.2], sunAt: [6, 9, 4], ground: {radius: 9, segments: 48, color: 0x5f6b63}});
const START_COUNT = 1000;

async function makeRenderer() {
  if (mode === 'webgl') return benchRenderer();
  if (mode === 'webgpu' && !navigator.gpu) return null;
  const renderer = new WebGPURenderer({antialias: true, powerPreference: 'high-performance', forceWebGL: mode === 'fallback'});
  renderer.setPixelRatio(Math.min(devicePixelRatio, BENCH_PIXEL_RATIO)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  document.body.prepend(renderer.domElement);
  await renderer.init();
  return renderer;
}
const renderer = await makeRenderer();
if (!renderer) {
  say('error', 'This browser has no WebGPU (navigator.gpu is missing). Open ?renderer=fallback to run the WebGPU renderer on WebGL 2, or ?renderer=webgl for today\'s sprites.');
  $('status').textContent = 'No WebGPU';
  throw Error('No WebGPU');
}
const backend = mode === 'webgl' ? 'WebGL 2 (WebGLRenderer)' : renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2 (WebGPURenderer fallback)';
if (mode === 'webgpu' && !renderer.backend.isWebGPUBackend) say('error', 'WebGPU was not available: three fell back to WebGL 2 on its own. The numbers below are the fallback\'s.');
const limit = mode === 'webgl' ? LIMITS.pool : MAX_POOL;

const scene = new T.Scene(); scene.background = new T.Color(LAYOUT.background);
const camera = new T.PerspectiveCamera(LAYOUT.fov, innerWidth / innerHeight, LAYOUT.near, LAYOUT.far); camera.position.set(...LAYOUT.eye);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...LAYOUT.target); controls.enableDamping = true;
const hemi = new T.HemisphereLight(...LAYOUT.hemi); scene.add(hemi);
const sun = new T.DirectionalLight(...LAYOUT.sun); sun.position.set(...LAYOUT.sunAt); scene.add(sun);
const {radius, segments, color} = LAYOUT.ground;
scene.add(new T.Mesh(new T.CircleGeometry(radius, segments).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({color, roughness: 1})));

const state = {renderer: mode, load: 'billow', count: START_COUNT, environment: false, windSpeed: 6, windHeading: 0, light: 1};
const environment = createEnvironment(), SUN_INTENSITY = sun.intensity, HEMI_INTENSITY = hemi.intensity;
let puffs = null, building = Promise.resolve();
const plume = createPlumeLoad();
function applyEnvironment() {
  setEnvironmentWind(environment, state.windSpeed, state.windHeading); environment.light.setScalar(state.light);
  const light = state.environment ? state.light : 1;
  sun.intensity = SUN_INTENSITY * light; hemi.intensity = HEMI_INTENSITY * light;
  puffs?.setEnvironment(state.environment ? environment : null);
}
// A fresh pool of `count` puffs (pool size = count, so both modes draw exactly what is measured).
function rebuild(count = state.count) {
  building = building.then(async () => {
    puffs?.dispose(); puffs = null; plume.reset();
    state.count = Math.min(limit, Math.max(1, Math.round(count)));
    const options = {pool: state.count, sheets: LOADS[state.load].sheets, environment: state.environment ? environment : null};
    puffs = mode === 'webgl' ? await createWebGLPuffs(scene, options) : await createGPUPuffs(scene, {...options, renderer});
    gui.controllersRecursive().forEach(controller => controller.updateDisplay());
  }).catch(error => say('error', String(error)));
  return building;
}

const results = [];
const line = r => `${r.count} puffs: frame ${r.frameMs} ms (p95 ${r.p95Ms}) · CPU ${r.cpuMs} ms · alive ${r.alive} · ${r.frames} frames`;
function report(title, rows) {
  results.push({mode, backend, load: state.load, title, rows});
  $('results').textContent = results.map(({title, load, rows}) => `${title} · ${LOADS[load].label}\n${rows.map(line).join('\n')}`).join('\n\n');
}
const meter = createMeter({rebuild, active: () => puffs?.active ?? 0, onProgress: text => { $('progress').textContent = text; }});
let busy = false;
async function run(job) {
  if (busy) return; busy = true;
  try { await job(); } catch (error) { say('error', String(error)); } finally { busy = false; $('progress').textContent = ''; await rebuild(START_COUNT); }
}
const fx = {
  'measure 500 / 1000 / 2000': () => run(async () => report('Fixed counts', await meter.fixed(limit))),
  'find max at 60 fps': () => run(async () => {
    const best = await meter.max60(limit);
    report(best.capped ? `Max at 60 fps: pool limit (${limit}) reached first` : best.none ? 'Max at 60 fps: no count held 60 fps (smallest tried)' : 'Max at 60 fps', [best]);
  }),
};

const gui = createBenchPanel('Particles · WebGPU');
gui.add(state, 'renderer', Object.fromEntries(Object.entries(MODES).map(([key, label]) => [label, key]))).name('renderer (reloads)')
  .onChange(value => { location.search = `?renderer=${value}`; });
gui.add(state, 'load', Object.fromEntries(Object.entries(LOADS).map(([key, {label}]) => [label, key]))).name('effect').onChange(() => rebuild());
gui.add(state, 'count', 1, limit, 1).name('puffs alive').onFinishChange(value => rebuild(value));
for (const name of Object.keys(fx)) gui.add(fx, name);
environmentControls(gui, {state, apply: applyEnvironment});

await rebuild();
const unbindResize = bindResize(renderer, camera);
let last = null, lastUI = 0, fps = 0;   // fps from the real frame interval (dt is clamped by the frame loop)
startFrameLoop(renderer, (dt, now) => {
  const start = performance.now();
  controls.update();
  if (puffs) { plume.step(puffs, dt, state.count); puffs.update(dt); }
  renderer.render(scene, camera);
  meter.tick({frameMs: last === null || dt === 0 ? null : now - last, cpuMs: performance.now() - start});
  if (last !== null && now > last) fps = 1000 / (now - last);
  if (now - lastUI > STATUS_REFRESH_MS && puffs) {
    lastUI = now;
    $('status').textContent = `${MODES[mode]} · backend ${backend}\npuffs ${puffs.active} / ${state.count}` + (puffs.draws === undefined ? ` · ${puffs.active} sprite draws` : ` · ${puffs.draws} draw(s)`) + ` · ${Math.round(fps)} fps`;
  }
  last = now;
}, {onHidden: () => { last = null; }});
document.body.dataset.ready = 'true';
onLeave(() => { renderer.setAnimationLoop(null); unbindResize(); puffs?.dispose(); controls.dispose(); gui.destroy(); renderer.dispose(); });
window.particlesWebgpuBench = {mode, backend, limit, results, state, rebuild, meter, renderer, scene, get puffs() { return puffs; }};
