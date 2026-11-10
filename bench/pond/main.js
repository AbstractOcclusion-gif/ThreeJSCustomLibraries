import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createBenchPanel} from '../panel.js';
import {createParticleDepthBinding, createWaterSpray} from '../../src/particles/water/index.js';
import {createRipples, createFlowBake, createChannelSurface, createFoamTexture, createFreezeTexture, createWaterFreeze, createWaterlineComposite, proceduralSky} from '../../src/water/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, bindResize, startFrameLoop} from '../kit/page.js';
import {stageControls} from '../kit/controls.js';
import {detectAssets} from '../kit/assets.js';
import {createBenchPondSettings, inlandWaterControls} from '../water/controls.js';
import {bindRippleGesture} from '../ripple-gesture.js';
import {valueNoise} from '../../src/core/value-noise.js';
import {sprayControls} from '../particles/controls.js';
import '../bench.css';
import {aimRay} from '../kit/input.js';

const renderer = benchRenderer();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 500);
camera.position.set(17, 12, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, -3);
controls.enableDamping = true;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.minDistance = 5;
controls.maxDistance = 64;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();
// Standalone: the basic stage gives the sun and light; the water, waterfall sheet and spray read the procedural sky's uniforms.
const stage = createBasicStage({scene, ground: false});
const sky = proceduralSky();
const ripples = createRipples({origin: [-15, -13], size: [100, 88], cell: 0.3});
const flow = createFlowBake();
const obstacles = Array.from({length: 4}, () => new THREE.Vector4());
const lightOccluders = [];
const freeze = createWaterFreeze(), freezeMap = createFreezeTexture();
const water = createChannelSurface({renderer, scene, camera, sky, ripples, obstacles, flow,
 freezeMap, causticSegments: 280, clipToBed: true, pondOptics: true, bedCaustics: 'material', lightOccluders});
const waterline = createWaterlineComposite(renderer, {caustics: water.lighting});

// Pond, cliff and falling sheet adapted from Glider 2's procedural waterfall sample.

const radiusX = 13, radiusZ = 11;
ripples.mask((x, z) => Math.hypot(x / radiusX, z / radiusZ) < 1);
const bedGeometry = new THREE.PlaneGeometry(54, 52, 124, 120).rotateX(-Math.PI / 2);
const points = bedGeometry.attributes.position, colors = [];
const bedNoise = valueNoise(91);
function pondBedHeight(x, z) {
 const r = Math.hypot(x / radiusX, z / radiusZ);
 const ground = r < 1 ? -3.2 * (1 - r ** 3) - .03 : Math.min(3, (r - 1) * 5);
 return ground + bedNoise(x * .65, z * .65) * .11 * Math.min(1, Math.abs(r - 1) * 12);
}
for (let i = 0; i < points.count; i++) {
 const x = points.getX(i), z = points.getZ(i), r = Math.hypot(x / radiusX, z / radiusZ);
 const variation = bedNoise(x * .8, z * .8) * .11;
 points.setY(i, pondBedHeight(x, z));
 const s = .88 + variation;
 const grass = THREE.MathUtils.smoothstep(r, .98, 1.1);
 colors.push(s * THREE.MathUtils.lerp(.42, .105, grass), s * THREE.MathUtils.lerp(.34, .155, grass), s * THREE.MathUtils.lerp(.23, .08, grass));
}
bedGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
bedGeometry.computeVertexNormals();
// Use the rendered bed's triangles as the wet mask, as in the Terrain bench.
// An independent ellipse slices through shallow bed triangles and catches light in slivers.
const waterGeometry = new THREE.BufferGeometry();
const coordinates = new Float32Array(points.count * 3), bedHeights = new Float32Array(points.count);
for (let i = 0; i < points.count; i++) {
 coordinates[i * 3] = points.getX(i); coordinates[i * 3 + 2] = points.getZ(i);
 bedHeights[i] = points.getY(i);
}
waterGeometry.setIndex(bedGeometry.index);
waterGeometry.setAttribute('position', new THREE.BufferAttribute(coordinates, 3));
waterGeometry.setAttribute('bedHeight', new THREE.BufferAttribute(bedHeights, 1));
waterGeometry.computeVertexNormals();
water.surface.geometry.dispose();
water.surface.geometry = waterGeometry;
const bedMaterial = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .95});
water.lighting.bindBedMaterial(bedMaterial);
// Original WebAquarium T_8 sand maps, available only from the staged asset library.
const sandBase = import.meta.env.BASE_URL + 'webaquarium/library/embedded/tex/';
const sand = await detectAssets(sandBase + 'sandAlb.webp', sandBase);
if (sand) {
 const loader = new THREE.TextureLoader();
 const texture = name => {
  const t = loader.load(sand + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
 };
 bedMaterial.map = texture('sandAlb.webp'); bedMaterial.map.colorSpace = THREE.SRGBColorSpace;
 bedMaterial.normalMap = texture('sandNrm.webp'); bedMaterial.normalScale.set(.7, .7);
 bedMaterial.map.repeat.set(54 / 1.3, 52 / 1.3);
 bedMaterial.normalMap.repeat.copy(bedMaterial.map.repeat);
}
scene.add(new THREE.Mesh(bedGeometry, bedMaterial));

const stone = new THREE.IcosahedronGeometry(1, 1);
const stoneMaterial = new THREE.MeshStandardMaterial({color: 0x655c4d, roughness: .95, flatShading: true});
water.lighting.bindBedMaterial(stoneMaterial);
const cliff = new THREE.InstancedMesh(stone, stoneMaterial, 38);
const pose = new THREE.Object3D();
for (let i = 0; i < cliff.count; i++) {
 const rear = i < 15, angle = i * 2.39996;
 pose.position.set(rear ? (i % 7 - 3) * 1.85 : Math.cos(angle) * 12.8,
  rear ? 1.6 + (i >= 7 ? 2.2 : 0) : .04, rear ? -11.7 - (i % 3) * .95 : Math.sin(angle) * 10.5);
 pose.scale.set(rear ? 2.4 : .85, rear ? 2.9 : .65, rear ? 2.1 : 1.0);
 pose.rotation.set(i * .49, angle, i * .63);
 if (i >= 31) {
  const x = Math.cos(angle) * (1.1 + (i - 31) * .65), z = Math.sin(angle) * (1.4 + (i - 31) * .58);
  pose.position.set(x, pondBedHeight(x, z) + .08, z);
  pose.scale.set(.33 + (i % 3) * .17, .25 + (i % 3) * .1, .42);
 }
 pose.updateMatrix();
 cliff.setMatrixAt(i, pose.matrix);
}
scene.add(cliff);
lightOccluders.push(cliff);

const foamTile = createFoamTexture();
foamTile.wrapS = foamTile.wrapT = THREE.RepeatWrapping;
const sheetGeometry = new THREE.PlaneGeometry(4.6, 6.8, 20, 30);
const sheetMaterial = new THREE.ShaderMaterial({
 side: THREE.DoubleSide, transparent: true, depthWrite: false,
 uniforms: {tile: {value: foamTile}, time: {value: 0}, discharge: {value: 1}, light: sky.uniforms.uDaylight},
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
  uniforms: {uSunCol: sky.uniforms.uSunCol, uFxAmbient: sky.uniforms.uAmb},
  direction: sky.uniforms.uSkySunDir.value, ambient: sky.uniforms.uAmb.value,
 },
 onDeposit(x, z, radius, strength) { if (freeze.progress < 1) ripples.splash(x, z, strength * .5); },
});



const state = {...createBenchPondSettings(), bankFoam: .12, discharge: 1, diveHeight: -2.1, airTemperature: 15};
const gui = createBenchPanel('Pond & waterfall');
stageControls(gui, stage, {wind: false, onChange: () => sky.setEnvironment(stage.environment)}).apply();
sprayControls(gui, {spray, depth}).close();
gui.add(state, 'discharge', 0, 2, 0.05).name('Waterfall flow');
// No weather here: this temperature drives the ice when Water > Pond phase is 'Weather' (freezes at -1 °C, thaws above 1 °C).
gui.add(state, 'airTemperature', -15, 30, 1).name('Air temperature · °C');
const {diveControl, diveHeight} = inlandWaterControls(gui.addFolder('Water'), {
 settings: state, freeze, toggleUnderwater, positionDiveCamera,
});

let diving = false;
const above = new THREE.Vector3();
function positionDiveCamera() {
  camera.position.set(.6, state.diveHeight, 3.5);
  camera.lookAt(-1.5, -2.9, -.2);
}
function toggleUnderwater() {
  rippleGesture.cancel();
  diving = !diving;
  if (diving) {
    above.copy(camera.position);
    positionDiveCamera();
    diveHeight.enable();
  } else {
    camera.position.copy(above);
    controls.update();
    diveHeight.disable();
  }
  diveControl.name(diving ? 'Return above water' : 'Underwater view');
  controls.enabled = !diving;
}
const canvas = renderer.domElement;
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ripplePoint = new THREE.Vector3();
const rippleGesture = bindRippleGesture(canvas, controls, event => {
  if (diving || freeze.progress >= 1) return;
  aimRay(ray, event, canvas, camera);
  if (!ray.ray.intersectPlane(plane, ripplePoint)) return;
  if (Math.hypot(ripplePoint.x / radiusX, ripplePoint.z / radiusZ) < 1) return ripplePoint;
}, ({x, z}, strength) => {
  if (freeze.progress < 1) ripples.splash(x, z, strength);
});
bindResize(renderer, camera);

let time = 0, fallTime = 0, nextImpact = 0;
startFrameLoop(renderer, (dt, now) => {
  time += dt;
  if (!diving) controls.update();
  stage.update(camera);
  const freezeProgress = freeze.update(dt, state.airTemperature);
  if (freezeProgress >= 1) rippleGesture.cancel();
  rippleGesture.update(dt);
  const discharge = state.discharge;
  fallTime += dt * (0.5 + discharge);
  sheet.visible = discharge > 0;
  sheetMaterial.uniforms.time.value = fallTime;
  sheetMaterial.uniforms.discharge.value = discharge;
  impact.w = Math.min(1, discharge * 0.75);
  if (discharge > 0 && time >= nextImpact) {
    nextImpact = time + 0.18 / Math.max(0.25, discharge);
    const x = (Math.random() - 0.5) * 3 * Math.min(1, discharge);
    if (freezeProgress < 1) ripples.splash(x, impact.y, discharge * 0.5);
    sprayPosition.set(x, 0.12, impact.y);
    spray.mist(sprayPosition, Math.min(1, discharge), 0.75);
    spray.splash(sprayPosition, Math.min(1, discharge * 0.5), 0.18);
  }
  spray.update(dt);
  if (freezeProgress < 1) ripples.update(dt);
  canvas.dataset.ripples = ripples.active ? 'active' : 'still';
  water.render(time * 0.12, {
    ...state, waveTime: time,
    impactFoam: impact,
    freezeProgress,
  });
  if (diving) {
    const light = sky.uniforms;
    waterline.render(scene, camera, {height: water.surface.position.y,
      clarity: state.clarity, godRays: state.godRays, sunDirection: light.uSkySun.value, sunColor: light.uSunCol.value, ambientColor: light.uAmb.value});
  } else renderer.render(scene, camera);
  renderer.autoClear = false;
  try { renderer.render(fxScene, camera); }
  finally { renderer.autoClear = true; }
});
document.body.dataset.ready = 'true';

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  renderer.setAnimationLoop(null);
  rippleGesture.dispose();
  spray.dispose();
  water.dispose();
  waterline.dispose();
  freezeMap.dispose();
  stage.dispose();
  ripples.dispose();
  flow.dispose();
  bedMaterial.map?.dispose(); bedMaterial.normalMap?.dispose();
  for (const resource of [bedGeometry, bedMaterial, cliff, stone, stoneMaterial, sheetGeometry, sheetMaterial, foamTile]) resource.dispose();
  controls.dispose();
  gui.destroy();
  renderer.dispose();
});
