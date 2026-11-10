import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {BUNDLED_FISH_MODELS_URL, FISH_SPECIES, createFishFlock} from '../../src/flocking/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const MAX_PER_SPECIES = 40;
const renderer = benchRenderer();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .05, 400);
camera.position.set(11, 6, 14);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 2, 0); controls.enableDamping = true; controls.update();
// Standalone: the basic stage gives sky, light and ground; the school swims in a box above it.
const stage = createBasicStage({scene});
const bounds = new THREE.Box3(new THREE.Vector3(-6, .5, -4), new THREE.Vector3(6, 4.5, 4));
const boundsHelper = new THREE.Box3Helper(bounds, 0xffc25b); scene.add(boundsHelper);

const response = await fetch(BUNDLED_FISH_MODELS_URL);
if (!response.ok) throw Error(`Could not load fish models (${response.status})`);
const models = await response.json();   // loaded once, every rebuild reuses it

const counts = Object.fromEntries(Object.keys(FISH_SPECIES).map(key => [key, 0]));
Object.assign(counts, {roach: 10, rudd: 6, perch: 4});   // the module's default school
const school = {size: .7};
let flock, building = null, pending = false;
async function rebuild() {
  if (building) { pending = true; return; }
  building = createFishFlock({models, bounds, counts: {...counts}, size: school.size});
  try {
    const next = await building;
    flock?.dispose(); flock = next; scene.add(flock.group);
  } catch (error) { $('error').hidden = false; $('error').textContent = error.message; }
  finally { building = null; }
  if (pending) { pending = false; rebuild(); }
}

const gui = createBenchPanel('Flocking');
stageControls(gui, stage, {wind: false});
const schoolFolder = gui.addFolder('School');
for (const key of Object.keys(counts)) schoolFolder.add(counts, key, 0, MAX_PER_SPECIES, 1).onFinishChange(rebuild);
schoolFolder.add(school, 'size', .2, 2, .05).name('fish size').onFinishChange(rebuild);
schoolFolder.add(boundsHelper, 'visible').name('show swim volume');
await rebuild();

const unbindResize = bindResize(renderer, camera);
let lastUI = 0;
startFrameLoop(renderer, (dt, now) => {
  controls.update(); stage.update(camera);
  flock?.update(dt);
  renderer.render(scene, camera);
  if (now - lastUI > STATUS_REFRESH_MS) { lastUI = now; $('status').textContent = `${flock?.fish.length ?? 0} fish`; }
});
document.body.dataset.ready = 'true';
window.flockingBench = {get flock() { return flock; }, counts, stage, scene, camera, renderer};
onLeave(() => {
  renderer.setAnimationLoop(null); unbindResize(); flock?.dispose(); scene.remove(boundsHelper); boundsHelper.dispose();
  stage.dispose(); controls.dispose(); gui.destroy(); renderer.dispose();
});
