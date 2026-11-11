import * as THREE from 'three';
import {createSound, createAmbience, SOUND_PRESETS} from '../../src/sound/index.js';
import {createThreeSound} from '../../src/sound/three.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {DEMO} from './presets.js';

const element = id => document.getElementById(id);
const {scene: view, initial} = DEMO;
const renderer = benchRenderer();
const scene = new THREE.Scene();
scene.background = new THREE.Color(view.background);
const camera = new THREE.PerspectiveCamera(view.cameraFov, innerWidth / innerHeight, view.near, view.far);
camera.position.set(...view.view);
camera.lookAt(scene.position);
const grid = new THREE.GridHelper(view.gridSize, view.gridDivisions);
const geometry = new THREE.SphereGeometry(view.markerRadius, view.markerSegments, view.markerSegments);
function marker(color) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color}));
  scene.add(mesh);
  return mesh;
}
const emitter = marker(view.emitterColor);
const listener = marker(view.listenerColor);
listener.position.set(initial.listener, view.markerRadius, view.listenerZ);
scene.add(grid);

let sound, spatial, ambience, underwater, cave, custom;
let elapsed = 0;
let lastMeter = -Infinity;
const meters = new Map();

function clip(context, {seconds, hz, gain, smoothing = 0, decay = 0}) {
  const frames = Math.ceil(seconds * context.sampleRate);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let noise = 0;
  for (let index = 0; index < frames; index++) {
    noise = noise * smoothing + (Math.random() * 2 - 1) * (1 - smoothing);
    const signal = hz ? Math.sin(2 * Math.PI * hz * index / context.sampleRate) : noise;
    samples[index] = signal * gain * Math.exp(-decay * index / frames);
  }
  return buffer;
}

function slider(input, range, value, change) {
  Object.assign(input, {...range, value});
  input.oninput = () => change(input.valueAsNumber);
}

function setupMixer() {
  for (const [id, gain] of Object.entries(DEMO.mix)) {
    const bus = sound.bus(id);
    bus.setMix({gain}, 0);
    const row = document.createElement('label');
    row.textContent = id;
    const input = document.createElement('input');
    input.type = 'range';
    input.setAttribute('aria-label', id + ' volume');
    slider(input, DEMO.range, gain, value => bus.setMix({gain: value}));
    const meter = document.createElement('meter');
    meter.setAttribute('aria-label', id + ' signal level');
    meters.set(id, meter);
    row.append(input, meter);
    for (const key of id === 'master' ? ['mute'] : ['mute', 'solo']) {
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.title = key;
      toggle.setAttribute('aria-label', id + ' ' + key);
      toggle.onchange = () => bus.setMix({[key]: toggle.checked});
      row.append(toggle);
    }
    element('mixer').append(row);
  }
}

element('unlock').onclick = async () => {
  const button = element('unlock');
  button.disabled = true;
  try {
    sound = createSound();
    await sound.unlock();
    const {context} = sound;
    const routes = {click: 'ui', music: 'music', emitter: 'sfx', rain: 'ambience', wind: 'ambience', cue: 'ambience'};
    for (const [id, bus] of Object.entries(routes)) sound.define(id, {bus, buffer: clip(context, DEMO.clips[id])});
    setupMixer();
    underwater = sound.addEnvironmentFilter(SOUND_PRESETS.underwater);
    cave = sound.addEnvironmentReverb({...SOUND_PRESETS.cave, impulse: clip(context, DEMO.clips.impulse)});
    sound.registerEffect('radio', (audio, {cutoffHz, q}) => {
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = cutoffHz;
      filter.Q.value = q;
      return {input: filter, output: filter, params: {cutoffHz: filter.frequency}};
    });
    spatial = createThreeSound(sound, {listener});
    spatial.update();
    spatial.attach(sound.play('emitter', {loop: true, spatial: {position: emitter.position}}), emitter);
    ambience = createAmbience(sound, {
      layers: ['music', 'rain', 'wind'].map(id => ({id, sound: id, gain: initial[id]})),
      cues: [{sound: 'cue', intervalSeconds: DEMO.cueIntervalSeconds}],
    });
    ambience.start();
    for (const id of ['controls', 'mixer', 'click']) element(id).disabled = false;
    element('status').textContent = 'Amber is the moving emitter. Blue is the listener. Menu clicks stay clear through zone effects.';
  } catch (error) {
    spatial?.dispose();
    await sound?.dispose();
    sound = spatial = ambience = null;
    meters.clear();
    element('mixer').querySelectorAll('label').forEach(row => row.remove());
    element('status').textContent = error.message;
    button.disabled = false;
  }
};

element('click').onclick = () => sound.play('click');
element('custom').onchange = event => {
  if (event.target.checked) {
    custom = sound.bus('sfx').addEffect('radio', {cutoffHz: DEMO.customFilterHz, q: DEMO.customFilterQ});
  } else custom?.remove();
};
slider(element('listener'), DEMO.listenerRange, initial.listener, value => { listener.position.x = value; });
slider(element('underwater'), DEMO.range, initial.underwater, value => underwater.setBlend(value));
slider(element('cave'), DEMO.range, initial.cave, value => cave.setBlend(value));
for (const id of ['rain', 'wind']) slider(element(id), DEMO.range, initial[id], value => ambience.setLevel(id, value));

const unbind = bindResize(renderer, camera);
startFrameLoop(renderer, seconds => {
  elapsed += seconds;
  const angle = elapsed * view.orbitRadiansPerSecond;
  emitter.position.set(Math.cos(angle) * view.orbitRadius, view.markerRadius, Math.sin(angle) * view.orbitRadius);
  spatial?.update();
  ambience?.update();
  if (elapsed - lastMeter >= STATUS_REFRESH_MS / 1000) {
    for (const [id, meter] of meters) meter.value = sound.bus(id).meter();
    lastMeter = elapsed;
  }
  renderer.render(scene, camera);
});
onLeave(() => {
  renderer.setAnimationLoop(null);
  unbind();
  spatial?.dispose();
  void sound?.dispose();
  for (const mesh of [emitter, listener, grid]) mesh.material.dispose();
  geometry.dispose();
  grid.geometry.dispose();
  renderer.dispose();
});
