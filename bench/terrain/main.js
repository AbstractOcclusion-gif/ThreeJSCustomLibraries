import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createTerrainAppearance, createTerrainField, createTerrainMaterial} from '../../src/terrain/index.js';
import {createSurfaceWeather, createTrackMask} from '../../src/surface/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, bindResize, onLeave} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import {aimRay} from '../kit/input.js';
import {loadTerrainTextures} from './textures.js';
import {terrainControls} from './controls.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const TRACK_RADIUS = .65;   // metres painted per stroke
const renderer = benchRenderer(); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 400);
camera.position.set(13, 5.5, 16);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49; controls.update();

// Same height field the vegetation bench grew on: gentle hills, 128 m square.
const resolution = 129, span = 128, half = span / 2;
// Standalone: the basic stage gives sky, sun and ambient light; the terrain is the ground.
const stage = createBasicStage({scene, ground: false, shadows: true, shadowExtent: half});
const heights = Float32Array.from({length: resolution ** 2}, (_, index) => {
  const x = index % resolution - half, z = Math.floor(index / resolution) - half;
  return Math.sin(x * .11) * Math.cos(z * .09) * 1.6 + Math.sin(x * .031 + z * .05) * .8;
});
const rules = {rockSlope: 1, snowLine: 22, mudBelow: -.55, mudBlend: 1.2, forestCover: 0};
const field = createTerrainField({origin: [-half, -half], size: [span, span], resolution: [resolution, resolution], heights, rules});
const {layerArray, detail, rock} = await loadTerrainTextures(renderer);
const appearance = createTerrainAppearance();
appearance.shoreWetness.value = 0;   // no water on this page
const surfaceWeather = createSurfaceWeather();
const tracks = createTrackMask({origin: [-half, -half], size: [span, span], resolution: 512, directional: true});
const groundMaterial = createTerrainMaterial({}, {field, layerArray, detailNormal: detail, appearance, weather: surfaceWeather, tracks, trackContrast: .5});
const ground = new THREE.Mesh(field.geometry, groundMaterial);
ground.receiveShadow = true;
scene.add(ground);

// Surface: manual wetness and snow (no weather here), tracks painted with the pointer.
const surface = {wetness: 0, snow: 0, paintTracks: false};
const applySurface = () => surfaceWeather.set(surface);
const gui = createBenchPanel('Terrain');
stageControls(gui, stage, {wind: false});
terrainControls(gui, {rules, appearance, onLayersChanged() { field.updateRules(rules); }});
const surfaceFolder = gui.addFolder('Surface');
surfaceFolder.add(surface, 'wetness', 0, 1, .01).name('Wetness and puddles').onChange(applySurface);
surfaceFolder.add(surface, 'snow', 0, 1, .01).name('Snow cover').onChange(applySurface);
surfaceFolder.add(surface, 'paintTracks').name('Paint tracks (drag)').onChange(on => { controls.enabled = !on; lastTrackPoint = undefined; });
surfaceFolder.add({clear: () => tracks.clear()}, 'clear').name('Clear tracks');

const raycaster = new THREE.Raycaster(), canvas = renderer.domElement, trackEvents = new AbortController();
let lastTrackPoint;
function paintTrack(event) {
  if (!surface.paintTracks || !(event.buttons & 1)) { lastTrackPoint = undefined; return; }
  aimRay(raycaster, event, canvas, camera);
  const hit = raycaster.intersectObject(ground)[0]?.point;
  if (hit) tracks.stamp(lastTrackPoint ?? hit, hit, TRACK_RADIUS);
  lastTrackPoint = hit;
}
for (const type of ['pointerdown', 'pointermove']) canvas.addEventListener(type, paintTrack, {signal: trackEvents.signal});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) canvas.addEventListener(type, () => { lastTrackPoint = undefined; }, {signal: trackEvents.signal});

const unbindResize = bindResize(renderer, camera);
let last = null, lastUI = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  controls.update(); stage.update(camera);
  surfaceWeather.update(dt, null);   // null: keeps the manual levels, still animates the rain streaks
  renderer.render(scene, camera);
  if (now - lastUI > 250) { lastUI = now; $('status').textContent = `${span} m square · ${resolution}² heights\nwetness ${surface.wetness.toFixed(2)} · snow ${surface.snow.toFixed(2)}`; }
});
document.body.dataset.ready = 'true';
window.terrainBench = {field, rules, appearance, surfaceWeather, tracks, stage, scene, camera, renderer};
onLeave(() => {
  renderer.setAnimationLoop(null); unbindResize(); trackEvents.abort();
  tracks.dispose(); field.dispose(); groundMaterial.dispose(); layerArray.dispose(); detail.dispose(); rock.dispose();
  stage.dispose(); controls.dispose(); gui.destroy(); renderer.dispose();
});
