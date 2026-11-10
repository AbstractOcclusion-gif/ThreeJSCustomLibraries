import {particleControls} from './controls.js';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createChips, createParticlePrefab, createPuffs, createParticleDepthBinding, createWaterSpray, OCEAN_SHEET_FILES} from '../../src/particles/index.js';
import {createEnvironment, setEnvironmentWind} from '../../src/core/index.js';
import {detectAssets} from '../kit/assets.js';
import {onLeave, bindResize, startFrameLoop} from '../kit/page.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const showError = error => { $('error').hidden = false; $('error').textContent = String(error); console.error(error); };

const renderer = new T.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
renderer.debug.onShaderError = (gl, program, v, f) => showError('Shader error: ' + gl.getProgramInfoLog(program) + ' ' + gl.getShaderInfoLog(v) + ' ' + gl.getShaderInfoLog(f));

const scene = new T.Scene(); scene.background = new T.Color(0x213343);
const camera = new T.PerspectiveCamera(44, innerWidth / innerHeight, .1, 120); camera.position.set(5, 3.2, 8);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, .8, 0); controls.enableDamping = true;
const hemi = new T.HemisphereLight(0xffffff, 0x718397, 1.6); scene.add(hemi);
const sun = new T.DirectionalLight(0xfff1dc, 2.2); sun.position.set(6, 9, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
const ground = new T.Mesh(new T.CircleGeometry(9, 48).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({color: 0x5f6b63, roughness: 1})); ground.receiveShadow = true; scene.add(ground);
scene.add(new T.GridHelper(16, 16, 0x7992a8, 0x42576a));
// A flat "water" disc at y = 0.3 on the far side: spray lands on it, chips/puffs live on the ground side.
const WATER_Y = .3, waterCentre = new T.Vector3(4.5, WATER_Y, -1);
const water = new T.Mesh(new T.CircleGeometry(3, 48).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({color: 0x2a6f8c, roughness: .15, metalness: .1, transparent: true, opacity: .85}));
water.position.copy(waterCentre); water.receiveShadow = true; scene.add(water);
const rock = new T.Mesh(new T.SphereGeometry(.45, 24, 16), new T.MeshStandardMaterial({color: 0x665d4f, roughness: .8})); rock.position.set(4.5, WATER_Y + .1, -1); rock.castShadow = true; scene.add(rock);

// Opaque pass → depth texture → composite, then the spray scene on top (what "post-composite" means for the spray stack).
let target = makeTarget(); function makeTarget() { const w = renderer.domElement.width, h = renderer.domElement.height; return new T.WebGLRenderTarget(w, h, {depthTexture: new T.DepthTexture(w, h, T.UnsignedIntType), type: T.HalfFloatType}); }
const viewport = new T.Vector2(target.width, target.height);
const blitScene = new T.Scene(), blitCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blit = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({map: target.texture, depthTest: false, depthWrite: false})); blitScene.add(blit);
const fxScene = new T.Scene();
const depth = createParticleDepthBinding({THREE: T, camera, depthTexture: target.depthTexture, viewport, softDistance: .2, waterPlane: new T.Vector4(0, 1, 0, -WATER_Y)});

const sheetsUrl = import.meta.env.BASE_URL + 'water/';
const assetBaseUrl = await detectAssets(sheetsUrl + OCEAN_SHEET_FILES['mist (8x8)'], sheetsUrl);
// No `lighting` passed: the spray owns its default light, which the optional environment below may drive.
const spray = createWaterSpray({THREE: T, scene: fxScene, renderer, depth, assets: {assetBaseUrl},
  surface: {glsl: `uniform float uOceanAmplitude; float surfaceHeightAt(vec2 xz) { return ${WATER_Y.toFixed(2)}; }`, uniforms: {uOceanAmplitude: {value: 1}}},
  onDeposit: () => {}});

const origin = new T.Vector3(-2, .12, 0), elevated = new T.Vector3(-2, 2.6, 0);
const puffs = await createPuffs(scene, {});
const fire = await createParticlePrefab(scene, 'fire', {position: origin, pool: 96});
const smoke = await createParticlePrefab(scene, 'smoke', {position: origin, pool: 96});
const dust = await createParticlePrefab(scene, 'dust', {position: origin, pool: 64});
const prefabs = [fire, smoke, dust]; const stop = () => prefabs.forEach(p => p.stop()); stop();
const chips = createChips(scene, {pool: 128}); chips.setGround(() => 0);
const fragmentMaterial = new T.MeshStandardMaterial({color: 0xef9c63}), fragmentGeometry = new T.BoxGeometry(.38, .08, .28);
const fragments = createChips(scene, {pool: 16, authored: true, material: fragmentMaterial}); fragments.setGround(() => 0);

const state = {chipColor: '#e0ae88', chipCount: 28, shock: 26, sprayLoop: false, mistSize: 1, splashStrength: .6, environment: false, windSpeed: 6, windHeading: 0, light: 1};
const environment = createEnvironment(), SUN_INTENSITY = sun.intensity, HEMI_INTENSITY = hemi.intensity;
environment.sun.direction.copy(sun.position).normalize();
function applyEnvironment() {
  const active = state.environment ? environment : null, light = state.environment ? state.light : 1;
  setEnvironmentWind(environment, state.windSpeed, state.windHeading); environment.light.setScalar(state.light);
  sun.intensity = SUN_INTENSITY * light; hemi.intensity = HEMI_INTENSITY * light;
  puffs.setEnvironment(active); prefabs.forEach(p => p.setEnvironment(active)); spray.setEnvironment(environment);
}
const fx = {
  impactDust: () => { stop(); dust.start(); }, campfire: () => { stop(); fire.start(); }, smokePlume: () => { stop(); smoke.start(); }, stopEmitters: stop,
  mortar: () => puffs.mortar(origin, 1.3),
  chips: () => chips.emit(origin, {color: new T.Color(state.chipColor).getHex(), chips: state.chipCount}, state.shock),
  fragments: () => { for (let i = 0; i < 7; i++) fragments.emitPiece(fragmentGeometry, elevated.clone().add(new T.Vector3((i - 3) * .42, 0, 0)), new T.Quaternion(), new T.Vector3((i - 3) * .5, 0, 0)); },
  sparks: () => { for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; puffs.emit('dust', origin, [Math.cos(a) * 3, 2 + Math.random() * 4, Math.sin(a) * 3], .16, .65, 0xffad45, 0, {gravity: 8, grow: 0, blending: T.AdditiveBlending}); } },
  mist: () => spray.mist(waterCentre.clone().add(new T.Vector3(-.8, .05, .6)), 1, state.mistSize),
  splash: () => spray.splash(waterCentre.clone().add(new T.Vector3(.6, 0, .4)), state.splashStrength, .25),
  clear: () => { stop(); prefabs.forEach(p => p.clear()); puffs.clear(); chips.clear(); fragments.clear(); spray.clear(); },
};
const gui = createBenchPanel('Particles');
particleControls(gui, {state, fx, depth, spray, applyEnvironment});

const unbindResize = bindResize(renderer, camera, () => { target.dispose(); target = makeTarget(); blit.material.map = target.texture; depth.uniforms.tFxDepth.value = target.depthTexture; viewport.set(target.width, target.height); });
let loopTimer = 0, lastUI = 0;
startFrameLoop(renderer, (dt, now) => {
  controls.update();
  if (state.sprayLoop) { loopTimer -= dt; if (loopTimer <= 0) { loopTimer = .35; fx.mist(); if (Math.random() < .5) fx.splash(); } }
  puffs.update(dt); prefabs.forEach(p => p.update(dt)); chips.update(dt); fragments.update(dt);
  renderer.setRenderTarget(target); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(blitScene, blitCamera);
  spray.update(dt); renderer.autoClear = false; renderer.render(fxScene, camera); renderer.autoClear = true;
  if (now - lastUI > 250) { lastUI = now; $('status').textContent = (assetBaseUrl ? 'Water spray: local sheets' : 'Water spray: generated soft disc') + `\npuffs ${puffs.active + prefabs.reduce((n, p) => n + p.active, 0)} · chips ${chips.active} · fragments ${fragments.active} · mist ${spray.active.mist} · droplets ${spray.active.droplets}`; }
});
document.body.dataset.ready = 'true';
onLeave(() => { renderer.setAnimationLoop(null); unbindResize(); puffs.dispose(); prefabs.forEach(prefab => prefab.dispose()); chips.dispose(); fragments.dispose(); fragmentMaterial.dispose(); fragmentGeometry.dispose(); spray.dispose(); target.dispose(); controls.dispose(); gui.destroy(); renderer.dispose(); });
window.particlesBench = {scene, fxScene, spray, puffs, chips, fragments, prefabs, renderer, camera};
