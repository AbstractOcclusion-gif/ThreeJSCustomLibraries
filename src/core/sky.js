// Glider library adaptation: respect the host tone mapping on the visible dome.
// atmosphere/sky-dome.js -- the sky shared by every page (16 Oct 2026, batch 3 of docs/plan/11_UNIFY_ATMOSPHERE_PROMPT.md): one GLSL
// sky(d, sunMul) that the pond's shaders/common.js (every aquarium / pond material, its dome, its water) and the ocean's surface and
// dome paste, so the horizon matches what the water mirrors. Merged from WebAquarium rendering/sky.js + shaders/common.js sky() and
// OceanPlayTest ocean/sky.js; each page's numbers are unchanged.
// Modes (uniforms): uSky 0..6 the procedural presets (skies.js; 0 = the clear-day gradient the ocean's "procedural" sky also is),
// 7 = equirect panorama / HDR; uSkyDyn 1 = the dynamic capture (dynamic-sky.js) replaces the sky.
// Compile flags (material.defines, see skyDefines): SKY_DYNAMIC the capture + per-pixel celestial layer (sun disc, moon, stars,
// galaxy); SKY_CELESTIAL the textured moon / star / galaxy maps (off: a shaded moon disc, no stars -- the pond water's sampler budget);
// SKY_CAPTURE_NO_BLEND one capture sampler (no cross-fade); SKY_STARS_FILTERED plain star map (water reflections: no screen footprint);
// SKY_DYNAMIC_ONLY drops the static paths and their samplers (the ocean water in dynamic mode); SKY_WEATHER_HDR the ocean's static sky:
// its HDR's four weather endpoints, day tint, env rotation and procedural night (off: the pond's panorama with its sky mask + veil);
// SKY_HOST_UNIFORMS the host already declares uSunCol / uAmb / uSky (the pond's GLSL_COMMON).
import * as THREE from 'three';
import {CLEAR_NOON_SUN} from './lighting.js';

const HDR_MAX_RADIANCE = 24.0;   // clamps HDR fireflies in reflections (both pages)
export const SKY_GLSL = /* glsl */`
#ifndef SKY_HOST_UNIFORMS
uniform vec3 uSunCol, uAmb; uniform int uSky;
#endif
uniform float uSkyDyn, uEnvI, uEnvRot, uNightBlend, uDaylight; uniform vec3 uSkySunDir;
#ifndef SKY_DYNAMIC_ONLY
uniform sampler2D tEnv;
#ifdef SKY_WEATHER_HDR
uniform sampler2D tEnvB; uniform mat3 uEnvTransform, uEnvBTransform; uniform vec4 uWeatherWeights; uniform vec3 uDayTint;
#else
uniform float uSkyVeil, uEnvMask; uniform vec3 uSkyVeilCol;
#endif
#endif
vec2 skyUv(vec3 r){ return vec2(atan(r.z, r.x) * 0.1591549 + 0.5, asin(clamp(r.y, -1.0, 1.0)) * 0.3183099 + 0.5); }
#ifdef SKY_DYNAMIC
// the atmosphere + volumetric cloud capture (alpha = the clouds' transmittance along that direction); two captures cross-faded so a
// new capture never snaps. The per-pixel layer on top stays sharp and moves smoothly: the sun disc, the moon, the stars and galaxy.
uniform samplerCube tDynamicSky;
#ifndef SKY_CAPTURE_NO_BLEND
uniform samplerCube tDynamicSkyPrev; uniform float uDynamicSkyBlend;
#endif
uniform vec3 uSkySun, uMoonDir;
uniform float uMoonOn, uMoonPhase, uMoonRadius, uMoonIntensity, uMoonEarthshine, uStarIntensity, uStarReflection, uGalaxyIntensity, uNightIntensity, uStarsRotation;
uniform vec2 uAuroraDirection;
uniform float uAuroraIntensity, uAuroraTime;
const float SUN_DISC_RADIUS = 0.0122;     // angular radius in radians (0.70 deg)
const float SUN_DISC_EDGE = 0.12;         // soft edge as a fraction of the radius
const float SUN_DISC_LIMB = 0.55;         // brightness kept at the limb (limb darkening)
const float SUN_DISC_RADIANCE = 24.0;     // matches the radiance clamp of the former captured disc
vec3 sunDisc(vec3 d){
  if (dot(d, uSkySun) <= 0.0) return vec3(0.0);
  float r = length(cross(d, uSkySun)) / SUN_DISC_RADIUS;   // sin(angle): precise at tiny angles, unlike acos
  float disc = 1.0 - smoothstep(1.0 - SUN_DISC_EDGE, 1.0 + SUN_DISC_EDGE, r), limb = mix(SUN_DISC_LIMB, 1.0, sqrt(max(0.0, 1.0 - r * r)));
  // Leave room for the sunset tint before the host tone mapper compresses the highlights.
  float radiance = mix(6.0, SUN_DISC_RADIANCE, smoothstep(0.03, 0.35, uSkySun.y));
  return uSunCol * (radiance * disc * limb * smoothstep(-0.01, 0.0, d.y) * uDaylight); }
#ifdef SKY_CELESTIAL
uniform sampler2D tMoon, tStars, tGalaxy;
// equirect lookup with seam-free gradients (atan wraps at +-pi and would pick the smallest mip on a 1-px line)
vec3 equirectSample(sampler2D map, vec2 uv){ vec2 dx = dFdx(uv), dy = dFdy(uv); dx.x -= floor(dx.x + 0.5); dy.x -= floor(dy.x + 0.5); return textureGrad(map, uv, dx, dy).rgb; }
// stars: the map holds one bright texel per star (about 5 screen pixels per texel at 60 deg fov). Bilinear magnification turns each
// into a blurry square that saturates when brightened, so every texel is drawn as a round point of fixed on-screen size centred on
// that texel. Once texels shrink below ~2 px (narrow view, rippled reflections) the filtered map is used.
const float STAR_SIGMA_PX = 0.7;               // point radius (Gaussian sigma) in screen pixels
const float STAR_PEAK = 1.6;                   // max core radiance: brighter stars grow a little instead of saturating into blocks
const float STAR_GROWTH = 0.22;                // sigma growth per doubling of brightness above STAR_PEAK
const vec2  STAR_FILTER_TEXEL_PX = vec2(1.5, 3.0);   // texel size in px: filtered below .x, points above .y
vec3 starPoints(vec2 uv, float intensity){
  vec2 size = vec2(textureSize(tStars, 0)); vec2 dx = dFdx(uv), dy = dFdy(uv); dx.x -= floor(dx.x + 0.5); dy.x -= floor(dy.x + 0.5);
  mat2 texelsPerPixel = mat2(dx * size, dy * size); float det = abs(determinant(texelsPerPixel)), texelPx = inversesqrt(max(det, 1e-8));
  vec3 filtered = textureGrad(tStars, uv, dx, dy).rgb * intensity;
#ifdef SKY_STARS_FILTERED
  return filtered * uStarReflection;   // water reflections (own brightness multiplier): wave-normal derivatives are no screen footprint, points would sparkle or NaN
#endif
  if (texelPx < STAR_FILTER_TEXEL_PX.x || det < 1e-6) return filtered;   // degenerate footprint (parallel derivatives) has no inverse: keep the filtered map
  vec2 texel = uv * size, cell = floor(texel), offsetPx = inverse(texelsPerPixel) * (texel - cell - 0.5);   // pixel offset from the star (texel) centre
  vec3 radiance = texelFetch(tStars, ivec2(mod(cell, size)), 0).rgb * intensity; float peak = max(max(radiance.r, radiance.g), radiance.b);
  float sigma = STAR_SIGMA_PX * (1.0 + STAR_GROWTH * log2(max(peak / STAR_PEAK, 1.0)));
  vec3 star = radiance * (min(peak, STAR_PEAK) / max(peak, 1e-5)) * exp(-dot(offsetPx, offsetPx) / (2.0 * sigma * sigma));
  return mix(filtered, star, smoothstep(STAR_FILTER_TEXEL_PX.x, STAR_FILTER_TEXEL_PX.y, texelPx)); }
#endif
vec3 celestialNight(vec3 d){
  vec3 night = vec3(0.0);
#ifdef SKY_CELESTIAL
  float c = cos(uStarsRotation), s = sin(uStarsRotation); vec2 uv = skyUv(vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z));
  night = (starPoints(uv, uStarIntensity) + equirectSample(tGalaxy, uv) * uGalaxyIntensity) * uNightIntensity;
#endif
  if (uMoonOn > 0.5 && dot(d, uMoonDir) > 0.0) {
    vec3 right = normalize(cross(abs(uMoonDir.y) > 0.99 ? vec3(0, 0, 1) : vec3(0, 1, 0), uMoonDir)), up = cross(uMoonDir, right);
    vec2 disk = vec2(dot(d, right), dot(d, up)) / sin(uMoonRadius); float rr = dot(disk, disk);
    if (rr < 1.0) { vec3 normal = vec3(disk, sqrt(max(0.0, 1.0 - rr))); float phase = uMoonPhase * 6.283185307;
      float lit = max(dot(normal, vec3(sin(phase), 0.0, -cos(phase))), 0.0);
#ifdef SKY_CELESTIAL
      vec4 tex = texture2D(tMoon, disk * 0.5 + 0.5);
#else
      vec4 tex = vec4(0.9, 0.9, 0.9, 1.0);
#endif
      vec3 moon = tex.rgb * vec3(0.65, 0.74, 0.9) * (lit + uMoonEarthshine) * uMoonIntensity;
      night = mix(night, moon, tex.a * (1.0 - smoothstep(0.96, 1.0, rr))); } }   // the moon hides the stars behind it
  return night * smoothstep(-0.05, 0.03, d.y); }
vec4 auroraCurtain(vec2 ray, float layer, float visibility) {
  float x = ray.x + layer * .23;
  float t = uAuroraTime;
  float wave = x * 8.0 + sin(x * 3.0 + layer) * 1.6 + layer * 2.1;
  // A folded vertical sheet. Perspective raises the nearer folds and spreads their rays.
  float depth = 1.0 + .24 * sin(wave + t * .32) + .09 * sin(wave * 2.1 - t * .21);
  float bottom = .14 + layer * .072 + .025 * sin(x * 5.0 + t * .21 + layer);
  float height = .28 + .075 * sin(x * 4.2 - t * .14 + layer);
  float h = (ray.y * depth - bottom) / height;
  float edge = smoothstep(-.18, .19, h) * (1.0 - smoothstep(.15, 1.12, h));
  float filament = .74 + .17 * sin(x * 49.0 + sin(wave) * 2.5 - t * .7)
                        + .09 * sin(x * 82.0 + layer - t * .44);
  float pulse = .68 + .32 * sin(x * 7.0 - t * .55 + layer);
  float ends = 1.0 - smoothstep(.35, 1.15, abs(x));
  vec3 emission = mix(vec3(.045, .83, .35), vec3(.44, .095, .60), smoothstep(.19, .80, h));
  float density = ends * pulse * exp(-layer * .45) * visibility;
  float opacity = edge * filament * density * .42;
  float haloHeight = (h - .30) / .57;
  float halo = exp(-haloHeight * haloHeight * 1.9) * density * .12;
  return vec4(emission * opacity + mix(vec3(.035, .58, .35), emission, .35) * halo, opacity);
}
vec4 auroraOver(vec4 front, vec4 back) { return front + back * (1.0 - front.a); }
vec4 auroraSky(vec3 d) {
  float darkness = smoothstep(.60, .98, uNightBlend);
  float forward = dot(d.xz, uAuroraDirection);
  if (uAuroraIntensity <= 0.0 || darkness <= 0.0 || d.y <= 0.0 || forward <= .25) return vec4(0.0);
  vec2 side = vec2(-uAuroraDirection.y, uAuroraDirection.x);
  vec2 ray = vec2(dot(d.xz, side), d.y) / forward;
  float visibility = darkness * smoothstep(.25, .5, forward) * smoothstep(0.0, .06, d.y);
  vec4 front = auroraCurtain(ray, 0.0, visibility);
  vec4 middle = auroraCurtain(ray, 1.0, visibility);
  vec4 back = auroraCurtain(ray, 2.0, visibility);
  vec4 curtains = auroraOver(front, auroraOver(middle, back));
  return vec4(curtains.rgb * uAuroraIntensity, curtains.a * min(1.0, uAuroraIntensity));
}
vec3 dynamicSkyColor(vec3 d, float sunMul){
#ifdef SKY_CAPTURE_NO_BLEND
  vec4 cap = textureCube(tDynamicSky, d);
#else
  vec4 cap = mix(textureCube(tDynamicSkyPrev, d), textureCube(tDynamicSky, d), uDynamicSkyBlend);
#endif
  vec4 aurora = auroraSky(d);
  vec3 night = celestialNight(d) * uNightBlend;
  return cap.rgb + (night * (1.0 - aurora.a) + aurora.rgb + sunDisc(d) * sunMul) * cap.a; }
#endif
#ifndef SKY_DYNAMIC_ONLY
// the clear-day gradient: the pond's preset 0 and the ocean's procedural sky (without the sun glint, which each adds in its colour)
vec3 clearGradient(vec3 d, float s){ float y = max(d.y, 0.0); return mix(vec3(0.72, 0.85, 0.95), vec3(0.22, 0.48, 0.82), pow(y, 0.5)) + vec3(1.0, 0.9, 0.7) * pow(s, 8.0) * 0.25; }
#ifdef SKY_WEATHER_HDR
vec3 rawDaySky(vec3 d, float sunMul){
  if (uSky == 7) return min(texture2D(tEnv, skyUv(d)).rgb, vec3(${HDR_MAX_RADIANCE.toFixed(1)}));
  float s = max(dot(d, uSkySunDir), 0.0);
  return clearGradient(d, s) + vec3(1.0, 0.96, 0.9) * pow(s, 900.0) * 12.0 * sunMul; }
vec3 weatherDaySky(vec3 d, float sunMul){
  vec3 clear = rawDaySky(d, sunMul);
  if (uWeatherWeights.x > 0.99999) return clear;
  vec3 soft = uSky == 7 ? min(texture2D(tEnvB, skyUv(uEnvBTransform * d)).rgb, vec3(${HDR_MAX_RADIANCE.toFixed(1)})) : clear;
  float y = max(d.y, 0.0);
  float cloud = sin(d.x * 19.0 + d.z * 13.0) * sin(d.z * 27.0 - d.y * 11.0) * 0.04;
  vec3 veil = mix(vec3(0.58, 0.64, 0.69), vec3(0.30, 0.34, 0.39), pow(y, 0.5)) + cloud;
  vec3 overcast = mix(soft, veil, 0.84), foggy = mix(soft, veil * 0.85, 0.70), storm = mix(soft, veil * 0.32, 0.96);
  return clear * uWeatherWeights.x + overcast * uWeatherWeights.y + foggy * uWeatherWeights.z + storm * uWeatherWeights.w; }
vec3 nightSky(vec3 d){
  vec3 c = mix(vec3(0.004, 0.008, 0.018), vec3(0.001, 0.002, 0.008), max(d.y, 0.0));
  vec3 moonDir = normalize(vec3(-0.4, 0.65, 0.3)); float moon = smoothstep(0.99985, 0.99995, dot(d, moonDir));
  vec2 cell = floor(skyUv(d) * vec2(1400.0, 700.0));
  float seed = fract(sin(dot(cell, vec2(127.1, 311.7))) * 1031.317);
  float star = smoothstep(0.9985, 1.0, seed) * smoothstep(0.0, 0.2, d.y);
  float cover = uWeatherWeights.x + uWeatherWeights.z * 0.15;
  return (c + vec3(0.05, 0.06, 0.08) * star + vec3(0.5, 0.6, 0.8) * moon) * (0.2 + 0.8 * cover); }
#else
float hsSky(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
#endif
#endif
vec3 sky(vec3 d, float sunMul){
#ifdef SKY_DYNAMIC_ONLY
  return dynamicSkyColor(d, sunMul) * uEnvI;
#else
// The standalone dome has no aquarium panorama/alpha mask. Use its capture
// whenever ready, retaining the procedural path while assets are loading.
#ifdef SKY_DYNAMIC
  if (uSkyDyn > 0.5) return dynamicSkyColor(d, sunMul) * uEnvI;
#endif
#ifdef SKY_WEATHER_HDR
  if (uNightBlend > 0.99999) return nightSky(d) * uEnvI;
  vec3 r = uEnvTransform * d; float cr = cos(uEnvRot), sr = sin(uEnvRot); r = vec3(cr * r.x - sr * r.z, r.y, sr * r.x + cr * r.z);
  if (uNightBlend < 0.00001) return weatherDaySky(r, sunMul) * uDayTint * uEnvI;
  return mix(weatherDaySky(r, sunMul) * uDayTint, nightSky(d), uNightBlend) * uEnvI;
#else
  if (uSky == 7) {                                       // v65 HDRI room / the spot's panorama (equirect, rotated about Y); the lamps in it are the highlights
    float cr = cos(uEnvRot), sr = sin(uEnvRot); vec3 r = vec3(cr * d.x - sr * d.z, d.y, sr * d.x + cr * d.z);
    vec4 e = texture2D(tEnv, skyUv(r)); vec3 h = min(e.rgb * uEnvI, vec3(${HDR_MAX_RADIANCE.toFixed(1)}));
#ifdef SKY_DYNAMIC
    if (uSkyDyn > 0.5) {                                 // the panorama's sky pixels (alpha mask, env.js) show the dynamic sky; its trees go blue under the moon
      h *= mix(vec3(0.45, 0.55, 0.9), vec3(1.0), uDaylight);
      return mix(h, dynamicSkyColor(d, sunMul), e.a * uEnvMask); }
#endif
    // the weather veil (fishing/weather.js): the photo sky blends toward the state's sky colour, brighter at the zenith, so background and reflections agree
    return mix(h, uSkyVeilCol * mix(0.75, 1.0, max(r.y, 0.0)), uSkyVeil); }
  float y = max(d.y, 0.0), s = max(dot(d, uSkySunDir), 0.0); vec3 c;
  if (uSky == 0) c = clearGradient(d, s);
  else if (uSky == 1) c = mix(vec3(1.0,0.5,0.25), vec3(0.18,0.16,0.4), pow(y, 0.35)) + vec3(1.0,0.45,0.15) * pow(s, 4.0) * 0.8;
  else if (uSky == 2) c = mix(vec3(0.66,0.68,0.7), vec3(0.48,0.5,0.55), y);
  else if (uSky == 3) { c = mix(vec3(0.03,0.05,0.1), vec3(0.004,0.008,0.025), pow(y, 0.5));
    c += step(0.9975, hsSky(floor(d * 220.0))) * smoothstep(0.0, 0.2, y) * 1.5; }
  else if (uSky == 4) { float a = atan(d.z, d.x); c = vec3(0.05 + 0.1 * y);
    c += 4.0 * step(abs(fract(a / 1.5708) - 0.5), 0.1) * step(abs(d.y - 0.3), 0.12);
    c += 3.0 * smoothstep(0.93, 0.95, d.y); }
  else if (uSky == 6) { c = vec3(0.004, 0.005, 0.007) + vec3(0.01, 0.012, 0.016) * smoothstep(0.6, 1.0, d.y); }
  else { vec2 uv = d.xz / (abs(d.y) + 0.12); float ch = mod(floor(uv.x * 1.5) + floor(uv.y * 1.5), 2.0);
    c = mix(vec3(0.95), vec3(0.12,0.3,0.75), ch); }
  if (d.y < 0.0 && uSky != 5 && uSky != 6) c = mix(c, uAmb * 1.4, min(-d.y * 6.0, 1.0));
  return c + uSunCol * pow(s, 900.0) * 12.0 * sunMul;
#endif
#endif
}`;

// material.defines for a sky user. dynamic: compiles the capture + celestial layer; celestial: the textured moon / stars / galaxy maps;
// water: the reflection trims (one capture sampler, filtered stars); dynamicOnly: drop the static paths (a water that recompiles per
// sky mode); weatherHdr: the ocean's static sky. Changing a material's defines recompiles it once.
export function skyDefines({ dynamic = false, celestial = false, water = false, dynamicOnly = false, weatherHdr = false } = {}) {
  const d = {};
  if (weatherHdr) d.SKY_WEATHER_HDR = 1;
  if (dynamic) { d.SKY_DYNAMIC = 1; if (water) { d.SKY_CAPTURE_NO_BLEND = 1; d.SKY_STARS_FILTERED = 1; } if (dynamicOnly) d.SKY_DYNAMIC_ONLY = 1; }
  if (celestial) d.SKY_CELESTIAL = 1;
  return d;
}
// the sky-dome.js uniforms a page that has no shared uniform set needs (the ocean; the pond's shaders/common.js U carries them).
// sunDir: the page's live sun direction. uSkyMode is JS-side state for the ocean's GUI / presets (0 procedural, 1 hdr, 2 dynamic);
// the shader reads uSky / uSkyDyn, which the page derives from it.
export function createSkyUniforms(sunDir) {
  return { uSunDir: { value: sunDir }, uSkySun: { value: sunDir }, uSkySunDir: { value: sunDir.clone() }, uSunCol: { value: new THREE.Color(...CLEAR_NOON_SUN) }, uAmb: { value: new THREE.Color(0.3, 0.3, 0.3) },
    uSkyMode: { value: 0 }, uSky: { value: 0 }, uSkyDyn: { value: 0 }, uDaylight: { value: 1 }, tEnv: { value: null }, tEnvB: { value: null },
    tDynamicSky: { value: null }, tDynamicSkyPrev: { value: null }, uDynamicSkyBlend: { value: 1 },
    tMoon: { value: null }, tStars: { value: null }, tGalaxy: { value: null }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonOn: { value: 1 }, uMoonPhase: { value: 0.5 }, uMoonRadius: { value: 0.026 },
    uMoonIntensity: { value: 1 }, uMoonEarthshine: { value: 0.02 }, uStarIntensity: { value: 1 }, uStarReflection: { value: 1 }, uGalaxyIntensity: { value: 0.2 }, uNightIntensity: { value: 1 }, uStarsRotation: { value: 0 },
    uAuroraDirection: { value: new THREE.Vector2(1, 0) }, uAuroraIntensity: { value: 0 }, uAuroraTime: { value: 0 },
    uEnvI: { value: 1 }, uEnvRot: { value: 0 }, uEnvTransform: { value: new THREE.Matrix3() }, uEnvBTransform: { value: new THREE.Matrix3() },
    uWeatherWeights: { value: new THREE.Vector4(1, 0, 0, 0) }, uNightBlend: { value: 0 }, uDayTint: { value: new THREE.Color(1, 1, 1) }, uFxAmbient: { value: new THREE.Color(0.35, 0.35, 0.35) } };
}
// brightest texel of a Float equirect HDR -> world direction (the shader's uv convention, flipY data) and its colour
export function sunFromHdr(texture) {
  const { data, width, height } = texture.image; let best = -1, bi = 0;
  for (let i = 0; i < width * height; i++) { const l = data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722; if (l > best) { best = l; bi = i; } }
  const px = bi % width, row = Math.floor(bi / width);
  const u = (px + 0.5) / width, v = texture.flipY ? 1 - (row + 0.5) / height : (row + 0.5) / height;
  const azimuth = (u - 0.5) / 0.1591549, y = Math.sin((v - 0.5) / 0.3183099), c = Math.sqrt(Math.max(1 - y * y, 0));
  const color = new THREE.Color(data[bi * 4], data[bi * 4 + 1], data[bi * 4 + 2]);
  const m = Math.max(color.r, color.g, color.b) || 1; color.multiplyScalar(1 / m);
  return { direction: new THREE.Vector3(Math.cos(azimuth) * c, y, Math.sin(azimuth) * c), color, radiance: best };
}
// the dome: an inside-out sphere drawn behind everything. glsl: the fragment preamble holding sky() (SKY_GLSL, or the pond's
// GLSL_COMMON which contains it); atFarPlane: the pond's depth trick (the dome sits at the far plane whatever its radius), else the
// ocean's plain projection (radius must stay inside the camera far plane).
export function createSkyDome(uniforms, { radius, defines = {}, glsl = SKY_GLSL, atFarPlane = false, renderOrder = -1000 } = {}) {
  const material = new THREE.ShaderMaterial({ uniforms, defines, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = ${atFarPlane ? 'p.xyww' : 'p'}; }`,
    fragmentShader: `${glsl} varying vec3 vDir; void main(){ gl_FragColor = vec4(sky(normalize(vDir), 1.0), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  mesh.frustumCulled = false; mesh.renderOrder = renderOrder;
  return mesh;
}
