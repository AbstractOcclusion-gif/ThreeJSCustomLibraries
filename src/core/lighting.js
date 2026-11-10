// Lighting contract shared by the lib's custom ShaderMaterials (leaved trees, water, ...).
// A material takes `lighting: {glsl, uniforms}`. The GLSL must declare the uniforms it needs and define
//   vec3 shade(vec3 albedo, vec3 n, float sunVisibility, float ao, float wrap)
//   vec3 applyFog(vec3 color, float viewDistance)
// This file is the default implementation: sun + hemisphere + linear distance fog. A project may pass its own.
import * as THREE from 'three';

export const LIGHTING_DEFAULTS = Object.freeze({
  sunColor: 0xfff1dc, hemiSky: 0xb8cfe6, hemiGround: 0x4a4636, fogColor: 0xc9d6d4, fogNear: 450, fogFar: 1600,
});

// Shared by every default (lighting hook, environment, sky, stage, spray): the direction toward the sun and the sky
// shader's clear-noon sun colour (linear RGB).
export const DEFAULT_SUN_DIRECTION = Object.freeze([0.3, 0.8, 0.5]);
export const CLEAR_NOON_SUN = Object.freeze([1, 0.96, 0.9]);

export const LIGHT_GLSL = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHemiSky; uniform vec3 uHemiGround;
uniform vec3 uFogColor; uniform vec2 uFogRange;
vec3 shade(vec3 albedo, vec3 n, float sunVisibility, float ao, float wrap) {
  float ndl = max((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0);
  vec3 hemi = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5);
  return albedo * (hemi * 0.55 * ao + uSunColor * ndl * sunVisibility * 1.1);
}
vec3 applyFog(vec3 color, float viewDistance) {
  return mix(color, uFogColor, smoothstep(uFogRange.x, uFogRange.y, viewDistance));
}`;

export const NOISE_GLSL = /* glsl */`
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float hash12(vec2 p) { return hash13(vec3(p, 17.0)); }
float valueNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;

// One uniform set, shared by reference between every material of a scene so sun / fog arrive once.
export function createLightingUniforms(options = {}) {
  const o = {...LIGHTING_DEFAULTS, ...options};
  return {
    uSunDir: {value: new THREE.Vector3(...DEFAULT_SUN_DIRECTION).normalize()},
    uSunColor: {value: new THREE.Color(o.sunColor)},
    uHemiSky: {value: new THREE.Color(o.hemiSky)},
    uHemiGround: {value: new THREE.Color(o.hemiGround)},
    uFogColor: {value: new THREE.Color(o.fogColor)},
    uFogRange: {value: new THREE.Vector2(o.fogNear, o.fogFar)},
  };
}

export function createLighting(options) {
  return {glsl: LIGHT_GLSL, uniforms: createLightingUniforms(options)};
}

// Drive the uniforms from ordinary Three lights (e.g. the ones the weather adapter animates) and the scene fog.
// Call once per frame. fogRange is used when the scene fog is FogExp2 (converted to a near/far pair) or absent.
const _dir = new THREE.Vector3();
export function syncLighting(uniforms, {sun, hemi, fog, fogRange} = {}) {
  if (sun) {
    _dir.copy(sun.position).sub(sun.target.position).normalize();
    uniforms.uSunDir.value.copy(_dir);
    uniforms.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
  }
  if (hemi) {
    uniforms.uHemiSky.value.copy(hemi.color).multiplyScalar(hemi.intensity);
    uniforms.uHemiGround.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity);
  }
  if (fog) {
    uniforms.uFogColor.value.copy(fog.color);
    if (fog.isFogExp2) {
      // Match the 2% / 98% transmittance distances of exp2 fog with a linear ramp.
      const d = Math.max(fog.density, 1e-6);
      uniforms.uFogRange.value.set(Math.sqrt(-Math.log(0.98)) / d, Math.sqrt(-Math.log(0.02)) / d);
    } else uniforms.uFogRange.value.set(fog.near, fog.far);
  } else if (fogRange) uniforms.uFogRange.value.set(fogRange[0], fogRange[1]);
}

// Same, from the shared environment (core/environment.js) instead of Three lights. Fog is left to the scene.
export function syncLightingFromEnvironment(uniforms, environment) {
  uniforms.uSunDir.value.copy(environment.sun.direction);
  uniforms.uSunColor.value.copy(environment.sun.color);
  uniforms.uHemiSky.value.copy(environment.ambient.sky);
  uniforms.uHemiGround.value.copy(environment.ambient.ground);
}
