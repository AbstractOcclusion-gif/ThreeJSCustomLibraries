import * as C from 'cannon-es';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {createCable, createThreeCableView, CABLE_PRESETS} from '../../src/cable/index.js';
import {benchRenderer} from '../shared.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const renderer = benchRenderer();
const scene = new T.Scene(); scene.background = new T.Color(0x213343);
scene.add(new T.HemisphereLight(0xffffff, 0x6e7c8a, 2.5)); scene.add(new T.GridHelper(20, 20, 0x7992a8, 0x42576a));
const camera = new T.PerspectiveCamera(42, innerWidth / innerHeight, .1, 100); camera.position.set(0, 3, 16);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1.5, 0); controls.enableDamping = true;
const world = new C.World({gravity: new C.Vec3(0, -9.82, 0)}); world.solver.iterations = 32;
const step = 1 / 120;
const S = {preset: 'rope', span: 8, slack: 1.1, breakStrength: 1e6, segments: 16};
const markers = [-1, 1].map(() => { const m = new T.Mesh(new T.SphereGeometry(.13), new T.MeshBasicMaterial({color: 0x66d6e5})); scene.add(m); return m; });
let cable, view, state, previous = null, elapsed = 0, lastUI = 0;
function refresh() { state = cable.snapshot(); }
function reset() {
  view?.dispose(); cable?.dispose();
  const endpoints = [-S.span / 2, S.span / 2].map(x => ({kind: 'fixed', position: [x, 3, 0]}));
  markers.forEach((m, i) => m.position.set(...endpoints[i].position));
  cable = createCable({world, endpoints, length: S.span * S.slack, preset: S.preset, breakStrength: S.breakStrength, segments: S.segments});
  refresh(); cable.subscribe(refresh);
  view = createThreeCableView({scene, cable: {links: cable.links, profile: cable.profile, get sections() { return state.sections; }}});
}
reset();
const gui = new GUI({title: 'Cable'});
gui.add(S, 'preset', Object.keys(CABLE_PRESETS)).onChange(reset); gui.add(S, 'span', 2, 14, .5).onFinishChange(reset); gui.add(S, 'slack', 1.01, 1.3, .01).name('length / span').onFinishChange(reset);
gui.add(S, 'segments', 4, 24, 1).onFinishChange(reset); gui.add(S, 'breakStrength', 100, 1e6, 100).onFinishChange(reset);
gui.add({cut: () => cable.breakAt(Math.floor(cable.joints.length / 2))}, 'cut').name('cut at centre'); gui.add({release: () => cable.release(0)}, 'release').name('release left anchor'); gui.add({reset}, 'reset');
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
renderer.setAnimationLoop(now => {
  elapsed += previous === null ? 0 : Math.min((now - previous) / 1000, .05); previous = now;
  while (elapsed >= step) { cable.beforeStep(step); world.step(step); cable.afterStep(step); elapsed -= step; }
  controls.update(); view.update(camera); renderer.render(scene, camera);
  if (now - lastUI > 250) { lastUI = now; $('status').textContent = `${S.preset} · sections ${state.sections.length} · attached ends ${state.attachments.filter(Boolean).length} · peak tension ${Math.round(Math.max(0, ...cable.joints.map(j => j.tension ?? 0)))} N · ${view.vertexCount} indices`; }
});
document.body.dataset.ready = 'true';
window.cableBench = {get cable() { return cable; }, get view() { return view; }, world, scene, reset};
