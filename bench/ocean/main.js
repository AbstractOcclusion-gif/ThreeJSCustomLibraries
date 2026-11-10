import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createOceanSurface, createWaterlineComposite, proceduralSky, SurfaceProbes} from '../../src/water/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import {detectAssets} from '../kit/assets.js';
import {aimRay} from '../kit/input.js';
import {bindRippleGesture} from '../ripple-gesture.js';
import {oceanControls} from './controls.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const START_WIND = 8;   // m/s: a moderate sea for the default view
const renderer = benchRenderer();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(53, innerWidth / innerHeight, .15, 9500);
camera.position.set(18, 6.5, 22);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, -40); controls.enableDamping = true;
controls.minDistance = 6; controls.maxDistance = 165; controls.maxPolarAngle = Math.PI * .495; controls.enablePan = false; controls.update();
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
// Standalone: the basic stage gives the sun, light and wind; the ocean draws its own sky through the procedural sky hook.
const stage = createBasicStage({scene, ground: false});
const sky = proceduralSky();
// Same foam lace as the demo: the staged WebAquarium sheet when present, else the bundled copy, else the generated one.
const aquariumAssets = new URL(import.meta.env.BASE_URL + 'webaquarium/', location.href);
const sheetsUrl = new URL('library/ocean/textures/', aquariumAssets).href;
const sheetBase = await detectAssets(sheetsUrl + 'foam_lace.png', sheetsUrl);
const foamUrl = sheetBase ? sheetBase + 'foam_lace.png' : import.meta.env.BASE_URL + 'webaquarium-water/foam_lace.png';
const laceTexture = await detectAssets(foamUrl, foamUrl)
  ? await new THREE.TextureLoader().loadAsync(foamUrl).catch(error => { console.warn('Foam lace texture failed to load; the ocean uses its generated one.', error); }) : undefined;
const ocean = createOceanSurface({renderer, sky, caustics: {}, wake: {}, laceTexture});
ocean.setEnvironment(stage.environment);
const waterScene = new THREE.Scene();
waterScene.add(ocean.mesh);
const probes = new SurfaceProbes(ocean.fft, 3, {wake: ocean.wake}), probeStep = 2;
const waterline = createWaterlineComposite(renderer, {caustics: ocean.caustics});
const ray = new THREE.Raycaster(), impact = new THREE.Vector3();
const meanSea = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const rippleGesture = bindRippleGesture(renderer.domElement, controls, event => {
  if (view.waterline) return;
  aimRay(ray, event, renderer.domElement, camera);
  if (!ray.ray.intersectPlane(meanSea, impact)) return;
  const {center, halfSize} = ocean.wake;
  if (Math.abs(impact.x - center.x) < halfSize && Math.abs(impact.z - center.y) < halfSize) return impact;
}, ({x, z}, strength) => ocean.wake.addDrop(x, z, 3.2, .65 * strength), {spacing: 1.5});

const gui = createBenchPanel('Ocean');
const stageUI = stageControls(gui, stage, {onChange: () => sky.setEnvironment(stage.environment)});
const {settings: s, view, orbitPosition} = oceanControls(gui, {ocean, camera, controls, rippleGesture,
  onHeading: heading => { stageUI.state.windHeading = heading; stageUI.apply(); stageUI.folder.controllersRecursive().forEach(c => c.updateDisplay()); },
  bundled: import.meta.glob('../../presets/ocean/*.json')});
Object.assign(stageUI.state, {windSpeed: START_WIND, windHeading: s.heading});
stageUI.folder.controllersRecursive().forEach(c => c.updateDisplay()); stageUI.apply();

const unbindResize = bindResize(renderer, camera);
let lastUI = 0, time = 0;
startFrameLoop(renderer, (dt, now) => {
  probes.collect();
  if (view.waterline) {
    camera.position.set(orbitPosition.x, view.eyeHeight, orbitPosition.z);
    camera.lookAt(controls.target.x, view.eyeHeight, controls.target.z);
  } else controls.update();
  stage.update(camera);
  rippleGesture.update(dt);
  ocean.update(dt, undefined, camera.position);   // wind speed and heading come from the stage environment
  time += dt;
  const {x, z} = camera.position;
  probes.points[0].set(x, 0, z);
  probes.points[1].set(x + probeStep, 0, z);
  probes.points[2].set(x, 0, z + probeStep);
  probes.issue(time, camera.position);
  const [a, b, c] = probes.samples;
  const valid = a.valid && b.valid && c.valid;
  const slopeX = valid ? (b.height - a.height) / probeStep : 0;
  const slopeZ = valid ? (c.height - a.height) / probeStep : 0;
  const height = valid ? a.height + slopeX * (x - a.x) + slopeZ * (z - a.z) : 0;
  const opaque = ocean.captureScene(scene, camera, {waterType: view.waterType});
  const water = ocean.captureWater(waterScene, camera);
  const light = sky.uniforms;
  waterline.renderLayers(opaque, water, camera, {height, slopeX, slopeZ, waterType: view.waterType, clarity: s.clarity, godRays: view.godRays,
    sunDirection: light.uSkySun.value, sunColor: light.uSunCol.value, ambientColor: light.uAmb.value});
  if (now - lastUI > STATUS_REFRESH_MS) {
    lastUI = now;
    const {fft, clipmap} = ocean;
    $('status').textContent = `wind ${stageUI.state.windSpeed.toFixed(1)} m/s · waves ${fft.effective.significantHeight.toFixed(2)} m
FFT ${fft.resolution}² × ${fft.cascades} · clipmap ${clipmap.levelCount} levels
Wake window ${ocean.wake.resolution}² · ${ocean.wake.halfSize * 2} m
Surface at camera ${a.valid ? a.height.toFixed(2) + ' m' : 'sampling…'}`;
  }
});
document.body.dataset.ready = 'true';
window.oceanBench = {ocean, stage, scene, camera, renderer, probes, controls};
onLeave(() => {
  renderer.setAnimationLoop(null);
  unbindResize();
  rippleGesture.dispose();
  probes.dispose();
  waterline.dispose();
  ocean.dispose();
  laceTexture?.dispose();
  stage.dispose();
  controls.dispose();
  gui.destroy();
  renderer.dispose();
});
