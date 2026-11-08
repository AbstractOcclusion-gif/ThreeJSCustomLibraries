import * as THREE from 'three';
import {CLOUD_GLSL} from './cloud-density.js';

// Dry-land adaptation of WebAquarium's air composite. Scene depth ends each ray,
// and the live sky density field determines how much sunlight reaches it.
export function createSunScattering(cloudUniforms, sunDirection) {
 const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
 depth.minFilter = depth.magFilter = THREE.NearestFilter;
 const target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthTexture: depth});
 const uniforms = {
  ...cloudUniforms,
  sceneColor: {value: target.texture},
  sceneDepth: {value: depth},
  inverseProjection: {value: new THREE.Matrix4()},
  cameraWorld: {value: new THREE.Matrix4()},
  sunDirection: {value: sunDirection},
  scatterColor: {value: new THREE.Color()},
  shaftStrength: {value: 0},
  bankColor: {value: new THREE.Color()},
  bankSettings: {value: new THREE.Vector4()},
  bankOffset: {value: new THREE.Vector2()},
 };
 const geometry = new THREE.PlaneGeometry(2, 2);
 const material = new THREE.ShaderMaterial({
  uniforms, depthTest: false, depthWrite: false,
  vertexShader: `varying vec2 screenUV;
   void main() { screenUV = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
   varying vec2 screenUV;
   uniform sampler2D sceneColor;
   uniform highp sampler2D sceneDepth;
   uniform mat4 inverseProjection, cameraWorld;
   uniform vec3 sunDirection, scatterColor;
   uniform float shaftStrength;
   uniform vec3 bankColor;
   uniform vec4 bankSettings;
   uniform vec2 bankOffset;
   ${CLOUD_GLSL}
   const int VIEW_STEPS = 16;
   const int SHADOW_STEPS = 6;

   float bankHash(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
   }

   float bankNoise(vec3 p) {
    vec3 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec3 x = vec3(1, 0, 0), y = vec3(0, 1, 0), z = vec3(0, 0, 1);
    return mix(
     mix(mix(bankHash(cell), bankHash(cell+x), f.x),
         mix(bankHash(cell+y), bankHash(cell+x+y), f.x), f.y),
     mix(mix(bankHash(cell+z), bankHash(cell+x+z), f.x),
         mix(bankHash(cell+y+z), bankHash(cell+x+y+z), f.x), f.y), f.z);
   }

   float bankExtinction(vec3 p) {
    float elevation = (p.y - bankSettings.w) / bankSettings.y;
    float h = max(0.0, elevation);
    if (h >= 3.0) return 0.0;
    vec3 q = vec3((p.xz - bankOffset) / bankSettings.z, elevation * .6);
    float shape = bankNoise(q) * .72 + bankNoise(q * 2.03 + 17.0) * .28;
    return bankSettings.x * exp(-h * h) * smoothstep(.36, .72, shape);
   }

   float sunlightVisibility(vec3 p) {
    float tau = 0.0;
    if (uCloudOn > .5 && uCloudCoverage > 0.0) {
     float entry = max(0.0, (uCloudBottom - p.y) / sunDirection.y);
     float exitDistance = (uCloudBottom + uCloudThickness - p.y) / sunDirection.y;
     float segment = clamp(exitDistance - entry, 0.0, CLOUD_SUN_RANGE) / float(SHADOW_STEPS);
     if (segment > 0.0) {
      for (int i = 0; i < SHADOW_STEPS; i++) {
       vec3 samplePosition = p + sunDirection * (entry + (float(i) + .5) * segment);
       tau += cloudDensityAt(samplePosition, false) * segment;
      }
     }
    }
    vec2 highCloud = p.xz + sunDirection.xz * max(0.0, (uCirrusAltitude - p.y) / sunDirection.y);
    return exp(-tau) * (1.0 - cirrusOpacityAt(highCloud));
   }

   void main() {
    vec3 color = texture2D(sceneColor, screenUV).rgb;
    float depth = texture2D(sceneDepth, screenUV).r;
    vec4 view = inverseProjection * vec4(screenUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 ray = mat3(cameraWorld) * (view.xyz / view.w);
    vec3 direction = normalize(ray);
    vec3 origin = cameraWorld[3].xyz;
    float distanceToSurface = min(length(ray), 650.0);
    float mu = dot(direction, sunDirection);
    const float g = .55;
    float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
    float horizonFade = smoothstep(.01, .15, sunDirection.y);
    float stepLength = distanceToSurface / float(VIEW_STEPS);
    // Stable interleaved noise breaks up aligned sample planes without frame-to-frame flicker.
    float offset = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(.06711056, .00583715))));
    float transmittance = 1.0;
    float bankTransmittance = 1.0;
    float scattering = 0.0;
    for (int i = 0; i < VIEW_STEPS; i++) {
     vec3 p = origin + direction * ((float(i) + offset) * stepLength);
     float bankT = 1.0;
     if (bankSettings.x > 0.0) bankT = exp(-bankExtinction(p) * stepLength);
     if (shaftStrength > 0.0) {
      float localT = exp(-.0025 * exp(-max(p.y, 0.0) / 95.0) * stepLength);
      scattering += transmittance * bankTransmittance * (1.0 - localT * bankT) * sunlightVisibility(p);
      transmittance *= localT;
     }
     bankTransmittance *= bankT;
    }
    vec3 fogged = mix(bankColor, color, bankTransmittance);
    gl_FragColor = vec4(fogged + scatterColor * (scattering * phase * horizonFade * .16), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
 });
 const quad = new THREE.Mesh(geometry, material);
 quad.frustumCulled = false;
 const composite = new THREE.Scene();
 composite.add(quad);
 const screenCamera = new THREE.Camera();
 const size = new THREE.Vector2();
 return {
  render(renderer, scene, camera, color, strength, fogColor, banks, offset) {
   renderer.getDrawingBufferSize(size);
   if (size.x === 0 || size.y === 0) return;
   target.setSize(size.x, size.y);
   camera.updateMatrixWorld();
   uniforms.cameraWorld.value.copy(camera.matrixWorld);
   uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
   uniforms.scatterColor.value.copy(color).multiplyScalar(strength);
   uniforms.shaftStrength.value = strength;
   uniforms.bankColor.value.copy(fogColor);
   uniforms.bankSettings.value.copy(banks);
   uniforms.bankOffset.value.copy(offset);
   const scissorTest = renderer.getScissorTest();
   const autoClear = renderer.autoClear;
   try {
    renderer.setRenderTarget(target);
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(composite, screenCamera);
   } finally {
    renderer.setScissorTest(scissorTest);
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(null);
   }
  },
  dispose() {
   target.dispose();
   material.dispose();
   geometry.dispose();
  },
 };
}
