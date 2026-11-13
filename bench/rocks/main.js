import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createBasicStage} from '../../src/stage/index.js';
import {createRocks, ROCK_DEFAULTS, ROCK_PROFILES} from '../../src/rocks/index.js';
import {createBenchPanel} from '../panel.js';
import '../bench.css';

const PREVIEW = {columns: 8, roughness: .9, maxPixelRatio: 2, fov: 42, near: .02, far: 150, framing: 1.3};
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, PREVIEW.maxPixelRatio));
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const stage = createBasicStage({scene, shadows: true, groundColor: 0x686861});
const camera = new THREE.PerspectiveCamera(PREVIEW.fov, 1, PREVIEW.near, PREVIEW.far);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
const direction = new THREE.Vector3(1, .72, 1.3).normalize();
const state = {...ROCK_DEFAULTS, columns: PREVIEW.columns, finish: 'Rock', normalStrength: 1};
const status = document.querySelector('#status');
const loader = new THREE.TextureLoader();
const files = import.meta.glob('../../assets/terrain/{rock_wall_02,mossy_rock}/{color,normal,roughness}.jpg', {
  eager: true, query: '?url', import: 'default',
});
function finish(id) {
  return Object.fromEntries(Object.entries({map: 'color', normalMap: 'normal', roughnessMap: 'roughness'}).map(([slot, role]) => {
    const texture = loader.load(files[`../../assets/terrain/${id}/${role}.jpg`]);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    if (role === 'color') texture.colorSpace = THREE.SRGBColorSpace;
    return [slot, texture];
  }));
}
const finishes = {Rock: finish('rock_wall_02'), 'Mossy rock': finish('mossy_rock'), Plain: {map: null, normalMap: null, roughnessMap: null}};
const material = new THREE.MeshStandardMaterial({roughness: PREVIEW.roughness, ...finishes[state.finish]});
let rocks;

function frame() {
  const sphere = new THREE.Box3().setFromObject(rocks.group).getBoundingSphere(new THREE.Sphere());
  orbit.target.copy(sphere.center);
  const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  camera.position.copy(orbit.target).addScaledVector(direction, PREVIEW.framing * sphere.radius / Math.sin(Math.min(vertical, horizontal)));
  orbit.update();
}
function rebuild(reframe = false) {
  const next = createRocks({...state, count: state.mode === 'cliff' ? state.columns : state.count, material});
  rocks?.dispose();
  rocks = next;
  scene.add(rocks.group);
  if (reframe) frame();
  const triangles = rocks.group.children.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count / 3, 0);
  status.textContent = `${rocks.group.children.length} meshes · ${triangles} triangles`;
}

const panel = createBenchPanel('Generator');
document.querySelector('#controls').append(panel.domElement);
panel.domElement.classList.remove('autoPlace');
panel.add(state, 'mode', ['stone', 'boulder', 'scatter', 'cliff']).onChange(() => rebuild(true));
panel.add(state, 'environment', Object.keys(ROCK_PROFILES)).onChange(() => rebuild());
panel.add(state, 'seed', 0, 65535, 1).onFinishChange(() => rebuild());
panel.add(state, 'count', 1, 120, 1).name('Scatter count').onFinishChange(() => rebuild());
panel.add(state, 'columns', 1, 24, 1).name('Cliff columns').onFinishChange(() => rebuild());
panel.add(state, 'span', 2, 24, .5).name('Span (m)').onFinishChange(() => rebuild(true));
panel.add(state, 'burial', 0, .45, .01).onFinishChange(() => rebuild());
panel.add(state, 'finish', Object.keys(finishes)).onChange(() => {
  material.setValues(finishes[state.finish]);
  material.needsUpdate = true;
});
panel.add(state, 'normalStrength', 0, 2, .05).name('Normal strength').onChange(value => material.normalScale.setScalar(value));
panel.add({frame}, 'frame').name('Frame rocks');
panel.add({async export() {
  try {
    const name = `${state.environment}_${state.mode}_${state.seed}`;
    const data = await new GLTFExporter().parseAsync(rocks.group, {binary: true});
    const url = URL.createObjectURL(new Blob([data], {type: 'model/gltf-binary'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.glb`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { status.textContent = error.message; }
}}, 'export').name('Export GLB');

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();
rebuild(true);
renderer.setAnimationLoop(() => {
  orbit.update();
  stage.update(camera);
  renderer.render(scene, camera);
});
