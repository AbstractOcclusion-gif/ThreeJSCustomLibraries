import {destructionControls} from './controls.js';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createThreeStructureView} from '../../src/destruction/three.js';
import {benchRenderer, bindResize} from '../kit/page.js';
import {createDemolition} from './physics.js';
import {createFixedStep} from '../../src/core/fixed-step.js';
import '../bench.css';
import {aimRay} from '../kit/input.js';

const renderer = benchRenderer();
renderer.shadowMap.enabled = true;
const scene = new T.Scene();
scene.background = new T.Color(0x213343);
scene.fog = new T.Fog(0x213343, 120, 270);
const camera = new T.PerspectiveCamera(45, innerWidth / innerHeight, .1, 350);
camera.position.set(29, 23, 46);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 9, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * .49;
scene.add(new T.HemisphereLight(0xd9efff, 0x535561, 2));
const sun = new T.DirectionalLight(0xffe0b2, 3);
sun.position.set(30, 65, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {left: -35, right: 35, top: 30, bottom: -30, far: 120});
scene.add(sun);

const ground = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({color: 0x374c49}));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const supports = new T.Group();
const supportGeometry = new T.BoxGeometry(1, 1, 1);
const concrete = new T.MeshStandardMaterial({color: 0x7c8b91});
const projectile = [{mass: 35, radius: .65, position: new T.Vector3()}];
const ballGeometry = new T.SphereGeometry(projectile[0].radius, 20, 12);
const ballMaterial = new T.MeshStandardMaterial({color: 0xffa54a, metalness: .45, roughness: .32});
scene.add(supports);

const balls = new Map();
let run, view, targetId, previous = null;
const clock = createFixedStep(), SLOW_MOTION_SCALE = .22;
function rebuild() {
  view?.dispose();
  run?.dispose();
  for (const mesh of balls.values()) scene.remove(mesh);
  balls.clear();
  supports.clear();
  run = createDemolition();
  view = createThreeStructureView({system: run, scene});
  targetId = run.members.find(m => m.type === 'endpost').id;
  for (const x of [-run.span / 2, run.span / 2]) {
    const support = new T.Mesh(supportGeometry, concrete);
    support.scale.set(2.4, run.deckY - .25, run.width + 3);
    support.position.set(x, (run.deckY - .25) / 2, 0);
    support.castShadow = support.receiveShadow = true;
    supports.add(support);
  }
  clock.reset();
}

const state = {
  speed: 32, slowMotion: false, shots: 0, impacts: 0, detached: 0,
  fire() {
    const body = run.launch(projectile, run.members[targetId].body.position, {speed: state.speed});
    if (!body) return;
    const mesh = new T.Mesh(ballGeometry, ballMaterial);
    mesh.position.copy(body.position);
    mesh.castShadow = true;
    scene.add(mesh);
    balls.set(body, mesh);
    for (const [old, oldMesh] of balls) {
      if (run.projectiles.includes(old)) continue;
      scene.remove(oldMesh);
      balls.delete(old);
    }
  },
  rebuild,
};
const gui = createBenchPanel('Destruction');
destructionControls(gui, state);

rebuild();

const raycaster = new T.Raycaster();
let down;
renderer.domElement.addEventListener('pointerdown', e => { if (e.button === 0) down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointercancel', () => { down = null; });
renderer.domElement.addEventListener('pointerup', e => {
  const start = down;
  down = null;
  if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
  aimRay(raycaster, e, renderer.domElement, camera);
  const hit = raycaster.intersectObjects(view.members.filter(mesh => mesh.visible), true)[0];
  if (hit) targetId = hit.object.parent.userData.id;
});

bindResize(renderer, camera);
renderer.setAnimationLoop(now => {
  const dt = previous === null ? 0 : Math.min(.05, (now - previous) / 1000);
  previous = now;
  if (document.hidden) return;
  clock.advance(dt * (state.slowMotion ? SLOW_MOTION_SCALE : 1), step => run.step(step));
  const target = view.members[targetId];
  view.update({hover: target.visible ? target : null});
  for (const [body, mesh] of balls) mesh.position.copy(body.position);
  state.shots = run.shots;
  state.impacts = run.hits;
  state.detached = run.broken;
  controls.update();
  renderer.render(scene, camera);
});
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  renderer.setAnimationLoop(null);
  view.dispose();
  run.dispose();
  controls.dispose();
  gui.destroy();
  for (const resource of [ground.geometry, ground.material, supportGeometry, concrete, ballGeometry, ballMaterial]) resource.dispose();
  sun.shadow.dispose();
  renderer.dispose();
});
