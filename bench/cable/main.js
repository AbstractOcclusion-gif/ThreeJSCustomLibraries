import {cableControls} from './controls.js';
import * as C from 'cannon-es';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createCable, createThreeCableView} from '../../src/cable/index.js';
import {benchRenderer, bindResize} from '../kit/page.js';
import {createEnvironment, setEnvironmentWind} from '../../src/core/index.js';
import {environmentControls} from '../kit/controls.js';
import {onLeave} from '../kit/page.js';
import {createFixedStep} from '../../src/core/fixed-step.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const renderer = benchRenderer();
const scene = new T.Scene(); scene.background = new T.Color(0x213343);
scene.add(new T.HemisphereLight(0xffffff, 0x6e7c8a, 2.5)); scene.add(new T.GridHelper(20, 20, 0x7992a8, 0x42576a));
const camera = new T.PerspectiveCamera(42, innerWidth / innerHeight, .1, 100); camera.position.set(0, 3, 16);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1.5, 0); controls.enableDamping = true;
const world = new C.World({gravity: new C.Vec3(0, -9.82, 0)}); world.solver.iterations = 32;
const clock = createFixedStep();
const S = {preset: 'rope', span: 8, slack: 1.1, breakStrength: 1e6, segments: 16};
const markers = [-1, 1].map(() => { const m = new T.Mesh(new T.SphereGeometry(.13), new T.MeshBasicMaterial({color: 0x66d6e5})); scene.add(m); return m; });
let cable, view, state, previous = null, lastUI = 0;
// Optional wind: off = the cable hangs still, as before.
const wind = {environment: false, windSpeed: 10, windHeading: 90, gust: .5}, environment = createEnvironment();
function applyWind() { setEnvironmentWind(environment, wind.windSpeed, wind.windHeading); environment.wind.gust = wind.gust; cable.setEnvironment(wind.environment ? environment : null); }
function refresh() { state = cable.snapshot(); }
function reset() {
  view?.dispose(); cable?.dispose();
  const endpoints = [-S.span / 2, S.span / 2].map(x => ({kind: 'fixed', position: [x, 3, 0]}));
  markers.forEach((m, i) => m.position.set(...endpoints[i].position));
  cable = createCable({world, endpoints, length: S.span * S.slack, preset: S.preset, breakStrength: S.breakStrength, segments: S.segments});
  refresh(); cable.subscribe(refresh); applyWind();
  view = createThreeCableView({scene, cable: {links: cable.links, profile: cable.profile, get sections() { return state.sections; }}});
}
reset();
const gui = createBenchPanel('Cable');
cableControls(gui, {settings: S, reset, cut: () => cable.breakAt(Math.floor(cable.joints.length / 2)), release: () => cable.release(0)});
environmentControls(gui, {state: wind, apply: applyWind});

const unbindResize = bindResize(renderer, camera);
renderer.setAnimationLoop(now => {
  const dt = previous === null ? 0 : Math.min((now - previous) / 1000, .05); previous = now;
  clock.advance(dt, step => { cable.beforeStep(step); world.step(step); cable.afterStep(step); });
  controls.update(); view.update(camera); renderer.render(scene, camera);
  if (now - lastUI > 250) { lastUI = now; $('status').textContent = `${S.preset} · sections ${state.sections.length} · attached ends ${state.attachments.filter(Boolean).length} · peak tension ${Math.round(Math.max(0, ...cable.joints.map(j => j.tension ?? 0)))} N · ${view.vertexCount} indices`; }
});
document.body.dataset.ready = 'true';
onLeave(() => { renderer.setAnimationLoop(null); unbindResize(); view.dispose(); cable.dispose(); for (const marker of markers) { marker.geometry.dispose(); marker.material.dispose(); } controls.dispose(); gui.destroy(); renderer.dispose(); });
window.cableBench = {get cable() { return cable; }, get view() { return view; }, world, scene, reset};
