// Lighting contract shared by the lib's custom ShaderMaterials (leaved trees, water, ...).
// A material takes `lighting: {glsl, uniforms}`. The GLSL must declare the uniforms it needs and define
//   vec3 shade(vec3 albedo, vec3 n, float sunVisibility, float ao, float wrap)
//   vec3 applyFog(vec3 color, float viewDistance)
// It may also define LIGHT_SHADE_AT and
//   vec3 shadeAt(vec3 albedo, vec3 n, float sunVisibility, float ao, float wrap, vec3 worldPosition)
// for light that changes from place to place (ambient by place, point and spot lights); the lib's materials call it
// when it is there.
// This file is the default implementation: sun + hemisphere + linear distance fog. A project may pass its own.
// Light values are in Three's units (colour x intensity of a DirectionalLight / HemisphereLight) and shade() is the
// diffuse term of Three's lit materials, so a hook surface and a MeshStandardMaterial of the same colour match under the
// same lights. wrap > 0 softens the terminator (foliage); 0 is plain Lambert.
import * as THREE from 'three';

export const LIGHTING_DEFAULTS = Object.freeze({
  sunColor: 0xfff1dc, hemiSky: 0xb8cfe6, hemiGround: 0x4a4636, fogColor: 0xc9d6d4, fogNear: 450, fogFar: 1600,
  sunIntensity: 2.4, ambientIntensity: 1.3,   // clear noon, as the basic stage's DirectionalLight and HemisphereLight
});

// Shared by every default (lighting hook, environment, sky, stage, spray): the direction toward the sun and the sky
// shader's clear-noon sun colour (linear RGB).
export const DEFAULT_SUN_DIRECTION = Object.freeze([0.3, 0.8, 0.5]);
export const CLEAR_NOON_SUN = Object.freeze([1, 0.96, 0.9]);

// The ambient light of the default hook: `vec3 lightAmbient(vec3 n, vec3 worldPosition)`, the irradiance on a surface
// facing n. Here the hemisphere, the same everywhere. createLighting({ambient: {glsl, uniforms}}) swaps it for one
// that depends on the place (the light probes of the lighting module); its GLSL may use the hook's uniforms.
export const LIGHT_AMBIENT_GLSL = /* glsl */`
vec3 lightAmbient(vec3 n, vec3 worldPosition) { return mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5); }`;

// The lights of a place in the default hook: `vec3 lightLocal(vec3 n, vec3 worldPosition, float wrap)`, the irradiance
// that the point and spot lights give a surface facing n. Here none. createLighting({lights: {glsl, uniforms}}) swaps
// it for real ones (the light rig of the lighting module).
export const LIGHT_LOCAL_GLSL = /* glsl */`
vec3 lightLocal(vec3 n, vec3 worldPosition, float wrap) { return vec3(0.0); }`;

// The sun at a place in the default hook: `vec3 lightSunVisibility(vec3 worldPosition, vec3 n)`, the share of the
// sunlight that reaches a surface facing n (per colour: light through tinted glass). Here all of it. It multiplies
// the sunVisibility a material passes itself. createLighting({sun}) builds a real one from sun covers: everything
// that stands between the sun and a place. A sun cover is {glsl, uniforms, read, air?}: its GLSL (written so that it
// may come twice in a shader), and `read`, a GLSL expression of worldPosition and n giving the vec3 share of the
// sunlight it lets through; `air`, the same for a point of the air (of worldPosition alone, cheap: it is read at every
// step of a march), defaults to `read` with no normal. One cover or a list: the sun shadows of the lighting module,
// the cloud cover of the weather.
export const LIGHT_SUN_GLSL = /* glsl */`
vec3 lightSunVisibility(vec3 worldPosition, vec3 n) { return vec3(1.0); }`;
export function sunCovers(sun) {
  const covers = sun === undefined ? [] : Array.isArray(sun) ? sun : [sun];
  for (const cover of covers) {
    if (typeof cover?.glsl !== 'string' || typeof cover.uniforms !== 'object' || typeof cover.read !== 'string') throw Error('A sun cover needs glsl, uniforms and read');
  }
  return covers;
}
const sunGLSL = covers => covers.map(cover => cover.glsl).join('\n') + `
vec3 lightSunVisibility(vec3 worldPosition, vec3 n) { return ${covers.map(cover => `(${cover.read})`).join(' * ')}; }`;

export const lightingGLSL = (ambient = LIGHT_AMBIENT_GLSL, lights = LIGHT_LOCAL_GLSL, sun = LIGHT_SUN_GLSL) => /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHemiSky; uniform vec3 uHemiGround;
uniform vec3 uFogColor; uniform vec2 uFogRange;
const float LIGHT_RECIPROCAL_PI = 0.3183098861837907;   // Lambert: a white surface returns irradiance / pi, as Three's BRDF
${ambient}
${lights}
${sun}
#define LIGHT_SHADE_AT
vec3 shadeAt(vec3 albedo, vec3 n, float sunVisibility, float ao, float wrap, vec3 worldPosition) {
  float ndl = max((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0);
  return albedo * LIGHT_RECIPROCAL_PI * (lightAmbient(n, worldPosition) * ao + uSunColor * lightSunVisibility(worldPosition, n) * (ndl * sunVisibility) + lightLocal(n, worldPosition, wrap));
}
// Without a place: the sun and the hemisphere, whatever the ambient, the lights and the shadows.
vec3 shade(vec3 albedo, vec3 n, float sunVisibility, float ao, float wrap) {
  float ndl = max((dot(n, uSunDir) + wrap) / (1.0 + wrap), 0.0);
  return albedo * LIGHT_RECIPROCAL_PI * (mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) * ao + uSunColor * ndl * sunVisibility);
}
vec3 applyFog(vec3 color, float viewDistance) {
  return mix(color, uFogColor, smoothstep(uFogRange.x, uFogRange.y, viewDistance));
}`;
export const LIGHT_GLSL = lightingGLSL();

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
    uSunColor: {value: new THREE.Color(o.sunColor).multiplyScalar(o.sunIntensity)},
    uHemiSky: {value: new THREE.Color(o.hemiSky).multiplyScalar(o.ambientIntensity)},
    uHemiGround: {value: new THREE.Color(o.hemiGround).multiplyScalar(o.ambientIntensity)},
    uFogColor: {value: new THREE.Color(o.fogColor)},
    uFogRange: {value: new THREE.Vector2(o.fogNear, o.fogFar)},
  };
}

// options: LIGHTING_DEFAULTS overrides, `ambient: {glsl, uniforms}` (see LIGHT_AMBIENT_GLSL),
// `lights: {glsl, uniforms}` (see LIGHT_LOCAL_GLSL) and `sun`: one sun cover or a list of them (see LIGHT_SUN_GLSL).
export function createLighting({ambient, lights, sun, ...options} = {}) {
  const covers = sunCovers(sun);
  for (const [name, part] of [['ambient', ambient], ['lights', lights]]) {
    if (part !== undefined && (typeof part?.glsl !== 'string' || typeof part.uniforms !== 'object')) throw Error(`Lighting ${name} needs glsl and uniforms`);
  }
  const uniforms = {...createLightingUniforms(options), ...ambient?.uniforms, ...lights?.uniforms};
  for (const cover of covers) Object.assign(uniforms, cover.uniforms);
  return {glsl: ambient || lights || covers.length ? lightingGLSL(ambient?.glsl, lights?.glsl, covers.length ? sunGLSL(covers) : undefined) : LIGHT_GLSL, uniforms};
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

// One-bounce ground light: the light an open, matte ground of colour `albedo` sends back up, as the ground colour
// of a hemisphere light (colour x intensity, to write into HemisphereLight.groundColor / environment.ambient.ground /
// uHemiGround). The ground receives the sun by the height of the sun and the whole sky; a matte surface returns its
// colour's share of that. sunColor and skyColor are colour x intensity; sunDirection points toward the sun.
export function groundBounce(target, albedo, {sunColor, sunDirection, skyColor}) {
  const sunHeight = Math.max(sunDirection.y, 0);
  return target.setRGB(albedo.r * (sunColor.r * sunHeight + skyColor.r), albedo.g * (sunColor.g * sunHeight + skyColor.g), albedo.b * (sunColor.b * sunHeight + skyColor.b));
}

// Same, from the shared environment (core/environment.js) instead of Three lights. Fog is left to the scene.
export function syncLightingFromEnvironment(uniforms, environment) {
  uniforms.uSunDir.value.copy(environment.sun.direction);
  uniforms.uSunColor.value.copy(environment.sun.color);
  uniforms.uHemiSky.value.copy(environment.ambient.sky);
  uniforms.uHemiGround.value.copy(environment.ambient.ground);
}
