// Glass of a vessel (a tumbler, a bottle, a tube), after WebAquarium's glass (objects/tank-props.js, jelly/tube.js): it
// is seen by what it reflects. Its opacity follows the reflection (Fresnel: clear face-on, a mirror at grazing angles),
// its own body shows where the eye looks along its thickness (the silhouette, the thick foot), fingerprints roughen and
// bend the reflection in handled patches (WebAquarium's glass dirt: ambientCG Fingerprints002, CC0), and condensation
// beads the band given as wet (WebAquarium's droplets, without the lens onto the scene behind).
// The look is hooked onto a Three physical material, so the glass keeps Three's lights, the light rig's shadows and an
// environment map (a reflection probe). The material is drawn blended as light added over what is behind, dimmed by
// the opacity: reflections keep their full strength however clear the glass is.
import * as THREE from 'three';

export const GLASS_DEFAULTS = Object.freeze({
  reflect: 1,          // how much of the Fresnel reflection hides what is behind (WebAquarium uReflect)
  clear: .03,          // opacity seen face-on (WebAquarium: .03)
  body: .3,            // how much the glass's own body shows at grazing angles, 0..1
  foot: .35,           // the same over its thick foot, 0..1
  tint: 0xcfe2e6,      // the colour of the glass's body
  smudges: 1,          // fingerprints: 0 = a clean glass (WebAquarium smudges)
  smudgeScale: 9,      // tiles of the print texture per m (a tile is a few prints across)
  smudgePatches: 28,   // handled patches per m
  droplets: 0,         // condensation over the wet band: 0 = dry, 1 = beaded all over
  dropletSize: .0022,  // m: the cell a bead sits in
});
export const GLASS_LIMITS = Object.freeze({reflect: [0, 4], clear: [0, 1], body: [0, 1], foot: [0, 1], smudges: [0, 3], smudgeScale: [.1, 200],
  smudgePatches: [.1, 500], droplets: [0, 1], dropletSize: [1e-4, 1]});
const PRINTS = Object.freeze({
  mask: new URL('../../assets/glass/prints.webp', import.meta.url).href,            // r: print opacity, g: its roughness
  normal: new URL('../../assets/glass/prints-normal.webp', import.meta.url).href,   // rg: the print's slope
});
// WebAquarium's constants (tank-props.js GLASS_DIRT, glassMat), named.
const FRESNEL_FACE_ON = .04;    // reflectance of glass seen face-on
const BODY_OPACITY = .5;        // opacity the glass's own body adds at most
const PRINT_BEND = .9;          // how far a print bends the reflection
const PRINT_ROUGHNESS = 2.5;    // roughness a print adds, per unit of its texture
const PRINT_FILM = .35;         // light a print's grease scatters, share of the body's
const BEAD_BEND = .8;           // how far a bead bends the reflection
const BEAD_FILM = .45;          // light a bead scatters, share of the body's
const BEAD_OPACITY = .12;       // opacity a bead adds
const BEAD_SMALL_PIXELS = '.2, .6';   // beads this share of a pixel wide fade into a haze (WebAquarium)

const PARS_GLSL = /* glsl */`
varying vec3 vGlassLocal, vGlassAround, vGlassUp;
uniform sampler2D uGlassPrints, uGlassPrintsNormal;
uniform vec3 uGlassTint;
uniform vec4 uGlassLook;      // reflect, clear, body, foot
uniform vec4 uGlassSmudge;    // smudges, tiles per m, patches per m, radius of the glass (m)
uniform vec4 uGlassWet;       // droplets, bead cells per m, bottom and top of the wet band (the glass's own y)
uniform vec2 uGlassFoot;      // bottom and top of the thick foot (the glass's own y)
float glassHash(vec2 p) { p = fract(p * vec2(41.3, 289.1)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.y); }
float glassNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(glassHash(cell), glassHash(cell + vec2(1.0, 0.0)), f.x), mix(glassHash(cell + vec2(0.0, 1.0)), glassHash(cell + vec2(1.0, 1.0)), f.x), f.y);
}
// Fingerprints at p (m round the glass, m up it): xy the slope they give the surface, z how much of a print is there.
vec3 glassPrints(vec2 p, out float rough) {
  vec2 uv = p * uGlassSmudge.y;
  vec3 mask = texture2D(uGlassPrints, uv).rgb;
  vec2 slope = texture2D(uGlassPrintsNormal, uv).rg * 2.0 - 1.0;
  float patches = smoothstep(.45, .8, glassNoise(p * uGlassSmudge.z + 3.1) * .65 + glassNoise(p * uGlassSmudge.z * 2.4 + 11.0) * .35);
  float print = smoothstep(.08, .55, mask.r) * patches * uGlassSmudge.x;
  rough = clamp(mask.g * ${PRINT_ROUGHNESS} * print, 0.0, 1.0);
  return vec3(slope * print * ${PRINT_BEND}, print);
}
// One layer of beads, cells of 1 / cells m: a cell holds a bead when its hash is under the amount of water there.
// xy: the slope of the bead's dome, z: how much of the pixel it covers, w: haze of beads too small to draw (footprint:
// m a pixel covers). WebAquarium's beads.
vec4 glassBeads(vec2 p, float amount, float cells, float footprint) {
  p *= cells;
  vec2 cell = floor(p);
  vec3 best = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    if (glassHash(c + 3.7) > amount) continue;
    vec2 d = p - c - .2 - .6 * vec2(glassHash(c), glassHash(c + 17.17));
    float radius = (.22 + .25 * glassHash(c + 9.1)) * clamp(amount * 2.5, .4, 1.0), t = length(d) / radius;
    if (t < 1.0) { float cover = smoothstep(1.0, .8, t); if (cover > best.z) best = vec3(d / radius, cover); }
  }
  float small = smoothstep(${BEAD_SMALL_PIXELS}, footprint * cells);
  return vec4(best.xy * (1.0 - small), best.z * (1.0 - small), clamp(amount, 0.0, 1.0) * small);
}`;
// After Three's normal: the prints and the beads bend it and roughen the surface; the glass's own colour is its body,
// shown where the eye looks along its thickness, and the light its prints and beads scatter.
const SURFACE_GLSL = /* glsl */`
float glassBody;
{
  vec2 glassAt = vec2(atan(vGlassLocal.z, vGlassLocal.x) * uGlassSmudge.w, vGlassLocal.y);
  float glassRough;
  vec3 prints = glassPrints(glassAt, glassRough);
  float wetBand = smoothstep(uGlassWet.z, uGlassWet.z + .15 * (uGlassWet.w - uGlassWet.z), vGlassLocal.y) * (1.0 - smoothstep(uGlassWet.w - .25 * (uGlassWet.w - uGlassWet.z), uGlassWet.w, vGlassLocal.y));
  float water = uGlassWet.x * wetBand * (.55 + .9 * glassNoise(glassAt * uGlassWet.y * .12));
  vec4 beads = water > 0.0 ? glassBeads(glassAt, water, uGlassWet.y, length(fwidth(vGlassLocal))) : vec4(0.0);
  vec2 slope = prints.xy + beads.xy * beads.z * ${BEAD_BEND};
  normal = normalize(normal + normalize(vGlassAround) * slope.x + normalize(vGlassUp) * slope.y);
  roughnessFactor = clamp(roughnessFactor + glassRough, 0.0, 1.0);
  float facing = saturate(abs(dot(normal, normalize(vViewPosition))));
  float foot = 1.0 - smoothstep(uGlassFoot.x, uGlassFoot.y, vGlassLocal.y);
  glassBody = clamp(pow(1.0 - facing, 3.0) * uGlassLook.z + foot * uGlassLook.w + prints.z * ${PRINT_FILM} + (beads.z + beads.w) * ${BEAD_FILM}, 0.0, 1.0);
  diffuseColor.rgb = uGlassTint * glassBody;
  diffuseColor.a = max(clamp(uGlassLook.y + (${FRESNEL_FACE_ON} + ${1 - FRESNEL_FACE_ON} * pow(1.0 - facing, 5.0)) * uGlassLook.x, 0.0, 1.0),
    max(glassBody * ${BODY_OPACITY}, beads.z * ${BEAD_OPACITY}));
}`;

// material: a transparent THREE.MeshPhysicalMaterial (the glass's; its roughness, ior and envMap stay its own).
// shape: the glass in its mesh's own frame, standing about its y axis: {radius (m), foot: [bottom, top] of its thick
// foot (y), wet: [bottom, top] of the band that takes condensation (y)}. Settings: GLASS_DEFAULTS. Returns {material,
// settings, set(key, value), dispose()}. Call before other features hook the material.
export function createGlassLook(material, {radius, foot, wet}, overrides = {}) {
  if (!material?.isMeshPhysicalMaterial) throw new TypeError('The glass look needs a MeshPhysicalMaterial');
  if (!(radius > 0)) throw new RangeError('The glass look needs the radius of the glass');
  for (const [name, band] of [['foot', foot], ['wet', wet]]) if (!Array.isArray(band) || !(band[1] >= band[0])) throw new RangeError(`The glass look needs its ${name} band: [bottom, top]`);
  const settings = {...GLASS_DEFAULTS};
  const check = (key, value) => {
    if (!(key in GLASS_DEFAULTS)) throw Error('Unknown glass setting: ' + key);
    const range = GLASS_LIMITS[key];
    if (range && (!Number.isFinite(value) || value < range[0] || value > range[1])) throw new RangeError('Invalid glass ' + key);
  };
  for (const [key, value] of Object.entries(overrides)) { check(key, value); settings[key] = value; }

  const loader = new THREE.TextureLoader();
  const prints = Object.entries(PRINTS).map(([, url]) => {
    const texture = loader.load(url);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.NoColorSpace;
    return texture;
  });
  const uniforms = {
    uGlassPrints: {value: prints[0]}, uGlassPrintsNormal: {value: prints[1]}, uGlassTint: {value: new THREE.Color()},
    uGlassLook: {value: new THREE.Vector4()}, uGlassSmudge: {value: new THREE.Vector4()}, uGlassWet: {value: new THREE.Vector4()},
    uGlassFoot: {value: new THREE.Vector2(foot[0], foot[1])},
  };
  function look() {
    uniforms.uGlassTint.value.set(settings.tint);
    uniforms.uGlassLook.value.set(settings.reflect, settings.clear, settings.body, settings.foot);
    uniforms.uGlassSmudge.value.set(settings.smudges, settings.smudgeScale, settings.smudgePatches, radius);
    uniforms.uGlassWet.value.set(settings.droplets, 1 / settings.dropletSize, wet[0], wet[1]);
  }
  look();
  // Light added over what is behind, which the opacity dims: gl_FragColor.rgb is not multiplied by its alpha.
  const blend = {transparent: material.transparent, blending: material.blending, blendSrc: material.blendSrc, blendDst: material.blendDst, depthWrite: material.depthWrite};
  Object.assign(material, {transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, depthWrite: false});
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vGlassLocal, vGlassAround, vGlassUp;\n' + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
      vGlassLocal = position;
      vGlassAround = mat3(modelViewMatrix) * vec3(-position.z, 0.0, position.x);
      vGlassUp = mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS_GLSL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SURFACE_GLSL);
  };
  material.customProgramCacheKey = function () { return previousKey.call(this) + '|glass-look'; };
  material.needsUpdate = true;

  return {
    material, settings,
    set(key, value) { check(key, value); settings[key] = value; look(); return this; },
    dispose() {
      for (const texture of prints) texture.dispose();
      Object.assign(material, blend, {onBeforeCompile: previous, customProgramCacheKey: previousKey});
      material.needsUpdate = true;
    },
  };
}
