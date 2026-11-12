import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createThreeCableView} from '../../src/cable/index.js';
import {createEnvironment, createFixedStep, setEnvironmentWind} from '../../src/core/index.js';
import {createBenchPanel} from '../panel.js';
import {environmentControls} from '../kit/controls.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {cableControls} from './controls.js';
import {BENCH_DEFAULTS, BENCH_WORLD as config, ENVIRONMENT_DEFAULTS} from './setups.js';
import {createCableSetup} from './simulation.js';
import {createBenchSnow} from './snow.js';
import '../bench.css';

const renderer = benchRenderer();
const scene = new THREE.Scene();
scene.background = new THREE.Color(config.background);
scene.add(new THREE.HemisphereLight(config.skyLight, config.groundLight, config.lightIntensity));
const grid = new THREE.GridHelper(config.groundSize, config.gridDivisions, config.gridCenter, config.gridLine);
scene.add(grid);
const camera = new THREE.PerspectiveCamera(config.fov, innerWidth / innerHeight, config.near, config.far);
camera.position.set(...config.cameraPosition);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(...config.cameraTarget);
orbit.enableDamping = true;

const clock = createFixedStep();
const settings = {...BENCH_DEFAULTS};
const weather = {...ENVIRONMENT_DEFAULTS};
const environment = createEnvironment();
const snow = createBenchSnow(scene);
const description = document.getElementById('setup-description');
const status = document.getElementById('status');
let simulation, views = [], visuals = [], lastUI = -Infinity;

function mesh(geometry, color, parent) {
  const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color}));
  parent.add(object);
  return object;
}

function applyEnvironment() {
  setEnvironmentWind(environment, weather.environment ? weather.windSpeed : 0, weather.windHeading);
  environment.wind.gust = weather.gust;
  environment.snow = weather.snow;
  for (const cable of simulation.cables) cable.setEnvironment(weather.environment ? environment : null);
}

function clearSetup() {
  for (const view of views) view.dispose();
  for (const {root} of visuals) {
    scene.remove(root);
    root.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
  }
  simulation?.dispose();
  views = [];
  visuals = [];
}

function reset() {
  clearSetup();
  clock.reset();
  settings.pull = 0;
  simulation = createCableSetup(settings);
  applyEnvironment();
  description.textContent = simulation.setup.description;
  const gate = simulation.setup.gate;
  if (gate) {
    const root = mesh(new THREE.BoxGeometry(...gate.markerSize), gate.color, scene);
    root.position.set(0, gate.clearHeight, gate.markerZ);
    visuals.push({root});
  }
  for (const {body, spec} of simulation.bodies.values()) {
    const root = new THREE.Group();
    scene.add(root);
    if (spec.boxes) {
      for (const box of spec.boxes) {
        mesh(new THREE.BoxGeometry(...box.size), spec.color, root).position.set(...box.offset);
      }
    } else {
      mesh(new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, config.postSides), spec.color, root);
    }
    visuals.push({root, sync() {
      root.position.copy(body.position);
      root.quaternion.copy(body.quaternion);
    }});
  }
  for (const cable of simulation.cables) {
    let state = cable.snapshot();
    cable.subscribe(() => { state = cable.snapshot(); });
    views.push(createThreeCableView({scene, cable: {
      links: cable.links, profile: cable.profile, get sections() { return state.sections; },
    }}));
    cable.attachments.forEach((attachment, index) => {
      if (!attachment.owned) return;
      const root = mesh(new THREE.SphereGeometry(config.anchorRadius), config.anchorColor, scene);
      visuals.push({root, sync() {
        const end = cable.attachments[index];
        root.visible = Boolean(end);
        if (end) root.position.copy(end.body.position);
      }});
    });
  }
  lastUI = -Infinity;
}

reset();
const gui = createBenchPanel('Cable');
const firstCable = () => simulation.cables[0];
cableControls(gui, {settings, reset,
  cut: () => firstCable().breakAt(Math.floor(firstCable().joints.length / 2)),
  release: () => firstCable().release(simulation.setup.releaseEnd ?? 0),
  act: () => simulation.act(),
});
environmentControls(gui, {state: weather, apply: applyEnvironment})
  .add(weather, 'snow', 0, 1, .01).name('Visual snowfall').onChange(applyEnvironment);

function updateStatus() {
  const states = simulation.cables.map(cable => cable.snapshot());
  const tension = Math.max(...states.map(state => state.peakTension));
  const gap = Math.max(...states.map(state => state.maxGap));
  const attachments = states.reduce((sum, state) => sum + state.attachments.filter(Boolean).length, 0);
  const {ropeContacts, objectContacts, height, gateOpen, twist} = simulation.readings;
  const stats = [
    'Attached ends ' + attachments,
    'Peak tension ' + Math.round(tension) + ' N',
    'Max joint gap ' + gap.toFixed(3) + ' m',
    'Rope contact samples ' + ropeContacts,
    'Object contact samples ' + objectContacts,
  ];
  if (twist !== undefined) stats.push('Stool spin ' + twist.toFixed(2) + ' rad/s');
  if (height !== undefined) stats.push('Gate ' + (gateOpen ? 'clear' : 'below mark') + ' · ' + height.toFixed(2) + ' m');
  status.textContent = stats.join(' · ');
}

const unbindResize = bindResize(renderer, camera);
startFrameLoop(renderer, (dt, now) => {
  clock.advance(dt, simulation.step);
  for (const visual of visuals) visual.sync?.();
  orbit.update();
  for (const view of views) view.update(camera);
  snow.update(dt, environment);
  renderer.render(scene, camera);
  if (now - lastUI >= STATUS_REFRESH_MS) {
    lastUI = now;
    updateStatus();
  }
});
document.body.dataset.ready = 'true';
onLeave(() => {
  renderer.setAnimationLoop(null);
  unbindResize();
  clearSetup();
  snow.dispose();
  grid.dispose();
  orbit.dispose();
  gui.destroy();
  renderer.dispose();
});
window.cableBench = {
  get cable() { return firstCable(); },
  get cables() { return simulation.cables; },
  get view() { return views[0]; },
  get world() { return simulation.world; },
  get readings() { return simulation.readings; },
  scene, reset,
};
