import * as THREE from 'three';
import {JERLOV} from './jerlov.js';
import {OCEAN_CAUSTIC_GLSL} from './ocean/caustics.js';
import {POND_OPTICS_GLSL} from './pond-optics.js';
import {createRenderScope} from '../core/render-state.js';

// WebAquarium ocean/composite.js: split the camera near plane at the local water
// plane and integrate only the submerged part of each view ray.
export function createWaterlineComposite(renderer, {caustics} = {}) {
 const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
 const target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthTexture: depth});
 const uniforms = {
  tScene: {value: target.texture}, tDepth: {value: depth}, uInvVP: {value: new THREE.Matrix4()},
  tWater: {value: null}, uWaterLayer: {value: false}, uUnderOn: {value: true},
  uCamPos: {value: new THREE.Vector3()}, uCamForward: {value: new THREE.Vector3()}, uNear: {value: .1},
  uPlaneN: {value: new THREE.Vector3(0, 1, 0)}, uPlaneD: {value: 0}, uSurfaceY: {value: 0},
  uExtinction: {value: new THREE.Vector3()}, uFogDensity: {value: 1},
  uDepthDarken: {value: .6}, uScatterIntensity: {value: 1}, uAnisotropy: {value: .6},
  uBodyColor: {value: new THREE.Color()},
  uMeniscus: {value: .03}, uSunDir: {value: new THREE.Vector3(0, 1, 0)},
  uSunCol: {value: new THREE.Color(1, .95, .85)}, uAmbCol: {value: new THREE.Color(.4, .5, .6)},
  ...(caustics ? {...caustics.uniforms, uGodStrength: {value: 1}} : {}),
 };
 const material = new THREE.ShaderMaterial({
  uniforms, depthTest: false, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
   varying vec2 vUv;
   uniform sampler2D tScene;
   uniform highp sampler2D tDepth, tWater;
   uniform bool uWaterLayer, uUnderOn;
   uniform mat4 uInvVP;
   uniform vec3 uCamPos, uCamForward, uPlaneN, uExtinction, uBodyColor, uSunDir, uSunCol, uAmbCol;
   uniform float uNear, uPlaneD, uSurfaceY, uFogDensity, uDepthDarken, uScatterIntensity, uAnisotropy, uMeniscus;
   ${caustics ? (caustics.glsl ?? OCEAN_CAUSTIC_GLSL) : ''}
   ${caustics?.lightsBed ? '#define POND_BED_CAUSTICS' : ''}
   ${caustics?.screenBed ? '#define POND_SCREEN_CAUSTICS' : ''}
   ${caustics?.pondOptics ? '#define POND_OPTICS\n' + POND_OPTICS_GLSL : ''}
   vec3 downwelling(float y) {
    return exp(-uExtinction * (uDepthDarken * max(0.0, uSurfaceY - y)));
   }
   float schlickPhase(float g, float c) {
    float k = 1.55 * g - 0.55 * g * g * g;
    float d = 1.0 - k * c;
    return (1.0 - k * k) / (4.0 * 3.14159265 * d * d);
   }
   #ifdef COAST_CAUSTICS
   uniform float uGodStrength;
   #ifdef POND_BED_CAUSTICS
   uniform float shaftLength, godFalloff;
   uniform vec3 godColor;
   uniform int godSteps;
   #endif
   vec3 godMarch(vec3 origin, vec3 dir, float L) {
    #ifdef POND_BED_CAUSTICS
    float stepLength = min(L, shaftLength) / float(godSteps);
    #else
    float stepLength = min(L, 40.0) / 8.0;
    #endif
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 accum = vec3(0.0);
    #ifdef POND_BED_CAUSTICS
    for (int i = 0; i < 40; i++) {
     if (i >= godSteps) break;
    #else
    for (int i = 0; i < 8; i++) {
    #endif
     float t = (float(i) + jitter) * stepLength;
     vec3 p = origin + dir * t;
     #ifdef POND_BED_CAUSTICS
     float focus = pondShaftFocus(p) * pondShadow(p, fract(jitter + float(i) * .618));
     accum += godColor * clamp(focus - .75, 0.0, 5.0) * exp(-t * godFalloff) * downwelling(p.y) * stepLength;
     #else
     float shaft = max(0.0, 1.0 + (causticRaw(p) - 1.0) * uCausticStrength);
     accum += downwelling(p.y) * shaft * uExtinction * uFogDensity * exp(-uExtinction * uFogDensity * t) * stepLength;
     #endif
    }
    return accum;
   }
   #endif
   void main() {
    vec3 color = texture2D(tScene, vUv).rgb;
    float z = texture2D(tDepth, vUv).r;
    vec4 p4 = uInvVP * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
    vec3 p = p4.xyz / p4.w;
    vec3 toP = p - uCamPos;
    float dist = length(toP);
    vec3 dir = toP / max(dist, 1e-5);
    float nearDistance = uNear / max(dot(dir, uCamForward), .001);
    if (uWaterLayer) {
     vec4 water = texture2D(tWater, vUv);
     float separation = dist - water.a;
     float shoreAA = max(.002, min(.15, fwidth(separation)));
     float waterWeight = water.a > 0.0 ? smoothstep(-shoreAA, shoreAA, separation) : 0.0;
     waterWeight *= smoothstep(nearDistance, nearDistance + uNear * .75, water.a);
     color = mix(color, water.rgb, waterWeight);
     if (water.a > 0.0 && water.a < dist) {
      dist = mix(dist, water.a, waterWeight);
      p = uCamPos + dir * dist;
     }
    }
    if (uUnderOn) {
    vec3 nearPoint = uCamPos + dir * nearDistance;
    float side = dot(uPlaneN, nearPoint) + uPlaneD;
    float sideWidth = fwidth(side);
    if (side < 0.0) {
     float L = max(0.0, dist - nearDistance);
     float denom = dot(uPlaneN, dir);
     if (denom > 1e-5) {
      float tExit = -side / denom;
      L = mix(L, min(L, tExit), 1.0 - smoothstep(1.0, 2.0, tExit));
     }
     float depthMid = nearPoint.y + dir.y * L * .5;
     float phase = schlickPhase(uAnisotropy, dot(uSunDir, -dir));
     vec3 lightSun = phase * uSunCol;
     float marchWeight = 0.0;
     #ifdef COAST_CAUSTICS
     if (uCausticOn > .5) marchWeight = clamp(uGodStrength, 0.0, 1.0);
     #endif
     vec3 inscatter = uBodyColor * uScatterIntensity * (uAmbCol + lightSun * (1.0 - marchWeight)) * downwelling(depthMid);
     vec3 absorb = exp(-uExtinction * uFogDensity * L);
     #ifdef POND_SCREEN_CAUSTICS
     if (z < 1.0) color *= max(vec3(0.0), 1.0 + uSunCol * pondBedFocus(p) * pondShadow(p, .5) * uCausticStrength);
     #endif
     #ifdef POND_OPTICS
     vec3 submerged = pondRadiance(color, L, max(0.0, uSurfaceY - depthMid), uSunCol, uAmbCol);
     #else
     vec3 submerged = mix(inscatter, color * downwelling(p.y), absorb);
     #endif
     #ifdef COAST_CAUSTICS
     #ifdef POND_BED_CAUSTICS
     if (marchWeight > 0.0) submerged += uSunCol * godMarch(nearPoint, dir, L) * uGodStrength * .6;
     #else
     if (marchWeight > 0.0) submerged += uBodyColor * uScatterIntensity * lightSun * godMarch(nearPoint, dir, L) * uGodStrength;
     #endif
     #endif
     color = mix(color, submerged, 1.0 - smoothstep(-max(.003, sideWidth), 0.0, side));
    }
    float width = min(uMeniscus, max(.00001, 3.0 * sideWidth));
    float band = 1.0 - smoothstep(0.0, max(width, .000001), abs(side));
    color = mix(color, color * .6 + uBodyColor * .8 + .25, band * .7);
    }
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
 });
 const geometry = new THREE.PlaneGeometry(2, 2);
 const quad = new THREE.Mesh(geometry, material);
 quad.frustumCulled = false;
 const composite = new THREE.Scene(), quadCamera = new THREE.Camera();
 composite.add(quad);
 const size = new THREE.Vector2(), corner = new THREE.Vector3();
 const scope = createRenderScope(renderer, {clearColor: false});
 const normal = uniforms.uPlaneN.value;

 // height is the plane height at the camera's xz, with optional slopes from the host's surface probes.
 function configure(camera, {height, slopeX = 0, slopeZ = 0, waterType = 'Open ocean II', bodyGain = .45,
  clarity = 1, sunDirection, sunColor, ambientColor, underwater = true, godRays = 1}) {
   camera.updateWorldMatrix(true, false);
   const eye = camera.getWorldPosition(uniforms.uCamPos.value);
   normal.set(-slopeX, 1, -slopeZ).normalize();
   const planeD = -(normal.x * eye.x + normal.y * height + normal.z * eye.z);
   let nearestSide = Infinity;
   for (const x of [-1, 1]) for (const y of [-1, 1]) {
    corner.set(x, y, -1).unproject(camera);
    nearestSide = Math.min(nearestSide, normal.dot(corner) + planeD);
   }
   uniforms.uUnderOn.value = underwater && nearestSide <= uniforms.uMeniscus.value;
   uniforms.uPlaneD.value = planeD;
   uniforms.uSurfaceY.value = height;
   uniforms.uNear.value = camera.near;
   const water = Object.hasOwn(JERLOV, waterType) ? JERLOV[waterType] : JERLOV['Open ocean II'];
   uniforms.uExtinction.value.fromArray(water.extinction);
   uniforms.uBodyColor.value.setRGB(...water.body, THREE.SRGBColorSpace).multiplyScalar(bodyGain);
   uniforms.uFogDensity.value = 1 / Math.max(.05, clarity);
   if (caustics) uniforms.uGodStrength.value = godRays;
   camera.getWorldDirection(uniforms.uCamForward.value);
   uniforms.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
   if (sunDirection) uniforms.uSunDir.value.copy(sunDirection);
   if (sunColor) uniforms.uSunCol.value.copy(sunColor);
   if (ambientColor) uniforms.uAmbCol.value.copy(ambientColor);
   return uniforms.uUnderOn.value;
 }
 return {
  uniforms,
  renderLayers(sceneTarget, waterTarget, camera, options) {
   configure(camera, options);
   uniforms.tScene.value = sceneTarget.texture;
   uniforms.tDepth.value = sceneTarget.depthTexture;
   uniforms.tWater.value = waterTarget.texture;
   uniforms.uWaterLayer.value = true;
   renderer.render(composite, quadCamera);
  },
  render(scene, camera, options) {
   if (!configure(camera, options)) {
    renderer.render(scene, camera);
    return;
   }
   uniforms.tScene.value = target.texture;
   uniforms.tDepth.value = depth;
   uniforms.uWaterLayer.value = false;
   const previous = renderer.getRenderTarget();
   if (previous) size.set(previous.width, previous.height);
   else renderer.getDrawingBufferSize(size);
   target.setSize(size.x, size.y);
   scope(() => {
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
   });
   renderer.render(composite, quadCamera);
  },
  dispose() {
   target.dispose();
   geometry.dispose();
   material.dispose();
  },
 };
}
