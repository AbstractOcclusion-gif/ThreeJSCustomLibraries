import * as THREE from 'three';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createTerrainAppearance, createTerrainField, createTerrainMaterial, SNOW_DEPTH_SCALE} from '../../src/terrain/index.js';
import {createSurfaceWeather, createTrackMask} from '../../src/surface/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import {aimRay} from '../kit/input.js';
import {loadTerrainTextures} from './textures.js';
import {terrainControls} from './controls.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const TERRAIN = {span: 64, resolution: 257};
const RELIEF = {ridgeHeight: 4.2, ridgeFrequency: [.14, .12], hillHeight: 2, hillFrequency: [.055, .07]};
const TRACK = {radius: .8, spacing: .28, depth: .11, contrast: .5, maskResolution: 512};
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
const heights = Float32Array.from({length: resolution ** 2}, (_, index) => {
  const x = (index % resolution) * sampleSpacing - half;
  const z = Math.floor(index / resolution) * sampleSpacing - half;
  const [ridgeX, ridgeZ] = RELIEF.ridgeFrequency;
  const [hillX, hillZ] = RELIEF.hillFrequency;
  return Math.sin(x * ridgeX) * Math.cos(z * ridgeZ) * RELIEF.ridgeHeight
    + Math.sin(x * hillX + z * hillZ) * RELIEF.hillHeight;
});
const rules = {rockSlope: 1, snowLine: 22, mudBelow: -.55, mudBlend: 1.2, forestCover: 0};
const field = createTerrainField({origin: [-half, -half], size: [span, span], resolution: [resolution, resolution], heights, rules, snowTrackRims: true});
const {layerArray, detail, rock, snowMaterial} = await loadTerrainTextures(renderer, {snowDetail: true});
const appearance = createTerrainAppearance();
appearance.shoreWetness.value = 0;   // no water on this page
const surfaceWeather = createSurfaceWeather();
const tracks = createTrackMask({origin: [-half, -half], size: [span, span], resolution: TRACK.maskResolution, directional: true});
const snowTransmission = {value: .2};
snowMaterial.transmission = snowTransmission;
const terrainMaterialOptions = {field, layerArray, detailNormal: detail, appearance, weather: surfaceWeather, snowMaterial};
const groundMaterial = createTerrainMaterial({}, {...terrainMaterialOptions, tracks, trackContrast: TRACK.contrast});
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
const surface = {wetness: 0, snow: false, snowDepth: SNOW_DEPTH_SCALE.initial, paintTracks: false};
function applySurface() {
  surfaceWeather.set({wetness: surface.wetness, snow: Number(surface.snow)});
  field.setSnowCover(surface.snow);
  rockWeather.set({wetness: surface.wetness});
  for (const cap of snowCaps) cap.visible = surface.snow;
  stage.sun.shadow.needsUpdate = true;
}
const gui = createBenchPanel('Terrain');
stageControls(gui, stage, {wind: false});
terrainControls(gui, {rules, appearance, onLayersChanged() { field.updateRules(rules); }});
const surfaceFolder = gui.addFolder('Surface');
surfaceFolder.add(surface, 'wetness', 0, 1, .01).name('Wetness and puddles').onChange(applySurface);
surfaceFolder.add(surface, 'snow').name('3D snow cover').onChange(applySurface);
surfaceFolder.add(surface, 'snowDepth', SNOW_DEPTH_SCALE.min, SNOW_DEPTH_SCALE.max, .05)
  .name('Snow depth ×').onFinishChange(scale => {
    field.setSnowDepthScale(scale);
    const previous = snowCapGeometry;
    snowCapGeometry = createSnowCapGeometry(boulderGeometry, scale);
    for (const cap of snowCaps) cap.geometry = snowCapGeometry;
    previous.dispose();
    stage.sun.shadow.needsUpdate = true;
  });
surfaceFolder.add(snowTransmission, 'value', 0, 1, .01).name('Snow light transmission');
surfaceFolder.add(surface, 'paintTracks').name('Paint tracks (drag)').onChange(on => { controls.enabled = !on; endStroke(); });
surfaceFolder.add({clear() {
  endStroke();
  tracks.clear();
  field.resetDeformation();
  stage.sun.shadow.needsUpdate = true;
}}, 'clear').name('Reset tracks and terrain');

const raycaster = new THREE.Raycaster(), canvas = renderer.domElement, trackEvents = new AbortController();
let lastTrackPoint;
let distanceToStamp = TRACK.spacing;
function endStroke() {
  lastTrackPoint = undefined;
  distanceToStamp = TRACK.spacing;
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

  tracks.stamp(lastTrackPoint ?? hit, hit, TRACK.radius);
  if (!lastTrackPoint) {
    field.deform(hit.x, hit.z, TRACK.radius, TRACK.depth);
  } else {
    const dx = hit.x - lastTrackPoint.x, dz = hit.z - lastTrackPoint.z;
    const length = Math.hypot(dx, dz);
    for (; distanceToStamp <= length; distanceToStamp += TRACK.spacing) {
      const fraction = distanceToStamp / length;
      field.deform(lastTrackPoint.x + dx * fraction, lastTrackPoint.z + dz * fraction, TRACK.radius, TRACK.depth);
    }
    distanceToStamp -= length;
  }
  lastTrackPoint = hit;
}
for (const type of ['pointerdown', 'pointermove']) canvas.addEventListener(type, paintTrack, {signal: trackEvents.signal});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) canvas.addEventListener(type, endStroke, {signal: trackEvents.signal});

const unbindResize = bindResize(renderer, camera);
let lastUI = 0;
startFrameLoop(renderer, (dt, now) => {
  if (field.flushDeformation()) stage.sun.shadow.needsUpdate = true;
  controls.update(); stage.update(camera);
  surfaceWeather.update(dt, null);   // null: keeps the manual levels, still animates the rain streaks
  renderer.render(scene, camera);
  if (now - lastUI > STATUS_REFRESH_MS) { lastUI = now; $('status').textContent = `${span} m square · ${resolution}² heights\nwetness ${surface.wetness.toFixed(2)} · snow ${surface.snow ? 'on' : 'off'}`; }
});
document.body.dataset.ready = 'true';
window.terrainBench = {field, rules, appearance, surfaceWeather, tracks, stage, scene, camera, renderer};
onLeave(() => {
  renderer.setAnimationLoop(null); unbindResize(); trackEvents.abort();
  snowMaterial.normal.dispose(); snowMaterial.roughness.dispose();
  boulderGeometry.dispose(); boulderMaterial.dispose();
  snowCapGeometry.dispose(); snowCapMaterial.dispose();
  tracks.dispose(); field.dispose(); groundMaterial.dispose(); layerArray.dispose(); detail.dispose(); rock.dispose();
  stage.dispose(); controls.dispose(); gui.destroy(); renderer.dispose();
});
