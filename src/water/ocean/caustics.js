import * as THREE from 'three';
import {FFT_SAMPLE_GLSL} from './fft.js';
import {SIM_SAMPLE_GLSL} from './sim-window.js';
import {createTargetScope} from './passes.js';
import {sunCovers} from '../../core/lighting.js';

// WebAquarium ocean/caustics.js. Each ocean owns the projected grid and map.
export const OCEAN_CAUSTIC_DEFAULTS = Object.freeze({
 on: true, resolution: 512, halfSize: 40, referenceDepth: 6,
 strength: 1, depthFade: .06, normalStrength: 1, gridSegments: 200,
});
const IOR = 1.333;
export const OCEAN_CAUSTIC_GLSL = `
 #define COAST_CAUSTICS
 uniform sampler2D tCaustics;
 uniform vec2 uCausticCenter;
 uniform vec3 uRefrLight;
 uniform float uCausticHalf, uCausticStrength, uCausticOn, uCausticDepthFade;
 float causticRaw(vec3 p) {
  if (uCausticOn < .5) return 1.0;
  vec2 mapXZ = p.xz - uRefrLight.xz * p.y / uRefrLight.y;
  vec2 uv = (mapXZ - uCausticCenter) / (2.0 * uCausticHalf) + .5;
  vec2 e = smoothstep(0.0, .1, uv) * (1.0 - smoothstep(.9, 1.0, uv));
  return mix(1.0, texture2D(tCaustics, uv).r, e.x * e.y);
 }
 float causticLight(vec3 p) {
  return 1.0 + (causticRaw(p) - 1.0) * uCausticStrength * exp(-uCausticDepthFade * max(0.0, -p.y)) * smoothstep(0.0, .3, -p.y);
 }`;

export function createOceanCaustics(fft, sun, settings, wake, cover) {
 const renderer = fft.renderer;
 const scope = createTargetScope(renderer);
 const s = {...OCEAN_CAUSTIC_DEFAULTS, ...settings};
 const target = new THREE.WebGLRenderTarget(s.resolution, s.resolution, {type: THREE.HalfFloatType, depthBuffer: false});
 const geometry = new THREE.PlaneGeometry(2, 2, s.gridSegments, s.gridSegments).rotateX(-Math.PI / 2);
 const uniforms = {
  tCaustics: {value: target.texture}, uCausticCenter: {value: new THREE.Vector2()},
  uCausticHalf: {value: s.halfSize}, uCausticDepth: {value: s.referenceDepth},
  uRefrLight: {value: new THREE.Vector3(0, -1, 0)}, uCausticOn: {value: 0},
  uCausticStrength: {value: s.strength}, uCausticDepthFade: {value: s.depthFade},
 };
 const covers = sunCovers(cover);
 const coverUniforms = Object.assign({}, ...covers.map(part => part.uniforms));
 const glsl = OCEAN_CAUSTIC_GLSL + (covers.length ? `
 #define OCEAN_SUN_COVER
 ${covers.map(part => part.glsl).join('\n')}
 vec3 oceanSunVisibility(vec3 p) {
  vec2 entry = p.xz - uRefrLight.xz * p.y / uRefrLight.y;
  vec3 worldPosition = vec3(entry.x, 0.0, entry.y);
  vec3 n = vec3(0.0);
  return ${covers.map(part => `(${part.air ?? part.read})`).join(' * ')};
 }` : '\n vec3 oceanSunVisibility(vec3 p) { return vec3(1.0); }');
 const material = new THREE.ShaderMaterial({
  uniforms: {...fft.uniforms, ...wake?.uniforms, ...uniforms, uLight: sun, uNormalStrength: {value: s.normalStrength}},
  side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  vertexShader: `
   uniform vec2 uCausticCenter;
   uniform float uCausticHalf, uCausticDepth, uNormalStrength;
   uniform vec3 uLight;
   varying vec3 vOld, vNew;
   ${FFT_SAMPLE_GLSL}
   ${wake ? SIM_SAMPLE_GLSL : ''}
   vec3 projectRay(vec3 p, vec3 r) { return p + r * ((-uCausticDepth - p.y) / min(-.05, r.y)); }
   void main() {
    vec2 xz = uCausticCenter + position.xz * uCausticHalf;
    ShoreData shore = shoreSample(xz);
    SurfWaveSample surf = surfSampleAt(xz, shore);
    float h = oceanDisplacementShore(xz, uCausticCenter, 1.0, shore, surf).y;
    OceanFftSum wave = oceanFftNormalSumShore(xz, shore);
    vec2 tilt = wave.tilt * surfAmbientWeight(surf.mask) - surf.slopeXZ;
    vec3 n = normalize(vec3(tilt.x * uNormalStrength, 1.0, tilt.y * uNormalStrength));
    ${wake ? 'float fade; vec4 ripple = sampleRipple(xz, fade); h += ripple.r; n = normalize(n + vec3(ripple.b, 0.0, ripple.a));' : ''}
    vec3 flatRay = refract(-uLight, vec3(0, 1, 0), 1.0 / ${IOR});
    vec3 ray = refract(-uLight, n, 1.0 / ${IOR});
    vOld = projectRay(vec3(xz.x, 0.0, xz.y), flatRay);
    vNew = projectRay(vec3(xz.x, h, xz.y), ray);
    vec2 mapXZ = vNew.xz + flatRay.xz * (uCausticDepth / flatRay.y);
    gl_Position = vec4((mapXZ - uCausticCenter) / uCausticHalf, 0.0, 1.0);
   }`,
  fragmentShader: `
   varying vec3 vOld, vNew;
   void main() {
    float oa = length(dFdx(vOld)) * length(dFdy(vOld));
    float na = length(dFdx(vNew)) * length(dFdy(vNew));
    gl_FragColor = vec4(min(oa / max(na, 1e-7), 8.0), 0.0, 0.0, 1.0);
   }`,
 });
 const scene = new THREE.Scene(), camera = new THREE.Camera();
 scene.background = new THREE.Color(0);
 const mesh = new THREE.Mesh(geometry, material);
 mesh.frustumCulled = false;
 scene.add(mesh);
 return {
  settings: s, uniforms: {...uniforms, ...coverUniforms}, glsl,
  update(position) {
   const direction = sun.value;
   const active = s.on && s.strength > 0 && direction.y > .025;
   uniforms.uCausticOn.value = active ? 1 : 0;
   if (!active) return;
   uniforms.uCausticStrength.value = s.strength;
   uniforms.uCausticCenter.value.set(position.x, position.z);
   const eta = 1 / IOR;
   uniforms.uRefrLight.value.set(-direction.x * eta,
    -Math.sqrt(1 - eta * eta * (1 - direction.y ** 2)), -direction.z * eta);
   scope(() => {
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
   });
  },
  dispose() {
   target.dispose();
   geometry.dispose();
   material.dispose();
  },
 };
}
