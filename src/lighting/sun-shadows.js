// Sun shadows: the kit's own cascaded shadow map. The view is cut into a few slices (cascades.js), each drawn from
// the sun into one tile of a depth atlas; a surface reads the finest cascade that holds it and gives way to the next
// one near the edge of its tile. Both lighting paths read the same atlas with the same GLSL: the hook through
// createLighting({sun: shadows.sun}), lit Three materials through shadows.applyTo(material) (a core light slot).
// The sun is a direction, not a light object: the Three DirectionalLight that points the same way is the one
// shadowed, and it must not cast Three's own shadow as well (light.castShadow = false).
import * as THREE from 'three';
import {addLightSlot} from '../core/light-slots.js';
import {createRenderScope} from '../core/render-state.js';
import {cascadeSplits, createCascadeFitter} from './cascades.js';
import {createShadowCasters, withShadowCasters, shadowAtlasTarget, SHADOW_LAYER} from './shadow-casters.js';

export const SUN_SHADOW_DEFAULTS = Object.freeze({
  cascades: 4,        // slices of the view, each with its own tile
  resolution: 1024,   // texels across a tile
  distance: 150,      // m from the camera where the shadows end
  near: .5,           // m: where the logarithmic cut starts (the first cascade still begins at the camera)
  lambda: .75,        // cut of the slices: 0 = even, 1 = logarithmic (detail near the camera)
  reach: 100,         // m toward the sun, outside a cascade, from which casters still fall into it
  strength: 1,        // 0 = no shadow, 1 = full
  softness: 1.5,      // texels: radius of the blur of the shadow edge
  normalOffset: 1.5,  // texels a surface is read away from itself, along its normal: stops self-shadow stripes
  depthBias: 1,       // texels of depth a surface is read nearer the sun: same purpose, for surfaces that face it
  blend: .1,          // share of a tile, from its edge, over which a cascade gives way to the next
  every: Object.freeze([1, 1, 2, 4]),   // frames between two draws of each cascade: the far ones can wait
  debug: false,       // tints each cascade: red, green, blue, yellow
  translucent: false, // transparent meshes cast too, as coloured glass (the atlas then holds colour: more memory)
});
export const SUN_SHADOW_LIMITS = Object.freeze({
  cascades: [1, 4] /* the per-cascade uniforms are vec4 */, resolution: [64, 4096], distance: [1, 10000], near: [.01, 100], lambda: [0, 1], reach: [0, 10000],
  strength: [0, 1], softness: [0, 8], normalOffset: [0, 16], depthBias: [0, 16], blend: [.001, .5],
});
const WHOLE = ['cascades', 'resolution'];
const ATLAS_COLUMNS = 2;                 // tiles per row of the atlas, when there is more than one cascade
const SLOT = 'sun-shadows';
const TO_UV = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);   // clip space -> 0..1

// `vec3 sunShadowAt(vec3 worldPosition, vec3 n)`: the share of the sunlight that reaches a surface facing n, and
// `vec3 sunShadowInAir(vec3 worldPosition)`: the same for a point of the air, read with a single tap (light shafts).
// Written once per shader, whoever brings it (the hook, a light slot). translucent: the light is also tinted by the
// transparent casters it went through.
export const sunShadowGLSL = (cascades, translucent = false) => /* glsl */`
#ifndef SUN_SHADOWS
#define SUN_SHADOWS
${translucent ? `#define SUN_SHADOW_GLASS
// Depth by which a surface must be behind a glass to take its tint: the glass must not tint itself.
#define SUN_SHADOW_GLASS_BIAS 0.001
uniform sampler2D uSunShadowGlass;   // rgb: light let through by the glass, a: depth of the nearest glass` : ''}
#define SUN_SHADOW_CASCADES ${cascades}
// Cosine above which a directional light is the sun.
#define SUN_SHADOW_SAME_DIRECTION 0.99999
uniform highp sampler2D uSunShadowAtlas;
uniform mat4 uSunShadowMatrix[SUN_SHADOW_CASCADES];   // world -> atlas uv (xy), depth (z)
uniform vec4 uSunShadowTile[SUN_SHADOW_CASCADES];     // tile of the cascade in the atlas: min uv, max uv
uniform vec4 uSunShadowTexel;     // per cascade: world metres per texel
uniform vec4 uSunShadowBias;      // per cascade: depth a surface is read nearer the sun
uniform vec4 uSunShadowLook;      // strength, normal offset (texels), softness (texels), blend (share of a tile)
uniform vec3 uSunShadowAtlasTexel;   // 1 / atlas width, 1 / atlas height, debug tint (0 or 1)
uniform vec3 uSunShadowDir;       // toward the sun
vec3 sunShadowTint(int cascade) {
  return cascade == 0 ? vec3(1.0, 0.4, 0.4) : cascade == 1 ? vec3(0.4, 1.0, 0.4) : cascade == 2 ? vec3(0.4, 0.55, 1.0) : vec3(1.0, 1.0, 0.4);
}
// kernel: taps on each side of the centre (1 = 3 x 3, 0 = one tap).
float sunShadowTaps(vec2 uv, float depth, vec4 tile, int kernel) {
  float lit = 0.0;
  for (int y = -kernel; y <= kernel; y++) for (int x = -kernel; x <= kernel; x++) {
    vec2 tap = clamp(uv + vec2(float(x), float(y)) * uSunShadowLook.z * uSunShadowAtlasTexel.xy, tile.xy, tile.zw);
    lit += step(depth, textureLod(uSunShadowAtlas, tap, 0.0).r);
  }
  float side = float(2 * kernel + 1);
  return lit / (side * side);
}
vec3 sunShadowRead(vec3 worldPosition, vec3 n, int kernel) {
  float lit = 0.0, left = 1.0;
  vec3 tint = vec3(0.0), through = vec3(0.0);
  for (int i = 0; i < SUN_SHADOW_CASCADES; i++) {
    vec3 origin = worldPosition + n * (uSunShadowTexel[i] * uSunShadowLook.y);
    vec3 coord = (uSunShadowMatrix[i] * vec4(origin, 1.0)).xyz;
    vec4 tile = uSunShadowTile[i];
    vec2 inTile = (coord.xy - tile.xy) / (tile.zw - tile.xy);
    vec2 border = min(inTile, 1.0 - inTile);
    float edge = min(border.x, border.y);
    if (edge <= 0.0 || coord.z <= 0.0 || coord.z >= 1.0) continue;
    float share = left * smoothstep(0.0, uSunShadowLook.w, edge);
    lit += share * sunShadowTaps(coord.xy, coord.z - uSunShadowBias[i], tile, kernel);
    #ifdef SUN_SHADOW_GLASS
    vec4 glass = textureLod(uSunShadowGlass, clamp(coord.xy, tile.xy, tile.zw), 0.0);
    through += share * (coord.z - SUN_SHADOW_GLASS_BIAS > glass.a ? glass.rgb : vec3(1.0));
    #else
    through += vec3(share);
    #endif
    tint += share * sunShadowTint(i);
    left -= share;
    if (left < 0.001) break;
  }
  // Outside every cascade: in the sun.
  vec3 visibility = mix(vec3(1.0), (lit + left) * (through + left), uSunShadowLook.x);
  return visibility * mix(vec3(1.0), tint + left, uSunShadowAtlasTexel.z);
}
vec3 sunShadowAt(vec3 worldPosition, vec3 n) { return sunShadowRead(worldPosition, n, 1); }
vec3 sunShadowInAir(vec3 worldPosition) { return sunShadowRead(worldPosition, vec3(0.0), 0); }
#endif`;

function validate(settings) {
  for (const [name, [min, max]] of Object.entries(SUN_SHADOW_LIMITS)) {
    const value = settings[name];
    if (!Number.isFinite(value) || value < min || value > max || (WHOLE.includes(name) && !Number.isInteger(value))) throw new RangeError(`Invalid sun shadow ${name}`);
  }
  if (settings.near >= settings.distance) throw new RangeError('Sun shadow near must be under its distance');
  const {every, cascades} = settings;
  if (!Array.isArray(every) || every.length < cascades || every.slice(0, cascades).some(frames => !Number.isInteger(frames) || frames < 1)) throw new RangeError('Invalid sun shadow every');
}

// renderer: the THREE.WebGLRenderer the cascades are drawn with. cascades, resolution and translucent are fixed at creation; the
// other settings are live in `settings` (set(name, value) checks them).
// Returns {settings, sun (a sun cover), atlas, set(name, value), applyTo(material) -> detach,
// render(scene, camera, sunDirection) -> cascades drawn, dispose()}.
export function createSunShadows({renderer, ...overrides} = {}) {
  if (typeof renderer?.render !== 'function') throw new TypeError('Sun shadows need a renderer');
  if (renderer.capabilities?.reversedDepthBuffer) throw Error('Sun shadows do not read a reversed depth buffer');
  const settings = {...SUN_SHADOW_DEFAULTS, ...overrides};
  validate(settings);
  const {cascades, resolution} = settings, translucent = Boolean(settings.translucent);
  const columns = Math.min(cascades, ATLAS_COLUMNS), rows = Math.ceil(cascades / columns);
  const width = columns * resolution, height = rows * resolution;
  const depth = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
  depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const target = shadowAtlasTarget(width, height, depth, translucent);
  const perCascade = make => Array.from({length: cascades}, make);
  const look = new THREE.Vector4(), atlasTexel = new THREE.Vector3(1 / width, 1 / height, 0), sunDir = new THREE.Vector3(0, 1, 0);
  const uniforms = {
    uSunShadowAtlas: {value: depth}, uSunShadowMatrix: {value: perCascade(() => new THREE.Matrix4())},
    uSunShadowTile: {value: perCascade(() => new THREE.Vector4())},
    uSunShadowTexel: {value: new THREE.Vector4()}, uSunShadowBias: {value: new THREE.Vector4()},
    uSunShadowLook: {value: look}, uSunShadowAtlasTexel: {value: atlasTexel}, uSunShadowDir: {value: sunDir},
    ...(translucent && {uSunShadowGlass: {value: target.texture}}),
  };
  const glsl = sunShadowGLSL(cascades, translucent);
  // Tiles in pixels, and in uv half a texel inside their edge so a blurred read never crosses into the next tile.
  const tiles = perCascade((_, index) => ({x: (index % columns) * resolution, y: Math.floor(index / columns) * resolution}));
  tiles.forEach(({x, y}, index) => uniforms.uSunShadowTile.value[index].set((x + .5) / width, (y + .5) / height, (x + resolution - .5) / width, (y + resolution - .5) / height));
  const toTile = tiles.map(({x, y}) => new THREE.Matrix4().makeScale(resolution / width, resolution / height, 1).setPosition(x / width, y / height, 0).multiply(TO_UV));
  const cameras = perCascade(() => { const camera = new THREE.OrthographicCamera(); camera.layers.set(SHADOW_LAYER); return camera; });
  const fitter = createCascadeFitter(), scope = createRenderScope(renderer), splits = [];
  const casters = createShadowCasters({translucent});
  let frame = 0, disposed = false;

  function draw(index, scene, camera, sunDirection) {
    const {reach, depthBias} = settings, lightCamera = cameras[index];
    const from = index ? splits[index - 1] : camera.near;
    const texel = fitter.fit(lightCamera, camera, Math.min(from, splits[index]), splits[index], sunDirection, resolution, reach);
    uniforms.uSunShadowMatrix.value[index].multiplyMatrices(toTile[index], lightCamera.projectionMatrix).multiply(lightCamera.matrixWorldInverse);
    uniforms.uSunShadowTexel.value.setComponent(index, texel);
    uniforms.uSunShadowBias.value.setComponent(index, texel * depthBias / (lightCamera.far - lightCamera.near));
    casters.drawTile(renderer, scene, lightCamera, target, tiles[index].x, tiles[index].y, resolution, 0);
  }

  const shadows = {
    // A sun cover (core/lighting.js) for the hook and for the air of a volumetric pass.
    settings, sun: {uniforms, glsl, read: 'sunShadowAt(worldPosition, n)', air: 'sunShadowInAir(worldPosition)'},
    atlas: depth,
    // Changes a live setting (everything but cascades and resolution).
    set(name, value) {
      if (name === 'cascades' || name === 'resolution' || name === 'translucent') throw Error(`Sun shadow ${name} is fixed at creation`);
      if (!(name in SUN_SHADOW_DEFAULTS)) throw Error(`Unknown sun shadow setting ${name}`);
      const next = {...settings, [name]: value};
      validate(next); settings[name] = value;
      return shadows;
    },
    // Gives a lit Three material (standard, physical, lambert, phong...) the shadow of the sun: the light of the
    // directional light that points as the sun is cut by the cascades. Returns the function that takes it away.
    applyTo(material) {
      return addLightSlot(material, {
        key: SLOT, uniforms, worldPosition: true, declarations: glsl,
        directional: /* glsl */`
          if (directLight.visible && dot(directLight.direction, transformDirection(uSunShadowDir, viewMatrix)) > SUN_SHADOW_SAME_DIRECTION) {
            directLight.color *= sunShadowAt(vLightWorld, inverseTransformDirection(geometryNormal, viewMatrix));
          }`,
      });
    },
    // Once per frame, before the scene is drawn. camera: the view (a PerspectiveCamera, world matrix up to date).
    // sunDirection: unit THREE.Vector3 toward the sun. Draws the cascades that are due and returns how many.
    render(scene, camera, sunDirection) {
      if (disposed) return 0;
      if (!scene?.isScene || !sunDirection?.isVector3) throw new TypeError('Sun shadows render a scene from a sun direction');
      const {distance, near, lambda, strength, normalOffset, softness, blend, every, debug} = settings;
      look.set(strength, normalOffset, softness, blend); atlasTexel.z = debug ? 1 : 0; sunDir.copy(sunDirection).normalize();
      cascadeSplits(Math.min(near, distance), distance, cascades, lambda, splits);
      let drawn = 0;
      // The first frame draws every cascade; after that each one waits its own number of frames.
      withShadowCasters(casters, scene, renderer, () => scope(() => {
        for (let index = 0; index < cascades; index++) if (frame === 0 || frame % every[index] === index % every[index]) { draw(index, scene, camera, sunDir); drawn++; }
      }));
      frame++;
      return drawn;
    },
    dispose() {
      if (disposed) return; disposed = true;
      target.dispose(); depth.dispose();
      casters.dispose();
    },
  };
  return shadows;
}
