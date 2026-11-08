import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {createParticleDepthBinding, createWaterSpray} from '../../src/particles/water/index.js';
import {createRipples, createFlowBake, createChannelSurface, createFoamTexture, skyFromWeather} from '../../src/water/index.js';
import {benchRenderer, createBenchWeather, weatherFolder} from '../shared.js';
import '../bench.css';

const renderer = benchRenderer();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 500);
camera.position.set(17, 12, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, -3);
controls.enableDamping = true;
controls.minDistance = 5;
controls.maxDistance = 64;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();
const weather = await createBenchWeather({scene, renderer, camera, initial: 'cloudy 1'});
const ripples = createRipples({origin: [-15, -13], size: [100, 88], cell: 0.3});
const flow = createFlowBake();
const obstacles = Array.from({length: 4}, () => new THREE.Vector4());
const water = createChannelSurface({renderer, scene, camera, sky: skyFromWeather(weather.view), ripples, obstacles, flow});

// Pond, cliff and falling sheet adapted from Glider 2's procedural waterfall sample.

const radiusX = 13, radiusZ = 11;
ripples.mask((x, z) => Math.hypot(x / radiusX, z / radiusZ) < 1);
water.surface.geometry.dispose();
water.surface.geometry = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2).scale(radiusX, 1, radiusZ);
const coordinates = water.surface.geometry.attributes.position;
const shore = new Float32Array(coordinates.count * 3);
for (let i = 0; i < coordinates.count; i++) {
 shore[i * 3 + 1] = Math.hypot(coordinates.getX(i) / radiusX, coordinates.getZ(i) / radiusZ);
}
water.surface.geometry.setAttribute('flow', new THREE.BufferAttribute(shore, 3));

const bedGeometry = new THREE.PlaneGeometry(54, 52, 124, 120).rotateX(-Math.PI / 2);
const points = bedGeometry.attributes.position, colors = [];
for (let i = 0; i < points.count; i++) {
 const x = points.getX(i), z = points.getZ(i), r = Math.hypot(x / radiusX, z / radiusZ);
 const ground = r < 1 ? -3.2 * (1 - r ** 3) - .03 : Math.min(3, (r - 1) * 5);
 const variation = Math.sin(x * 1.3) * Math.cos(z * 1.4) * .11;
 points.setY(i, ground + variation * Math.min(1, Math.abs(r - 1) * 12));
 const s = .88 + variation;
 colors.push(...(r < 1.02 ? [.31, .25, .16] : [.105, .155, .08]).map(c => c * s));
}
bedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
bedGeometry.computeVertexNormals();
const bedMaterial = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95});
scene.add(new THREE.Mesh(bedGeometry, bedMaterial));

const stone = new THREE.IcosahedronGeometry(1, 1);
const stoneMaterial = new THREE.MeshStandardMaterial({color: 0x655c4d, roughness: .95, flatShading: true});
const cliff = new THREE.InstancedMesh(stone, stoneMaterial, 31);
const pose = new THREE.Object3D();
for (let i = 0; i < cliff.count; i++) {
 const rear = i < 15, angle = i * 2.39996;
 pose.position.set(rear ? (i % 7 - 3) * 1.85 : Math.cos(angle) * 12.8,
  rear ? 1.6 + (i >= 7 ? 2.2 : 0) : .04, rear ? -11.7 - (i % 3) * .95 : Math.sin(angle) * 10.5);
 pose.scale.set(rear ? 2.4 : .85, rear ? 2.9 : .65, rear ? 2.1 : 1.0);
 pose.rotation.set(i * .49, angle, i * .63);
 pose.updateMatrix();
 cliff.setMatrixAt(i, pose.matrix);
}
scene.add(cliff);

const foamTile = createFoamTexture();
foamTile.wrapS = foamTile.wrapT = THREE.RepeatWrapping;
const sheetGeometry = new THREE.PlaneGeometry(4.6, 6.8, 20, 30);
const sheetMaterial = new THREE.ShaderMaterial({
 side: THREE.DoubleSide, transparent: true, depthWrite: false,
 uniforms: {tile: {value: foamTile}, time: {value: 0}, discharge: {value: 1}, light: weather.view.uniforms.uDaylight},
 vertexShader: `
 uniform float time;
 varying vec2 sheetUV;
 void main(){
  sheetUV = uv;
  vec3 p = position;
  p.z += 2.4 * pow(1.0 - uv.y, .65) + .11 * sin(uv.x * 34.0 + uv.y * 9.0 - time * 3.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
 }`,
 fragmentShader: `
 uniform sampler2D tile;
 uniform float time, discharge, light;
 varying vec2 sheetUV;
 void main(){
  vec2 uv = vec2(sheetUV.x * 4.0, sheetUV.y * 1.4 + time);
  vec4 foam = texture2D(tile, uv);
  float width = mix(.22,.5,clamp(discharge,0.0,1.0));
  float edge = 1.0 - smoothstep(width - .08, width, abs(sheetUV.x - .5));
  float film = foam.a * smoothstep(.16,.8,foam.r + foam.g - foam.b * .32);
  vec3 color = mix(vec3(.16,.31,.32),vec3(.76,.86,.83),film);
  gl_FragColor = vec4(color * (.2 + .8 * light), edge * min(1.0, discharge) * (.36 + .54 * film));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`,
});
const sheet = new THREE.Mesh(sheetGeometry, sheetMaterial);
sheet.position.set(0, 3.35, -9.2);
scene.add(sheet);
const impact = new THREE.Vector4(0, -6.8, 2.5, 0);
const sprayPosition = new THREE.Vector3();
const fxScene = new THREE.Scene();
const depth = createParticleDepthBinding({
 THREE, camera, depthTexture: water.depthTexture, viewport: water.viewport,
 waterPlane: new THREE.Vector4(0, 1, 0, 0), softDistance: .25,
});
const spray = createWaterSpray({
 THREE, scene: fxScene, renderer, depth,
 surface: {
  glsl: 'uniform float uOceanAmplitude; float surfaceHeightAt(vec2 xz) { return 0.0; }',
  uniforms: {uOceanAmplitude: {value: 1}},
 },
 lighting: {
  uniforms: {uSunCol: weather.view.uniforms.uSunCol, uFxAmbient: weather.view.uniforms.uAmb},
  direction: weather.view.uniforms.uSkySunDir.value, ambient: weather.view.uniforms.uAmb.value,
 },
 onDeposit(x, z, radius, strength) { ripples.splash(x, z, strength * .5); },
});



const state = {discharge: 1, waves: 0.025, foam: 0.65, godRays: 0.6, rippleMode: false};
const gui = new GUI({title: 'Pond & waterfall'});
gui.add(state, 'discharge', 0, 2, 0.05).name('Waterfall flow');
gui.add(state, 'waves', 0, 0.12, 0.005).name('Wind waves');
gui.add(state, 'foam', 0, 1, 0.05).name('Foam');
gui.add(state, 'godRays', 0, 2, 0.05).name('Underwater light shafts');
gui.add(state, 'rippleMode').name('Tap to make ripples').onChange(syncControls);
const diveControl = gui.add({toggleUnderwater}, 'toggleUnderwater').name('Underwater view');
const weatherUI = weatherFolder(gui, weather);

let diving = false;
const above = new THREE.Vector3();
const fog = new THREE.FogExp2(0x33665b, 0.17);
function syncControls() { controls.enabled = !diving && !state.rippleMode; }
function toggleUnderwater() {
  diving = !diving;
  if (diving) {
    above.copy(camera.position);
    camera.position.set(1.5, -1.5, 3.5);
    camera.lookAt(0, -0.15, -6);
  } else {
    camera.position.copy(above);
    controls.update();
  }
  diveControl.name(diving ? 'Return above water' : 'Underwater view');
  syncControls();
}
const canvas = renderer.domElement;
const pointer = new THREE.Vector2();
const ray = new THREE.Raycaster();
canvas.addEventListener('pointerdown', event => {
  if (diving || !state.rippleMode || event.button !== 0) return;
  const bounds = canvas.getBoundingClientRect();
  pointer.set(2 * (event.clientX - bounds.left) / bounds.width - 1, 1 - 2 * (event.clientY - bounds.top) / bounds.height);
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObject(water.surface)[0];
  if (hit) ripples.splash(hit.point.x, hit.point.z, 1);
});
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let last, time = 0, fallTime = 0, nextImpact = 0;
renderer.setAnimationLoop(now => {
  if (document.hidden) { last = undefined; return; }
  const dt = last === undefined ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  if (!diving) controls.update();
  weather.system.update(dt);
  weather.view.update(dt);
  weatherUI.sync();
  const discharge = state.discharge;
  fallTime += dt * (0.5 + discharge);
  sheet.visible = discharge > 0;
  sheetMaterial.uniforms.time.value = fallTime;
  sheetMaterial.uniforms.discharge.value = discharge;
  impact.w = Math.min(1, discharge * 0.75);
  if (discharge > 0 && time >= nextImpact) {
    nextImpact = time + 0.18 / Math.max(0.25, discharge);
    const x = (Math.random() - 0.5) * 3 * Math.min(1, discharge);
    ripples.splash(x, impact.y, discharge * 0.5);
    sprayPosition.set(x, 0.12, impact.y);
    spray.mist(sprayPosition, Math.min(1, discharge), 0.75);
    spray.splash(sprayPosition, Math.min(1, discharge * 0.5), 0.18);
  }
  spray.update(dt);
  ripples.update(dt);
  const previousFog = scene.fog;
  if (diving) {
    fog.color.set(0x33665b).multiplyScalar(0.22 + 0.78 * weather.system.day.daylight);
    scene.fog = fog;
  }
  try {
    water.render(time * 0.12, {
      foam: state.foam, bankFoam: 0.12, foamFeather: 0.7, refraction: 0.8, speed: 1, waveTime: time,
      waveHeight: state.waves, wavelength: 1.05, godRays: state.godRays, waveSpread: 45,
      waveDirection: THREE.MathUtils.degToRad(weather.system.weather.windHeading), impactFoam: impact,
    });
    renderer.render(scene, camera);
    renderer.autoClear = false;
    try { renderer.render(fxScene, camera); }
    finally { renderer.autoClear = true; }
  } finally { scene.fog = previousFog; }
});
document.body.dataset.ready = 'true';

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  renderer.setAnimationLoop(null);
  spray.dispose();
  water.dispose();
  weather.view.dispose();
  ripples.dispose();
  flow.dispose();
  for (const resource of [bedGeometry, bedMaterial, cliff, stone, stoneMaterial, sheetGeometry, sheetMaterial, foamTile]) resource.dispose();
  controls.dispose();
  gui.destroy();
  renderer.dispose();
});
