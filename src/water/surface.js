import * as THREE from 'three';
import {createWaveBank, WIND_WAVE_GLSL} from './waves.js';
import {proceduralSky} from './sky-binding.js';
import {createFoamTexture} from './foam-texture.js';
import {ICE_COVERAGE_GLSL, ICE_MAP_SCALE, ICE_PATTERN_GLSL, createIceLook, iceLookUniforms} from './freeze.js';
import {createPlanarCapture} from './planar-capture.js';
import {POND_OPTICS_GLSL} from './pond-optics.js';
import {createPondShadow, POND_SHADOW_GLSL} from './pond-shadow.js';
import {createRenderScope} from '../core/render-state.js';

// WebAquarium's Fishing pond reflection settings.
export const POND_REFLECTION_DEFAULTS = Object.freeze({on: true, mix: .75, distort: .08, resolution: 512, hz: 15, floor: .15});
// What render(seconds, settings) uses for a setting the host leaves out. clarity drives the refraction; pondClarity is the
// pond-optics clarity, read from the same settings.clarity but with its own default.
export const CHANNEL_RENDER_DEFAULTS = Object.freeze({
  clarity: 1, pondClarity: .93, haze: .25, depthDark: 1.2, bankFoam: 1, godRays: 0,
  f0: .02, fresnelPower: 5, sunGlint: .07, reflection: 1, rippleStrength: 1, microRipples: 0,
  caustics: 0, causticDepth: 2.4, causticFalloff: .35, causticFocus: .3, causticNormalScale: 1,
  shaftLength: 4, godFalloff: .9, godSteps: 24, godColor: '#bfeaff', pondColor: '#377e68',
  waveHeight: 0, wavelength: 1.2, waveDirection: 0, waveSpread: Math.PI / 4,   // m, m, rad, rad
});
const MAX_GOD_STEPS = 40;             // ray-march steps of the light shafts, upper bound
const WATER_IOR = 1.333;              // refraction of the sun direction into the water
const MIN_SUN_HEIGHT = .025;          // sun direction y: below this no caustics, shafts or pond shadow are drawn
const MIN_MIRROR_EYE_HEIGHT = .005;   // m: an eye this close to the surface skips the planar mirror
const CAUSTIC_MAP_SIZE = 512;         // texels of the projected caustic map
const POND_CAUSTIC_MIP = 2.5;         // mip bias the volumetric shafts read the caustic map at (pond optics)
const FALLBACK_AMBIENT = [.3, .3, .3];   // pond ambient when the sky hook has no uAmb
const POND_ICE_LIGHT_GLSL = `
 uniform float freezeProgress;
 uniform sampler2D iceDamageMap;
 uniform vec4 iceDamageBounds;
 uniform bool iceHasDamage;
 float pondLightThroughIce(vec2 entry) {
  if (freezeProgress < 1.0) return 1.0;
  if (!iceHasDamage) return 0.0;
  vec2 uv = (entry - iceDamageBounds.xy) / iceDamageBounds.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return 0.0;
  return textureLod(iceDamageMap, uv, 0.0).r;
 }`;
const POND_CAUSTICS_GLSL = `
 #define COAST_CAUSTICS
 uniform sampler2D causticMap;
 uniform vec4 rippleBounds;
 uniform vec3 pondRefractedSun;
 uniform float pondLightLevel, uCausticOn, uCausticStrength, causticFalloff, causticFocus, pondCausticMip;
 vec2 pondSunEntry(vec3 p) {
  float depth = pondLightLevel - p.y;
  return p.xz + pondRefractedSun.xz * depth / pondRefractedSun.y;
 }
 float causticRawLevel(vec2 entry, float lod) {
  if (uCausticOn < .5) return 1.0;
  vec2 uv = (entry - rippleBounds.xy) / rippleBounds.zw;
  vec2 edge = smoothstep(0.0, .05, uv) * (1.0 - smoothstep(.95, 1.0, uv));
  return mix(1.0, textureLod(causticMap, uv, lod).r, edge.x * edge.y);
 }
 float pondShaftFocus(vec3 p) {
  vec2 entry = pondSunEntry(p);
  return causticRawLevel(entry, pondCausticMip) * pondLightThroughIce(entry);
 }
 #ifndef POND_SHAFT_SHADOWS
 float pondShadow(vec3 p, float r) { return 1.0; }
 #endif
 float pondBedFocus(vec3 p) {
  float depth = max(0.0, pondLightLevel - p.y);
  float focus = causticFocus > 0.0 ? smoothstep(0.0, causticFocus, depth) : 1.0;
  // A small filter footprint suppresses the projection mesh's triangle edges on the bed.
  vec2 entry = pondSunEntry(p);
  float projectedLight = causticRawLevel(entry, max(0.0, pondCausticMip - 1.0));
  return clamp(projectedLight - 1.0, -.65, 4.0) * pondLightThroughIce(entry) * focus * exp(-depth * causticFalloff);
 }`;

// Both passes must see the same continuous height field. The ripple DataTexture
// uses nearest sampling; sampling it directly produces bands in projected light.
const RIPPLE_HEIGHT_GLSL = `
 float ripple(vec2 uv) {
  vec2 size = vec2(textureSize(rippleMap, 0));
  vec2 p = uv * size - .5;
  vec2 i = floor(p), f = fract(p);
  vec2 q = (i + .5) / size, d = 1.0 / size;
  return mix(mix(texture2D(rippleMap, q).r, texture2D(rippleMap, q + vec2(d.x,0)).r, f.x),
   mix(texture2D(rippleMap, q + vec2(0,d.y)).r, texture2D(rippleMap, q+d).r, f.x), f.y);
 }`;

// Inland water surface (river / pond): refraction against a half-resolution bed capture, Beer-Lambert absorption, wind-wave
// bank, interactive ripples, rock wakes, baked flow foam, underwater light shafts. Draws the sky through the `sky` hook:
// {glsl, uniforms, defines} where glsl defines vec3 sky(vec3 dir, float sunMul) and the uniforms carry uSkySun, uSunCol,
// uDaylight (see sky-binding.js: skyFromWeather(view) or proceduralSky()). foamTexture (rgba tile: r/g brightness,
// b density threshold, a coverage) is optional; without it a generated tile is used.
// The host calls render(seconds, settings) once per frame (it captures the bed), then draws the scene itself.
export function createChannelSurface({renderer, scene, camera, sky = proceduralSky(), ripples, obstacles, flow, foamTexture, freezeMap, iceDamage, iceLook = createIceLook(), captureScale = .5, causticSegments = 160, clipToBed = false, pondOptics = false, bedCaustics = 'screen', lightOccluders}) {
 if (!renderer || !scene || !camera || !ripples || !obstacles || !flow) throw Error('Channel surface needs renderer, scene, camera, ripples, obstacles and flow');
 const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
 const capture = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthTexture: depth});
 const waves = createWaveBank();
 const causticTarget = new THREE.WebGLRenderTarget(CAUSTIC_MAP_SIZE, CAUSTIC_MAP_SIZE, {type: THREE.HalfFloatType, depthBuffer: false,
  ...(pondOptics ? {generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter} : {})});
 const causticGrid = new THREE.PlaneGeometry(2, 2, causticSegments, causticSegments).rotateX(-Math.PI / 2);
 const shadow = lightOccluders ? createPondShadow(renderer, lightOccluders) : null;
 const iceLightingGLSL = iceDamage ? POND_ICE_LIGHT_GLSL : 'float pondLightThroughIce(vec2 entry) { return 1.0; }';
 const lightingGLSL = (shadow ? POND_SHADOW_GLSL : '') + iceLightingGLSL + POND_CAUSTICS_GLSL;
 const ownsFoam = !foamTexture;
 const foamTile = foamTexture ?? createFoamTexture();
 foamTile.wrapS = foamTile.wrapT = THREE.RepeatWrapping;
 const R = CHANNEL_RENDER_DEFAULTS;
 const uniforms = {
  ...shadow?.uniforms,
  ...sky.uniforms,
  ...waves.uniforms,
  bedColor: {value: capture.texture},
  bedDepth: {value: depth},
  clipRange: {value: new THREE.Vector2(camera.near, camera.far)},
  bedClipToWorld: {value: new THREE.Matrix4()},
  causticMap: {value: causticTarget.texture},
  causticDepth: {value: R.causticDepth},
  causticFalloff: {value: R.causticFalloff},
  causticFocus: {value: R.causticFocus},
  causticNormalScale: {value: R.causticNormalScale},
  // Volumetric shafts are a wide light sample; use filtered projection to avoid
  // reading the caustic triangles as a checker pattern through the volume.
  pondCausticMip: {value: pondOptics ? POND_CAUSTIC_MIP : 0},
  uCausticOn: {value: 0},
  pondLightLevel: {value: 0},
  pondRefractedSun: {value: new THREE.Vector3(0, -1, 0)},
  shaftLength: {value: R.shaftLength},
  godFalloff: {value: R.godFalloff},
  godColor: {value: new THREE.Color(R.godColor)},
  godSteps: {value: R.godSteps},
  pondGodHalf: {value: false}, tPondGod: {value: null},
  currentTime: {value: 0},
  foamAmount: {value: .55},
  bankFoam: {value: R.bankFoam},
  foamFeather: {value: .65},
  refraction: {value: 1},
  rippleMap: {value: ripples.texture},
  rippleBounds: {value: ripples.bounds},
  rippleCell: {value: ripples.cell},
  rippleActive: {value: false},
  rocks: {value: obstacles},
  flowSpeed: {value: 1},
  flowMap: {value: flow.texture},
  flowBounds: {value: flow.bounds},
  bakedFlow: {value: false},
  foamTile: {value: foamTile},
  waveTime: {value: 0},
  godRays: {value: .55},
  impactFoam: {value: new THREE.Vector4()},
  waterTint: {value: new THREE.Color()},
  pondColor: {value: new THREE.Color(R.pondColor)}, pondHaze: {value: R.haze}, pondDepthDark: {value: R.depthDark}, pondClarity: {value: R.pondClarity},
  pondAmbient: sky.uniforms.uAmb ?? {value: new THREE.Color(...FALLBACK_AMBIENT)},
  f0: {value: R.f0}, fresnelPower: {value: R.fresnelPower}, sunGlint: {value: R.sunGlint},
  clarity: {value: R.clarity},
  reflectionStrength: {value: R.reflection},
  tPlanar: {value: null},
  uPlanarMatrix: {value: new THREE.Matrix4()},
  uPlanarMix: {value: 0},
  uPlanarDistort: {value: 0},
  uPlanarFloor: {value: 0},
  uUnderMirror: {value: 0},
  rippleStrength: {value: R.rippleStrength},
  microRipples: {value: R.microRipples},
  caustics: {value: R.caustics},
  freezeProgress: {value: 0},
  freezeMap: {value: freezeMap ?? foamTile},
  ...iceLookUniforms(iceLook),
  ...(iceDamage ? {iceDamageMap: {value: iceDamage.texture}, iceDamageBounds: {value: iceDamage.bounds},
   iceHasDamage: iceDamage.active, iceSolidSurface: iceDamage.solidSurface ?? {value: false}} : {}),
 };
 // WebAquarium's additive projected-grid pass, driven by this surface's wave bank.
 const causticMaterial = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
  vertexShader: `
   uniform vec4 rippleBounds;
   uniform highp sampler2D rippleMap;
   uniform float rippleCell, rippleStrength, causticDepth, causticNormalScale;
   uniform bool rippleActive;
   uniform vec3 uSkySun;
   varying vec3 vOld, vNew;
   ${WIND_WAVE_GLSL}
   ${RIPPLE_HEIGHT_GLSL}
   vec3 projectRay(vec3 p, vec3 ray) { return p + ray * ((-causticDepth - p.y) / min(-.1, ray.y)); }
   void main() {
    vec2 uv = position.xz * .5 + .5;
    vec2 p = rippleBounds.xy + uv * rippleBounds.zw;
    vec2 slope;
    float h = windWaveHeight(p, slope);
    if (rippleActive && rippleStrength > 0.0) {
     vec2 texel = 1.0 / vec2(textureSize(rippleMap, 0));
     h += rippleStrength * ripple(uv);
     slope += rippleStrength * vec2(
      ripple(uv + vec2(texel.x, 0)) - ripple(uv - vec2(texel.x, 0)),
      ripple(uv + vec2(0, texel.y)) - ripple(uv - vec2(0, texel.y))
     ) / (2.0 * rippleCell);
    }
    vec3 flatRay = refract(-uSkySun, vec3(0, 1, 0), 1.0 / 1.333);
    vec3 ray = refract(-uSkySun, normalize(vec3(-slope.x * causticNormalScale, 1.0, -slope.y * causticNormalScale)), 1.0 / 1.333);
    vOld = projectRay(vec3(p.x, 0, p.y), flatRay);
    vNew = projectRay(vec3(p.x, h, p.y), ray);
    vec2 projectedUV = uv + (vNew.xz - vOld.xz) / rippleBounds.zw;
    gl_Position = vec4(projectedUV * 2.0 - 1.0, 0.0, 1.0);
   }`,
  fragmentShader: `
   varying vec3 vOld, vNew;
   void main() {
    float oa = length(dFdx(vOld)) * length(dFdy(vOld));
    float na = length(dFdx(vNew)) * length(dFdy(vNew));
    gl_FragColor = vec4(min(oa / max(na, 1e-7), 8.0), 0.0, 0.0, 1.0);
   }`,
 });
 const causticScene = new THREE.Scene();
 causticScene.background = new THREE.Color(0);
 const causticMesh = new THREE.Mesh(causticGrid, causticMaterial);
 causticMesh.frustumCulled = false;
 causticScene.add(causticMesh);
 const causticCamera = new THREE.Camera();
 const material = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  defines: {...sky.defines, ...(clipToBed ? {WATER_BED_CLIP: 1} : {}), ...(iceDamage ? {WATER_ICE_DAMAGE: 1} : {})},
  vertexShader: `
   attribute vec3 flow;
   varying vec3 vFlow, vWorld, vNormal;
   varying vec4 vClip;
   #ifdef WATER_BED_CLIP
   attribute float bedHeight;
   varying float vBedHeight;
   #endif
   void main() {
    vFlow = flow;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    #ifdef WATER_BED_CLIP
    vBedHeight = bedHeight;
    #endif
    vNormal = mat3(modelMatrix) * normal;
    vClip = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
    gl_Position = vClip;
   }`,
  fragmentShader: `
   ${sky.glsl}
   uniform sampler2D bedColor;
   uniform highp sampler2D bedDepth;
   uniform vec2 clipRange;
   uniform mat4 bedClipToWorld;
   uniform float currentTime;
   uniform float foamAmount, bankFoam, foamFeather, refraction, rippleCell, flowSpeed;
   uniform highp sampler2D rippleMap;
   uniform bool rippleActive;
   uniform vec4 rocks[4];
   uniform sampler2D flowMap, foamTile;
   uniform vec4 flowBounds;
   uniform bool bakedFlow;
   ${WIND_WAVE_GLSL}
   uniform float waveTime, godRays;
   uniform vec4 impactFoam;
   uniform vec3 waterTint;
   uniform float clarity, reflectionStrength;
   uniform float f0, fresnelPower, sunGlint;
   ${pondOptics ? POND_OPTICS_GLSL + '\n uniform vec3 pondAmbient;' : ''}
   uniform sampler2D tPlanar;
   uniform mat4 uPlanarMatrix;
   uniform float uPlanarMix, uPlanarDistort, uPlanarFloor, uUnderMirror;
   uniform float rippleStrength, microRipples, caustics, godFalloff;
   uniform vec3 godColor;
   uniform int godSteps;
   uniform float shaftLength;
   ${pondOptics ? 'uniform bool pondGodHalf; uniform sampler2D tPondGod;' : ''}
   ${lightingGLSL}
   ${iceDamage ? '' : 'uniform float freezeProgress;'}
   uniform sampler2D freezeMap;
   #ifdef WATER_ICE_DAMAGE
   uniform bool iceSolidSurface;
   #endif
   ${ICE_COVERAGE_GLSL}
   ${ICE_PATTERN_GLSL}
   varying vec3 vFlow, vWorld, vNormal;
   varying vec4 vClip;
   #ifdef WATER_BED_CLIP
   varying float vBedHeight;
   #endif

   // WebAquarium's foreground-safe refraction and Beer-Lambert absorption.
   float viewDepth(float z) {
    return clipRange.x * clipRange.y / (clipRange.y - z * (clipRange.y - clipRange.x));
   }
   vec2 foamFilm(vec2 p, float coverage) {
    vec4 tile = texture2D(foamTile, p);
    float density = clamp(coverage * 1.15, 0.0, 1.2);
    float band = mix(.09, .22, foamFeather);
    float opacity = tile.a * smoothstep(tile.b - band, tile.b + band, density) *
     smoothstep(0.0, mix(.22, .40, foamFeather), coverage);
    return vec2(clamp(tile.r + tile.g * .9, 0.0, 1.0), opacity);
   }
   // WebAquarium's jittered view march through the projected caustic map.
   vec3 underwaterLight(vec3 origin, vec3 ray, float path) {
    if (godRays <= 0.0 || uCausticOn < .5 || path <= 0.0) return vec3(0.0);
    float stepLength = min(path, shaftLength) / float(godSteps);
    // WebAquarium's h12 jitter avoids coherent stripes between marching rays.
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float energy = 0.0;
    for (int i = 0; i < 40; i++) {
     if (i >= godSteps) break;
     float t = (float(i) + jitter) * stepLength;
     vec3 p = origin + ray * t;
     float depth = max(vWorld.y - p.y, 0.0);
     float focus = clamp(pondShaftFocus(p) * pondShadow(p, fract(jitter + float(i) * .618)) - .75, 0.0, 5.0);
     energy += focus * exp(-t * godFalloff - depth * .3);
    }
    return godColor * uSunCol * (energy * stepLength * godRays * .6);
   }
   vec3 shaftRadiance(vec3 origin, vec3 ray, float path) {
    ${pondOptics ? `#ifndef POND_GOD_PASS
    if (pondGodHalf) return texture2D(tPondGod, vClip.xy / vClip.w * .5 + .5).rgb;
    #endif` : ''}
    return underwaterLight(origin, ray, path);
   }
   ${RIPPLE_HEIGHT_GLSL}
   void main() {
    float footprint = length(fwidth(vWorld.xz));
    float across = vFlow.y;
    #ifdef WATER_BED_CLIP
    float basinDepth = vWorld.y - vBedHeight;
    if (basinDepth <= .002) discard;
    across = 1.0 - smoothstep(0.0, .65, basinDepth);
    #endif
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 baseNormal = normalize(vNormal);
    float iceCoverage = 0.0, iceOpacity = 1.0;
    vec3 iceColor = vec3(0.0);
    #ifdef WATER_ICE_DAMAGE
    if (iceSolidSurface && !iceHasDamage) discard;
    if (!iceSolidSurface)
    #endif
    if (freezeProgress > 0.0) {
     vec2 p = vWorld.xz;
     float deep = 1.0 - abs(across);
     #ifdef WATER_BED_CLIP
     deep = smoothstep(.05, 2.0, basinDepth);
     #endif
     float order = texture2D(freezeMap, p * ${ICE_MAP_SCALE}).r;
     iceCoverage = iceCoverageAt(freezeProgress, deep, order);
     float brokenEdge = 0.0;
     #ifdef WATER_ICE_DAMAGE
     if (iceHasDamage) {
      vec2 uv = (p - iceDamageBounds.xy) / iceDamageBounds.zw;
      vec2 pixel = 1.0 / vec2(textureSize(iceDamageMap, 0));
      iceCoverage *= 1.0 - textureLod(iceDamageMap, uv, 0.0).r;
      brokenEdge = max(max(textureLod(iceDamageMap, uv + vec2(pixel.x, 0), 0.0).r,
                           textureLod(iceDamageMap, uv - vec2(pixel.x, 0), 0.0).r),
                       max(textureLod(iceDamageMap, uv + vec2(0, pixel.y), 0.0).r,
                           textureLod(iceDamageMap, uv - vec2(0, pixel.y), 0.0).r));
     }
     #endif
     if (iceCoverage > 0.0) {
      #ifdef POND_GOD_PASS
      if (iceCoverage >= 1.0) discard;
      #endif
      float frost, cracks, deepCracks, bubbles;
      icePattern(p, V, deep, freezeMap, frost, cracks, deepCracks, bubbles);
      vec3 ice = iceBody(frost, cracks, deepCracks, bubbles, iceOpacity) + ICE_WHITE * brokenEdge * .8;
      // Clear ice is glassy: a sharp sun and a strong grazing reflection. Frost is matte and glitters instead.
      vec3 mirrored = reflect(-V, baseNormal);
      float glint = (.05 + .6 * pow(1.0 - abs(dot(baseNormal, V)), 4.0)) * mix(1.0, .4, frost);
      float sunward = max(dot(mirrored, uSkySun), 0.0);
      float sunSpot = pow(sunward, mix(900.0, 40.0, frost)) * mix(5.0, .5, frost);
      const float crystalsPerMeter = 110.0;
      float crystalsResolved = 1.0 - smoothstep(.3, .8, length(fwidth(p)) * crystalsPerMeter);
      float crystals = step(.985, iceHash(floor(p * crystalsPerMeter))) * pow(sunward, 5.0) * frost * iceSparkle * 4.0 * crystalsResolved;
      iceColor = mix(ice * (.20 + .80 * uDaylight), sky(mirrored, .04), glint) + uSunCol * (sunSpot + crystals);
     }
    }
    vec2 rippleUV = (vWorld.xz - rippleBounds.xy) / rippleBounds.zw;
    vec2 d = rippleCell / rippleBounds.zw;
    vec2 gradient = vec2(0.0);
    if (rippleActive) {
     gradient = rippleStrength * vec2(ripple(rippleUV + vec2(d.x,0)) - ripple(rippleUV - vec2(d.x,0)),
      ripple(rippleUV + vec2(0,d.y)) - ripple(rippleUV - vec2(0,d.y))) / (2.0 * rippleCell);
    }
    float wake = 0.0;
    vec2 wakeNormal = vec2(0.0);
    for (int i = 0; i < 4; i++) {
     if (bakedFlow) break;
     vec4 rock = rocks[i];
     if (rock.z <= 0.0) continue;
     vec2 delta = vWorld.xz - rock.xy;
     vec2 direction = normalize(vec2(1, rock.w));
     float downstream = dot(delta, direction);
     float lateral = dot(delta, vec2(-direction.y, direction.x));
     float wing = abs(abs(lateral) - (.45 * rock.z + .32 * downstream));
     float wakeShape = smoothstep(0.0, .6, downstream) * (1.0 - smoothstep(1.0, 6.0, downstream)) *
      (1.0 - smoothstep(.06, .42, wing));
     float moving = smoothstep(0.0, .4, flowSpeed);
     wake += wakeShape * moving;
     wakeNormal += vec2(-direction.y, direction.x) * wakeShape * cos(downstream * 8.0 - currentTime * 5.0) * moving;
    }
    gradient -= wakeNormal * .1;
    vec2 windGradient;
    windWaveHeight(vWorld.xz, windGradient);
    gradient += windGradient;
    if (microRipples > 0.0) {
     vec2 p = vWorld.xz;
     vec2 a = vec2(.94, .34), b = vec2(-.42, .91);
     gradient += microRipples * (1.0 - smoothstep(.025, .12, footprint)) *
      (.65 * a * cos(dot(p, a) * 34.0 - waveTime * 13.0) + .35 * b * cos(dot(p, b) * 48.0 - waveTime * 17.0));
    }
    vec3 n = normalize(baseNormal - vec3(gradient.x, 0, gradient.y) * (1.0 - iceCoverage));
    if (!gl_FrontFacing) {
     #ifdef POND_GOD_PASS
     gl_FragColor = vec4(shaftRadiance(vWorld, V, distance(cameraPosition, vWorld)), 1.0);
     return;
     #endif
     // WebAquarium's underwater Snell window and soft total internal reflection.
     const float ior = 1.333;
     vec3 through = refract(-V, -n, ior);
     float cosI = clamp(dot(-n, V), 0.0, 1.0);
     float sinT2 = ior * ior * (1.0 - cosI * cosI);
     float cosT = sqrt(clamp(1.0 - sinT2, 0.0, 1.0));
     float fresnelBelow = .02 + .98 * pow(1.0 - cosT, 5.0);
     fresnelBelow = mix(fresnelBelow, 1.0, smoothstep(.85, 1.0, sinT2));
     vec2 screenUV = vClip.xy / vClip.w * .5 + .5;
     vec2 bentUV = clamp(screenUV + n.xz * .04 * refraction, .001, .999);
     if (texture2D(bedDepth, bentUV).r < gl_FragCoord.z) bentUV = screenUV;
     vec3 underTint = vec3(.85, .95, 1.0);
     vec3 refr = texture2D(bedColor, bentUV).rgb * underTint;
     if (dot(through, through) > 1e-6) refr += uSunCol * pow(max(dot(normalize(through), uSkySun), 0.0), 250.0) * 6.0;
     vec3 inscatter = vec3(.035, .16, .14) * waterTint * (.18 + .82 * uDaylight);
     vec3 mirror = inscatter;
     if (uUnderMirror > 0.0) {
      vec4 mp = uPlanarMatrix * vec4(vWorld, 1.0);
      vec2 muv = clamp(mp.xy / mp.w + n.xz * .024, .001, .999);
      mirror = mix(texture2D(tPlanar, muv).rgb * underTint, inscatter, .35);
     }
     vec3 color = mix(refr, mirror, fresnelBelow);
     color += shaftRadiance(vWorld, V, distance(cameraPosition, vWorld));
     gl_FragColor = vec4(mix(color, iceColor, iceCoverage * iceOpacity), 1.0);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
     return;
    }
    vec2 uv = vClip.xy / vClip.w * .5 + .5;
    float front = viewDepth(gl_FragCoord.z);
    float rawBedDepth = texture2D(bedDepth, uv).r;
    float behind = viewDepth(rawBedDepth);
    float edge = 1.0 - smoothstep(.8, 1.0, abs(across));
    vec2 bent = clamp(uv + (mat3(viewMatrix) * (n - baseNormal)).xy * .16 * edge * refraction, .001, .999);
    float rawBentDepth = texture2D(bedDepth, bent).r;
    float bentDepth = viewDepth(rawBentDepth);
    if (bentDepth > front && abs(bentDepth - behind) < max(.8, .12 * behind)) {
     uv = bent;
     behind = bentDepth;
     rawBedDepth = rawBentDepth;
    }
    float path = max(0.0, behind - front) / max(.3, (mat3(viewMatrix) * V).z);
    vec3 shafts = shaftRadiance(vWorld, refract(-V, n, 1.0 / 1.333), path);
    #ifdef POND_GOD_PASS
    gl_FragColor = vec4(shafts, 1.0);
    return;
    #endif
    vec3 transmission = exp(-vec3(.65, .24, .17) * path / clarity);
    vec3 tint = vec3(.025, .12, .095) * waterTint * (.25 + .75 * uDaylight);
    vec3 bedRadiance = texture2D(bedColor, uv).rgb;
    ${bedCaustics === 'screen' ? `if (caustics > 0.0 && uSkySun.y > .025 && rawBedDepth < 1.0 && behind > front) {
     // Project onto the same submerged geometry that supplies the refracted color.
     vec4 bedPoint = bedClipToWorld * vec4(vec3(uv, rawBedDepth) * 2.0 - 1.0, 1.0);
     vec3 bed = bedPoint.xyz / bedPoint.w;
     bedRadiance *= max(vec3(0.0), 1.0 + uSunCol * pondBedFocus(bed) * pondShadow(bed, .5) * caustics);
    }` : ''}
    ${pondOptics ? `float thick = max(0.0, behind - front);
    vec3 refracted = pondRadiance(bedRadiance, thick, max(0.0, V.y * thick * .5), uSunCol, pondAmbient);`
    : 'vec3 refracted = bedRadiance * transmission + tint * (1.0 - transmission);'}
    refracted += shafts;
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), fresnelPower);
    vec3 reflected = sky(reflect(-V, n), sunGlint);
    vec3 planar = vec3(0.0);
    float planarMix = 0.0;
    if (uPlanarMix > 0.0) {
     vec4 projection = uPlanarMatrix * vec4(vWorld + vec3(n.x, 0.0, n.z) * uPlanarDistort, 1.0);
     vec2 uv = projection.xy / projection.w;
     if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
      planar = texture2D(tPlanar, uv).rgb;
      planarMix = uPlanarMix;
      reflected = mix(reflected, planar, planarMix);
     }
    }
    float reflectance = clamp(fresnel * reflectionStrength, 0.0, 1.0);
    vec3 color = mix(refracted, reflected, reflectance);
    color = mix(color, planar, clamp(planarMix * uPlanarFloor * reflectionStrength * (1.0 - reflectance), 0.0, 1.0));
    float bank = smoothstep(mix(.76, .62, foamFeather), .89, abs(across)) *
     (1.0 - smoothstep(mix(.94, .90, foamFeather), 1.0, abs(across))) * .48 * bankFoam;
    vec4 field = bakedFlow ? texture2D(flowMap, (vWorld.xz - flowBounds.xy) / flowBounds.zw) : vec4(.6,.5,0,1);
    vec2 impactDelta = (vWorld.xz - impactFoam.xy) * vec2(.65, 1.0);
    float impact = impactFoam.w * (1.0 - smoothstep(.2, max(.21, impactFoam.z), length(impactDelta)));
    float coverage = clamp(bank + sqrt(field.b) * field.a * .9 + wake * .58 + impact, 0.0, 1.0);
    float foamOpacity = foamAmount * smoothstep(0.0, .35, flowSpeed);
    if (coverage > 0.0 && foamOpacity > 0.0) {
     vec2 velocity = (field.rg - .5) * 10.0;
     float cycle = fract(currentTime * .36), phase = fract(cycle + .5);
     const float tileScale = .85;
     vec2 foamUV = vWorld.xz * tileScale;
     vec2 flowUV = velocity * (tileScale / .36);
     vec2 film = mix(foamFilm(foamUV - flowUV * phase + .5, coverage),
      foamFilm(foamUV - flowUV * cycle, coverage), 1.0 - abs(cycle * 2.0 - 1.0));
     vec3 foamColor = vec3(.72, .80, .77) * (.18 + .82 * uDaylight) * mix(.5, 1.25, film.x);
     color = mix(color, foamColor, film.y * foamOpacity);
    }
    gl_FragColor = vec4(mix(color, iceColor, iceCoverage * iceOpacity), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
 });
 const surface = new THREE.Mesh(new THREE.BufferGeometry(), material);
 scene.add(surface);
 // Same surface geometry and refracted path as the final draw. WebAquarium's
 // half-resolution shaft pass avoids screen-door jitter and costs fewer samples.
 const godTarget = pondOptics ? new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthBuffer: false}) : null;
 const godMaterial = godTarget && new THREE.ShaderMaterial({uniforms, side: material.side, depthTest: false, depthWrite: false,
  defines: {...material.defines, POND_GOD_PASS: 1}, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader});
 const godScene = godTarget && new THREE.Scene();
 const godMesh = godTarget && new THREE.Mesh(surface.geometry, godMaterial);
 if (godMesh) {
  godMesh.matrixAutoUpdate = false;
  godScene.background = new THREE.Color(0);
  godScene.add(godMesh);
  uniforms.tPondGod.value = godTarget.texture;
 }
 const size = new THREE.Vector2();
 const scope = createRenderScope(renderer, {clearColor: false});
 const worldPosition = new THREE.Vector3(), eye = new THREE.Vector3();
 const planar = createPlanarCapture(renderer);

 function renderReflection(settings) {
  uniforms.uPlanarMix.value = 0;
  uniforms.uUnderMirror.value = 0;
  if (!settings?.on || uniforms.reflectionStrength.value <= 0) return;
  const waterLevel = surface.getWorldPosition(worldPosition).y;
  const eyeHeight = camera.getWorldPosition(eye).y - waterLevel;
  if (Math.abs(eyeHeight) <= MIN_MIRROR_EYE_HEIGHT) return;
  const below = eyeHeight < 0;
  const {resolution, mix, distort, floor, hz} = {...POND_REFLECTION_DEFAULTS, ...settings};
  planar.render(scene, camera, {height: waterLevel, below, resolution, hz});
  uniforms.tPlanar.value = planar.texture;
  uniforms.uPlanarMatrix.value.copy(planar.matrix);
  uniforms.uUnderMirror.value = below ? 1 : 0;
  uniforms.uPlanarMix.value = below ? 0 : mix;
  uniforms.uPlanarDistort.value = distort;
  uniforms.uPlanarFloor.value = floor;
 }

 const lightingUniforms = {
   ...shadow?.uniforms,
   ...(iceDamage ? {freezeProgress: uniforms.freezeProgress, iceDamageMap: uniforms.iceDamageMap,
    iceDamageBounds: uniforms.iceDamageBounds, iceHasDamage: uniforms.iceHasDamage} : {}),
   causticMap: uniforms.causticMap, rippleBounds: uniforms.rippleBounds,
   pondRefractedSun: uniforms.pondRefractedSun, pondLightLevel: uniforms.pondLightLevel,
   pondCausticMip: uniforms.pondCausticMip,
   uCausticOn: uniforms.uCausticOn, uCausticStrength: uniforms.caustics, causticFalloff: uniforms.causticFalloff,
   shaftLength: uniforms.shaftLength, causticFocus: uniforms.causticFocus,
   godFalloff: uniforms.godFalloff, godColor: uniforms.godColor, godSteps: uniforms.godSteps,
   pondColor: uniforms.pondColor, pondHaze: uniforms.pondHaze, pondDepthDark: uniforms.pondDepthDark, pondClarity: uniforms.pondClarity,
 };
 const litMaterials = new WeakSet();
 // WebAquarium rendering/underwater-lit.js multiplies the material's direct
 // diffuse and specular. The same caustics then appear in capture, refraction,
 // reflection, and on a diver's view, without a second screen-space light.
 function bindBedMaterial(mat) {
  if (bedCaustics !== 'material') throw new Error('Set bedCaustics to material before binding a bed material.');
  if (litMaterials.has(mat)) return mat;
  const compile = mat.onBeforeCompile, cacheKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = function (shader, renderer) {
   compile.call(this, shader, renderer);
   Object.assign(shader.uniforms, lightingUniforms);
   shader.vertexShader = 'varying vec3 vPondBed;\n' + shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    vec4 pondBedWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
    pondBedWorld = instanceMatrix * pondBedWorld;
    #endif
    vPondBed = (modelMatrix * pondBedWorld).xyz;`);
   shader.fragmentShader = ('varying vec3 vPondBed;\n' + shader.fragmentShader)
    .replace('#include <packing>', '#include <packing>\n' + lightingGLSL)
    .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
     float pondFocus = max(0.0, 1.0 + pondBedFocus(vPondBed) * uCausticStrength);
     if (vPondBed.y < pondLightLevel - .03) pondFocus *= pondShadow(vPondBed, .5);
     reflectedLight.directDiffuse *= pondFocus;
     reflectedLight.directSpecular *= pondFocus;`);
  };
  mat.customProgramCacheKey = () => `${cacheKey}|pond-caustics:${Boolean(shadow)}:${Boolean(iceDamage)}`;
  mat.needsUpdate = true;
  litMaterials.add(mat);
  return mat;
 }
 return {
  surface,
  material,
  uniforms,
  lighting: {glsl: lightingGLSL, lightsBed: true, screenBed: bedCaustics === 'screen', pondOptics, uniforms: lightingUniforms, bindBedMaterial},
  get depthTexture() { return capture.depthTexture; },
  get viewport() { return size; },
  render(seconds, settings) {
   uniforms.freezeProgress.value = settings.frozen === true ? 1 : THREE.MathUtils.clamp(settings.freezeProgress ?? 0, 0, 1);
   uniforms.uCausticOn.value = 0;
   if (shadow) shadow.uniforms.pondShadowOn.value = 0;
   uniforms.pondGodHalf.value = false;
   uniforms.pondClarity.value = settings.clarity ?? R.pondClarity;
   if (settings.pondColor) uniforms.pondColor.value.set(settings.pondColor);
   uniforms.pondHaze.value = settings.haze ?? R.haze;
   uniforms.pondDepthDark.value = settings.depthDark ?? R.depthDark;
   // A frozen pond still draws what lies under its clear ice, so the captures keep running.
   if (!surface.visible) return;
   renderer.getDrawingBufferSize(size);
   capture.setSize(Math.max(1, Math.floor(size.x * captureScale)), Math.max(1, Math.floor(size.y * captureScale)));
   uniforms.currentTime.value = seconds;
   uniforms.foamAmount.value = settings.foam;
   uniforms.bankFoam.value = settings.bankFoam ?? R.bankFoam;
   uniforms.foamFeather.value = settings.foamFeather;
   uniforms.refraction.value = settings.refraction;
   uniforms.flowSpeed.value = settings.speed;
   uniforms.rippleActive.value = ripples.active;
   uniforms.bakedFlow.value = flow.ready;
   uniforms.waveTime.value = settings.waveTime ?? seconds;
   uniforms.uWindTime.value = uniforms.waveTime.value;
   uniforms.godRays.value = settings.godRays ?? R.godRays;
   if (settings.tint) uniforms.waterTint.value.set(settings.tint);
   uniforms.clarity.value = settings.clarity ?? R.clarity;
   uniforms.f0.value = settings.f0 ?? R.f0;
   uniforms.fresnelPower.value = settings.fresnelPower ?? R.fresnelPower;
   uniforms.sunGlint.value = settings.sunGlint ?? R.sunGlint;
   uniforms.reflectionStrength.value = settings.reflection ?? R.reflection;
   uniforms.rippleStrength.value = settings.rippleStrength ?? R.rippleStrength;
   uniforms.microRipples.value = settings.microRipples ?? R.microRipples;
   uniforms.caustics.value = settings.caustics ?? R.caustics;
   uniforms.causticDepth.value = settings.causticDepth ?? R.causticDepth;
   uniforms.causticFalloff.value = settings.causticFalloff ?? R.causticFalloff;
   uniforms.causticFocus.value = Math.max(0, settings.causticFocus ?? R.causticFocus);
   uniforms.causticNormalScale.value = Math.max(0, settings.causticNormalScale ?? R.causticNormalScale);
   uniforms.shaftLength.value = settings.shaftLength ?? R.shaftLength;
   uniforms.godFalloff.value = settings.godFalloff ?? R.godFalloff;
   uniforms.godSteps.value = THREE.MathUtils.clamp(Math.round(settings.godSteps ?? R.godSteps), 1, MAX_GOD_STEPS);
   if (settings.godColor) uniforms.godColor.value.set(settings.godColor);
   uniforms.pondLightLevel.value = surface.getWorldPosition(worldPosition).y;
   const sun = uniforms.uSkySun.value, eta = 1 / WATER_IOR;
   uniforms.pondRefractedSun.value.set(-eta * sun.x, -Math.sqrt(1 - eta * eta * (1 - sun.y * sun.y)), -eta * sun.z);
   uniforms.clipRange.value.set(camera.near, camera.far);
   if (settings.impactFoam) uniforms.impactFoam.value.copy(settings.impactFoam);
   if (settings.windWaves) waves.configure(settings.windWaves);
   else waves.update(settings.waveHeight ?? R.waveHeight, settings.wavelength ?? R.wavelength, settings.waveDirection ?? R.waveDirection, settings.waveSpread ?? R.waveSpread);
   surface.visible = false;
   scope(() => { try {
    if (sun.y > MIN_SUN_HEIGHT) shadow?.render(ripples.bounds, uniforms.pondLightLevel.value, uniforms.pondRefractedSun.value, settings);
    if ((uniforms.caustics.value > 0 || uniforms.godRays.value > 0) && sun.y > MIN_SUN_HEIGHT) {
     renderer.setRenderTarget(causticTarget);
     renderer.render(causticScene, causticCamera);
     uniforms.uCausticOn.value = 1;
    }
    renderReflection(settings.planarReflection);
    renderer.setRenderTarget(capture);
    renderer.render(scene, camera);
    if (bedCaustics === 'screen' && uniforms.caustics.value > 0) uniforms.bedClipToWorld.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    if (godTarget && settings.godHalf !== false && uniforms.godRays.value > 0 && uniforms.uCausticOn.value > .5) {
     godTarget.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
     godMesh.geometry = surface.geometry;
     godMesh.matrix.copy(surface.matrixWorld);
     renderer.setRenderTarget(godTarget);
     renderer.render(godScene, camera);
     uniforms.pondGodHalf.value = true;
    }
   } finally {
    surface.visible = true;
   } });
  },
  dispose() {
   scene.remove(surface);
  godTarget?.dispose(); godMaterial?.dispose();
  shadow?.dispose();
   surface.geometry.dispose();
   capture.dispose();
   planar.dispose();
   causticTarget.dispose();
   causticGrid.dispose();
   causticMaterial.dispose();
   if (ownsFoam) foamTile.dispose();
   material.dispose();
  },
 };
}
