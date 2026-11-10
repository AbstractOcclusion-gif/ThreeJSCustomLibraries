import * as THREE from 'three';
import GUI from 'lil-gui';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createTerrainAppearance, createTerrainField, createTerrainMaterial, TERRAIN_LAYERS} from '../../src/terrain/index.js';
import {createFreeVegetation, createGrassField} from '../../src/vegetation/index.js';
import {seededRandom} from '../../src/core/hash.js';
import {valueNoise} from '../../src/terrain/terrain-noise.js';
import {createSurfaceWeather, createTrackMask} from '../../src/surface/index.js';
import {createParticleDepthBinding, createWaterSpray} from '../../src/particles/water/index.js';
import {createChannelSurface, createFlowBake, createFreezeTexture, createRipples, createWaterFreeze, createWaterlineComposite, skyFromWeather} from '../../src/water/index.js';
import {benchRenderer, createBenchPondSettings, createBenchWeather, pondWindControls, waterFreezeControls, waterMaterialControls, weatherFolder} from '../shared.js';
import {createTerrainImpacts} from './impacts.js';
import {createTerrainIce} from './ice.js';
import {loadTerrainTextures} from './textures.js';
import {bindRippleGesture} from '../ripple-gesture.js';
import '../bench.css';

const renderer = benchRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .2, 1800);
camera.position.set(26, 15, 27);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, -3);
controls.enableDamping = true;
controls.update();
const weather = await createBenchWeather({scene, renderer, camera, lightTarget: new THREE.Vector3(), initial: 'cloudy 1', hour: 14, precipitation: false});
weather.view.configure({sky: {captureInterval: 1.25, lightingInterval: 8}});
weather.view.sun.castShadow = true;
weather.view.sun.shadow.autoUpdate = false;
weather.view.sun.shadow.needsUpdate = true;
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
const layerColors = {grass: [99, 108, 62], rock: [118, 110, 100], snow: [204, 216, 219], mud: [108, 83, 62], forest: [64, 52, 39]};
let layers = Object.fromEntries(Object.entries(layerColors).map(([name, rgb], index) => [name, tile((u, v) => {
 const h = relief(u + index * .17, v);
 const grain = periodicNoise(u + index * .31, v, 33);
 const strata = name === 'rock' ? .045 * Math.sin(2 * Math.PI * (v * 7 + .65 * periodicNoise(u, v, 3))) : 0;
 const variation = .73 + h * .5 + .14 * grain + strata;
 return [...rgb.map(channel => channel * variation), h * 255];
}, THREE.SRGBColorSpace)]));
let detail = tile((u, v) => {
 const step = 1 / textureSize;
 const n = new THREE.Vector3(relief(u - step, v) - relief(u + step, v), relief(u, v - step) - relief(u, v + step), .5).normalize();
 return [(n.x * .5 + .5) * 255, (n.y * .5 + .5) * 255, (n.z * .5 + .5) * 255, 255];
});
try {
 const photos = await loadTerrainTextures(renderer, {forest: true});
 Object.values(layers).forEach(texture => texture.dispose());
 detail.dispose();
 ({layers, detail} = photos);
} catch (error) {
 console.warn('Terrain photo maps unavailable. Using procedural textures.', error);
}

const resolution = 129, span = 66, half = span / 2;
const heights = Float32Array.from({length: resolution * resolution}, (_, i) => {
 const x = (i % resolution) * span / (resolution - 1) - half;
 const z = Math.floor(i / resolution) * span / (resolution - 1) - half;
 const basin = -3.8 * Math.exp(-((x + 8 + 2 * noise(x * .09, z * .09)) ** 2 / 145 + (z - 2) ** 2 / 88));
 const escarpment = THREE.MathUtils.smoothstep(-z + 4 * noise(x * .07, z * .06), 8, 19);
 const cliff = (10 + 4 * noise(x * .08, z * .08) + 1.1 * noise(x * .27, z * .24)) * escarpment;
 return 1.55 + basin + cliff + .52 * noise(x * .12, z * .12) + .14 * noise(x * .48, z * .48);
});
const rules = {rockSlope: .71, snowLine: 13.5, snowBlend: 2, snowJitter: 1.5, mudBelow: .75, mudBlend: .8, patchStrength: .32, forestCover: .5};
const field = createTerrainField({origin: [-half, -half], size: [span, span], resolution: [resolution, resolution], heights, rules});
const appearance = createTerrainAppearance(), surfaceWeather = createSurfaceWeather();
appearance.rockScale.value = .36;
const tracks = createTrackMask({origin: [-half, -half], size: [span, span], resolution: 512, directional: true});
const shared = {field, layers, detailNormal: detail, appearance, weather: surfaceWeather};
const groundMaterial = createTerrainMaterial({}, {...shared, tracks, trackContrast: .29});
const boulderSurface = {color: '#a49a86', map: layers.rock, roughness: .87};
layers.rock.repeat.setScalar(.72);
const rockMaterial = createTerrainMaterial(boulderSurface, {...shared, contactBand: .8, puddles: 0});
const plainRock = createTerrainMaterial(boulderSurface, {...shared, contactBand: 0, puddles: 0});
const ground = new THREE.Mesh(field.geometry, groundMaterial);
ground.receiveShadow = true;
scene.add(ground);
const rockGeometry = new THREE.DodecahedronGeometry(1.7, 1);
const rocks = [[-2, 6], [3, 2], [-6, -6], [8, -9]].map(([x, z], i) => {
 const rock = new THREE.Mesh(rockGeometry, rockMaterial);
 rock.position.set(x, field.heightAt(x, z) + .73, z);
 rock.rotation.set(i * .34, i * 1.1, -.16);
 rock.scale.set(1.2 + i * .15, .62 + i * .1, .85 + (i % 2) * .24);
 rock.castShadow = rock.receiveShadow = true;
 scene.add(rock);
 return rock;
});
for (const material of [groundMaterial, rockMaterial, plainRock]) weather.view.addCloudShadowReceiver(material);

// Share the live bed heights with the pond so liquid and ice end at the same shore.
const waterGeometry = field.geometry.clone();
const waterPositions = waterGeometry.getAttribute('position');
const bedHeight = new THREE.BufferAttribute(field.heightMap.image.data, 1);
waterGeometry.setAttribute('bedHeight', bedHeight);
for (let i = 0; i < waterPositions.count; i++) waterPositions.setY(i, 0);
const maxWaterLevel = .85;
const bedIndices = field.geometry.index.array, waterIndices = [];
for (let i = 0; i < bedIndices.length; i += 3) {
 const a = bedIndices[i], b = bedIndices[i + 1], c = bedIndices[i + 2];
 if (Math.min(heights[a], heights[b], heights[c]) < maxWaterLevel + .65) waterIndices.push(a, b, c);
}
waterGeometry.setIndex(waterIndices);
waterGeometry.computeVertexNormals();
waterGeometry.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(waterPositions.count * 3), 3));
const ripples = createRipples({origin: [-24, -16], size: [96, 96], cell: .4});
const flow = createFlowBake();
const obstacles = Array.from({length: 4}, () => new THREE.Vector4());
const freeze = createWaterFreeze(), freezeMap = createFreezeTexture();
const ice = createTerrainIce(field, freezeMap, scene);
weather.view.addCloudShadowReceiver(ice.material);
const lightOccluders = [ground, ...rocks];
const pond = createChannelSurface({renderer, scene, camera, sky: skyFromWeather(weather.view, {water: true}), ripples, flow, obstacles,
 freezeMap, iceDamage: ice, captureScale: .4, causticSegments: 280, clipToBed: true, pondOptics: true, lightOccluders});
const waterline = createWaterlineComposite(renderer, {caustics: pond.lighting});
const sprayScene = new THREE.Scene();
const waterPlane = new THREE.Vector4(0, 1, 0, 0);
const splashPosition = new THREE.Vector3();
const light = weather.view.uniforms;
const spray = createWaterSpray({
 THREE, scene: sprayScene, renderer,
 depth: createParticleDepthBinding({THREE, camera, depthTexture: pond.depthTexture, viewport: pond.viewport, waterPlane}),
 surface: {
  glsl: 'uniform float uOceanAmplitude, uPondLevel; float surfaceHeightAt(vec2 xz) { return uPondLevel; }',
  uniforms: {uOceanAmplitude: {value: 1}, uPondLevel: appearance.waterLevel},
 },
 lighting: {uniforms: {uSunCol: light.uSunCol, uFxAmbient: light.uAmb}, direction: light.uSkySunDir.value, ambient: light.uAmb.value},
});
pond.surface.geometry.dispose();
pond.surface.geometry = waterGeometry;
const pondSettings = {...createBenchPondSettings(), foam: 0, foamFeather: .7, speed: 1, waveTime: 0, freezeProgress: 0, diveHeight: -1.2};
pondSettings.planarReflection.on = false;
let diving = false;
const aboveWater = new THREE.Vector3();
const diveX = -8, diveZ = 4;
const diveTargetX = -4, diveTargetZ = 5;
const pondRay = new THREE.Raycaster(), pointer = new THREE.Vector2();
const wetAt = (x, z) => (field.heightAt(x, z) ?? Infinity) < appearance.waterLevel.value;
const rippleGesture = bindRippleGesture(renderer.domElement, controls, event => {
 if (diving || !pond.surface.visible || freeze.progress === 1) return;
 const rect = renderer.domElement.getBoundingClientRect();
 pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
 pondRay.setFromCamera(pointer, camera);
 const hit = pondRay.intersectObject(pond.surface)[0]?.point;
 return hit && wetAt(hit.x, hit.z) ? hit : undefined;
}, ({x, z}, strength) => {
 if (!pond.surface.visible || freeze.progress >= 1 || !wetAt(x, z)) return;
 if (!ripples.active) ripples.mask(wetAt);
 ripples.splash(x, z, 1.6 * strength);
});

function stampDemo() {
 for (const side of [-1, 1]) {
  const point = i => ({x: -8 + i * .74, z: 14 + Math.sin(i * .12) * 1.8 + side * .65});
  for (let i = 0; i < 28; i++) tracks.stamp(point(i), point(i + 1), .32);
 }
}
const gui = new GUI({title: 'Terrain material'});
const controlsState = {blendObjects: true, water: true, wetPreview: false};
const meadow = createFreeVegetation({meadowBlades: true});
const cover = {grass: 1, rock: 0, snow: 0, mud: 0, forest: .24, patchiness: .85, patchSize: 5};
const patchNoise = valueNoise(23);
const meadowGreen = new THREE.Color('#50762e'), meadowDry = new THREE.Color('#c2aa61'), meadowTint = new THREE.Color();
let terrainGrass, grassDirty = false;
function rebuildGrass() {
 terrainGrass?.dispose();
 const random = seededRandom(41), placements = [];
 for (let i = 0; i < 14000; i++) {
  const x = (random() - .5) * span, z = (random() - .5) * span;
  const chance = random(), yaw = random() * Math.PI * 2, variation = random();
  const y = field.heightAt(x, z);
  if (controlsState.water && y < appearance.waterLevel.value + .06) continue;
  let density = 0, strongest = -1, dominant = 'grass';
  for (let layer = 0; layer < TERRAIN_LAYERS.length; layer++) {
   const weight = field.layerWeightAt(x, z, layer), name = TERRAIN_LAYERS[layer];
   density += weight * cover[name];
   if (weight > strongest) { strongest = weight; dominant = name; }
  }
  if (cover[dominant] === 0) continue;
  const patch = THREE.MathUtils.smoothstep(patchNoise(x / cover.patchSize, z / cover.patchSize), -.5, .5);
  if (chance >= density * (1 - cover.patchiness * patch)) continue;
  const dry = Math.max(patch, field.layerWeightAt(x, z, TERRAIN_LAYERS.indexOf('mud')));
  meadowTint.lerpColors(meadowGreen, meadowDry, dry);
  const scale = THREE.MathUtils.lerp(.4, 1.75, .7 * (1 - dry) + .3 * variation);
  placements.push({x, y: y - .02, z, yaw, scale, tint: meadowTint.toArray()});
 }
 terrainGrass = createGrassField({scene, geometries: meadow.grassGeometries, map: meadow.atlas, color: 0xffffff,
  placements, tileSize: 6, flatColorMix: .75, contactTracks: tracks, followTracks: true});
 grassDirty = false;
}
rebuildGrass();
const impacts = createTerrainImpacts({scene, field, tracks, material: rockMaterial, ice, lightOccluders,
 onIceBreak(x, y, z, energy) {
  const strength = THREE.MathUtils.clamp(energy / 2400, .55, 1);
  spray.emitSplash(x, y, z, strength, 1.55, 1.75, null, 360, 8, false, {size: 2.5, height: 3.3});
  spray.mist(splashPosition.set(x, y + .5, z), strength, 1.25);
  if (!ripples.active) ripples.mask(wetAt);
  ripples.splash(x, z, strength * 2);
 }});
const impactSettings = {surface: 'mud', preview: false};
const impactControls = gui.addFolder('Rolling and impact');
impactControls.add(impactSettings, 'surface', ['mud', 'snow']).name('Impact surface').onChange(surface => {
 impactSettings.preview = true;
 if (impacts.setSurface(surface)) { bedHeight.needsUpdate = true; rebuildGrass(); }
 weather.view.sun.shadow.needsUpdate = true;
});
function launch(kind) {
 impactSettings.preview = true;
 impacts.launch(kind, impactSettings.surface);
}
impactControls.add({roll: () => launch('sphere')}, 'roll').name('Roll a boulder');
impactControls.add({drop: () => launch('box')}, 'drop').name('Drop a block');
impactControls.add({reset: () => {
 if (impacts.reset()) { bedHeight.needsUpdate = true; rebuildGrass(); }
 spray.clear();
 weather.view.sun.shadow.needsUpdate = true;
}}, 'reset').name('Reset impacts and tracks');
gui.add(controlsState, 'blendObjects').name('Blend boulder bases').onChange(value => rocks.forEach(rock => { rock.material = value ? rockMaterial : plainRock; }));
gui.add(controlsState, 'wetPreview').name('Rain wetness preview');
const automatic = gui.addFolder('Automatic layers');
for (const [key, min, max, step] of [['rockSlope', .2, 2, .05], ['snowLine', -2, 22, .5], ['mudBelow', -3, 6, .1]]) {
 automatic.add(rules, key, min, max, step).onFinishChange(() => { field.updateRules(rules); rebuildGrass(); });
}
automatic.add(rules, 'forestCover', 0, 1, .01).name('Forest floor coverage').onFinishChange(() => { field.updateRules(rules); rebuildGrass(); });
const groundCover = gui.addFolder('Grass cover');
for (const [layer, label] of [['grass', 'Meadow'], ['mud', 'Mud'], ['forest', 'Forest floor'], ['rock', 'Rock'], ['snow', 'Snow']]) {
 groundCover.add(cover, layer, 0, 1, .01).name(label + ' density').onFinishChange(rebuildGrass);
}
groundCover.add(cover, 'patchiness', 0, 1, .01).name('Patch contrast').onFinishChange(rebuildGrass);
groundCover.add(cover, 'patchSize', 2, 15, .5).name('Patch size · m').onFinishChange(rebuildGrass);
const textures = gui.addFolder('Triplanar textures');
textures.add(appearance.rockScale, 'value', .15, 1.2, .01).name('Rock tiling');
for (const [key, min, max, step] of [['tiling', .1, 2, .05], ['sharpness', 1, 8, .25], ['antiTiling', 0, 1, .05], ['detailStrength', 0, 2, .05], ['heightBlend', 0, 1, .05]]) {
 textures.add(appearance[key], 'value', min, max, step).name(key);
}
const waterControls = gui.addFolder('Water');
waterControls.add(controlsState, 'water').name('Show pond').onChange(rebuildGrass);
waterControls.add(appearance.waterLevel, 'value', -2, maxWaterLevel, .05).name('Water level · m').onFinishChange(rebuildGrass);
waterControls.add(pondSettings, 'foam', 0, 1, .05).name('Shore foam');
waterControls.add(pondSettings, 'foamFeather', 0, 1, .05).name('Foam feather');
pondWindControls(waterControls.addFolder('Wind ripples'), pondSettings.windWaves);
waterMaterialControls(waterControls, pondSettings);
const viewControls = waterControls.addFolder('View');
const diveControl = viewControls.add({toggleUnderwater: () => setDiving(!diving)}, 'toggleUnderwater').name('Underwater view');
const diveHeight = viewControls.add(pondSettings, 'diveHeight', -2.4, .25, .01).name('Eye above water · m').disable();
function setDiving(enabled) {
 rippleGesture.cancel();
 diving = enabled;
 controls.enabled = !enabled;
 if (enabled) aboveWater.copy(camera.position);
 else { camera.position.copy(aboveWater); controls.update(); }
 diveHeight.enable(enabled);
 diveControl.name(enabled ? 'Return above water' : 'Underwater view');
}
waterFreezeControls(waterControls.addFolder('Freeze and thaw'), freeze);
const iceControls = waterControls.addFolder('Ice impacts');
function dropOnIce(hard) {
 impacts.launch('box', impactSettings.surface, {hard, level: appearance.waterLevel.value});
}
iceControls.add({slide: () => dropOnIce(false)}, 'slide').name('Slide a block on ice');
iceControls.add({crack: () => dropOnIce(true)}, 'crack').name('Drop a block hard');
iceControls.add({repair: () => ice.clear()}, 'repair').name('Clear ice damage');
const iceLook = waterControls.addFolder('Ice material').close();
iceLook.addColor(ice.material, 'color').name('Ice color');
iceLook.add(ice.material, 'roughness', .05, 1, .01).name('Roughness');
iceLook.add(ice.material, 'clearcoat', 0, 1, .01).name('Gloss coat');
iceLook.add(ice.material, 'bumpScale', 0, .12, .005).name('Frost relief');
const shoreline = gui.addFolder('Shoreline');
shoreline.add(appearance.shoreWidth, 'value', 0, 2, .05).name('Wet band · m');
shoreline.add(appearance.shoreWetness, 'value', 0, 1, .05).name('Water wetness');
gui.add({stampDemo}, 'stampDemo').name('Lay tracks');
gui.add(tracks, 'clear').name('Clear tracks');
const weatherUI = weatherFolder(gui, weather);
const profiling = gui.addFolder('Performance');
const performanceSettings = {skyInterval: 1.25, pixelRatio: renderer.getPixelRatio(), cloudShadows: true};
profiling.add(performanceSettings, 'skyInterval', [.35, 1.25, 8]).name('Sky refresh · s').onChange(value => weather.view.configure({sky: {captureInterval: value}}));
profiling.add(performanceSettings, 'pixelRatio', [.75, 1, 1.25]).name('Render pixel ratio').onChange(value => renderer.setPixelRatio(value));
profiling.add(performanceSettings, 'cloudShadows').name('Cloud shadows').onChange(enabled => weather.view.configure({appearance: {cloudShadowStrength: enabled ? 1 : 0}}));
const benchmarkResult = document.getElementById('benchmark-result');
let benchmark;
profiling.add({run() {
 benchmark = {start: undefined, frames: [], ratio: renderer.getPixelRatio()};
 benchmarkResult.hidden = false;
 benchmarkResult.textContent = 'Measuring the current view for 5 seconds…';
}}, 'run').name('Run 5-second benchmark');
profiling.close();

function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
addEventListener('resize', resize);
const frameRate = document.getElementById('frame-rate');
let last, measuredSince, frames = 0;
const lastSun = new THREE.Vector3(Infinity, Infinity, Infinity);
let wasMoving = false;
renderer.setAnimationLoop(now => {
 if (document.hidden) {
  last = measuredSince = undefined; frames = 0;
  if (benchmark) { benchmark = undefined; benchmarkResult.textContent = 'Benchmark canceled when the tab was hidden.'; }
  return;
 }
 measuredSince ??= now;
 if (now - measuredSince >= 1000) {
  const frameTime = (now - measuredSince) / frames;
  frameRate.textContent = `${Math.round(1000 / frameTime)} fps · ${frameTime.toFixed(1)} ms/frame`;
  measuredSince = now;
  frames = 0;
 }
 frames++;
 if (benchmark) {
  if (benchmark.start === undefined) benchmark.start = now;
  else if (last !== undefined) benchmark.frames.push(now - last);
  if (now - benchmark.start >= 5000) {
   const sorted = benchmark.frames.sort((a, b) => a - b);
   const p95 = sorted[Math.ceil(sorted.length * .95) - 1];
   const fps = sorted.length * 1000 / (now - benchmark.start);
   benchmarkResult.textContent = `${fps.toFixed(1)} fps average · ${p95.toFixed(1)} ms p95 · ${benchmark.ratio} pixel ratio`;
   benchmark = undefined;
  }
 }
 const dt = last === undefined ? 0 : Math.min(.05, (now - last) / 1000);
 last = now;
 if (!diving) controls.update();
 weather.system.update(dt);
 weather.view.update(dt);
 weatherUI.sync();
 if (impactSettings.preview) {
  surfaceWeather.set({wetness: impactSettings.surface === 'mud' ? .38 : .08, snow: impactSettings.surface === 'snow' ? .95 : 0});
  surfaceWeather.update(dt, null);
 }
 else if (controlsState.wetPreview) { surfaceWeather.set({wetness: 1, snow: 0}); surfaceWeather.update(dt, null); }
 else surfaceWeather.update(dt, weather.system.weather);
 pondSettings.freezeProgress = freeze.update(dt, weather.system.weather.temperature);
 const bedChanged = impacts.update(dt, controlsState.water ? freeze.progress : 0, appearance.waterLevel.value);
 if (bedChanged) { bedHeight.needsUpdate = true; grassDirty = true; }
 if (grassDirty && !impacts.moving) rebuildGrass();
 const wind = weather.system.weather, heading = THREE.MathUtils.degToRad(wind.windHeading);
 terrainGrass.update(dt, {camera, windX: Math.cos(heading) * wind.wind, windZ: Math.sin(heading) * wind.wind,
  gust: .4, transmission: 1.45 * weather.system.day.daylight, lodDistance: 22, farDensity: .45, shadowDistance: 0, density: 1});
 const moving = impacts.moving, sun = weather.view.sun;
 if (moving || wasMoving || !lastSun.equals(sun.position)) sun.shadow.needsUpdate = true;
 wasMoving = moving;
 lastSun.copy(sun.position);
 if (ripples.active && (bedChanged || pond.surface.position.y !== appearance.waterLevel.value)) ripples.mask(wetAt);
 pond.surface.position.y = appearance.waterLevel.value;
 pond.surface.visible = controlsState.water;
 const diveFloor = field.heightAt(diveX, diveZ);
 const waterLevel = pond.surface.position.y;
 waterPlane.w = -waterLevel;
 const canDive = pond.surface.visible && waterLevel - diveFloor > .55;
 if (!canDive && diving) setDiving(false);
 diveControl.enable(canDive);
 if (diving) {
  const eye = Math.max(diveFloor + .3, waterLevel + pondSettings.diveHeight);
  camera.position.set(diveX, eye, diveZ);
  camera.lookAt(diveTargetX, Math.min(waterLevel - .2, field.heightAt(diveTargetX, diveTargetZ) + .18), diveTargetZ);
 }
 if (!pond.surface.visible || freeze.progress >= 1) rippleGesture.cancel();
 rippleGesture.update(dt);
 if (freeze.progress < 1 || ice.active.value) {
  pondSettings.waveTime += dt;
  ripples.update(dt);
 }
 pond.render(pondSettings.waveTime, pondSettings);
 spray.update(dt);
 if (diving) {
  waterline.render(scene, camera, {height: waterLevel, clarity: pondSettings.clarity, godRays: pondSettings.godRays,
   sunDirection: light.uSkySun.value, sunColor: light.uSunCol.value, ambientColor: light.uAmb.value});
 } else weather.view.render();
 const {droplets, mist} = spray.active;
 if (pond.surface.visible && (droplets > 0 || mist > 0)) {
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  try { renderer.render(sprayScene, camera); }
  finally { renderer.autoClear = autoClear; }
 }
});
addEventListener('pagehide', event => {
 if (event.persisted) return;
 renderer.setAnimationLoop(null);
 removeEventListener('resize', resize);
 weather.view.dispose();
 rippleGesture.dispose();
 controls.dispose();
 gui.destroy();
 impacts.dispose();
 spray.dispose();
 pond.dispose();
 waterline.dispose();
 ice.dispose();
 freezeMap.dispose();
 ripples.dispose();
 flow.dispose();
 field.dispose();
 terrainGrass.dispose();
 meadow.grassGeometries.forEach(geometry => geometry.dispose());
 meadow.dispose();
 tracks.dispose();
 for (const resource of [...Object.values(layers), detail, groundMaterial, rockMaterial, plainRock, rockGeometry]) resource.dispose();
 renderer.dispose();
}, {once: true});
