import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {createChannel, createChannelSurface, createRipples, createFlowBake, skyFromWeather} from '../../src/water/index.js';
import {createSurfaceWeather, createWeatherSurfaceMaterial} from '../../src/surface/index.js';
import {benchRenderer, createBenchWeather, weatherFolder, presetsFolder} from '../shared.js';
import '../bench.css';

const $ = id => document.getElementById(id);
const renderer = benchRenderer();
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, .2, 800);
camera.position.set(46, 39, 63);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = 7; controls.maxDistance = 135; controls.maxPolarAngle = Math.PI * .485; controls.target.set(4, 0, 0); controls.update();
const weather = await createBenchWeather({scene, renderer, camera, initial: 'cloudy 1', hour: 15, precipitation: {count: 420, radius: 40, height: 44, floorHeight: -2}});

const ripples = createRipples();
const flow = createFlowBake();
const obstacles = Array.from({length: 4}, () => new THREE.Vector4());
const water = createChannelSurface({renderer, scene, camera, sky: skyFromWeather(weather.view), ripples, obstacles, flow});
const bankWeather = createSurfaceWeather();
const surfaceOptions = {weather: bankWeather, puddles: 0};
const bed = new THREE.Mesh(new THREE.BufferGeometry(), createWeatherSurfaceMaterial({vertexColors: true, roughness: .94}, surfaceOptions)); scene.add(bed);
const stone = new THREE.IcosahedronGeometry(1, 1), stoneMaterial = createWeatherSurfaceMaterial({color: 0x736754, roughness: .95, flatShading: true}, surfaceOptions);
const rocks = new THREE.InstancedMesh(stone, stoneMaterial, 28); scene.add(rocks);
const movableRocks = obstacles.map(() => { const m = new THREE.Mesh(stone, stoneMaterial); m.visible = false; scene.add(m); return m; });
const markers = new THREE.InstancedMesh(new THREE.SphereGeometry(.22, 10, 6), new THREE.MeshBasicMaterial({color: 0xff9e35}), 22); markers.frustumCulled = false; scene.add(markers);
const markerPositions = Array.from({length: markers.count}, () => new THREE.Vector3()), velocity = new THREE.Vector2(), pose = new THREE.Object3D();
const underwaterFog = new THREE.FogExp2(0x336c65, .13), abovePosition = new THREE.Vector3(), aboveTarget = new THREE.Vector3();
let channel, flowTime = 0, waveTime = 0, diving = false, dragged = -1;

const P = {
  channel: {preset: 'stream', width: 1, drop: 3, depth: 1},
  water: {speed: 1, foam: .55, foamFeather: .65, refraction: 1, clarity: 1, reflection: 1, godRays: .55, tint: '#ffffff'},
  waves: {height: .035, wavelength: 1.2, direction: 0, spread: 45, speed: 1},
  interact: {mode: 'orbit', rippleStrength: 1, markers: true},
  bake: {iterations: 90},
};
const wetAt = (x, z) => { const s = channel.sectionAt(x); return s && Math.abs(z - s.centre) < s.width && !obstacles.some(r => r.z > 0 && Math.hypot(x - r.x, z - r.y) < r.z); };
function syncObstacles() {
  if (flow.ready) { flow.invalidate(); setBakeStatus('Channel changed — bake again.'); }
  for (let i = 0; i < obstacles.length; i++) {
    const rock = obstacles[i], mesh = movableRocks[i], section = channel.sectionAt(rock.x);
    mesh.visible = rock.z > 0 && !!section; if (!mesh.visible) continue;
    const margin = Math.max(0, section.width - rock.z * .65);
    rock.y = THREE.MathUtils.clamp(rock.y, section.centre - margin, section.centre + margin); rock.w = section.slope;
    mesh.position.set(rock.x, section.height - rock.z * .31, rock.y); mesh.scale.set(rock.z, rock.z * 1.3, rock.z);
  }
  ripples.mask(wetAt);
}
function rebuild() {
  channel = createChannel({width: P.channel.width, depth: P.channel.depth, drop: P.channel.drop, river: P.channel.preset === 'river'});
  water.surface.geometry.dispose(); water.surface.geometry = channel.surface; bed.geometry.dispose(); bed.geometry = channel.bed;
  for (let i = 0; i < rocks.count; i++) {
    channel.sample(channel.duration * (i + .5) / rocks.count, (i % 2 ? -1 : 1) * (.76 + (i % 4) * .12), pose.position); pose.position.y -= .19;
    pose.rotation.set(i * .37, i * 1.7, i * .14); pose.scale.set(.48 + (i % 4) * .28, .44 + (i % 3) * .25, .52 + (i % 5) * .14); pose.updateMatrix(); rocks.setMatrixAt(i, pose.matrix);
  }
  rocks.instanceMatrix.needsUpdate = true; rocks.computeBoundingSphere(); syncObstacles(); if (diving) positionUnderwater();
}
let bakeStatus = 'No baked flow (analytic wakes).'; const setBakeStatus = t => { bakeStatus = t; };
function bake() {
  const {before, after} = flow.bake(channel, obstacles, P.bake.iterations);
  setBakeStatus(`Baked flow: RMS divergence −${before > 0 ? Math.round(100 * (1 - Math.sqrt(after / before))) : 0}%.`);
  for (let i = 0; i < markers.count; i++) channel.sample(channel.duration * (i + .5) / markers.count, 0, markerPositions[i]);
}
function positionUnderwater() { const s = channel.sectionAt(27), up = channel.sectionAt(16); camera.position.set(27, s.height - P.channel.depth * .57, s.centre); camera.lookAt(16, up.height - .12, up.centre); }
function toggleUnderwater() {
  if (!diving) { abovePosition.copy(camera.position); aboveTarget.copy(controls.target); positionUnderwater(); }
  else { camera.position.copy(abovePosition); controls.target.copy(aboveTarget); controls.update(); }
  diving = !diving; controls.enabled = !diving && P.interact.mode === 'orbit';
}
rebuild();

const gui = new GUI({title: 'Channel water'});
const wf = weatherFolder(gui, weather);
const banks = {state: 'follow weather'};
gui.add(banks, 'state', ['follow weather', 'dry', 'wet', 'snow']).name('Bank surface').onChange(state => {
  if (state !== 'follow weather') bankWeather.set({wetness: Number(state === 'wet'), snow: Number(state === 'snow')});
});
const fc = gui.addFolder('Channel'); fc.add(P.channel, 'preset', ['stream', 'river']).onChange(rebuild); fc.add(P.channel, 'width', .6, 1.6, .05).onChange(rebuild); fc.add(P.channel, 'drop', 0, 6, .1).name('drop · m').onChange(rebuild); fc.add(P.channel, 'depth', .4, 2, .05).onChange(rebuild);
const fw = gui.addFolder('Water'); for (const [k, a, b] of [['speed', 0, 2], ['foam', 0, 1], ['foamFeather', 0, 1], ['refraction', 0, 2], ['clarity', .2, 3], ['reflection', 0, 1.5], ['godRays', 0, 2]]) fw.add(P.water, k, a, b, .01); fw.addColor(P.water, 'tint');
const fv = gui.addFolder('Wind waves'); fv.add(P.waves, 'height', 0, .16, .005); fv.add(P.waves, 'wavelength', .35, 4, .05); fv.add(P.waves, 'direction', -180, 180, 5).name('direction vs wind °'); fv.add(P.waves, 'spread', 0, 90, 5); fv.add(P.waves, 'speed', 0, 2, .05); fv.close();
const fi = gui.addFolder('Interact'); fi.add(P.interact, 'mode', ['orbit', 'ripple', 'rock']).onChange(v => { controls.enabled = !diving && v === 'orbit'; }); fi.add(P.interact, 'rippleStrength', 0, 2, .05); fi.add(P.interact, 'markers').name('flow markers');
fi.add({clearRocks: () => { for (const r of obstacles) r.set(0, 0, 0, 0); syncObstacles(); }}, 'clearRocks').name('clear rocks'); fi.add({toggleUnderwater}, 'toggleUnderwater').name('underwater view');
const fb = gui.addFolder('Flow bake'); fb.add(P.bake, 'iterations', 10, 400, 10); fb.add({bake}, 'bake').name('bake flow field');
presetsFolder(gui, {bundled: import.meta.glob('../../presets/water/*.json'), name: 'channel-water',
  getState: () => ({schema: 'three-kit.channel-water', version: 1, channel: {...P.channel}, water: {...P.water}, waves: {...P.waves}}),
  apply: p => { Object.assign(P.channel, p.channel); Object.assign(P.water, p.water); Object.assign(P.waves, p.waves); rebuild(); gui.controllersRecursive().forEach(c => c.updateDisplay()); }});

// Pointer interaction on the water surface.
const canvas = renderer.domElement, pointer = new THREE.Vector2(), ray = new THREE.Raycaster(); let lastEdit = 0;
function pick(e) { const b = canvas.getBoundingClientRect(); pointer.set((e.clientX - b.left) / b.width * 2 - 1, 1 - (e.clientY - b.top) / b.height * 2); ray.setFromCamera(pointer, camera); return ray.intersectObject(water.surface)[0]?.point; }
const disturb = (p, k = 1) => { const a = P.interact.rippleStrength * k; if (a > 0) ripples.splash(p.x, p.z, a); };
function moveRock(i, p) { const r = obstacles[i]; if (r.z > 0) ripples.splash(r.x, r.y, P.interact.rippleStrength * .4); r.set(p.x, p.z, .9, 0); syncObstacles(); disturb(p, .55); }
canvas.addEventListener('pointerdown', e => {
  if (diving || P.interact.mode === 'orbit' || e.button !== 0) return; const p = pick(e);
  if (P.interact.mode === 'rock') { const hit = ray.intersectObjects(movableRocks.filter(m => m.visible))[0]; dragged = hit ? movableRocks.indexOf(hit.object) : obstacles.findIndex(r => r.z === 0); if (!hit && p && dragged >= 0) moveRock(dragged, p); else if (!hit) dragged = -1; }
  else if (p) disturb(p);
  canvas.setPointerCapture(e.pointerId); lastEdit = e.timeStamp;
});
canvas.addEventListener('pointermove', e => { if (!canvas.hasPointerCapture(e.pointerId) || e.timeStamp - lastEdit < 60) return; const p = pick(e); if (!p) return; if (dragged >= 0 && P.interact.mode === 'rock') moveRock(dragged, p); else if (P.interact.mode === 'ripple') disturb(p, .38); lastEdit = e.timeStamp; });
canvas.addEventListener('lostpointercapture', () => { dragged = -1; });

function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
let last = null, lastUI = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = null; return; }
  const dt = last === null ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  flowTime += dt * P.water.speed; waveTime += dt * P.waves.speed;
  if (!diving) controls.update(); weather.system.update(dt); weather.view.update(dt);
  if (!weather.system.paused) bankWeather.update(dt, banks.state === 'follow weather' ? weather.system.weather : null);
  markers.visible = P.interact.markers;
  if (markers.visible) {
    pose.rotation.set(0, 0, 0); pose.scale.setScalar(1);
    for (let i = 0; i < markers.count; i++) {
      if (flow.ready) { const m = markerPositions[i]; if (flow.sample(m.x, m.z, velocity) && velocity.lengthSq() > .0025) { m.x += velocity.x * dt * P.water.speed; m.z += velocity.y * dt * P.water.speed; } else channel.sample(.7 + i * .16, ((i % 7) - 3) * .12, m); m.y = channel.sectionAt(m.x)?.height ?? m.y; pose.position.copy(m); }
      else channel.sample(flowTime + channel.duration * i / markers.count, ((i % 5) - 2) * .26, pose.position);
      pose.position.y += .12; pose.updateMatrix(); markers.setMatrixAt(i, pose.matrix);
    }
    markers.instanceMatrix.needsUpdate = true;
  }
  ripples.update(dt);
  const fog = scene.fog; if (diving) { underwaterFog.color.set(0x336c65).multiplyScalar(.22 + .78 * weather.system.day.daylight); scene.fog = underwaterFog; }
  try {
    water.render(flowTime, {foam: P.water.foam, foamFeather: P.water.foamFeather, refraction: P.water.refraction, speed: P.water.speed, clarity: P.water.clarity, reflection: P.water.reflection, tint: P.water.tint, godRays: P.water.godRays,
      waveTime, waveHeight: P.waves.height, wavelength: P.waves.wavelength, waveDirection: THREE.MathUtils.degToRad(weather.system.weather.windHeading + P.waves.direction), waveSpread: THREE.MathUtils.degToRad(P.waves.spread)});
    weather.view.render();
  } finally { scene.fog = fog; }
  if (now - lastUI > 250) { lastUI = now; wf.sync(); $('status').textContent = (weather.assetBaseUrl === 'bundled' ? 'Bundled sky textures\n' : '') + weather.system.weather.dominant + ' · ' + weather.hourLabel(weather.system.day.hour) + '\n' + bakeStatus + (ripples.active ? '\nripples active' : ''); }
});
document.body.dataset.ready = 'true';
window.waterBench = {water, ripples, flow, obstacles, weather, scene, camera, renderer, bake, get channel() { return channel; }};
