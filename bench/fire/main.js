import {fireControls} from './controls.js';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createFireSystem} from '../../src/fire/index.js';
import {createParticlePrefab} from '../../src/particles/index.js';
import {benchRenderer, bindResize, startFrameLoop} from '../kit/page.js';
import {createEnvironment, setEnvironmentWind} from '../../src/core/index.js';
import {environmentControls} from '../kit/controls.js';
import '../bench.css';
import {aimRay} from '../kit/input.js';

const renderer = benchRenderer();
renderer.shadowMap.enabled = true;
const scene = new T.Scene();
scene.background = new T.Color(0x27363c);
const camera = new T.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 80);
camera.position.set(4, 5.8, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.5, 0.6, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new T.HemisphereLight(0xc2dae7, 0x544438, 1.6));
const sun = new T.DirectionalLight(0xffe2bf, 2);
sun.position.set(-4, 8, 3);
sun.castShadow = true;
Object.assign(sun.shadow.camera, {left: -7, right: 7, top: 6, bottom: -6});
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
const ground = new T.Mesh(new T.CircleGeometry(15, 64), new T.MeshStandardMaterial({color: 0x535849, roughness: 1}));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const system = createFireSystem();
const cube = new T.BoxGeometry(1, 1, 1);
const wood = new T.Color(0xb18451);
const char = new T.Color(0x241b16);
const pickables = [];
const setups = [
  [-3.7, 0, 10], [-2.1, 0.15, 12], [-0.5, -0.15, 8], [1.15, 0.25, 10], [4.6, -0.1, 10],
];
const crates = await Promise.all(setups.map(async ([x, z, burnSeconds], index) => {
  const group = new T.Group();
  group.position.set(x, 0, z);
  const fire = system.add({position: group.position, burnSeconds});
  const plank = new T.MeshStandardMaterial({color: wood, roughness: 0.9});
  const trim = plank.clone();
  function part(material, x, y, z, sx, sy, sz) {
    const mesh = new T.Mesh(cube, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.crate = index;
    group.add(mesh);
    pickables.push(mesh);
    return mesh;
  }
  for (let row = 0; row < 4; row++) part(plank, 0, 0.1 + row * 0.2, 0, 0.94, 0.193, 0.8);
  for (const side of [-1, 1]) {
    for (const x of [-0.33, 0.33]) part(trim, x, 0.4, side * 0.407, 0.13, 0.81, 0.06);
    part(trim, 0, 0.414, side * 0.439, 0.11, 0.98, 0.04).rotation.z = side * 0.7;
  }
  scene.add(group);
  const light = new T.PointLight(0xff8f36, 0, 3.5, 2);
  light.position.set(x, 1.1, z);
  scene.add(light);
  const fx = await createParticlePrefab(scene, 'fire', {position: new T.Vector3(x, 0.58, z), size: 1.16, pool: 30});
  fx.stop();
  return {fire, fx, light, plank, trim, burning: false};
}));

const status = document.getElementById('status');
const reset = () => {
  system.reset();
  for (const crate of crates) {
    crate.burning = false;
    crate.fx.stop();
    crate.fx.clear();
  }
};
const gui = createBenchPanel('Fire');
fireControls(gui, {ignite: () => crates[0].fire.ignite(), reset});
// Optional wind: off = even spread and upright flames, as before.
const wind = {environment: false, windSpeed: 8, windHeading: 0}, environment = createEnvironment();
function applyWind() {
  setEnvironmentWind(environment, wind.windSpeed, wind.windHeading);
  const active = wind.environment ? environment : null;
  system.setEnvironment(active); for (const crate of crates) crate.fx.setEnvironment(active);
}
environmentControls(gui, {state: wind, apply: applyWind});

const ray = new T.Raycaster();
let down;
renderer.domElement.addEventListener('pointerdown', e => { if (e.button === 0) down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointercancel', () => { down = null; });
renderer.domElement.addEventListener('pointerup', e => {
  const start = down;
  down = null;
  if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
  aimRay(ray, e, renderer.domElement, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  if (hit) crates[hit.object.userData.crate].fire.ignite();
});
bindResize(renderer, camera);
let lastStatus = '';
startFrameLoop(renderer, (dt, now) => {
  system.update(dt);
  let burning = 0, burned = 0;
  for (const [index, crate] of crates.entries()) {
    const {fire, fx, light, plank, trim} = crate;
    const isBurning = fire.phase === 'burning';
    if (crate.burning !== isBurning) {
      crate.burning = isBurning;
      if (isBurning) fx.start();
      else fx.stop();
    }
    burning += Number(isBurning);
    burned += Number(fire.phase === 'burned');
    fx.update(dt);
    plank.color.copy(wood).lerp(char, 1 - fire.fuel);
    trim.color.copy(plank.color).multiplyScalar(0.75);
    light.intensity = isBurning ? 2.8 * Math.min(1, fire.fuel * 3) * (0.9 + 0.1 * Math.sin(now * 0.017 + index)) : 0;
  }
  const summary = `${crates.length - burning - burned} unlit · ${burning} burning · ${burned} burned`;
  if (lastStatus !== summary) { status.textContent = summary; lastStatus = summary; }
  controls.update();
  renderer.render(scene, camera);
});
document.body.dataset.ready = 'true';

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  renderer.setAnimationLoop(null);
  for (const {fx, plank, trim} of crates) { fx.dispose(); plank.dispose(); trim.dispose(); }
  for (const resource of [cube, ground.geometry, ground.material]) resource.dispose();
  controls.dispose();
  gui.destroy();
  sun.shadow.dispose();
  renderer.dispose();
});
