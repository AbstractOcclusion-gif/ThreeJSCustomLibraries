// Lighting bench: the kit's secondary light on the basic stage. A ground of two colours with a trench, light probes
// measured from it, and pairs of white objects: one on Three's standard material, one on the lighting hook.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createBasicStage} from '../../src/stage/index.js';
import {createLightProbes, LIGHT_PROBE_DEFAULTS} from '../../src/lighting/index.js';
import {benchRenderer, onLeave, bindResize, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import '../bench.css';

const VIEW = {fov: 45, near: .1, far: 400, position: [22, 3, -27], target: [4, -2, -3]};
// The ground: `size` m across in `cells` cells, one colour for z < 0 and one beyond, and a trench along z whose
// floor is `floor` m wide and whose sides rise over `bank` m.
const GROUND = {size: 128, cells: 128, colors: ['#4f8a2c', '#a8452a'], trench: {depth: 6, floor: 8, bank: 4}};
const OBJECT = {color: 0xf2f2f2, radius: 1, lift: .3, pair: 1.3, side: 6, flat: 15, pillar: [1.2, 12, 1.2]};
const renderer = benchRenderer(); renderer.shadowMap.enabled = true;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, innerWidth / innerHeight, VIEW.near, VIEW.far);
camera.position.set(...VIEW.position);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(...VIEW.target); controls.enableDamping = true;
const settings = {colorA: GROUND.colors[0], colorB: GROUND.colors[1], bounce: 1};

// The ground the probes measure and the mesh that shows it, from the same two functions.
const groundColors = [new THREE.Color(settings.colorA), new THREE.Color(settings.colorB)];
const ground = {
  heightAt(x) {
    const {depth, floor, bank} = GROUND.trench;
    return -depth * (1 - THREE.MathUtils.smoothstep(Math.abs(x), floor / 2, floor / 2 + bank));
  },
  colorAt: (x, z, target) => target.copy(groundColors[z < 0 ? 0 : 1]),
};
const probes = createLightProbes({ground});
const stage = createBasicStage({scene, shadows: true, ground: false, shadowExtent: GROUND.size / 4, ambient: probes.ambient});

const groundGeometry = new THREE.PlaneGeometry(GROUND.size, GROUND.size, GROUND.cells, GROUND.cells).rotateX(-Math.PI / 2);
const position = groundGeometry.attributes.position;
groundGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(position.count * 3), 3));
const paint = new THREE.Color();
function paintGround() {
  for (let index = 0; index < position.count; index++) {
    ground.colorAt(position.getX(index), position.getZ(index), paint).toArray(groundGeometry.attributes.color.array, index * 3);
  }
  groundGeometry.attributes.color.needsUpdate = true;
}
for (let index = 0; index < position.count; index++) position.setY(index, ground.heightAt(position.getX(index)));
groundGeometry.computeVertexNormals();
paintGround();
const groundMaterial = probes.applyTo(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1}), stage.lighting);
const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// The same white on both lighting paths.
const standard = probes.applyTo(new THREE.MeshStandardMaterial({color: OBJECT.color, roughness: 1}), stage.lighting);
const hooked = new THREE.ShaderMaterial({
  uniforms: {...stage.lighting.uniforms, uColor: {value: new THREE.Color(OBJECT.color)}},
  vertexShader: /* glsl */`varying vec3 vNormal; varying vec3 vWorld;
    void main() { vNormal = normalize(mat3(modelMatrix) * normal); vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
  fragmentShader: /* glsl */`${stage.lighting.glsl}
    uniform vec3 uColor; varying vec3 vNormal; varying vec3 vWorld;
    void main() {
      gl_FragColor = vec4(applyFog(shadeAt(uColor, normalize(vNormal), 1.0, 1.0, 0.0, vWorld), distance(vWorld, cameraPosition)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sphere = new THREE.SphereGeometry(OBJECT.radius, 48, 24), pillar = new THREE.BoxGeometry(...OBJECT.pillar);
// A pair at (x, z): the standard one toward -z, the hook one toward +z, their base `lift` m off the ground.
function addPair(geometry, x, z, halfHeight) {
  [standard, hooked].forEach((material, index) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, ground.heightAt(x) + OBJECT.lift + halfHeight, z + (index ? OBJECT.pair : -OBJECT.pair));
    mesh.castShadow = material === standard;
    scene.add(mesh);
  });
}
// In the trench and on the flat, on each colour; a pillar standing in the trench shows the sky opening with height.
for (const z of [-OBJECT.side, OBJECT.side]) { addPair(sphere, 0, z, OBJECT.radius); addPair(sphere, OBJECT.flat, z, OBJECT.radius); }
addPair(pillar, 0, -OBJECT.side * 2.6, OBJECT.pillar[1] / 2);

const albedo = new THREE.Color();
function applyGround() {
  groundColors[0].set(settings.colorA); groundColors[1].set(settings.colorB);
  paintGround();
  probes.refresh();
  // Away from the probes, and at probe strength 0: one bounce for the whole ground, from the mean of its colours.
  stage.setGround(settings.bounce > 0 ? albedo.copy(groundColors[0]).lerp(groundColors[1], .5) : null, settings.bounce);
}
const gui = createBenchPanel('Lighting');
stageControls(gui, stage, {wind: false});
const probeFolder = gui.addFolder('Light probes');
probeFolder.add(probes.strength, 'value', 0, 1, .01).name('strength (0 = plain ambient)');
const groundFolder = gui.addFolder('Ground');
groundFolder.addColor(settings, 'colorA').name('colour, near side').onChange(applyGround);
groundFolder.addColor(settings, 'colorB').name('colour, far side').onChange(applyGround);
groundFolder.add(settings, 'bounce', 0, 1, .01).name('plain ambient: ground bounce').onChange(applyGround);
applyGround();

const status = document.getElementById('status'), unbindResize = bindResize(renderer, camera);
let lastStatus = 0;
startFrameLoop(renderer, (dt, now) => {
  controls.update(); stage.update(camera);
  probes.update(controls.target.x, controls.target.z);
  renderer.render(scene, camera);
  if (now - lastStatus > STATUS_REFRESH_MS) {
    lastStatus = now;
    const {columns, spacing, layers} = LIGHT_PROBE_DEFAULTS;
    status.textContent = `${columns} x ${columns} columns of ${layers} probes, ${spacing} m apart\n${probes.pending} columns to measure`;
  }
});
document.body.dataset.ready = 'true';
onLeave(() => { renderer.setAnimationLoop(null); unbindResize(); stage.dispose(); probes.dispose(); for (const item of [standard, hooked, groundMaterial, groundGeometry, sphere, pillar]) item.dispose(); controls.dispose(); gui.destroy(); renderer.dispose(); });
window.lightingBench = {stage, probes, settings, applyGround, scene, camera, controls, renderer};
