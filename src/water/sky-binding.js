// The `sky` hook water materials take: {glsl, uniforms, defines}. glsl must define vec3 sky(vec3 dir, float sunMul); the
// uniforms must include uSkySun (vec3 sun dir), uSunCol (vec3) and uDaylight (float), which the water shaders also read.
import * as THREE from 'three';
import {SKY_GLSL, skyDefines, createSkyUniforms} from '../core/sky.js';

// Share the weather adapter's sky: the water mirrors exactly what the dome shows (clouds, moon, stars).
export function skyFromWeather(view, {celestial = true, water = false} = {}) {
  return {glsl: SKY_GLSL, uniforms: view.uniforms, defines: skyDefines({dynamic: true, celestial, water})};
}

const PROCEDURAL_SUN = [1, .96, .9];   // createSkyUniforms' clear-noon sun colour

// No weather adapter: the static procedural gradient sky with a sun you drive yourself.
export function proceduralSky(sunDir = new THREE.Vector3(.4, .6, .3).normalize()) {
  const uniforms = createSkyUniforms(sunDir);
  return {glsl: SKY_GLSL, uniforms, defines: {},
    setSun(direction, color) { uniforms.uSkySunDir.value.copy(direction); uniforms.uSkySun.value.copy(direction); if (color) uniforms.uSunCol.value.copy(color); },
    // Optional shared environment (core/environment.js): sun direction, light level and daylight in one call per frame.
    setEnvironment(environment) {
      this.setSun(environment.sun.direction);
      uniforms.uSunCol.value.setRGB(...PROCEDURAL_SUN).multiply(environment.light); uniforms.uDaylight.value = environment.daylight;
    }};
}

// Any custom sky: pass your own GLSL + uniforms (uniform objects are shared by reference, update them in your loop).
export function customSky({glsl, uniforms, defines = {}}) {
  for (const name of ['uSkySun', 'uSunCol', 'uDaylight']) if (!uniforms[name]) throw Error(`custom sky needs uniform ${name}`);
  return {glsl, uniforms, defines};
}
