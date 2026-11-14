// Lighting bench: the kit's lights on the basic stage. A ground of two colours with a trench, light probes measured
// from it, a point light and a spot light in a light rig, the kit's cascaded sun shadows, and pairs of white objects:
// one on Three's standard material, one on the lighting hook. Each light stands midway between the two objects of a
// pair, and both cast and receive the same shadows, so they must match.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createBasicStage} from '../../src/stage/index.js';
import {createLightProbes, createLightRig, createSunShadows, LIGHT_PROBE_DEFAULTS, SUN_SHADOW_LIMITS} from '../../src/lighting/index.js';
import {benchRenderer, onLeave, bindResize, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import '../bench.css';

const VIEW = {fov: 45, near: .1, far: 400, position: [22, 3, -27], target: [4, -2, -3]};
// The ground: `size` m across in `cells` cells, one colour for z < 0 and one beyond, and a trench along z whose
// floor is `floor` m wide and whose sides rise over `bank` m.
const GROUND = {size: 128, cells: 128, colors: ['#4f8a2c', '#a8452a'], trench: {depth: 6, floor: 8, bank: 4}};
const OBJECT = {color: 0xf2f2f2, radius: 1, lift: .3, pair: 1.3, side: 6, flat: 15, pillar: [1.2, 12, 1.2]};
// The point light hangs `lift` m over the trench pair; the spot looks straight down on the flat pair from `height` m.
// intensity in candela, distance (cutoff) in m, angle in degrees.
const POINT = {color: 0xffa040, intensity: 12, distance: 20, decay: 2, lift: 3.5};
const SPOT = {color: 0x80b0ff, intensity: 150, distance: 30, decay: 2, height: 8, angle: 25, penumbra: .4};
const renderer = benchRenderer();
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
const probes = createLightProbes({ground}), rig = createLightRig(), shadows = createSunShadows({renderer});
const stage = createBasicStage({scene, ground: false, ambient: probes.ambient, lights: rig.lights, sun: shadows.sun});

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
// A ground has no underside to draw from the sun: it casts with the side that faces it.
const groundMaterial = probes.applyTo(new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1, shadowSide: THREE.FrontSide}), stage.lighting);
shadows.applyTo(groundMaterial);
const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
groundMesh.castShadow = true;
scene.add(groundMesh);

// The same white on both lighting paths.
const standard = probes.applyTo(new THREE.MeshStandardMaterial({color: OBJECT.color, roughness: 1}), stage.lighting);
shadows.applyTo(standard);
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
    mesh.castShadow = true;
    scene.add(mesh);
  });
}
// In the trench and on the flat, on each colour; a pillar standing in the trench shows the sky opening with height.
for (const z of [-OBJECT.side, OBJECT.side]) { addPair(sphere, 0, z, OBJECT.radius); addPair(sphere, OBJECT.flat, z, OBJECT.radius); }
addPair(pillar, 0, -OBJECT.side * 2.6, OBJECT.pillar[1] / 2);

// Three lights its standard materials with these two; the rig gives them to the hook.
const point = new THREE.PointLight(POINT.color, POINT.intensity, POINT.distance, POINT.decay);
point.position.set(0, ground.heightAt(0) + POINT.lift, -OBJECT.side);
const spot = new THREE.SpotLight(SPOT.color, SPOT.intensity, SPOT.distance, THREE.MathUtils.degToRad(SPOT.angle), SPOT.penumbra, SPOT.decay);
spot.position.set(OBJECT.flat, ground.heightAt(OBJECT.flat) + SPOT.height, OBJECT.side);
spot.target.position.set(OBJECT.flat, ground.heightAt(OBJECT.flat), OBJECT.side);
scene.add(point, spot, spot.target);
rig.add(point); rig.add(spot);
const spotSettings = {angle: SPOT.angle};

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
const pointFolder = gui.addFolder('Point light (trench pair)');
pointFolder.add(point, 'visible').name('on');
pointFolder.add(point, 'intensity', 0, 100, .5).name('intensity · cd');
pointFolder.add(point, 'distance', 0, 60, .5).name('cutoff · m (0 = none)');
pointFolder.add(point.position, 'y', ground.heightAt(0) + .5, 12, .1).name('height · m');
pointFolder.addColor(point, 'color').name('colour');
const spotFolder = gui.addFolder('Spot light (flat pair)');
spotFolder.add(spot, 'visible').name('on');
spotFolder.add(spot, 'intensity', 0, 600, 1).name('intensity · cd');
spotFolder.add(spotSettings, 'angle', 5, 80, 1).name('cone · °').onChange(angle => { spot.angle = THREE.MathUtils.degToRad(angle); });
spotFolder.add(spot, 'penumbra', 0, 1, .01).name('soft edge');
spotFolder.add(spot.target.position, 'x', OBJECT.flat - 10, OBJECT.flat + 10, .1).name('aim x · m');
spotFolder.addColor(spot, 'color').name('colour');
const shadowFolder = gui.addFolder('Sun shadows (cascades)');
const shadowSlider = (name, step, label) => shadowFolder.add(shadows.settings, name, ...SUN_SHADOW_LIMITS[name], step).name(label);
shadowSlider('strength', .01, 'strength');
shadowSlider('softness', .1, 'soft edge · texels');
shadowFolder.add(shadows.settings, 'distance', 20, VIEW.far, 1).name('distance · m');
shadowSlider('lambda', .01, 'cut (0 even, 1 log)');
shadowSlider('blend', .005, 'cascade blend');
shadowSlider('normalOffset', .1, 'normal offset · texels');
shadowSlider('depthBias', .1, 'depth bias · texels');
shadowFolder.add(shadows.settings, 'debug').name('show cascades');
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
  const lit = rig.update(camera.position);
  camera.updateMatrixWorld();
  const drawn = shadows.render(scene, camera, stage.environment.sun.direction);
  renderer.render(scene, camera);
  if (now - lastStatus > STATUS_REFRESH_MS) {
    lastStatus = now;
    const {columns, spacing, layers} = LIGHT_PROBE_DEFAULTS;
    status.textContent = `${columns} x ${columns} columns of ${layers} probes, ${spacing} m apart\n${probes.pending} columns to measure\n${lit} of ${rig.count} rig lights on the hook\n${drawn} of ${shadows.settings.cascades} cascades drawn this frame`;
  }
});
document.body.dataset.ready = 'true';
onLeave(() => { renderer.setAnimationLoop(null); unbindResize(); stage.dispose(); probes.dispose(); rig.dispose(); shadows.dispose(); scene.remove(point, spot, spot.target); point.dispose(); spot.dispose(); for (const item of [standard, hooked, groundMaterial, groundGeometry, sphere, pillar]) item.dispose(); controls.dispose(); gui.destroy(); renderer.dispose(); });
window.lightingBench = {stage, probes, rig, shadows, point, spot, settings, applyGround, scene, camera, controls, renderer};
