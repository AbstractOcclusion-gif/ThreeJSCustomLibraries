import * as THREE from 'three';
import {createInteraction} from '../../src/interaction/index.js';
import {createThreeInteractionPicker} from '../../src/interaction/three.js';
import {createConditionRule, createPuzzle, createSequenceRule} from '../../src/puzzle/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop} from '../kit/page.js';
import {DEMO} from './presets.js';

const renderer = benchRenderer();
const canvas = renderer.domElement;
const scene = new THREE.Scene();
scene.background = new THREE.Color(DEMO.background);
const view = DEMO.camera;
const camera = new THREE.PerspectiveCamera(view.fov, innerWidth / innerHeight, view.near, view.far);
camera.position.set(...view.position);
camera.lookAt(...view.target);
camera.updateMatrixWorld();
scene.add(new THREE.GridHelper(DEMO.grid.size, DEMO.grid.divisions));

const interaction = createInteraction();
const picker = createThreeInteractionPicker({maxDistance: DEMO.maxDistance});
const sequence = createPuzzle({id: 'harbor-sequence', rule: createSequenceRule(DEMO.sequence)});
const load = createPuzzle({
  id: 'harbor-counterweight', latch: false,
  rule: createConditionRule({
    test: ({massKg}) => massKg >= DEMO.weights.requiredKg,
    holdSeconds: DEMO.weights.settleSeconds,
  }),
});

function box({size, color, position}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({color}));
  mesh.position.set(...position);
  scene.add(mesh);
  return mesh;
}

function target(mesh, id, options) {
  picker.bind(mesh, id);
  interaction.register(id, options);
}

function gate(x) {
  const {size, color, z} = DEMO.gate;
  return box({size, color, position: [x, size[1] / 2, z]});
}

const sequenceGate = gate(DEMO.gate.sequenceX);
const weightGate = gate(DEMO.gate.weightX);
let gateOpen = false;
const levers = DEMO.levers.map(({id, label, color, position}) => {
  const lever = box({...DEMO.lever, color, position});
  target(lever, id, {prompt: 'Pull ' + label + ' lever', activate() {
    lever.rotation.z = -lever.rotation.z || DEMO.lever.activatedAngle;
    sequence.act(id);
  }});
  return lever;
});

const latch = box(DEMO.latch);
target(latch, 'latch', {
  prompt: 'Hold to open gate', holdSeconds: DEMO.latch.holdSeconds,
  available: () => sequence.solved && !gateOpen,
  activate() { gateOpen = true; },
});

const screen = box(DEMO.screen);
scene.remove(screen);
let unblock;
document.getElementById('screen').onchange = event => {
  if (event.target.checked) {
    scene.add(screen);
    unblock = picker.block(screen);
  } else {
    unblock?.();
    scene.remove(screen);
  }
};

box(DEMO.plate);
const weightSettings = DEMO.weights;
const weights = weightSettings.massesKg.map((massKg, index) => {
  const x = weightSettings.firstX + index * weightSettings.spacing;
  const mesh = box({...weightSettings, position: [x, weightSettings.size[1] / 2, weightSettings.shelfZ]});
  const weight = {massKg, onPlate: false};
  function place(onPlate) {
    weight.onPlate = onPlate;
    mesh.position.y = (weightSettings.size[1] / 2) + (onPlate ? DEMO.plate.size[1] : 0);
    mesh.position.z = onPlate ? weightSettings.plateZ : weightSettings.shelfZ;
  }
  weight.reset = () => place(false);
  target(mesh, 'weight-' + index, {prompt: 'Move ' + massKg + ' kg weight', activate() { place(!weight.onPlate); }});
  return weight;
});

const pointer = new THREE.Vector2();
let pointing = false;
let input = null;
function focus() {
  interaction.focus(pointing ? picker.pick(camera, pointer) : null);
}
function track(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.set(
    (event.clientX - bounds.left) / bounds.width * 2 - 1,
    1 - (event.clientY - bounds.top) / bounds.height * 2,
  );
  pointing = true;
  scene.updateMatrixWorld(true);
  focus();
}

function press(source) {
  if (input !== null) return;
  input = source;
  interaction.press();
}

function release(source = input) {
  if (source !== input) return;
  input = null;
  interaction.release();
}

const listeners = new AbortController();
const options = {signal: listeners.signal};
canvas.addEventListener('pointermove', track, options);
canvas.addEventListener('pointerleave', () => { pointing = false; focus(); }, options);
canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  track(event);
  press(event.pointerId);
}, options);
for (const event of ['pointerup', 'pointercancel']) {
  addEventListener(event, event => release(event.pointerId), options);
}
addEventListener('keydown', event => {
  if (event.code === DEMO.useKey && !event.repeat && pointing) press(DEMO.useKey);
}, options);
addEventListener('keyup', event => release(event.code), options);
addEventListener('blur', () => release(), options);

const sequenceText = document.getElementById('sequence');
const leverLabels = new Map(DEMO.levers.map(({id, label}) => [id, label]));
document.getElementById('order').textContent = 'Lever order: '
  + DEMO.sequence.map(id => leverLabels.get(id)).join(' → ');
const weightText = document.getElementById('weight');
const prompt = document.getElementById('prompt');
const hold = document.getElementById('hold');
function show(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

document.getElementById('reset').onclick = () => {
  release();
  sequence.reset();
  load.reset();
  gateOpen = false;
  for (const lever of levers) lever.rotation.z = 0;
  for (const weight of weights) weight.reset();
};

function moveGate(mesh, open, dt) {
  const {size, lift, speed} = DEMO.gate;
  mesh.position.y = THREE.MathUtils.damp(mesh.position.y, size[1] / 2 + (open ? lift : 0), speed, dt);
}

const unbindResize = bindResize(renderer, camera);
startFrameLoop(renderer, dt => {
  scene.updateMatrixWorld(true);
  focus();
  interaction.update(dt);
  const massKg = weights.reduce((sum, weight) => sum + (weight.onPlate ? weight.massKg : 0), 0);
  load.observe({massKg}, dt);
  moveGate(sequenceGate, gateOpen, dt);
  moveGate(weightGate, load.solved, dt);
  show(sequenceText, gateOpen ? 'Sequence gate open' : sequence.solved ? 'Sequence solved. Use the latch.'
    : 'Lever sequence ' + Math.round(sequence.progress * DEMO.sequence.length) + '/' + DEMO.sequence.length);
  show(weightText, 'Plate load ' + massKg + ' / ' + weightSettings.requiredKg + ' kg'
    + (load.solved ? ' · Gate open' : load.progress > 0 ? ' · Settling' : ' · Gate closed'));
  const status = interaction.status;
  show(prompt, status ? (status.available ? status.prompt : 'Gate latch unavailable') : 'Point at a lever, latch, or weight.');
  hold.value = status?.progress ?? 0;
  renderer.render(scene, camera);
}, {onHidden: () => release()});

onLeave(() => {
  renderer.setAnimationLoop(null);
  listeners.abort();
  unbindResize();
  picker.clear();
  scene.add(screen);
  scene.traverse(object => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  renderer.dispose();
});
