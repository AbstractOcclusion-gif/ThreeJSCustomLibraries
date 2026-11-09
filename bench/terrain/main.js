import * as THREE from 'three';
import GUI from 'lil-gui';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createTerrainAppearance, createTerrainField, createTerrainMaterial} from '../../src/terrain/index.js';
import {valueNoise} from '../../src/terrain/terrain-noise.js';
import {createSurfaceWeather, createTrackMask} from '../../src/surface/index.js';
import {benchRenderer, createBenchWeather, weatherFolder} from '../shared.js';
import '../bench.css';

const renderer = benchRenderer();
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .2, 1800);
camera.position.set(26, 15, 27);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, -3);
controls.enableDamping = true;
controls.update();
const weather = await createBenchWeather({scene, renderer, camera, initial: 'cloudy 1', hour: 14, precipitation: false});
weather.view.sun.castShadow = true;
weather.view.sun.shadow.mapSize.set(1024, 1024);
Object.assign(weather.view.sun.shadow.camera, {left: -42, right: 42, top: 42, bottom: -42, far: 240});
weather.view.sun.shadow.camera.updateProjectionMatrix();

// Free repeatable diagnostic swatches. Alpha is micro-height, never transparency.
const textureSize = 96;
const noise = valueNoise(19);
function periodicNoise(u, v, frequency) {
 u -= Math.floor(u);
 v -= Math.floor(v);
 const x = u * frequency, y = v * frequency;
 const blendX = THREE.MathUtils.smoothstep(u, 0, 1), blendY = THREE.MathUtils.smoothstep(v, 0, 1);
 return THREE.MathUtils.lerp(
  THREE.MathUtils.lerp(noise(x, y), noise(x - frequency, y), blendX),
  THREE.MathUtils.lerp(noise(x, y - frequency), noise(x - frequency, y - frequency), blendX), blendY,
 );
}
function relief(u, v) {
 return .5 + .23 * periodicNoise(u, v, 5) + .15 * periodicNoise(u + .23, v + .41, 13) + .09 * periodicNoise(u, v, 29);
}
function tile(pixel, colorSpace = THREE.NoColorSpace) {
 const data = new Uint8Array(textureSize * textureSize * 4);
 for (let y = 0; y < textureSize; y++) for (let x = 0; x < textureSize; x++) {
  data.set(pixel(x / textureSize, y / textureSize), (y * textureSize + x) * 4);
 }
 const texture = new THREE.DataTexture(data, textureSize, textureSize);
 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
 texture.minFilter = THREE.LinearMipmapLinearFilter;
 texture.magFilter = THREE.LinearFilter;
 texture.generateMipmaps = true;
 texture.colorSpace = colorSpace;
 texture.needsUpdate = true;
 return texture;
}
const layerColors = {grass: [104, 137, 71], rock: [119, 112, 105], snow: [213, 229, 235], mud: [106, 75, 49]};
const layers = Object.fromEntries(Object.entries(layerColors).map(([name, rgb], index) => [name, tile((u, v) => {
 const h = relief(u + index * .17, v), variation = .70 + h * .48;
 return [...rgb.map(channel => channel * variation), h * 255];
}, THREE.SRGBColorSpace)]));
const detail = tile((u, v) => {
 const step = 1 / textureSize;
 const n = new THREE.Vector3(relief(u - step, v) - relief(u + step, v), relief(u, v - step) - relief(u, v + step), .5).normalize();
 return [(n.x * .5 + .5) * 255, (n.y * .5 + .5) * 255, (n.z * .5 + .5) * 255, 255];
});

const resolution = 129, span = 66, half = span / 2;
const heights = Float32Array.from({length: resolution * resolution}, (_, i) => {
 const x = (i % resolution) * span / (resolution - 1) - half;
 const z = Math.floor(i / resolution) * span / (resolution - 1) - half;
 const basin = -3.3 * Math.exp(-((x + 8) ** 2 / 120 + (z - 2) ** 2 / 75));
 const cliff = (11 + 2 * Math.sin(x * .21)) * THREE.MathUtils.smoothstep(-z + Math.sin(x * .13) * 4, 9, 17);
 return 1.05 + basin + cliff + .23 * Math.sin(x * .53) * Math.cos(z * .41);
});
const rules = {rockSlope: .69, snowLine: 12, snowBlend: 2, snowJitter: 1.5, mudBelow: 1.1, mudBlend: .65};
const field = createTerrainField({origin: [-half, -half], size: [span, span], resolution: [resolution, resolution], heights, rules});
const appearance = createTerrainAppearance(), surfaceWeather = createSurfaceWeather();
const tracks = createTrackMask({origin: [-half, -half], size: [span, span], resolution: 512});
const shared = {field, layers, detailNormal: detail, appearance, weather: surfaceWeather};
const groundMaterial = createTerrainMaterial({}, {...shared, tracks, trackContrast: .29});
const rockMaterial = createTerrainMaterial({color: '#8a8178', roughness: .92}, {...shared, contactBand: .8, puddles: 0});
const plainRock = createTerrainMaterial({color: '#8a8178', roughness: .92}, {...shared, contactBand: 0, puddles: 0});
const ground = new THREE.Mesh(field.geometry, groundMaterial);
ground.receiveShadow = true;
scene.add(ground);
const rockGeometry = new THREE.DodecahedronGeometry(1.7, 1);
const rocks = [[-2, 6], [3, 2], [-6, -6], [8, -9]].map(([x, z], i) => {
 const rock = new THREE.Mesh(rockGeometry, rockMaterial);
 rock.position.set(x, field.heightAt(x, z) + .73, z);
 rock.rotation.set(i * .34, i * 1.1, -.16);
 rock.scale.set(1.1 + i * .13, .95, 1);
 rock.castShadow = rock.receiveShadow = true;
 scene.add(rock);
 return rock;
});
for (const material of [groundMaterial, rockMaterial, plainRock]) weather.view.addCloudShadowReceiver(material);

// A water-level marker for the basin. Terrain shading consumes the level independently.
const waterGeometry = new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2);
const waterMaterial = new THREE.MeshPhysicalMaterial({color: '#367f84', roughness: .19, transparent: true, opacity: .68, depthWrite: false});
const water = new THREE.Mesh(waterGeometry, waterMaterial);
scene.add(water);

function stampDemo() {
 for (const side of [-1, 1]) {
  const point = i => ({x: -8 + i * .74, z: 14 + Math.sin(i * .12) * 1.8 + side * .65});
  for (let i = 0; i < 28; i++) tracks.stamp(point(i), point(i + 1), .32);
 }
}
const gui = new GUI({title: 'Terrain material'});
const controlsState = {blendObjects: true, water: true, wetPreview: false};
gui.add(controlsState, 'blendObjects').name('Blend boulder bases').onChange(value => rocks.forEach(rock => { rock.material = value ? rockMaterial : plainRock; }));
gui.add(controlsState, 'wetPreview').name('Rain wetness preview');
const automatic = gui.addFolder('Automatic layers');
for (const [key, min, max, step] of [['rockSlope', .2, 2, .05], ['snowLine', -2, 22, .5], ['mudBelow', -3, 6, .1]]) {
 automatic.add(rules, key, min, max, step).onFinishChange(() => field.updateRules(rules));
}
const textures = gui.addFolder('Triplanar textures');
for (const [key, min, max, step] of [['tiling', .1, 2, .05], ['sharpness', 1, 8, .25], ['antiTiling', 0, 1, .05], ['detailStrength', 0, 2, .05], ['heightBlend', 0, 1, .05]]) {
 textures.add(appearance[key], 'value', min, max, step).name(key);
}
const shoreline = gui.addFolder('Shoreline');
shoreline.add(controlsState, 'water').name('Show water plane');
shoreline.add(appearance.waterLevel, 'value', -2, .85, .05).name('Water level · m');
shoreline.add(appearance.shoreWidth, 'value', 0, 2, .05).name('Wet band · m');
shoreline.add(appearance.shoreWetness, 'value', 0, 1, .05).name('Water wetness');
gui.add({stampDemo}, 'stampDemo').name('Lay tracks');
gui.add(tracks, 'clear').name('Clear tracks');
const weatherUI = weatherFolder(gui, weather);

function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
addEventListener('resize', resize);
const frameRate = document.getElementById('frame-rate');
let last, measuredSince, frames = 0;
renderer.setAnimationLoop(now => {
 if (document.hidden) { last = measuredSince = undefined; frames = 0; return; }
 measuredSince ??= now;
 if (now - measuredSince >= 1000) {
  const frameTime = (now - measuredSince) / frames;
  frameRate.textContent = `${Math.round(1000 / frameTime)} fps · ${frameTime.toFixed(1)} ms/frame`;
  measuredSince = now;
  frames = 0;
 }
 frames++;
 const dt = last === undefined ? 0 : Math.min(.05, (now - last) / 1000);
 last = now;
 controls.update();
 weather.system.update(dt);
 weather.view.update(dt);
 weatherUI.sync();
 if (controlsState.wetPreview) { surfaceWeather.set({wetness: 1, snow: 0}); surfaceWeather.update(dt, null); }
 else surfaceWeather.update(dt, weather.system.weather);
 water.position.y = appearance.waterLevel.value;
 water.visible = controlsState.water;
 weather.view.render();
});
addEventListener('pagehide', event => {
 if (event.persisted) return;
 renderer.setAnimationLoop(null);
 removeEventListener('resize', resize);
 weather.view.dispose();
 controls.dispose();
 gui.destroy();
 field.dispose();
 tracks.dispose();
 for (const resource of [...Object.values(layers), detail, groundMaterial, rockMaterial, plainRock, rockGeometry, waterGeometry, waterMaterial]) resource.dispose();
 renderer.dispose();
}, {once: true});
