import {boundariesControls} from './controls.js';
import {treeProfileControls} from '../trees/controls.js';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createBoundaries, validateLayout, layout, makeRun, distance} from '../../src/boundaries/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {downloadJson, readJsonFile} from '../../src/core/presets.js';
import {benchRenderer, onLeave, bindResize} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import '../bench.css';
import {aimRay} from '../kit/input.js';

const $ = id => document.getElementById(id), LIMIT = 40;
const renderer = benchRenderer(); renderer.shadowMap.enabled = true;
const scene = new T.Scene(), camera = new T.PerspectiveCamera(48, innerWidth / innerHeight, .1, 600); camera.position.set(22, 27, 38);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - .04;
// Standalone: the basic stage gives sky, light, ground and the environment the hedges react to.
const stage = createBasicStage({scene, shadows: true, groundSize: LIMIT * 2, shadowExtent: LIMIT}); stage.ground.position.y = -.015;
const lighting = stage.lighting;
scene.add(new T.GridHelper(LIMIT * 2, LIMIT * 2, 0x688460, 0x829b79));
const boundaries = createBoundaries({scene, lighting}); boundaries.setEnvironment(stage.environment);
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
const stageUI = stageControls(gui, stage); stageUI.state.windSpeed = 6; stageUI.state.gust = .4; stageUI.folder.controllersRecursive().forEach(c => c.updateDisplay()); stageUI.apply();
boundariesControls(gui, {settings: S, actions, hedge: boundaries.hedgeOptions, refresh});
treeProfileControls(gui, {title: 'Hedge foliage profile', trees: boundaries.hedges});

// Tap (not drag) on the ground adds a point.
const ray = new T.Raycaster(), ground = new T.Plane(new T.Vector3(0, 1, 0)); let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = {x: e.clientX, y: e.clientY, id: e.pointerId}; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || e.pointerId !== down.id || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || e.button !== 0) { down = null; return; } down = null;
  aimRay(ray, e, renderer.domElement, camera);
  const hit = ray.ray.intersectPlane(ground, new T.Vector3()); if (!hit || Math.abs(hit.x) > LIMIT || Math.abs(hit.z) > LIMIT) return;
  const point = [Math.round(hit.x * 2) / 2, Math.round(hit.z * 2) / 2];
  if (points.length && distance(points.at(-1), point) < 1) return refresh('Place the next point at least 1 m away.');
  const next = [...points, point];
  if (next.length > 1) { try { validateLayout(layout([...runs, makeRun(S.kind, next)])); } catch (err) { return refresh(err.message); } }
  points = next; refresh();
});
actions.sample();

const unbindResize = bindResize(renderer, camera);
let last = null, lastUI = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  controls.update(); stage.update(camera);
  boundaries.update(dt); renderer.render(scene, camera);
  if (now - lastUI > 250) { lastUI = now; $('status').textContent = `${message}\n${runs.length} runs · ${boundaries.hedges.count} hedge bushes`; }
});
document.body.dataset.ready = 'true';
onLeave(() => { renderer.setAnimationLoop(null); unbindResize(); boundaries.dispose(); stage.dispose(); markerMaterial.dispose(); markerGeometry.dispose(); controls.dispose(); gui.destroy(); renderer.dispose(); });
window.boundariesBench = {boundaries, get runs() { return runs; }, change, actions, scene, camera, renderer};
