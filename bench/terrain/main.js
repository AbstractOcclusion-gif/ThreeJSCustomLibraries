import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createSnowLook, createTerrainAppearance, createTerrainDrainage, createTerrainField, createTerrainMaterial, SNOW_DEPTH_SCALE} from '../../src/terrain/index.js';
import {createSurfaceLook, createSurfaceWeather, createTrackMask} from '../../src/surface/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import {aimRay} from '../kit/input.js';
import {loadTerrainTextures} from './textures.js';
import {snowBodyControls, snowLookControls, snowTrackControls, terrainControls, wetnessControls} from './controls.js';
import {createTerrainRunoff} from '../../src/terrain/runoff.js';
import {createTerrainBasins} from './basins.js';
import {FOOTSTEP_DEFAULTS, stampFootstepTrail} from './footsteps.js';
import {CONTACT_SURFACES, createTerrainImpacts} from './impacts.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const TERRAIN = {span: 64, resolution: 257};
const RELIEF = {ridgeHeight: 4.2, ridgeFrequency: [.14, .12], hillHeight: 2, hillFrequency: [.055, .07]};
const SNOW_MELT = {metresPerSecond: .025, updateInterval: .3, bakeInterval: 1.5, runoffShare: .7};
// depth (m) digs bare ground; load is the share of the packable snow depth pressed out when snow lies.
const TRACK = {radius: .8, spacing: .28, depth: .11, load: .85, contrast: .5, maskResolution: 512};
const PUDDLE = {maxDepth: .32}; // m, deepest a filled hollow may stand
const WET_TRACK_BAKE_INTERVAL = 1.25; // seconds between flow-map refreshes while the ball rolls
const FOOTSTEP_DEMO = {from: {x: 11, z: 11}, to: {x: 2, z: 4}};
const BOULDER = {radius: 1.25, detail: 2, contactBand: .65, roughness: .87};
const SNOW_CAP = {edgeHeight: .44, fullHeight: .78, thickness: .22, color: '#e4edf2', roughness: .83};
const BOULDERS = [
  {x: -4, z: 3, scale: [1.4, .8, 1], yaw: .6},
  {x: 4, z: -3, scale: [1, .64, 1.3], yaw: 1.9},
  {x: -10, z: -7, scale: [1.7, 1.2, 1.1], yaw: 2.5},
  {x: 9, z: 7, scale: [.8, .6, .7], yaw: .3},
];
const renderer = benchRenderer(); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 400);
camera.position.set(13, 5.5, 16);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49; controls.update();

const {span, resolution} = TERRAIN;
const half = span / 2, sampleSpacing = span / (resolution - 1);
// Standalone: the basic stage gives sky, sun and ambient light; the terrain is the ground.
const stage = createBasicStage({scene, ground: false, shadows: true, shadowExtent: half});
const basins = createTerrainBasins((x, z) => {
  const [ridgeX, ridgeZ] = RELIEF.ridgeFrequency;
  const [hillX, hillZ] = RELIEF.hillFrequency;
  return Math.sin(x * ridgeX) * Math.cos(z * ridgeZ) * RELIEF.ridgeHeight
    + Math.sin(x * hillX + z * hillZ) * RELIEF.hillHeight;
});
const heights = Float32Array.from({length: resolution ** 2}, (_, index) => {
  const x = (index % resolution) * sampleSpacing - half;
  const z = Math.floor(index / resolution) * sampleSpacing - half;
  return basins.heightAt(x, z);
});
const rules = {rockSlope: 1, snowLine: 22, mudBelow: -.55, mudBlend: 1.2, forestCover: 0};
const field = createTerrainField({origin: [-half, -half], size: [span, span], resolution: [resolution, resolution], heights, rules, snowTrackRims: true});
// Live copies of the defaults, edited from the panel.
const paint = {radius: TRACK.radius, depth: TRACK.depth, load: TRACK.load};
const footstep = {...FOOTSTEP_DEFAULTS};
const contactSurfaces = structuredClone(CONTACT_SURFACES);
const melt = {metresPerSecond: SNOW_MELT.metresPerSecond};
const puddle = {...PUDDLE};
const surfaceLook = createSurfaceLook();
const drainage = createTerrainDrainage(field, {maxPuddleDepth: puddle.maxDepth});
let drainageDirty = false, meltDrainageDirty = false, meltFlowDirty = false, meltBakeElapsed = 0;
let rollingBakeElapsed = 0;
const {layerArray, detail, rock, snowMaterial} = await loadTerrainTextures(renderer, {snowDetail: true});
const appearance = createTerrainAppearance();
appearance.shoreWetness.value = 0;   // each puddle has its own local fill level
const surfaceWeather = createSurfaceWeather();
const tracks = createTrackMask({origin: [-half, -half], size: [span, span], resolution: TRACK.maskResolution, directional: true});
const runoff = createTerrainRunoff({field, drainage, tracks});
const rainAmount = {value: 0};
const rills = {value: 1};
const puddleFill = {value: 0};
const snowLook = createSnowLook();
const terrainMaterialOptions = {field, layerArray, detailNormal: detail, appearance, weather: surfaceWeather, snowMaterial, snowLook, rainAmount, look: surfaceLook};
const groundMaterial = createTerrainMaterial({}, {
  ...terrainMaterialOptions, tracks, trackContrast: TRACK.contrast,
  drainage: {texture: drainage.texture, fill: puddleFill},
  runoffTexture: runoff.texture,
  runoffFilm: {texture: runoff.film, coverage: runoff.coverage},
  puddleSky: stage.skyUniforms,
});
const ground = new THREE.Mesh(field.geometry, groundMaterial);
ground.receiveShadow = true;
scene.add(ground);

const boulderGeometry = new THREE.DodecahedronGeometry(BOULDER.radius, BOULDER.detail);
// Keep the original rock triangles under the cap. The outer surface rejoins
// the rock where all three vertices have zero snow depth.
function createSnowCapGeometry(rockGeometry, depthScale) {
  const positions = rockGeometry.getAttribute('position');
  const vertices = [];
  const triangle = Array.from({length: 3}, () => new THREE.Vector3());
  for (let start = 0; start < positions.count; start += triangle.length) {
    let covered = false;
    for (const [offset, vertex] of triangle.entries()) {
      vertex.fromBufferAttribute(positions, start + offset);
      const depth = SNOW_CAP.thickness * depthScale * THREE.MathUtils.smoothstep(
        vertex.y / BOULDER.radius, SNOW_CAP.edgeHeight, SNOW_CAP.fullHeight,
      );
      if (depth > 0) {
        covered = true;
        vertex.setLength(vertex.length() + depth);
      }
    }
    if (covered) for (const {x, y, z} of triangle) vertices.push(x, y, z);
  }

  const triangles = new THREE.BufferGeometry();
  triangles.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const cap = mergeVertices(triangles);
  triangles.dispose();
  cap.computeVertexNormals();
  return cap;
}
let snowCapGeometry = createSnowCapGeometry(boulderGeometry, SNOW_DEPTH_SCALE.initial);
const snowCapMaterial = createTerrainMaterial({color: SNOW_CAP.color, roughness: SNOW_CAP.roughness}, {
  ...terrainMaterialOptions, contactBand: 0, puddles: 0,
});
// The physical cap owns the boulder's snow coverage.
const rockWeather = createSurfaceWeather();
const boulderMaterial = createTerrainMaterial({map: rock, roughness: BOULDER.roughness}, {
  ...terrainMaterialOptions, weather: rockWeather, contactBand: BOULDER.contactBand, puddles: 0,
});
const impacts = createTerrainImpacts({scene, field, tracks, material: boulderMaterial, surfaces: contactSurfaces});
const snowCaps = [];
for (const {x, z, scale, yaw} of BOULDERS) {
  const boulder = new THREE.Mesh(boulderGeometry, boulderMaterial);
  boulder.position.set(x, field.heightAt(x, z), z);
  boulder.scale.set(...scale);
  boulder.rotation.y = yaw;
  boulder.castShadow = boulder.receiveShadow = true;
  const snowCap = new THREE.Mesh(snowCapGeometry, snowCapMaterial);
  snowCap.visible = false;
  snowCap.castShadow = snowCap.receiveShadow = true;
  boulder.add(snowCap);
  snowCaps.push(snowCap);
  scene.add(boulder);
}

// Surface: manual wetness and snow (no weather here), tracks painted with the pointer.
const surfaceWater = createSurfaceWeather();
const surface = {wetness: 0, puddles: 0, snow: false, melt: 0, snowDepth: SNOW_DEPTH_SCALE.initial, paintTracks: false};
let capMeltShare = 1, meltDepth = 0, meltElapsed = 0;
function resizeSnowCaps() {
  const previous = snowCapGeometry;
  snowCapGeometry = createSnowCapGeometry(boulderGeometry, surface.snowDepth * capMeltShare);
  for (const cap of snowCaps) cap.geometry = snowCapGeometry;
  previous.dispose();
  stage.sun.shadow.needsUpdate = true;
}
function applySurface() {
  surfaceWeather.set({wetness: surface.wetness, snow: Number(surface.snow)});
  if (surface.snow !== field.snowCover.value && impacts.setSurface(surface.snow ? 'snow' : 'mud')) {
    drainageDirty = true;
    if (surface.snow) resizeSnowCaps();
  }
  rockWeather.set({wetness: surface.wetness});
  for (const cap of snowCaps) cap.visible = surface.snow;
  stage.sun.shadow.needsUpdate = true;
}
const gui = createBenchPanel('Terrain');
stageControls(gui, stage, {wind: false});
terrainControls(gui, {rules, appearance, onLayersChanged() { field.updateRules(rules); }});
const surfaceFolder = gui.addFolder('Surface');
surfaceFolder.add(surface, 'wetness', 0, 1, .01).name('Ground wetness').onChange(applySurface);
surfaceFolder.add(surface, 'snow').name('3D snow cover').listen().onChange(applySurface);
surfaceFolder.add(surface, 'snowDepth', SNOW_DEPTH_SCALE.min, SNOW_DEPTH_SCALE.max, .05)
  .name('Snow depth ×').onFinishChange(scale => {
    if (field.setSnowDepthScale(scale, impacts.onHeightSample)) drainageDirty = true;
    resizeSnowCaps();
  });
surfaceFolder.add(surface, 'paintTracks').name('Paint tracks (drag)').onChange(on => { controls.enabled = !on; endStroke(); });
function enableTestSnow() {
  if (surface.snow) return;
  surface.snow = true;
  applySurface();
}
surfaceFolder.add({roll() {
  enableTestSnow();
  impacts.launch('sphere', 'snow');
}}, 'roll').name('Roll ball in snow');
surfaceFolder.add({walk() {
  enableTestSnow();
  stampFootstepTrail({field, tracks, ...FOOTSTEP_DEMO, onSample: impacts.onHeightSample, step: footstep});
}}, 'walk').name('Stamp footsteps in snow');
function resetTerrain() {
  endStroke();
  if (impacts.reset()) drainageDirty = true;
  capMeltShare = 1;
  meltDepth = meltElapsed = 0;
  if (surface.snow) resizeSnowCaps();
  stage.sun.shadow.needsUpdate = true;
}
surfaceFolder.add({clear: resetTerrain}, 'clear').name('Reset tracks and terrain');
snowLookControls(gui, snowLook);
snowBodyControls(gui, {field, onRelay: resetTerrain});
snowTrackControls(gui, {field, paint, footstep, contact: contactSurfaces.snow});
const rainFolder = gui.addFolder('Rain and runoff');
rainFolder.add(surface, 'melt', 0, 1, .05).name('Snow melt');
rainFolder.add(rainAmount, 'value', 0, 1, .05).name('Rain on surfaces');
rainFolder.add(rills, 'value', 0, 1, .05).name('Downhill runoff');
rainFolder.add(surface, 'puddles', 0, 1, .05).name('Puddle fill');
wetnessControls(gui, {
  look: surfaceLook, rates: surfaceWater.rates, melt, puddle,
  onPuddleDepth(maxPuddleDepth) { drainage.rebuild({maxPuddleDepth}); },
});

const raycaster = new THREE.Raycaster(), canvas = renderer.domElement, trackEvents = new AbortController();
let lastTrackPoint;
let distanceToStamp = TRACK.spacing;
function endStroke() {
  lastTrackPoint = undefined;
  distanceToStamp = TRACK.spacing;
}
function pressTrack(x, z) {
  if (field.snowCover.value) field.compactSnow(x, z, paint.radius, paint.load, impacts.onHeightSample);
  else field.deform(x, z, paint.radius, paint.depth, impacts.onHeightSample);
}
function paintTrack(event) {
  if (!surface.paintTracks || !(event.buttons & 1)) {
    endStroke();
    return;
  }
  aimRay(raycaster, event, canvas, camera);
  const hit = raycaster.intersectObject(ground)[0]?.point;
  if (!hit) {
    endStroke();
    return;
  }

  tracks.stamp(lastTrackPoint ?? hit, hit, paint.radius);
  if (!lastTrackPoint) {
    pressTrack(hit.x, hit.z);
  } else {
    const dx = hit.x - lastTrackPoint.x, dz = hit.z - lastTrackPoint.z;
    const length = Math.hypot(dx, dz);
    for (; distanceToStamp <= length; distanceToStamp += TRACK.spacing) {
      const fraction = distanceToStamp / length;
      pressTrack(lastTrackPoint.x + dx * fraction, lastTrackPoint.z + dz * fraction);
    }
    distanceToStamp -= length;
  }
  lastTrackPoint = hit;
}
for (const type of ['pointerdown', 'pointermove']) canvas.addEventListener(type, paintTrack, {signal: trackEvents.signal});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) canvas.addEventListener(type, endStroke, {signal: trackEvents.signal});

const unbindResize = bindResize(renderer, camera);
let lastUI = 0;
function updateMelt(dt) {
  if (!surface.snow || surface.melt <= 0) return 0;
  const supply = surface.melt * SNOW_MELT.runoffShare;
  if (lastTrackPoint) return supply;
  meltElapsed += dt;
  meltDepth += dt * surface.melt * melt.metresPerSecond;
  if (meltElapsed >= SNOW_MELT.updateInterval) {
    const result = field.meltSnow(meltDepth, impacts.onHeightSample);
    meltDepth = meltElapsed = 0;
    if (result?.removed > 0) {
      field.flushDeformation();
      stage.sun.shadow.needsUpdate = true;
      meltDrainageDirty = meltFlowDirty = true;
      if (result.remaining > 0) {
        capMeltShare *= result.remaining / (result.remaining + result.removed);
        resizeSnowCaps();
      } else {
        surface.snow = false;
        capMeltShare = 1;
        applySurface();
      }
    }
  }
  return surface.snow ? supply : 0;
}

startFrameLoop(renderer, (dt, now) => {
  if (impacts.update(dt)) {
    stage.sun.shadow.needsUpdate = true;
    drainageDirty = true;
  }
  const meltSupply = updateMelt(dt);
  if (meltDrainageDirty) meltBakeElapsed += dt;
  const meltNeedsBake = meltDrainageDirty && (!meltSupply || meltBakeElapsed >= SNOW_MELT.bakeInterval);
  const meltFlowNeedsBake = meltFlowDirty && !meltSupply;
  const rolling = impacts.moving;
  const hasWater = rainAmount.value > 0 || meltSupply > 0 || puddleFill.value > 0;
  if (rolling && drainageDirty && hasWater) rollingBakeElapsed += dt;
  else rollingBakeElapsed = 0;
  if (!lastTrackPoint && (!rolling || rollingBakeElapsed >= WET_TRACK_BAKE_INTERVAL)) {
    if (drainageDirty || meltNeedsBake) {
      drainage.rebuild();
      meltDrainageDirty = false;
      meltBakeElapsed = 0;
    }
    // Keep the channels steady while snow is thinning. Refresh their routes
    // after the melt stops, or immediately after a track changes the bed.
    if (drainageDirty || meltFlowNeedsBake) {
      runoff.rebuild();
      meltFlowDirty = false;
    }
    drainageDirty = false;
    rollingBakeElapsed = 0;
  }
  controls.update(); stage.update(camera);
  const waterSupply = Math.min(1, rainAmount.value + meltSupply);
  surfaceWater.update(dt, {rain: waterSupply});
  const water = surfaceWater.levels.value.x;
  const wetness = Math.max(surface.wetness, water);
  surfaceWeather.set({wetness});
  rockWeather.set({wetness});
  surfaceWeather.update(dt, null);
  rockWeather.update(dt, null);
  puddleFill.value = Math.min(1, surface.puddles + water);
  runoff.update(dt, {supply: waterSupply, wetness: water, amount: rills.value, puddleFill: puddleFill.value});
  renderer.render(scene, camera);
  if (now - lastUI > STATUS_REFRESH_MS) { lastUI = now; $('status').textContent = `${span} m square · ${resolution}² heights\nwetness ${wetness.toFixed(2)} · snow ${surface.snow ? 'on' : 'off'}`; }
});
document.body.dataset.ready = 'true';
window.terrainBench = {field, rules, appearance, surfaceWeather, tracks, drainage, impacts, rainAmount, rills, puddleFill, stage, scene, camera, renderer};
onLeave(() => {
  renderer.setAnimationLoop(null); unbindResize(); trackEvents.abort();
  snowMaterial.normal.dispose(); snowMaterial.roughness.dispose();
  boulderGeometry.dispose(); boulderMaterial.dispose();
  snowCapGeometry.dispose(); snowCapMaterial.dispose();
  impacts.dispose();
  runoff.dispose();
  drainage.dispose();
  tracks.dispose(); field.dispose(); groundMaterial.dispose(); layerArray.dispose(); detail.dispose(); rock.dispose();
  stage.dispose(); controls.dispose(); gui.destroy(); renderer.dispose();
});
