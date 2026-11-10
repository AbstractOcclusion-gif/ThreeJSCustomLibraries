import {boundariesControls} from './controls.js';
import {treeProfileControls} from '../trees/controls.js';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createBoundaries, validateLayout, layout, makeRun, distance} from '../../src/boundaries/index.js';
import {createLighting, syncLighting} from '../../src/core/lighting.js';
import {downloadJson, readJsonFile} from '../../src/core/presets.js';
import {benchRenderer, createBenchWeather, mountWeatherControls} from '../shared.js';
import '../bench.css';

const $ = id => document.getElementById(id), LIMIT = 40;
const renderer = benchRenderer(); renderer.shadowMap.enabled = true;
const scene = new T.Scene(), camera = new T.PerspectiveCamera(48, innerWidth / innerHeight, .1, 600); camera.position.set(22, 27, 38);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - .04;
const weather = await createBenchWeather({scene, renderer, camera, initial: 'clear', hour: 14, precipitation: false});
const lighting = createLighting();
const field = new T.Mesh(new T.PlaneGeometry(LIMIT * 2, LIMIT * 2).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({color: 0x617a4b, roughness: 1})); field.position.y = -.015; field.receiveShadow = true; scene.add(field);
scene.add(new T.GridHelper(LIMIT * 2, LIMIT * 2, 0x688460, 0x829b79));
const boundaries = createBoundaries({scene, lighting});
const markerMaterial = new T.MeshBasicMaterial({color: 0xffc25b}), markerGeometry = new T.SphereGeometry(.16, 8, 6), pins = new T.Group(); scene.add(pins);

const sample = [['hedge', [[-13, 9], [-3, 9], [-3, 4]]], ['fence', [[0, 9], [12, 9]]], ['wall', [[-13, 0], [-5, 0], [-5, -4]]], ['electric', [[-16, -9], [0, -9], [15, -5]]]];
let runs = [], points = [], history = [], message = '';
const S = {kind: 'hedge'};
function refresh(msg) {
  message = msg ?? (points.length ? `${points.length} points in current run.` : 'Pick a kind and click the ground to start.');
  const preview = points.length >= 2 ? [...runs, makeRun(S.kind, points)] : runs;
  boundaries.setRuns(preview);
  pins.clear(); for (const [x, z] of points) { const pin = new T.Mesh(markerGeometry, markerMaterial); pin.position.set(x, .2, z); pins.add(pin); }
}
function change(next) { validateLayout(layout(next)); history.push(runs); if (history.length > LIMIT) history.shift(); runs = next; points = []; refresh(); }
const actions = {
  finish: () => { try { if (points.length < 2) return refresh('Need at least two points.'); change([...runs, makeRun(S.kind, points)]); } catch (e) { refresh(e.message); } },
  backPoint: () => { points.pop(); refresh(); },
  undo: () => { if (points.length) { points = []; return refresh(); } if (history.length) { runs = history.pop(); refresh(); } },
  removeLast: () => { if (runs.length) change(runs.slice(0, -1)); },
  sample: () => change(sample.map(([kind, route]) => makeRun(kind, route))),
  clearAll: () => change([]),
  export: () => downloadJson('boundary-layout.json', layout(runs)),
  import: () => input.click(),
};
const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true; document.body.append(input);
input.onchange = async () => { try { if (input.files[0]) change(validateLayout(await readJsonFile(input.files[0]))); } catch (e) { refresh(e.message); } finally { input.value = ''; } };

const gui = createBenchPanel('Boundaries');
const wf = mountWeatherControls(weather);
boundariesControls(gui, {settings: S, actions, hedge: boundaries.hedgeOptions, refresh});
treeProfileControls(gui, {title: 'Hedge foliage profile', trees: boundaries.hedges});

// Tap (not drag) on the ground adds a point.
const ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0)); let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = {x: e.clientX, y: e.clientY, id: e.pointerId}; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || e.pointerId !== down.id || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || e.button !== 0) { down = null; return; } down = null;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new T.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), camera);
  const hit = ray.ray.intersectPlane(ground, new T.Vector3()); if (!hit || Math.abs(hit.x) > LIMIT || Math.abs(hit.z) > LIMIT) return;
  const point = [Math.round(hit.x * 2) / 2, Math.round(hit.z * 2) / 2];
  if (points.length && distance(points.at(-1), point) < 1) return refresh('Place the next point at least 1 m away.');
  const next = [...points, point];
  if (next.length > 1) { try { validateLayout(layout([...runs, makeRun(S.kind, next)])); } catch (err) { return refresh(err.message); } }
  points = next; refresh();
});
actions.sample();

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
let last = null, lastUI = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  controls.update(); weather.system.update(dt); weather.view.update(dt);
  syncLighting(lighting.uniforms, {sun: weather.view.sun, hemi: weather.view.hemi, fog: scene.fog});
  boundaries.update(dt); weather.view.render();
  if (now - lastUI > 250) { lastUI = now; wf.sync(); $('status').textContent = `${message}\n${runs.length} runs · ${boundaries.hedges.count} hedge bushes`; }
});
document.body.dataset.ready = 'true';
window.boundariesBench = {boundaries, get runs() { return runs; }, change, actions, scene, camera, renderer};
