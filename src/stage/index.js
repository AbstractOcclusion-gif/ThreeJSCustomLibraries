// Basic stage: the plain fallbacks a module needs to be seen on its own - a clear gradient sky, a sun and an ambient light,
// a flat ground, the default lighting hook, and the shared environment object (core/environment.js) kept in step with them.
// No weather and no terrain: a project that has those drives the same environment object from them instead.
import * as THREE from 'three';
import {createEnvironment, setEnvironmentWind} from '../core/environment.js';
import {createLighting, syncLighting, LIGHTING_DEFAULTS, CLEAR_NOON_SUN} from '../core/lighting.js';
import {createSkyDome, createSkyUniforms} from '../core/sky.js';

export const STAGE_DEFAULTS = Object.freeze({
  sunIntensity: LIGHTING_DEFAULTS.sunIntensity, ambientIntensity: LIGHTING_DEFAULTS.ambientIntensity, sunElevation: 50, sunAzimuth: 35,   // degrees; azimuth 0 = +X, 90 = +Z
  groundSize: 80, groundColor: 0x617a4b, skyRadius: 100, shadowMapSize: 1024, shadowExtent: 30,
});
const SUN_DISTANCE = 100;          // metres from the light target, so the shadow camera sees the whole stage

// sky / ground: false leaves that part out (the host has its own). shadows: the sun casts, the ground receives.
export function createBasicStage({scene, sky = true, ground = true, shadows = false, ...options} = {}) {
  if (!scene) throw Error('Basic stage needs a scene');
  const o = {...STAGE_DEFAULTS, ...options};
  const environment = createEnvironment(), lighting = createLighting(), direction = environment.sun.direction;
  const sun = new THREE.DirectionalLight(LIGHTING_DEFAULTS.sunColor, o.sunIntensity);
  const hemi = new THREE.HemisphereLight(LIGHTING_DEFAULTS.hemiSky, LIGHTING_DEFAULTS.hemiGround, o.ambientIntensity);
  scene.add(sun, sun.target, hemi);
  if (shadows) {
    sun.castShadow = true; sun.shadow.mapSize.set(o.shadowMapSize, o.shadowMapSize);
    Object.assign(sun.shadow.camera, {left: -o.shadowExtent, right: o.shadowExtent, top: o.shadowExtent, bottom: -o.shadowExtent, far: SUN_DISTANCE * 2});
    sun.shadow.camera.updateProjectionMatrix();
  }
  const skyUniforms = sky ? createSkyUniforms(direction) : null;   // shares the direction vector by reference
  const dome = sky ? createSkyDome(skyUniforms, {radius: o.skyRadius, atFarPlane: true}) : null;
  if (dome) scene.add(dome);
  let groundMesh = null;
  if (ground) {
    groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(o.groundSize, o.groundSize).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({color: o.groundColor, roughness: 1}));
    groundMesh.receiveShadow = true; scene.add(groundMesh);
  }
  let level = 1, disposed = false;
  function apply() {
    sun.position.copy(sun.target.position).addScaledVector(direction, SUN_DISTANCE);
    sun.intensity = o.sunIntensity * level; hemi.intensity = o.ambientIntensity * level;
    environment.sun.color.copy(sun.color).multiplyScalar(sun.intensity);
    environment.ambient.sky.copy(hemi.color).multiplyScalar(hemi.intensity); environment.ambient.ground.copy(hemi.groundColor).multiplyScalar(hemi.intensity);
    environment.light.setScalar(level); environment.daylight = level;
    if (skyUniforms) { skyUniforms.uSkySunDir.value.copy(direction); skyUniforms.uSunCol.value.setRGB(...CLEAR_NOON_SUN).multiplyScalar(level); skyUniforms.uDaylight.value = level; }
    syncLighting(lighting.uniforms, {sun, hemi, fog: scene.fog});
  }
  const stage = {
    environment, lighting, sun, hemi, sky: dome, skyUniforms, ground: groundMesh,
    setSun(elevationDegrees, azimuthDegrees) {
      if (!Number.isFinite(elevationDegrees) || !Number.isFinite(azimuthDegrees)) throw Error('Stage sun needs finite elevation and azimuth');
      const elevation = THREE.MathUtils.degToRad(elevationDegrees), azimuth = THREE.MathUtils.degToRad(azimuthDegrees);
      direction.set(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth)); apply(); return stage;
    },
    // 1 = clear noon, 0 = dark. Scales the lights, the sky and environment.light together.
    setLight(next) { if (!Number.isFinite(next) || next < 0) throw Error('Stage light must be non-negative'); level = next; apply(); return stage; },
    setWind(speed, headingDegrees, gust = environment.wind.gust) { setEnvironmentWind(environment, speed, headingDegrees); environment.wind.gust = gust; return stage; },
    // Once per frame: keeps the sky dome on the camera and the lighting hook in step with the scene fog.
    update(camera) { if (disposed) return; if (dome && camera) camera.getWorldPosition(dome.position); syncLighting(lighting.uniforms, {sun, hemi, fog: scene.fog}); },
    dispose() {
      if (disposed) return; disposed = true; scene.remove(sun, sun.target, hemi); sun.shadow.map?.dispose(); sun.dispose(); hemi.dispose();
      if (dome) { scene.remove(dome); dome.geometry.dispose(); dome.material.dispose(); }
      if (groundMesh) { scene.remove(groundMesh); groundMesh.geometry.dispose(); groundMesh.material.dispose(); }
    },
  };
  return stage.setSun(o.sunElevation, o.sunAzimuth);
}
