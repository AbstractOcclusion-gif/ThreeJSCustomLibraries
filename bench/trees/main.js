import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {LeavedTrees, resolveProfile, PROFILES} from '../../src/trees/index.js';
import {createLighting, syncLighting} from '../../src/core/lighting.js';
import {hash2, seededRandom} from '../../src/core/hash.js';
import {benchRenderer, createBenchWeather, weatherFolder, presetsFolder} from '../shared.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const renderer = benchRenderer(); renderer.shadowMap.enabled = true;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 1200);
camera.position.set(0, 9, 34);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 5, 0); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49; controls.update();
const weather = await createBenchWeather({scene, renderer, camera, initial: 'clear', hour: 15, precipitation: false});
const lighting = createLighting();
const heightAt = (x, z) => Math.sin(x * .05) * Math.cos(z * .04) * 2.5;
const groundGeometry = new THREE.PlaneGeometry(600, 600, 120, 120).rotateX(-Math.PI / 2);
{ const p = groundGeometry.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i))); groundGeometry.computeVertexNormals(); }
const ground = new THREE.Mesh(groundGeometry, new THREE.MeshStandardMaterial({color: 0x56703f, roughness: 1})); ground.receiveShadow = true; scene.add(ground);

const S = {profileName: 'tree', lineupHeight: 9, lineupRadius: 3, field: {count: 600, radius: 220, heightMin: 5, heightMax: 12, crownRatio: .34, tintA: '#2f6b1f', tintB: '#8aa33a', tintMix: 1}, wind: 1};
let profile = resolveProfile(S.profileName);
const lineup = new LeavedTrees({scene, profile, lighting});
const field = new LeavedTrees({scene, profile, lighting, sampleGround: heightAt});

function placeLineup() {
  const V = lineup.profile.variants, gap = S.lineupRadius * 2.6;
  // Items pick their variant by position hash: search x positions until each variant is represented once, in order.
  const items = []; let x = -((V - 1) * gap) / 2;
  for (let v = 0; v < V; v++, x += gap) { let z = 0; while (Math.floor(hash2(x, z, 9) * V) % V !== v) z += .37; items.push({x, z, y: 0, h: S.lineupHeight, r: S.lineupRadius, yaw: 0, tint: [.13, .3, .08]}); }
  lineup.place(items);
}
function placeField() {
  const random = seededRandom(5), a = new THREE.Color(S.field.tintA).convertSRGBToLinear(), b = new THREE.Color(S.field.tintB).convertSRGBToLinear(), c = new THREE.Color(), items = [];
  for (let i = 0; i < S.field.count; i++) {
    const ang = random() * Math.PI * 2, r = 18 + Math.sqrt(random()) * S.field.radius, x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const h = S.field.heightMin + random() * (S.field.heightMax - S.field.heightMin), t = random();
    c.lerpColors(a, b, t * S.field.tintMix);
    items.push({x, z, h, r: h * S.field.crownRatio, tint: [c.r, c.g, c.b]});
  }
  field.place(items);
}
function applyProfile() { lineup.setProfile(profile); field.setProfile(profile); placeLineup(); }
placeLineup(); placeField();

// GUI generated from the profile object. Ranges by key; arrays [min, max] become two sliders.
const RANGES = {variants: [1, 8, 1], sides: [3, 12, 1], radiusBottom: [.01, .3], radiusTop: [.005, .2], belowGround: [0, .1], topIntoCrown: [0, 1], depth: [.1, 1], bottomFlatten: [.1, 1], mainRadius: [.5, 1.5], mainSquash: [.3, 1.5], fixedSquash: [.3, 1.5], mainCentreY: [0, 1],
  count: [0, 8, 1], radius: [.1, 1], offset: [0, 1.2], drop: [0, .8], spread: [.5, 2], dropScale: [0, 2], baseY: [0, 1], dropShare: [0, 1], noiseAmplitude: [0, .4], noiseFrequency: [.5, 6], tintJitter: [0, .4], detail: [0, 2, 1], radiusShare: [.3, 1], shade: [.1, 1],
  perUnitArea: [1, 40], size: [.05, 1.2], tilt: [0, 1.5], sink: [0, .3], scale: [.2, 2], subcells: [1, 4, 1], yCompensation: [.1, 1], bottom: [.2, 1.5], top: [.5, 1.6]};
const gui = new GUI({title: 'Leaved trees'});
const wf = weatherFolder(gui, weather);
gui.add(S, 'profileName', Object.keys(PROFILES)).name('base profile').onChange(v => { profile = resolveProfile(v); applyProfile(); rebuildProfileGui(); });
gui.add(S, 'wind', 0, 3, .01).onChange(v => { lineup.setWind(v); field.setWind(v); });
let profileFolder;
function rebuildProfileGui() {
  profileFolder?.destroy();
  profileFolder = gui.addFolder('Profile');
  const bind = (folder, obj, key) => {
    const v = obj[key], range = RANGES[key] ?? [0, Math.max(1, Math.abs(v) * 3)];
    if (typeof v === 'boolean') return folder.add(obj, key).onFinishChange(applyProfile);
    if (typeof v === 'string' && v.startsWith('#')) return folder.addColor(obj, key).onFinishChange(applyProfile);
    if (typeof v === 'number') return folder.add(obj, key, range[0], range[1], range[2] ?? .005).onFinishChange(applyProfile);
    if (v === null) { const proxy = {on: false, value: (range[0] + range[1]) / 2}; const c = folder.add(proxy, 'on').name(key + ' (override)').onFinishChange(on => { obj[key] = on ? proxy.value : null; s.show(on); applyProfile(); }); const s = folder.add(proxy, 'value', range[0], range[1], .005).name(key).onFinishChange(val => { if (proxy.on) { obj[key] = val; applyProfile(); } }); s.show(false); return c; }
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') { folder.add(v, '0', range[0], range[1], range[2] ?? .005).name(key + ' min').onFinishChange(applyProfile); folder.add(v, '1', range[0], range[1], range[2] ?? .005).name(key + ' max').onFinishChange(applyProfile); }
  };
  for (const [section, value] of Object.entries(profile)) {
    if (section === 'name') continue;
    if (typeof value !== 'object') { bind(profileFolder, profile, section); continue; }
    const f = profileFolder.addFolder(section); for (const key of Object.keys(value)) bind(f, value, key); if (!['lobes', 'crown'].includes(section)) f.close();
  }
}
rebuildProfileGui();
const fl = gui.addFolder('Line-up'); fl.add(S, 'lineupHeight', 2, 20, .1).onFinishChange(placeLineup); fl.add(S, 'lineupRadius', .5, 8, .1).onFinishChange(placeLineup); fl.close();
const ff = gui.addFolder('Field'); ff.add(S.field, 'count', 0, 5000, 50).onFinishChange(placeField); ff.add(S.field, 'radius', 40, 400, 10).onFinishChange(placeField); ff.add(S.field, 'heightMin', 1, 20, .5).onFinishChange(placeField); ff.add(S.field, 'heightMax', 1, 30, .5).onFinishChange(placeField); ff.add(S.field, 'crownRatio', .1, .8, .01).onFinishChange(placeField);
ff.addColor(S.field, 'tintA').onFinishChange(placeField); ff.addColor(S.field, 'tintB').onFinishChange(placeField); ff.add(S.field, 'tintMix', 0, 1, .01).onFinishChange(placeField); ff.close();
presetsFolder(gui, {bundled: import.meta.glob('../../presets/trees/*.json'), name: profile.name,
  getState: () => ({schema: 'three-kit.tree-profile', version: 1, ...profile}),
  apply: p => { const {schema, version, ...rest} = p; profile = resolveProfile(rest); S.profileName = profile.name in PROFILES ? profile.name : S.profileName; applyProfile(); rebuildProfileGui(); }});

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
let last = null, lastUI = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  controls.update(); weather.system.update(dt); weather.view.update(dt);
  syncLighting(lighting.uniforms, {sun: weather.view.sun, hemi: weather.view.hemi, fog: scene.fog});
  lineup.update(dt); field.update(dt);
  weather.view.render();
  if (now - lastUI > 250) { lastUI = now; wf.sync(); $('status').textContent = `${profile.name} · ${profile.variants} variants · line-up ${lineup.count} · field ${field.count} in ${field.meshes.length} batches\n${weather.system.weather.dominant} · ${weather.hourLabel(weather.system.day.hour)}`; }
});
document.body.dataset.ready = 'true';
window.treesBench = {lineup, field, get profile() { return profile; }, applyProfile, weather, scene, camera, renderer};
