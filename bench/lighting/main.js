// Lighting bench: the kit's secondary light on the basic stage. Pairs of white objects, one on Three's standard
// material and one on the lighting hook (core/lighting.js), over a ground whose colour can be changed.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, onLeave, bindResize, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import '../bench.css';

const VIEW = {fov: 45, near: .1, far: 400, position: [0, 3.4, 13], target: [0, 1.5, 0]};
const GROUND = {size: 120, color: '#4f8a2c'};
const OBJECT = {color: 0xf2f2f2, spacing: 2.7, lift: .6};   // in a row, `spacing` m apart and `lift` m off the ground
const renderer = benchRenderer(); renderer.shadowMap.enabled = true;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, innerWidth / innerHeight, VIEW.near, VIEW.far);
camera.position.set(...VIEW.position);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...VIEW.target); controls.enableDamping = true;
const stage = createBasicStage({scene, shadows: true, groundSize: GROUND.size, groundColor: GROUND.color});
const settings = {ground: GROUND.color, bounce: 1};

// The same white on both lighting paths.
const standard = new THREE.MeshStandardMaterial({color: OBJECT.color, roughness: 1});
const hooked = new THREE.ShaderMaterial({
  uniforms: {...stage.lighting.uniforms, uColor: {value: new THREE.Color(OBJECT.color)}},
  vertexShader: /* glsl */`varying vec3 vNormal; varying vec3 vWorld;
    void main() { vNormal = normalize(mat3(modelMatrix) * normal); vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
  fragmentShader: /* glsl */`${stage.lighting.glsl}
    uniform vec3 uColor; varying vec3 vNormal; varying vec3 vWorld;
    void main() {
      gl_FragColor = vec4(applyFog(shade(uColor, normalize(vNormal), 1.0, 1.0, 0.0), distance(vWorld, cameraPosition)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const shapes = [new THREE.SphereGeometry(1, 48, 24), new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.TorusKnotGeometry(.7, .26, 120, 16)];
shapes.forEach((geometry, index) => {
  [standard, hooked].forEach((material, side) => {
    const mesh = new THREE.Mesh(geometry, material);
    geometry.computeBoundingBox();
    mesh.position.set((index * 2 + side - shapes.length + .5) * OBJECT.spacing, OBJECT.lift - geometry.boundingBox.min.y, 0);
    mesh.castShadow = material === standard;
    scene.add(mesh);
  });
});

const albedo = new THREE.Color();
function applyGround() {
  stage.ground.material.color.set(settings.ground);
  stage.setGround(settings.bounce > 0 ? albedo.set(settings.ground) : null, settings.bounce);
}
const gui = createBenchPanel('Lighting');
stageControls(gui, stage, {wind: false});
const folder = gui.addFolder('Ground bounce');
folder.addColor(settings, 'ground').name('ground colour').onChange(applyGround);
folder.add(settings, 'bounce', 0, 1, .01).name('bounce (0 = fixed ambient)').onChange(applyGround);
applyGround();

const status = document.getElementById('status'), unbindResize = bindResize(renderer, camera);
let lastStatus = 0;
startFrameLoop(renderer, (dt, now) => {
  controls.update(); stage.update(camera); renderer.render(scene, camera);
  if (now - lastStatus > STATUS_REFRESH_MS) {
    lastStatus = now;
    const {ground, sky} = stage.environment.ambient;
    status.textContent = `ambient from above  ${sky.toArray().map(v => v.toFixed(2)).join(' ')}\nambient from below  ${ground.toArray().map(v => v.toFixed(2)).join(' ')}`;
  }
});
document.body.dataset.ready = 'true';
onLeave(() => { renderer.setAnimationLoop(null); unbindResize(); stage.dispose(); standard.dispose(); hooked.dispose(); shapes.forEach(shape => shape.dispose()); controls.dispose(); gui.destroy(); renderer.dispose(); });
window.lightingBench = {stage, settings, applyGround, scene, camera, renderer};
