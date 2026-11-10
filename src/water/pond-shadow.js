import * as THREE from 'three';
import {createTargetScope} from './ocean/passes.js';

// WebAquarium rendering/shadow.js and shaders/common.js: rasterize the highest
// occluder along refracted sunlight, then jitter the lookup along each view ray.
const HEIGHT_OFFSET = 10;
export const POND_SHADOW_GLSL = `
 #define POND_SHAFT_SHADOWS
 uniform sampler2D tPondShadow;
 uniform mat4 pondShadowVP;
 uniform float pondShadowOn, pondShadowStrength, pondShaftSoftness, pondShadowTexel;
 float pondShadow(vec3 p, float r) {
  if (pondShadowOn < .5) return 1.0;
  vec4 c = pondShadowVP * vec4(p, 1.0);
  vec2 uv = c.xy / c.w * .5 + .5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
  uv += (vec2(fract(r * 7.13), fract(r * 3.71 + .37)) - .5) * pondShadowTexel * pondShaftSoftness;
  float y = texture2D(tPondShadow, uv).r;
  return y > 0.0 && y - ${HEIGHT_OFFSET.toFixed(1)} > p.y + .03 ? 1.0 - pondShadowStrength * .8 : 1.0;
 }`;

export function createPondShadow(renderer, casters, resolution = 512) {
 const target = new THREE.WebGLRenderTarget(resolution, resolution, {
  type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
 });
 const scope = createTargetScope(renderer), scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
 scene.background = new THREE.Color(0);
 const material = new THREE.ShaderMaterial({side: THREE.DoubleSide,
  vertexShader: `varying float vY; void main() {
   vec4 wp = vec4(position, 1.0);
   #ifdef USE_INSTANCING
   wp = instanceMatrix * wp;
   #endif
   wp = modelMatrix * wp; vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp;
  }`,
  fragmentShader: `varying float vY; void main(){ gl_FragColor = vec4(vY + ${HEIGHT_OFFSET.toFixed(1)}, 0.0, 0.0, 1.0); }`,
 });
 const copies = new Map(), center = new THREE.Vector3();
 const uniforms = {tPondShadow: {value: target.texture}, pondShadowVP: {value: new THREE.Matrix4()},
  pondShadowOn: {value: 0}, pondShadowStrength: {value: .7}, pondShaftSoftness: {value: 4}, pondShadowTexel: {value: 1 / resolution}};
 let frame = 0;
 return {
  uniforms,
  render(bounds, level, direction, {shadowStrength = .7, shaftSoftness = 4, shadowEvery = 2} = {}) {
   uniforms.pondShadowOn.value = shadowStrength > 0 && casters.length > 0 ? 1 : 0;
   uniforms.pondShadowStrength.value = shadowStrength;
   uniforms.pondShaftSoftness.value = shaftSoftness;
   if (!uniforms.pondShadowOn.value || frame++ % Math.max(1, shadowEvery | 0)) return;
   const half = Math.max(bounds.z, bounds.w) * .62;
   Object.assign(camera, {left: -half, right: half, top: half, bottom: -half, near: .05, far: 4 * half});
   center.set(bounds.x + bounds.z * .5, level - .5, bounds.y + bounds.w * .5);
   camera.position.copy(center).addScaledVector(direction, -2 * half);
   camera.up.set(0, 0, -1);
   camera.lookAt(center);
   camera.updateProjectionMatrix(); camera.updateMatrixWorld();
   uniforms.pondShadowVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
   for (const [mesh, copy] of copies) if (!casters.includes(mesh)) { scene.remove(copy); copies.delete(mesh); }
   for (const mesh of casters) {
    let copy = copies.get(mesh);
    if (!copy) {
     copy = mesh.isInstancedMesh ? new THREE.InstancedMesh(mesh.geometry, material, 0) : new THREE.Mesh(mesh.geometry, material);
     copy.matrixAutoUpdate = false; copy.frustumCulled = false;
     copies.set(mesh, copy); scene.add(copy);
    }
    mesh.updateWorldMatrix(true, false);
    copy.geometry = mesh.geometry; copy.matrix.copy(mesh.matrixWorld); copy.visible = mesh.visible;
    if (mesh.isInstancedMesh) { copy.instanceMatrix = mesh.instanceMatrix; copy.count = mesh.count; }
   }
   scope(() => { renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera); });
  },
  dispose() { material.dispose(); target.dispose(); scene.clear(); copies.clear(); },
 };
}
