import * as THREE from 'three';
import {WIND_WAVE_GLSL} from './waves.js';
import {ICE_COVERAGE_GLSL, ICE_MAP_SCALE, ICE_PATTERN_GLSL} from './freeze.js';
import {POND_OPTICS_GLSL} from './pond-optics.js';
import {POND_SHADOW_GLSL} from './pond-shadow.js';
import {FLOW_VELOCITY_SCALE} from './flow-bake.js';
import {WATER_IOR} from './water-optics.js';

export const CHANNEL_OBSTACLE_COUNT = 4;
export const MAX_GOD_STEPS = 40;             // ray-march steps of the light shafts, upper bound
export const MIN_SUN_HEIGHT = .025;          // sun direction y: below this no caustics, shafts or pond shadow are drawn


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



export function channelLightingGLSL({covers, shadow, iceDamage}) {
 const coverGLSL = covers.length ? `
 #define POND_SHAFT_SHADOWS
 ${covers.map(cover => cover.glsl).join('\n')}
 float pondShadow(vec3 p, float r) {
  vec3 worldPosition = p, n = vec3(0.0);
  vec3 through = ${covers.map(cover => `(${cover.air ?? cover.read})`).join(' * ')};
  return (through.r + through.g + through.b) / 3.0;
 }` : '';
 const iceLightingGLSL = iceDamage ? POND_ICE_LIGHT_GLSL : 'float pondLightThroughIce(vec2 entry) { return 1.0; }';
 return (covers.length ? coverGLSL : shadow ? POND_SHADOW_GLSL : '') + iceLightingGLSL + POND_CAUSTICS_GLSL;
}


export function createChannelCausticMaterial(uniforms) {
 return new THREE.ShaderMaterial({
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
    vec3 flatRay = refract(-uSkySun, vec3(0, 1, 0), 1.0 / ${WATER_IOR});
    vec3 ray = refract(-uSkySun, normalize(vec3(-slope.x * causticNormalScale, 1.0, -slope.y * causticNormalScale)), 1.0 / ${WATER_IOR});
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
}


export function createChannelMaterial({uniforms, sky, clipToBed, iceDamage, pondOptics, lightingGLSL, bedCaustics}) {
 return new THREE.ShaderMaterial({
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
   uniform vec4 rocks[${CHANNEL_OBSTACLE_COUNT}];
   uniform sampler2D flowMap, foamTile;
   uniform vec4 flowBounds;
   uniform bool bakedFlow;
   ${WIND_WAVE_GLSL}
   uniform float waveTime, godRays;
   uniform vec4 impactFoam;
   uniform sampler2D foamLayerMap;
   uniform vec4 foamLayerBounds;
   uniform float splashFoam;   // opacity of the foam left by splashes; 0 without a foam layer
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
   uniform float freezeThaw;
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
    for (int i = 0; i < ${MAX_GOD_STEPS}; i++) {
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
    // iceMix: how much of the water's own colour the ice (and slush) replaces.
    float iceCoverage = 0.0, iceOpacity = 1.0, iceCalm = 0.0, iceMix = 0.0;
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
     // Freezing: crystal stars reach ahead of the ice, so the front grows as needles instead of fading in.
     // Melting: no crystals, the edge just retreats.
     const float needleReach = .16;     // progress the tip of a needle is ahead of the plain front
     const float frontEdge = .03;       // progress over which a spot turns from water to ice
     const float slushAhead = .2;       // progress ahead of the ice where the water is already slush
     float growing = 1.0 - freezeThaw;
     float level = iceFrontLevel(freezeProgress, deep, order)
       + (iceCrystalStars(p) - .45) * needleReach * iceNeedles * growing;
     iceCoverage = smoothstep(-frontEdge, frontEdge, level);
     // Everything is frozen at full progress and open at none, whatever the crystals say.
     iceCoverage = mix(iceCoverage, iceCoverageAt(freezeProgress, deep, order), smoothstep(.9, 1.0, freezeProgress));
     float slush = smoothstep(-slushAhead, -frontEdge, level) * (1.0 - iceCoverage) * iceSlush * growing;
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
     // Slush and ice both still the water.
     iceCalm = max(iceCoverage, slush * .85);
     if (iceCoverage > 0.0 || slush > 0.0) {
      #ifdef POND_GOD_PASS
      if (iceCoverage >= 1.0) discard;
      #endif
      float frost, cracks, deepCracks, bubbles;
      icePattern(p, V, deep, freezeMap, frost, cracks, deepCracks, bubbles);
      // Fresh ice is thin and clear; frost and cracks come as it ages. Melting ice is wet: its frost soaks away,
      // first where it is thinnest.
      const float agedAfter = .1;        // progress behind the front where the ice has its full frost and cracks
      float aged = smoothstep(0.0, agedAfter, level);
      float wet = freezeThaw * (1.0 - .6 * smoothstep(.1, .6, level));
      frost *= mix(.25, 1.0, aged) * (1.0 - .75 * wet);
      cracks *= aged; deepCracks *= aged;
      vec3 ice = iceBody(frost, cracks, deepCracks, bubbles, iceOpacity) + ICE_WHITE * brokenEdge * .8;
      // A bright thin rim where the ice is forming; none on a melting edge.
      float rim = iceCoverage * (1.0 - iceCoverage) * 4.0 * growing;
      ice += ICE_WHITE * rim * .5;
      iceOpacity = mix(iceOpacity, 1.0, rim * .6) * (1.0 - .35 * wet);
      // Clear ice is glassy: a sharp sun and a strong grazing reflection. Frost is matte and glitters instead.
      vec3 mirrored = reflect(-V, baseNormal);
      float glint = (.05 + .6 * pow(1.0 - abs(dot(baseNormal, V)), 4.0)) * mix(1.0, .4, frost);
      float sunward = max(dot(mirrored, uSkySun), 0.0);
      float sunSpot = pow(sunward, mix(900.0, 40.0, frost)) * mix(5.0, .5, frost);
      const float crystalsPerMeter = 110.0;
      float crystalsResolved = 1.0 - smoothstep(.3, .8, length(fwidth(p)) * crystalsPerMeter);
      float crystals = step(.985, iceHash(floor(p * crystalsPerMeter))) * pow(sunward, 5.0) * frost * iceSparkle * 4.0 * crystalsResolved;
      iceColor = mix(ice * (.20 + .80 * uDaylight), sky(mirrored, .04), glint) + uSunCol * (sunSpot + crystals);
      // Slush: the water ahead of the ice turns milky before it sets.
      const vec3 slushColor = vec3(.3, .45, .52);
      const float slushOpacity = .3;
      vec3 milky = slushColor * (.20 + .80 * uDaylight);
      float iceShare = iceCoverage * iceOpacity, slushShare = slush * slushOpacity * (1.0 - iceCoverage);
      iceColor = (iceColor * iceShare + milky * slushShare) / max(iceShare + slushShare, .0001);
      iceMix = iceShare + slushShare;
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
    for (int i = 0; i < ${CHANNEL_OBSTACLE_COUNT}; i++) {
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
    vec3 n = normalize(baseNormal - vec3(gradient.x, 0, gradient.y) * (1.0 - iceCalm));
    if (!gl_FrontFacing) {
     #ifdef POND_GOD_PASS
     gl_FragColor = vec4(shaftRadiance(vWorld, V, distance(cameraPosition, vWorld)), 1.0);
     return;
     #endif
     // WebAquarium's underwater Snell window and soft total internal reflection.
     const float ior = ${WATER_IOR};
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
     gl_FragColor = vec4(mix(color, iceColor, iceMix), 1.0);
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
    vec3 shafts = shaftRadiance(vWorld, refract(-V, n, 1.0 / ${WATER_IOR}), path);
    #ifdef POND_GOD_PASS
    gl_FragColor = vec4(shafts, 1.0);
    return;
    #endif
    vec3 transmission = exp(-vec3(.65, .24, .17) * path / clarity);
    vec3 tint = vec3(.025, .12, .095) * waterTint * (.25 + .75 * uDaylight);
    vec3 bedRadiance = texture2D(bedColor, uv).rgb;
    ${bedCaustics === 'screen' ? `if (caustics > 0.0 && uSkySun.y > ${MIN_SUN_HEIGHT} && rawBedDepth < 1.0 && behind > front) {
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
    float flowing = clamp(bank + sqrt(field.b) * field.a * .9 + wake * .58 + impact, 0.0, 1.0);
    // Foam left by splashes shows on still water too, whatever the flow foam setting; none on ice.
    float left = 0.0;
    if (splashFoam > 0.0) {
     vec2 layerUV = (vWorld.xz - foamLayerBounds.xy) / foamLayerBounds.zw;
     if (all(greaterThanEqual(layerUV, vec2(0.0))) && all(lessThanEqual(layerUV, vec2(1.0)))) {
      left = texture2D(foamLayerMap, layerUV).r * splashFoam * (1.0 - iceCalm);
     }
    }
    float flowOpacity = foamAmount * smoothstep(0.0, .35, flowSpeed);
    float coverage = clamp(flowing + left, 0.0, 1.0);
    // Each kind of foam keeps its own opacity where they overlap.
    float foamOpacity = coverage > 0.0 ? clamp((flowing * flowOpacity + left) / coverage, 0.0, 1.0) : 0.0;
    if (coverage > 0.0 && foamOpacity > 0.0) {
     vec2 velocity = (field.rg - .5) * ${FLOW_VELOCITY_SCALE.toFixed(1)};
     float cycle = fract(currentTime * .36), phase = fract(cycle + .5);
     const float tileScale = .85;
     vec2 foamUV = vWorld.xz * tileScale;
     vec2 flowUV = velocity * (tileScale / .36);
     vec2 film = mix(foamFilm(foamUV - flowUV * phase + .5, coverage),
      foamFilm(foamUV - flowUV * cycle, coverage), 1.0 - abs(cycle * 2.0 - 1.0));
     vec3 foamColor = vec3(.72, .80, .77) * (.18 + .82 * uDaylight) * mix(.5, 1.25, film.x);
     color = mix(color, foamColor, film.y * foamOpacity);
    }
    gl_FragColor = vec4(mix(color, iceColor, iceMix), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
 });
}
