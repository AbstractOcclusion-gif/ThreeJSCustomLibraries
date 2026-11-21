// Light caustics: the bright, shifting web a small body of liquid throws when a lamp shines through it (a glass on a
// desk, a bowl, a fish tank). The pond's method (channel-material.js), under one light of a scene instead of the sun:
// a grid over a ripple field (ripples.js) is refracted along the light's rays at the flat and at the rippled surface,
// and both are carried down to a plane under the liquid (the table). Where the rippled rays crowd together the light
// is focused: the map holds that focus, the area of a grid cell flat over its area rippled. A material that receives
// (applyTo, through the light slots of core/light-slots.js) has the light of that one lamp multiplied by it, inside
// the patch the liquid lights and near the plane; its other lights are left alone.
// The surface: a horizontal mesh whose own x and z are the ripple field's (the field's origin is in its frame).
import * as THREE from 'three';
import {addLightSlot} from '../core/light-slots.js';
import {WATER_IOR} from './water-optics.js';

export const LIGHT_CAUSTIC_DEFAULTS = Object.freeze({
  resolution: 256,   // texels across the map
  segments: 64,      // grid cells across the ripple field
  strength: 1,       // 0 = no caustics, 1 = as refracted
  heightScale: 1,    // m of liquid surface per unit of the ripple field (a small field in a glass wants a few mm)
  normalScale: 1,    // scale on the ripple slopes (steeper waves focus more)
  ior: WATER_IOR,    // refractive index of the liquid
  spread: 1.6,       // the map covers the field this many times over, for the rays that fan out
  band: .03,         // m above and below the plane a surface still receives
  maxFocus: 8,       // brightest a texel of the map may get (folds focus without end)
});
export const LIGHT_CAUSTIC_LIMITS = Object.freeze({
  resolution: [16, 2048], segments: [4, 512], strength: [0, 4], heightScale: [1e-5, 10], normalScale: [0, 8], ior: [1, 3], spread: [1, 8], band: [.001, 1], maxFocus: [1, 64],
});
const FIXED = ['resolution', 'segments'];
const SLOT = 'light-caustics';
const SAME_LIGHT = 1e-3;   // m (view space): a light of the loop is this light when it stands this near it

const MAP_VERTEX = /* glsl */`
uniform sampler2D uRipple;
uniform vec4 uRippleBounds;   // x, z of the field's origin and its width and depth, in the surface's frame (m)
uniform vec2 uRippleTexel;    // one texel of the field in uv
uniform float uRippleCell;    // m
uniform mat4 uSurface;        // the surface's world matrix
uniform vec3 uLightPosition;  // world
uniform float uPlaneY, uIor, uHeightScale, uNormalScale, uMapHalf;
uniform vec2 uMapCenter;
varying vec3 vFlat, vRippled;
varying vec2 vFromMiddle;   // -1..1 across the field
float rippleHeight(vec2 at) { return texture2D(uRipple, at).r * uHeightScale; }
vec3 toPlane(vec3 p, vec3 ray) { return p + ray * ((uPlaneY - p.y) / min(-1e-3, ray.y)); }
void main() {
  vec2 p = uRippleBounds.xy + uv * uRippleBounds.zw;
  vFromMiddle = uv * 2.0 - 1.0;
  float h = rippleHeight(uv);
  vec2 slope = vec2(rippleHeight(uv + vec2(uRippleTexel.x, 0.0)) - rippleHeight(uv - vec2(uRippleTexel.x, 0.0)),
                    rippleHeight(uv + vec2(0.0, uRippleTexel.y)) - rippleHeight(uv - vec2(0.0, uRippleTexel.y))) / (2.0 * uRippleCell);
  vec3 still = (uSurface * vec4(p.x, 0.0, p.y, 1.0)).xyz, moved = (uSurface * vec4(p.x, h, p.y, 1.0)).xyz;
  vec3 incoming = normalize(still - uLightPosition);
  vFlat = toPlane(still, refract(incoming, vec3(0.0, 1.0, 0.0), 1.0 / uIor));
  vRippled = toPlane(moved, refract(incoming, normalize(vec3(-slope.x * uNormalScale, 1.0, -slope.y * uNormalScale)), 1.0 / uIor));
  gl_Position = vec4((vRippled.xz - uMapCenter) / uMapHalf, 0.0, 1.0);
}`;
// r: focus (summed where the grid folds over itself); g: how many layers of the grid cover the texel.
const MAP_FRAGMENT = /* glsl */`
uniform float uMaxFocus;
varying vec3 vFlat, vRippled;
varying vec2 vFromMiddle;
void main() {
  #ifdef LIGHT_CAUSTIC_DISC
  if (dot(vFromMiddle, vFromMiddle) > 1.0) discard;   // the liquid is the disc inside the field
  #endif
  float flatArea = length(dFdx(vFlat)) * length(dFdy(vFlat)), rippledArea = length(dFdx(vRippled)) * length(dFdy(vRippled));
  gl_FragColor = vec4(min(flatArea / max(rippledArea, 1e-9), uMaxFocus), 1.0, 0.0, 1.0);
}`;
const RECEIVER_GLSL = /* glsl */`
uniform sampler2D tLightCaustic;
uniform vec2 uLightCausticCenter;
uniform float uLightCausticHalf, uLightCausticStrength;
uniform vec2 uLightCausticPlane;    // y of the plane (m), half the band that receives (m)
uniform vec3 uLightCausticView;     // the light, in view space (as the light loop has it)
float lightCausticAt(vec3 p) {
  vec2 uv = (p.xz - uLightCausticCenter) / (2.0 * uLightCausticHalf) + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))) || abs(p.y - uLightCausticPlane.x) > uLightCausticPlane.y) return 1.0;
  vec2 focus = texture2D(tLightCaustic, uv).rg;
  return mix(1.0, max(0.0, 1.0 + (focus.r - 1.0) * uLightCausticStrength), clamp(focus.g, 0.0, 1.0));
}`;
// GLSL's refract(): the ray i (unit) through a surface of normal n (unit, against i) with eta = n1 / n2. In place.
function refract(i, n, eta) {
  const cos = i.dot(n), k = 1 - eta * eta * (1 - cos * cos);
  return k < 0 ? i.set(0, 0, 0) : i.multiplyScalar(eta).addScaledVector(n, -(eta * cos + Math.sqrt(k)));
}
const UP = new THREE.Vector3(0, 1, 0);
const forLight = light => `if (distance(${light}.position, uLightCausticView) < ${SAME_LIGHT.toFixed(4)}) directLight.color *= lightCausticAt(vLightWorld);`;

// renderer: the THREE.WebGLRenderer. ripples: a createRipples() field. surface: the liquid's mesh (horizontal; its own x,
// z are the field's). light: the THREE.PointLight or SpotLight that shines through it. planeY: world height (m) of
// the plane that catches the light (e.g. the table top). Settings: LIGHT_CAUSTIC_DEFAULTS; resolution and segments are
// fixed at creation. shape: 'square' (the whole field holds liquid) or 'disc' (the disc inside it: a glass, a bowl).
// Returns {settings, texture, uniforms, set(key, value), applyTo(material) -> detach,
// update(camera), dispose()}; update once per frame, after the ripples and before the scene is drawn.
export function createLightCaustics({renderer, ripples, surface, light, planeY, shape = 'square', ...overrides} = {}) {
  if (shape !== 'square' && shape !== 'disc') throw new TypeError("Light caustic shape is 'square' or 'disc'");
  if (!renderer) throw new TypeError('Light caustics need the renderer');
  if (!ripples?.texture || !ripples.bounds?.isVector4) throw new TypeError('Light caustics need a ripple field (createRipples)');
  if (!surface?.isObject3D) throw new TypeError('Light caustics need the liquid surface (an Object3D)');
  if (!light?.isPointLight && !light?.isSpotLight) throw new TypeError('Light caustics need a Three PointLight or SpotLight');
  if (!Number.isFinite(planeY)) throw new RangeError('Light caustics need the height of the plane that catches them');
  const settings = {...LIGHT_CAUSTIC_DEFAULTS};
  const check = (key, value) => {
    const range = LIGHT_CAUSTIC_LIMITS[key];
    if (!range) throw Error('Unknown light caustic setting: ' + key);
    if (!Number.isFinite(value) || value < range[0] || value > range[1] || (FIXED.includes(key) && !Number.isInteger(value))) throw new RangeError(`Invalid light caustic ${key}`);
  };
  for (const [key, value] of Object.entries(overrides)) { check(key, value); settings[key] = value; }

  const target = new THREE.WebGLRenderTarget(settings.resolution, settings.resolution, {type: THREE.HalfFloatType, depthBuffer: false});
  const field = ripples.texture.image;
  const mapUniforms = {
    uRipple: {value: ripples.texture}, uRippleBounds: {value: ripples.bounds}, uRippleCell: {value: ripples.cell},
    uRippleTexel: {value: new THREE.Vector2(1 / field.width, 1 / field.height)},
    uSurface: {value: surface.matrixWorld}, uLightPosition: {value: new THREE.Vector3()},
    uPlaneY: {value: planeY}, uIor: {value: settings.ior}, uHeightScale: {value: settings.heightScale}, uNormalScale: {value: settings.normalScale},
    uMapCenter: {value: new THREE.Vector2()}, uMapHalf: {value: 1}, uMaxFocus: {value: settings.maxFocus},
  };
  const grid = new THREE.PlaneGeometry(1, 1, settings.segments, settings.segments);
  const material = new THREE.ShaderMaterial({uniforms: mapUniforms, vertexShader: MAP_VERTEX, fragmentShader: MAP_FRAGMENT, defines: shape === 'disc' ? {LIGHT_CAUSTIC_DISC: 1} : {},
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false});
  const mesh = new THREE.Mesh(grid, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(mesh);
  const uniforms = {
    tLightCaustic: {value: target.texture}, uLightCausticCenter: mapUniforms.uMapCenter, uLightCausticHalf: mapUniforms.uMapHalf,
    uLightCausticStrength: {value: settings.strength}, uLightCausticPlane: {value: new THREE.Vector2(planeY, settings.band)},
    uLightCausticView: {value: new THREE.Vector3()},
  };
  const centre = new THREE.Vector3(), ray = new THREE.Vector3(), clear = new THREE.Color(), detach = new Set();
  const bounds = ripples.bounds;

  return {
    settings, texture: target.texture, uniforms,
    set(key, value) {
      check(key, value);
      if (FIXED.includes(key)) throw Error(`Light caustic ${key} is fixed at creation`);
      settings[key] = value;
      mapUniforms.uIor.value = settings.ior; mapUniforms.uHeightScale.value = settings.heightScale; mapUniforms.uNormalScale.value = settings.normalScale; mapUniforms.uMaxFocus.value = settings.maxFocus;
      uniforms.uLightCausticStrength.value = settings.strength; uniforms.uLightCausticPlane.value.y = settings.band;
      return this;
    },
    // A lit Three material (standard, physical...) on or near the plane: its light from this lamp gets the caustics.
    applyTo(target) {
      const off = addLightSlot(target, {key: SLOT, uniforms, declarations: RECEIVER_GLSL, worldPosition: true, point: forLight('pointLight'), spot: forLight('spotLight')});
      detach.add(off);
      return () => { off(); detach.delete(off); };
    },
    // camera: the camera the scene is drawn with (the light loop works in its view space).
    update(camera) {
      surface.updateWorldMatrix(true, false);
      light.getWorldPosition(mapUniforms.uLightPosition.value);
      uniforms.uLightCausticView.value.copy(mapUniforms.uLightPosition.value).applyMatrix4(camera.matrixWorldInverse);
      // The map is centred where the middle of the field throws its light on the plane, unrippled.
      centre.set(bounds.x + bounds.z / 2, 0, bounds.y + bounds.w / 2).applyMatrix4(surface.matrixWorld);
      ray.copy(centre).sub(mapUniforms.uLightPosition.value).normalize();
      refract(ray, UP, 1 / settings.ior);
      const down = Math.min(-1e-3, ray.y), reach = (planeY - centre.y) / down;
      mapUniforms.uMapCenter.value.set(centre.x + ray.x * reach, centre.z + ray.z * reach);
      mapUniforms.uMapHalf.value = Math.max(bounds.z, bounds.w) / 2 * settings.spread;
      const previous = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(clear, alpha);
    },
    dispose() {
      for (const off of [...detach]) off();
      target.dispose(); grid.dispose(); material.dispose();
    },
  };
}
