// Environment contract: the one optional input the reactive modules share (particles, vegetation, trees, water, fire, cable).
// Plain data owned by whoever drives the scene. The weather adapter fills one each frame (`view.environment`); a project
// without weather fills its own, or passes nothing and every module keeps its own calm, clear-noon defaults.
//   wind.x / wind.z  horizontal velocity the air moves toward, m/s        wind.speed  its length
//   wind.gust        0..1 turbulence share; the weather adapter leaves it to the host
//   sun.direction    unit vector toward the key light (the moon at night)  sun.color  colour x intensity, as a DirectionalLight
//   ambient.sky / ambient.ground   colour x intensity, as a HemisphereLight
//   light            relative scene light for unlit things (sprites): white at clear noon, dim and tinted at dusk or night
//   daylight, rain, snow   0..1
import * as THREE from 'three';
import {LIGHTING_DEFAULTS} from './lighting.js';

const DEFAULT_SUN_DIRECTION = [0.3, 0.8, 0.5];

export function createEnvironment() {
  return {
    wind: {x: 0, z: 0, speed: 0, gust: 0},
    sun: {direction: new THREE.Vector3(...DEFAULT_SUN_DIRECTION).normalize(), color: new THREE.Color(LIGHTING_DEFAULTS.sunColor)},
    ambient: {sky: new THREE.Color(LIGHTING_DEFAULTS.hemiSky), ground: new THREE.Color(LIGHTING_DEFAULTS.hemiGround)},
    light: new THREE.Color(1, 1, 1),
    daylight: 1, rain: 0, snow: 0,
  };
}

// Wind from a speed (m/s) and the heading it blows toward (degrees, 0 = +X, 90 = +Z: the weather module's convention).
export function setEnvironmentWind(environment, speed, headingDegrees) {
  if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(headingDegrees)) throw Error('Wind needs a non-negative speed and a finite heading');
  const heading = THREE.MathUtils.degToRad(headingDegrees);
  environment.wind.x = Math.cos(heading) * speed; environment.wind.z = Math.sin(heading) * speed; environment.wind.speed = speed;
  return environment;
}
