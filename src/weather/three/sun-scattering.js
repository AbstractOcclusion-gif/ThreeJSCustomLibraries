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
  waterDistance: {value: null},
  hasWaterDistance: {value: false},
  hasWaterPlane: {value: false},
  waterPlane: {value: new THREE.Vector4()},
  cameraNear: {value: .1},
  inverseProjection: {value: new THREE.Matrix4()},
  cameraWorld: {value: new THREE.Matrix4()},
  sunDirection: {value: sunDirection},
  scatterColor: {value: new THREE.Color()},
  shaftStrength: {value: 0},
  bankColor: {value: new THREE.Color()},
  bankSunColor: {value: new THREE.Color()},
  bankSunStrength: {value: 0},
  bankSettings: {value: new THREE.Vector4()},
  bankOffset: {value: new THREE.Vector2()},
  bankTime: {value: 0},
  wakeHead: {value: new THREE.Vector4()},
  wakeTail: {value: new THREE.Vector3()},
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
   uniform highp sampler2D waterDistance;
   uniform bool hasWaterDistance, hasWaterPlane;
   uniform vec4 waterPlane;
   uniform float cameraNear;
   uniform mat4 inverseProjection, cameraWorld;
   uniform vec3 sunDirection, scatterColor;
   uniform float shaftStrength;
   uniform vec3 bankColor, bankSunColor;
   uniform float bankSunStrength;
   uniform vec4 bankSettings;
   uniform vec2 bankOffset;
   uniform float bankTime;
   uniform vec4 wakeHead;
   uniform vec3 wakeTail;
   ${CLOUD_GLSL}
   const int VIEW_STEPS = 16;

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
    float roll = bankNoise(q * .83 + vec3(13.0, 7.0, -bankTime * .075)) - .5;
    q += vec3(.28, -.2, .7) * roll;
    float shape = bankNoise(q) * .72 + bankNoise(q * 2.03 + vec3(17.0, 17.0, 17.0 - bankTime * .12)) * .28;
    float wake = 1.0;
    if (wakeHead.w > 0.0) {
     vec3 axis = wakeTail - wakeHead.xyz;
     vec3 relative = p - wakeHead.xyz;
     float t = clamp(dot(relative, axis) / max(dot(axis, axis), .001), 0.0, 1.0);
     float distanceToWake = length(relative - axis * t) / wakeHead.w;
     wake -= .9 * (1.0 - t) * (1.0 - smoothstep(.2, 1.0, distanceToWake));
    }
    return bankSettings.x * exp(-h * h) * smoothstep(.36, .72, shape) * wake;
   }

   void main() {
    vec3 color = texture2D(sceneColor, screenUV).rgb;
    float depth = texture2D(sceneDepth, screenUV).r;
    vec4 view = inverseProjection * vec4(screenUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 ray = mat3(cameraWorld) * (view.xyz / view.w);
    vec3 direction = normalize(ray);
    vec3 origin = cameraWorld[3].xyz;
    float distanceToSurface = length(ray);
    if (hasWaterDistance) {
     float water = texture2D(waterDistance, screenUV).a;
     if (water > 0.0) distanceToSurface = min(distanceToSurface, water);
    }
    float airStart = 0.0, airEnd = distanceToSurface;
    // WebAquarium's local water-plane interval, limited to crossings near the eye.
    if (hasWaterPlane) {
     airStart = min(cameraNear / max(dot(direction, -cameraWorld[2].xyz), .001), airEnd);
     float side = dot(waterPlane.xyz, origin + direction * airStart) + waterPlane.w;
     float slope = dot(waterPlane.xyz, direction);
     if (side < 0.0) {
      if (slope <= .00001) airStart = airEnd;
      else {
       float crossing = -side / slope;
       airStart = mix(airEnd, min(airEnd, airStart + crossing), 1.0 - smoothstep(1.0, 2.0, crossing));
      }
     } else if (slope < -.00001) {
      float crossing = -side / slope;
      airEnd = mix(airEnd, min(airEnd, airStart + crossing), 1.0 - smoothstep(1.0, 2.0, crossing));
     }
    }
    distanceToSurface = min(airEnd - airStart, 650.0);
    origin += direction * airStart;
    if (distanceToSurface <= 0.0 || (shaftStrength <= 0.0 && bankSettings.x <= 0.0)) {
     gl_FragColor = vec4(color, 1.0);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
     return;
    }
    float mu = dot(direction, sunDirection);
    const float g = .55;
    float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
    float horizonFade = smoothstep(.01, .15, sunDirection.y);
    // Stable interleaved noise breaks up aligned sample planes without frame-to-frame flicker.
    float offset = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(.06711056, .00583715))));
    float transmittance = 1.0;
    float bankTransmittance = 1.0;
    float bankSun = 0.0;
    float bankLight = bankSunStrength * smoothstep(.01, .06, sunDirection.y);
    float scattering = 0.0;
    for (int i = 0; i < VIEW_STEPS; i++) {
     float a = float(i) / float(VIEW_STEPS);
     float b = float(i + 1) / float(VIEW_STEPS);
     // Keep nearby fog detail when the depth ray runs all the way to the sky.
     if (bankSettings.x > 0.0) { a *= a; b *= b; }
     float stepLength = (b - a) * distanceToSurface;
     vec3 p = origin + direction * (a * distanceToSurface + offset * stepLength);
     float bankT = 1.0;
     if (bankSettings.x > 0.0) bankT = exp(-bankExtinction(p) * stepLength);
     float bankOpacity = 1.0 - bankT;
     float visibility = 0.0;
     if (shaftStrength > 0.0 || (bankLight > 0.0 && bankOpacity > 0.0)) visibility = cloudGroundTransmittance(p, sunDirection);
     // Keep a broad warm contribution from the sky in cloud shadow.
     bankSun += bankTransmittance * bankOpacity * mix(.35, 1.0, visibility);
     if (shaftStrength > 0.0) {
      float localT = exp(-.0025 * exp(-max(p.y, 0.0) / 95.0) * stepLength);
      scattering += transmittance * bankTransmittance * (1.0 - localT) * visibility;
      transmittance *= localT;
     }
     bankTransmittance *= bankT;
    }
    vec3 fogged = mix(bankColor, color, bankTransmittance);
    fogged += (bankSunColor - bankColor) * (bankSun * bankLight * mix(.7, 1.0, smoothstep(-.2, .9, mu)));
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
  render(renderer, scene, camera, color, strength, fogColor, sunColor, sunStrength, banks, offset, time, wakeHead, wakeTail, input) {
   if (!input) {
    renderer.getDrawingBufferSize(size);
    if (size.x === 0 || size.y === 0) return;
    target.setSize(size.x, size.y);
   }
   camera.updateMatrixWorld();
   uniforms.sceneColor.value = input?.color ?? target.texture;
   uniforms.sceneDepth.value = input?.depth ?? depth;
   uniforms.hasWaterDistance.value = Boolean(input?.waterDistance);
   uniforms.waterDistance.value = input?.waterDistance ?? null;
   uniforms.hasWaterPlane.value = Boolean(input?.waterPlane);
   if (input?.waterPlane) uniforms.waterPlane.value.copy(input.waterPlane);
   uniforms.cameraNear.value = camera.near;
   uniforms.cameraWorld.value.copy(camera.matrixWorld);
   uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
   uniforms.scatterColor.value.copy(color).multiplyScalar(strength);
   uniforms.shaftStrength.value = strength;
   uniforms.bankColor.value.copy(fogColor);
   uniforms.bankSunColor.value.copy(sunColor);
   uniforms.bankSunStrength.value = sunStrength;
   uniforms.bankSettings.value.copy(banks);
   uniforms.bankOffset.value.copy(offset);
   uniforms.bankTime.value = time;
   uniforms.wakeHead.value.copy(wakeHead);
   uniforms.wakeTail.value.copy(wakeTail);
   const scissorTest = renderer.getScissorTest();
   const autoClear = renderer.autoClear;
   try {
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    if (!input) {
     renderer.setRenderTarget(target);
     renderer.render(scene, camera);
    }
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
