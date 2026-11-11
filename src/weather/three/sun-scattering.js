import * as THREE from 'three';
import {CLOUD_GLSL} from './cloud-density.js';

// Cloud shadow map for the sun shafts: sun rays are parallel, so whether a point is in cloud shadow depends only on
// where its ray crosses one horizontal plane. size texels cover a square of `cover` metres centred on the camera.
const SHADOW_MAP = Object.freeze({size: 384, cover: 16000});
// Sun rays show while the view direction is within this range of cosines to the sun: gone at the first, full at the second.
const RAY_FACING = [.1, .5];
const RAY_OFFSCREEN = .3;   // share of the half screen the sun may sit outside the frame before the rays are gone

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
  bankShape: {value: new THREE.Vector4()},
  shaftHaze: {value: new THREE.Vector4()},
  sunScreen: {value: new THREE.Vector3()},
  rayStrength: {value: 0},
  rayGlare: {value: 1},
  rainbow: {value: new THREE.Vector2()},
  cloudShadowMap: {value: null},
  shadowCentre: {value: new THREE.Vector3()},
  shadowCover: {value: SHADOW_MAP.cover},
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
   uniform vec4 bankSettings;   // density, falloff height (m), noise scale (m), base elevation (m)
   uniform vec4 bankShape;      // coverage, puffiness, sun glow, samples per pixel
   uniform vec4 shaftHaze;      // haze density (1/m at sea level), haze scale height (m), march range (m), shadow contrast
   const float BANK_RANGE = 650.0;   // m of air the fog bank is marched through
   const float BANK_TOP = 3.0;       // falloff heights above the base elevation where the bank ends
   const float BANK_OPAQUE = .02;    // light left through the bank below which the march stops
   const int SHAFT_STEPS = 40;       // haze samples per pixel for the sun shafts
   uniform sampler2D cloudShadowMap;
   uniform vec3 sunScreen;      // xy = the sun's position on screen (uv), z = 1 facing the sun, 0 with it behind
   uniform vec2 rainbow;        // strength of the primary bow, strength of the second bow
   uniform float rayStrength, rayGlare;   // rayGlare: scene brightness above which a sky pixel counts as sun glare
   uniform vec3 shadowCentre;
   uniform float shadowCover;
   uniform vec2 bankOffset;
   uniform float bankTime;
   uniform vec4 wakeHead;
   uniform vec3 wakeTail;
   ${CLOUD_GLSL}

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

   // Extinction per metre. light (0..1) is how much sky and sun reach the sample: tops are bright, dense cores dark.
   float bankExtinction(vec3 p, out float light) {
    const float billowFrequency = 4.3;     // billows per large fog shape
    const float billowWeight = .34;        // how far billows carve the shape at full puffiness
    const float lowestTop = .4;            // top height of the thinnest fog, as a share of the falloff height
    const float topRange = 1.3;            // extra top height under the thickest fog
    const vec2 softEdge = vec2(.36, .12);  // shape range from clear to full fog: smooth blanket, sharp puffs
    const float coreShade = .38;           // light left in the densest core
    light = 1.0;
    float elevation = (p.y - bankSettings.w) / bankSettings.y;
    if (elevation >= BANK_TOP) return 0.0;
    float coverage = bankShape.x, puffiness = bankShape.y;
    vec3 q = vec3((p.xz - bankOffset) / bankSettings.z, elevation * .6);
    float roll = bankNoise(q * .83 + vec3(13.0, 7.0, -bankTime * .075)) - .5;
    q += vec3(.28, -.2, .7) * roll;
    float body = bankNoise(q) * .72 + bankNoise(q * 2.03 + vec3(17.0, 17.0, 17.0 - bankTime * .12)) * .28;
    // Billows: rounded lumps where the fine noise folds, like the tops of cumulus.
    float billow = 1.0 - abs(bankNoise(q * billowFrequency + vec3(5.0, 31.0, bankTime * .2)) * 2.0 - 1.0);
    float shape = body + (billow - .5) * billowWeight * puffiness;
    // Thick fog stands taller than thin fog, so the top is lumpy instead of level.
    float top = mix(1.0, lowestTop + topRange * body, puffiness);
    float h = max(0.0, elevation) / top;
    float start = mix(.78, .18, coverage);
    float fill = smoothstep(start, start + mix(softEdge.x, softEdge.y, puffiness), shape) * exp(-h * h);
    float rise = clamp(h, 0.0, 1.0);
    light = mix(coreShade, 1.0, rise) * mix(1.0, coreShade, fill * puffiness * (1.0 - rise));
    float wake = 1.0;
    if (wakeHead.w > 0.0) {
     vec3 axis = wakeTail - wakeHead.xyz;
     vec3 relative = p - wakeHead.xyz;
     float t = clamp(dot(relative, axis) / max(dot(axis, axis), .001), 0.0, 1.0);
     float distanceToWake = length(relative - axis * t) / wakeHead.w;
     wake -= .9 * (1.0 - t) * (1.0 - smoothstep(.2, 1.0, distanceToWake));
    }
    return bankSettings.x * fill * wake;
   }

   // Sunlight reaching p through the clouds, read from the shadow map along p's own sun ray.
   float sunThroughClouds(vec3 p) {
    vec2 crossing = p.xz - sunDirection.xz * ((p.y - shadowCentre.y) / sunDirection.y);
    return texture2D(cloudShadowMap, (crossing - shadowCentre.xz) / shadowCover + .5).r;
   }

   // Light streaks: the glare of the sun seen through gaps is smeared away from the sun across the screen.
   // Clouds, terrain and trees are darker than the glare, so they cut the smear into rays.
   vec3 sunRays() {
    const int RAY_STEPS = 36;
    const float reach = .85;          // share of the way to the sun each pixel gathers light from
    const float falloff = .955;       // weight kept per step away from the pixel
    const float glareLimit = 10.0;    // brightest glare counted, so the bare disc does not swamp the rays
    vec2 stride = (sunScreen.xy - screenUV) * (reach / float(RAY_STEPS));
    float jitter = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(.06711056, .00583715))));
    vec2 uv = screenUV + stride * jitter;
    vec3 light = vec3(0.0);
    float weight = 1.0, total = 0.0;
    for (int i = 0; i < RAY_STEPS; i++) {
     uv += stride;
     // Beyond the screen edge there is nothing to read: no light comes from there.
     if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) break;
     vec3 seen = texture2D(sceneColor, uv).rgb;
     float sky = step(1.0, texture2D(sceneDepth, uv).r);
     float glare = clamp(max(seen.r, max(seen.g, seen.b)) - rayGlare, 0.0, glareLimit) * sky;
     light += seen / max(max(seen.r, max(seen.g, seen.b)), .001) * glare * weight;
     total += weight;
     weight *= falloff;
    }
    return light / total;
   }

   // Pure spectral colour: 0 violet, 1 red.
   vec3 spectrum(float t) {
    float hue = mix(.72, 0.0, clamp(t, 0.0, 1.0));
    return clamp(abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
   }

   // Light added by the rainbow along a view direction. Drops send colours back at fixed angles from the point
   // opposite the sun: 40.6-42.4 degrees for the primary bow (red outside), 50-53.5 for the second (red inside).
   // The sky is a little brighter inside the primary bow and darker between the two.
   vec3 rainbowLight(vec3 direction) {
    const vec2 primary = vec2(40.6, 42.4);
    const vec2 second = vec2(50.0, 53.5);
    const float edge = .6;               // degrees over which a bow fades at each side
    const float bowLight = .42;          // light a full-strength bow adds: a bow is translucent, never paint
    const float innerGlow = .06;         // white light inside the primary bow
    const float glowReach = 12.0;        // degrees the inner glow extends toward the centre
    float angle = degrees(acos(clamp(-dot(direction, sunDirection), -1.0, 1.0)));
    float inPrimary = smoothstep(primary.x - edge, primary.x + edge, angle) * (1.0 - smoothstep(primary.y - edge, primary.y + edge, angle));
    float inSecond = smoothstep(second.x - edge, second.x + edge, angle) * (1.0 - smoothstep(second.y - edge, second.y + edge, angle));
    vec3 light = spectrum((angle - primary.x) / (primary.y - primary.x)) * inPrimary * rainbow.x;
    light += spectrum(1.0 - (angle - second.x) / (second.y - second.x)) * inSecond * rainbow.y;
    light *= bowLight;
    light += vec3(innerGlow * rainbow.x) * smoothstep(primary.x - glowReach, primary.x, angle) * (1.0 - smoothstep(primary.x, primary.x + edge, angle));
    return light;
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
    float airDistance = airEnd - airStart;
    origin += direction * airStart;
    if (airDistance <= 0.0 || (shaftStrength <= 0.0 && bankSettings.x <= 0.0 && rainbow.x <= 0.0)) {
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
    float bankTransmittance = 1.0;
    float bankSun = 0.0;
    float bankShade = 0.0;
    float bankLight = bankSunStrength * smoothstep(.01, .06, sunDirection.y);
    if (bankSettings.x > 0.0) {
     // The bank lies under one height: march only the part of the ray below it, where the fog can be.
     float bankTop = bankSettings.w + BANK_TOP * bankSettings.y;
     float enter = 0.0, leave = min(airDistance, BANK_RANGE);
     if (origin.y > bankTop) enter = direction.y < 0.0 ? (bankTop - origin.y) / direction.y : leave;
     else if (direction.y > 0.0) leave = min(leave, (bankTop - origin.y) / direction.y);
     float inBank = leave - enter;
     int steps = inBank > 0.0 ? int(bankShape.w) : 0;
     for (int i = 0; i < steps; i++) {
      // Squared spacing keeps nearby fog detail when the ray runs a long way through the bank.
      float a = float(i) / bankShape.w, b = float(i + 1) / bankShape.w;
      a *= a; b *= b;
      float stepLength = (b - a) * inBank;
      vec3 p = origin + direction * (enter + a * inBank + offset * stepLength);
      float bankLit = 1.0;
      float bankT = exp(-bankExtinction(p, bankLit) * stepLength);
      float bankOpacity = 1.0 - bankT;
      float visibility = bankLight > 0.0 && bankOpacity > 0.0 ? sunThroughClouds(p) : 0.0;
      // Keep a broad warm contribution from the sky in cloud shadow.
      bankSun += bankTransmittance * bankOpacity * bankLit * mix(.35, 1.0, visibility);
      bankShade += bankTransmittance * bankOpacity * bankLit;
      bankTransmittance *= bankT;
      if (bankTransmittance < BANK_OPAQUE) break;   // nothing behind this much fog shows
     }
    }
    // Sun shafts: haze lit wherever the clouds let the sun through, marched far enough to reach the cloud shadows.
    float scattering = 0.0, unshadowed = 0.0;
    if (shaftStrength > 0.0) {
     float shaftDistance = min(airDistance, shaftHaze.z);
     float transmittance = 1.0;
     for (int i = 0; i < SHAFT_STEPS; i++) {
      // Squared spacing: short steps near the eye, long ones far away where a beam covers few pixels.
      float a = float(i) / float(SHAFT_STEPS), b = float(i + 1) / float(SHAFT_STEPS);
      a *= a; b *= b;
      float stepLength = (b - a) * shaftDistance;
      float travelled = a * shaftDistance + offset * stepLength;
      vec3 p = origin + direction * travelled;
      float localT = exp(-shaftHaze.x * exp(-max(p.y, 0.0) / shaftHaze.y) * stepLength);
      // A fog bank in front dims the beam. Its transmittance is known for the whole bank march only.
      float throughBank = mix(1.0, bankTransmittance, clamp(travelled / BANK_RANGE, 0.0, 1.0));
      float lit = transmittance * throughBank * (1.0 - localT);
      unshadowed += lit;
      scattering += lit * sunThroughClouds(p);
      transmittance *= localT;
     }
    }
    vec3 fogged = color * bankTransmittance + bankColor * bankShade;
    fogged += max(bankSunColor - bankColor, 0.0) * (bankSun * bankLight * bankShape.z * mix(.7, 1.0, smoothstep(-.2, .9, mu)));
    // Air in cloud shadow darkens what lies behind it; lit air glows. The glow is screened over the scene, so it
    // shows against terrain and cloud bases without washing out a sky that is already bright.
    const float glowScale = .16;
    float shade = min((unshadowed - scattering) * shaftHaze.w * horizonFade, .9);
    fogged *= 1.0 - shade;
    vec3 glow = scatterColor * (scattering * phase * horizonFade * glowScale);
    if (rayStrength > 0.0 && sunScreen.z > 0.0) glow += sunRays() * (rayStrength * sunScreen.z * horizonFade);
    if (rainbow.x > 0.0) {
     // The bow forms in the rain between the eye and the background: none in front of nearby things, full far away.
     const vec2 rainDepth = vec2(40.0, 500.0);   // m
     const float brightSkyLoss = .6;             // share of the bow lost against a sky that is already white
     float inRain = smoothstep(rainDepth.x, rainDepth.y, airDistance) * bankTransmittance;
     float brightness = clamp(max(fogged.r, max(fogged.g, fogged.b)), 0.0, 1.0);
     // A bow belongs to the sky: it fades out below the horizon instead of lying on the ground seen from above.
     const vec2 horizon = vec2(-.03, .05);       // view direction y
     float aboveHorizon = smoothstep(horizon.x, horizon.y, direction.y);
     glow += rainbowLight(direction) * inRain * aboveHorizon * horizonFade * (1.0 - brightSkyLoss * brightness);
    }
    gl_FragColor = vec4(fogged + glow * (1.0 - clamp(fogged, 0.0, 1.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
 });
 const shadowTarget = new THREE.WebGLRenderTarget(SHADOW_MAP.size, SHADOW_MAP.size, {depthBuffer: false});
 shadowTarget.texture.minFilter = shadowTarget.texture.magFilter = THREE.LinearFilter;
 uniforms.cloudShadowMap.value = shadowTarget.texture;
 const shadowMaterial = new THREE.ShaderMaterial({
  uniforms: {...cloudUniforms, sunDirection: uniforms.sunDirection, shadowCentre: uniforms.shadowCentre, shadowCover: uniforms.shadowCover},
  depthTest: false, depthWrite: false,
  vertexShader: `varying vec2 mapUV;
   void main() { mapUV = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
   varying vec2 mapUV;
   uniform vec3 sunDirection, shadowCentre;
   uniform float shadowCover;
   ${CLOUD_GLSL}
   void main() {
    vec2 ground = shadowCentre.xz + (mapUV - .5) * shadowCover;
    gl_FragColor = vec4(vec3(cloudGroundTransmittance(vec3(ground.x, shadowCentre.y, ground.y), sunDirection)), 1.0);
   }`,
 });
 const shadowQuad = new THREE.Mesh(geometry, shadowMaterial);
 shadowQuad.frustumCulled = false;
 const shadowScene = new THREE.Scene();
 shadowScene.add(shadowQuad);
 const quad = new THREE.Mesh(geometry, material);
 quad.frustumCulled = false;
 const composite = new THREE.Scene();
 composite.add(quad);
 const screenCamera = new THREE.Camera();
 const size = new THREE.Vector2();
 const forward = new THREE.Vector3(), sunPoint = new THREE.Vector3();
 return {
  render(renderer, scene, camera, color, strength, haze, rays, glare, fogColor, sunColor, sunStrength, banks, shape, offset, time, wakeHead, wakeTail, bow, input) {
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
   uniforms.shaftHaze.value.copy(haze);
   // Where the sun sits on screen. Rays fade out as the camera turns away from it.
   const facing = camera.getWorldDirection(forward).dot(uniforms.sunDirection.value);
   sunPoint.setFromMatrixPosition(camera.matrixWorld).addScaledVector(uniforms.sunDirection.value, camera.far * .5).project(camera);
   // With the sun outside the frame there is no glare on screen to spread: the rays fade out over RAY_OFFSCREEN.
   const outside = Math.max(Math.abs(sunPoint.x) - 1, Math.abs(sunPoint.y) - 1, 0);
   const onScreen = 1 - THREE.MathUtils.smoothstep(outside, 0, RAY_OFFSCREEN);
   uniforms.sunScreen.value.set(sunPoint.x * .5 + .5, sunPoint.y * .5 + .5, onScreen * THREE.MathUtils.smoothstep(facing, RAY_FACING[0], RAY_FACING[1]));
   uniforms.rayStrength.value = strength > 0 ? rays : 0;
   uniforms.rayGlare.value = glare;
   uniforms.rainbow.value.copy(bow);
   uniforms.bankColor.value.copy(fogColor);
   uniforms.bankSunColor.value.copy(sunColor);
   uniforms.bankSunStrength.value = sunStrength;
   uniforms.bankSettings.value.copy(banks);
   uniforms.bankShape.value.copy(shape);
   uniforms.bankOffset.value.copy(offset);
   uniforms.bankTime.value = time;
   uniforms.wakeHead.value.copy(wakeHead);
   uniforms.wakeTail.value.copy(wakeTail);
   const scissorTest = renderer.getScissorTest();
   const autoClear = renderer.autoClear;
   try {
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    if (strength > 0 || sunStrength > 0) {
     uniforms.shadowCentre.value.setFromMatrixPosition(camera.matrixWorld);
     renderer.setRenderTarget(shadowTarget);
     renderer.render(shadowScene, screenCamera);
    }
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
   shadowTarget.dispose();
   shadowMaterial.dispose();
   material.dispose();
   geometry.dispose();
  },
 };
}
