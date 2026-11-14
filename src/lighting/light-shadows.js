// Light shadows: the shadows of point and spot lights, in one depth atlas. Each light that casts holds a block of the
// atlas: a spot light uses one tile of it (its cone seen from the light), a point light six (a cube around it).
// Used through the light rig (rig.js), which decides which of its lights cast and gives both lighting paths the read.
import * as THREE from 'three';
import {createRenderScope} from '../core/render-state.js';
import {createShadowCasters, withShadowCasters, SHADOW_LAYER} from './shadow-casters.js';

export const LIGHT_SHADOW_DEFAULTS = Object.freeze({
  casters: 4,         // lights that cast at once
  resolution: 512,    // texels across a tile
  perFrame: 1,        // lights whose shadow is drawn again each frame, in turn (a new one is drawn at once)
  range: 50,          // m: how far the shadow of a light without a cutoff distance is drawn
  strength: 1,        // 0 = no shadow, 1 = full
  softness: 1.5,      // texels: radius of the blur of the shadow edge
  normalOffset: 1.5,  // texels a surface is read away from itself, along its normal
  depthBias: 1.5,     // texels a surface is read nearer the light
});
export const LIGHT_SHADOW_LIMITS = Object.freeze({
  casters: [1, 8], resolution: [64, 2048], perFrame: [1, 8], range: [1, 10000], strength: [0, 1], softness: [0, 8], normalOffset: [0, 16], depthBias: [0, 16],
});
const WHOLE = ['casters', 'resolution', 'perFrame'];
const NEAR = .1;                         // m: near plane of the light cameras
const BLOCK = Object.freeze([3, 2]);     // tiles of a block: the six faces of a point light
const CUBE_FACE_ANGLE = 90;              // degrees
const MAX_SPOT_ANGLE = 170;              // degrees: widest cone a single tile can hold
const UP = new THREE.Vector3(0, 1, 0), SIDE = new THREE.Vector3(0, 0, 1);
const UP_LIMIT = .99;                    // |y| of a spot direction above which its camera rolls around +Z instead of +Y
// The faces of a point light, in the order the GLSL finds them: where each looks and its up. Tile = column face % 3,
// row floor(face / 3).
const FACES = Object.freeze([[1, 0, 0, UP], [-1, 0, 0, UP], [0, 1, 0, SIDE], [0, -1, 0, SIDE], [0, 0, 1, UP], [0, 0, -1, UP]]
  .map(([x, y, z, up]) => ({forward: new THREE.Vector3(x, y, z), up})));

// `float lightShadowOf(int caster, vec3 worldPosition, vec3 n)`: the share of a casting light that reaches a surface
// facing n, and `float lightShadowNear(vec3 lightViewPosition, ...)`: the same for the light standing at a place,
// for Three's own light loop. Written once per shader, whoever brings it.
export const lightShadowGLSL = casters => /* glsl */`
#ifndef LIGHT_SHADOWS
#define LIGHT_SHADOWS
#define LIGHT_SHADOW_CASTERS ${casters}
#define LIGHT_SHADOW_NEAR ${NEAR.toFixed(4)}
// Metres within which a light of Three's loop is the caster drawn at that place (a moving light is drawn a few frames late).
#define LIGHT_SHADOW_SAME_PLACE 0.5
uniform highp sampler2D uLightShadowAtlas;
uniform mat4 uLightShadowMatrix[LIGHT_SHADOW_CASTERS];     // spot light: world -> clip space of its tile
uniform vec4 uLightShadowPlace[LIGHT_SHADOW_CASTERS];      // position of the light when drawn, far plane (0 = no caster)
uniform vec4 uLightShadowBlock[LIGHT_SHADOW_CASTERS];      // first tile of the caster in the atlas: min uv, size in uv
uniform vec2 uLightShadowKind[LIGHT_SHADOW_CASTERS];       // 1 = point light (six tiles), 0 = spot; tangent of half the view of a tile
uniform vec4 uLightShadowLook;       // strength, normal offset (texels), softness (texels), depth bias (texels)
uniform vec3 uLightShadowTexel;      // 1 / atlas width, 1 / atlas height, texels across a tile
float lightShadowOf(int caster, vec3 worldPosition, vec3 n) {
  vec4 place = uLightShadowPlace[caster];
  if (place.w <= 0.0) return 1.0;
  vec3 toLight = place.xyz - worldPosition;
  float lightDistance = max(length(toLight), 0.0001);
  vec2 kind = uLightShadowKind[caster];
  float texel = 2.0 * lightDistance * kind.y / uLightShadowTexel.z;
  vec3 origin = worldPosition + n * (texel * uLightShadowLook.y) + toLight * (texel * uLightShadowLook.w / lightDistance);
  vec4 block = uLightShadowBlock[caster];
  vec2 tile = block.xy, inTile;
  float depth;
  if (kind.x > 0.5) {
    // The face of the cube the surface is seen through, and where on it.
    vec3 d = origin - place.xyz, a = abs(d);
    float along, face;
    vec2 across;
    if (a.x >= a.y && a.x >= a.z) { along = a.x; face = d.x > 0.0 ? 0.0 : 1.0; across = vec2(d.x > 0.0 ? d.z : -d.z, d.y); }
    else if (a.y >= a.z) { along = a.y; face = d.y > 0.0 ? 2.0 : 3.0; across = vec2(d.y > 0.0 ? d.x : -d.x, d.z); }
    else { along = a.z; face = d.z > 0.0 ? 4.0 : 5.0; across = vec2(d.z > 0.0 ? -d.x : d.x, d.y); }
    along = max(along, LIGHT_SHADOW_NEAR);
    inTile = across / along * 0.5 + 0.5;
    tile += vec2(mod(face, 3.0), floor(face / 3.0)) * block.zw;
    float farPlane = place.w;
    depth = ((farPlane + LIGHT_SHADOW_NEAR) / (farPlane - LIGHT_SHADOW_NEAR) - 2.0 * farPlane * LIGHT_SHADOW_NEAR / ((farPlane - LIGHT_SHADOW_NEAR) * along)) * 0.5 + 0.5;
  } else {
    vec4 clip = uLightShadowMatrix[caster] * vec4(origin, 1.0);
    if (clip.w <= 0.0) return 1.0;
    vec3 seen = clip.xyz / clip.w * 0.5 + 0.5;
    inTile = seen.xy; depth = seen.z;
    if (inTile.x <= 0.0 || inTile.y <= 0.0 || inTile.x >= 1.0 || inTile.y >= 1.0) return 1.0;
  }
  if (depth >= 1.0) return 1.0;
  // Half a texel inside the tile, so a blurred read never crosses into the next one.
  vec2 inset = 0.5 * uLightShadowTexel.xy, low = tile + inset, high = tile + block.zw - inset;
  vec2 uv = tile + inTile * block.zw;
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 tap = clamp(uv + vec2(float(x), float(y)) * uLightShadowLook.z * uLightShadowTexel.xy, low, high);
    lit += step(depth, textureLod(uLightShadowAtlas, tap, 0.0).r);
  }
  return mix(1.0, lit / 9.0, uLightShadowLook.x);
}
float lightShadowNear(vec3 lightViewPosition, mat4 view, vec3 worldPosition, vec3 n) {
  for (int caster = 0; caster < LIGHT_SHADOW_CASTERS; caster++) {
    vec4 place = uLightShadowPlace[caster];
    if (place.w > 0.0 && distance((view * vec4(place.xyz, 1.0)).xyz, lightViewPosition) < LIGHT_SHADOW_SAME_PLACE) return lightShadowOf(caster, worldPosition, n);
  }
  return 1.0;
}
#endif`;

function validate(settings) {
  for (const [name, [min, max]] of Object.entries(LIGHT_SHADOW_LIMITS)) {
    const value = settings[name];
    if (!Number.isFinite(value) || value < min || value > max || (WHOLE.includes(name) && !Number.isInteger(value))) throw new RangeError(`Invalid light shadow ${name}`);
  }
}

// renderer: the THREE.WebGLRenderer the shadows are drawn with. casters and resolution are fixed at creation, the
// other settings are live. Returns {settings, glsl, uniforms, atlas, set(name, value), assign(lights) -> block of each,
// blockOf(light), render(scene) -> lights drawn, dispose()}.
export function createLightShadows({renderer, ...overrides} = {}) {
  if (typeof renderer?.render !== 'function') throw new TypeError('Light shadows need a renderer');
  if (renderer.capabilities?.reversedDepthBuffer) throw Error('Light shadows do not read a reversed depth buffer');
  const settings = {...LIGHT_SHADOW_DEFAULTS, ...overrides};
  validate(settings);
  const {casters: capacity, resolution} = settings;
  // Blocks side by side, in as square an atlas as they allow.
  const columns = Math.ceil(Math.sqrt(capacity * BLOCK[1] / BLOCK[0])), rows = Math.ceil(capacity / columns);
  const blockWidth = BLOCK[0] * resolution, blockHeight = BLOCK[1] * resolution, width = columns * blockWidth, height = rows * blockHeight;
  const depth = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
  depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const target = new THREE.WebGLRenderTarget(width, height, {depthTexture: depth, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter});
  target.scissorTest = true;
  const each = make => Array.from({length: capacity}, make);
  const look = new THREE.Vector4();
  const uniforms = {
    uLightShadowAtlas: {value: depth}, uLightShadowMatrix: {value: each(() => new THREE.Matrix4())},
    uLightShadowPlace: {value: each(() => new THREE.Vector4())}, uLightShadowBlock: {value: each(() => new THREE.Vector4())},
    uLightShadowKind: {value: each(() => new THREE.Vector2())},
    uLightShadowLook: {value: look}, uLightShadowTexel: {value: new THREE.Vector3(1 / width, 1 / height, resolution)},
  };
  const origins = each((_, block) => ({x: (block % columns) * blockWidth, y: Math.floor(block / columns) * blockHeight}));
  origins.forEach(({x, y}, block) => uniforms.uLightShadowBlock.value[block].set(x / width, y / height, resolution / width, resolution / height));
  const holders = each(() => null);     // the light of each block
  const fresh = each(() => false);      // true: the block has a new light, not drawn yet
  const camera = new THREE.PerspectiveCamera(); camera.layers.set(SHADOW_LAYER);
  const scope = createRenderScope(renderer), shadowCasters = createShadowCasters();
  const position = new THREE.Vector3(), aim = new THREE.Vector3(), toward = new THREE.Vector3(), due = [];
  let turn = 0, disposed = false;

  function drawTile(scene, block, face) {
    const {x, y} = origins[block], left = x + (face % BLOCK[0]) * resolution, bottom = y + Math.floor(face / BLOCK[0]) * resolution;
    target.viewport.set(left, bottom, resolution, resolution); target.scissor.set(left, bottom, resolution, resolution);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
  }
  function draw(scene, block) {
    const light = holders[block], far = light.distance > 0 ? light.distance : settings.range;
    light.getWorldPosition(position);
    camera.position.copy(position); camera.near = NEAR; camera.far = far; camera.aspect = 1;
    if (light.isSpotLight) {
      camera.fov = Math.min(THREE.MathUtils.radToDeg(light.angle) * 2, MAX_SPOT_ANGLE);
      light.target.getWorldPosition(aim);
      camera.up.copy(Math.abs(toward.copy(aim).sub(position).normalize().y) > UP_LIMIT ? SIDE : UP);
      camera.lookAt(aim); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      uniforms.uLightShadowMatrix.value[block].multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      uniforms.uLightShadowKind.value[block].set(0, Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      drawTile(scene, block, 0);
    } else {
      camera.fov = CUBE_FACE_ANGLE; camera.updateProjectionMatrix();
      uniforms.uLightShadowKind.value[block].set(1, 1);
      FACES.forEach(({forward, up}, face) => {
        camera.up.copy(up); camera.lookAt(aim.copy(position).add(forward)); camera.updateMatrixWorld(true);
        drawTile(scene, block, face);
      });
    }
    uniforms.uLightShadowPlace.value[block].set(position.x, position.y, position.z, far);
    fresh[block] = false;
  }

  const shadows = {
    settings, glsl: lightShadowGLSL(capacity), uniforms, atlas: depth, capacity,
    set(name, value) {
      if (name === 'casters' || name === 'resolution') throw Error(`Light shadow ${name} is fixed at creation`);
      if (!(name in LIGHT_SHADOW_DEFAULTS)) throw Error(`Unknown light shadow setting ${name}`);
      validate({...settings, [name]: value}); settings[name] = value;
      return shadows;
    },
    // The block a light holds, or -1.
    blockOf: light => holders.indexOf(light),
    // The lights that cast this frame, the ones that count most first; at most `casters` are kept. A light keeps its
    // block from one frame to the next; one that left gives its block up.
    assign(lights) {
      const count = Math.min(lights.length, capacity);
      for (let block = 0; block < capacity; block++) {
        const index = holders[block] ? lights.indexOf(holders[block]) : -1;
        if (holders[block] && (index < 0 || index >= count)) { holders[block] = null; uniforms.uLightShadowPlace.value[block].w = 0; }
      }
      for (let index = 0; index < count; index++) {
        if (holders.includes(lights[index])) continue;
        const block = holders.indexOf(null);
        holders[block] = lights[index]; fresh[block] = true;
      }
    },
    // Once per frame, after assign() and before the scene is drawn. Draws the new casters and `perFrame` of the
    // others, in turn. Returns the lights drawn.
    render(scene) {
      if (disposed) return 0;
      if (!scene?.isScene) throw new TypeError('Light shadows render a scene');
      const {strength, normalOffset, softness, depthBias, perFrame} = settings;
      look.set(strength, normalOffset, softness, depthBias);
      due.length = 0;
      for (let block = 0; block < capacity; block++) if (holders[block] && fresh[block]) due.push(block);
      for (let step = 0, again = 0; step < capacity && again < perFrame; step++) {
        const block = (turn + step) % capacity;
        if (!holders[block] || fresh[block]) continue;
        due.push(block); again++;
        if (again === perFrame) turn = (block + 1) % capacity;
      }
      if (!due.length) return 0;
      withShadowCasters(shadowCasters, scene, renderer, () => scope(() => { for (const block of due) draw(scene, block); }));
      return due.length;
    },
    dispose() { if (disposed) return; disposed = true; target.dispose(); depth.dispose(); shadowCasters.dispose(); },
  };
  return shadows;
}
