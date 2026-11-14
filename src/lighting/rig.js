// Light rig: gives the lighting hook the point and spot lights of a scene. A light stays a Three light (PointLight,
// SpotLight): Three lights its own materials with it, the rig gives the same light, in the same units and with the
// same falloff, to the materials on the hook (core createLighting({lights: rig.lights})), so both paths match.
// The hook holds a fixed number of lights; with more in the rig, the ones that count most at the focus are kept.
import * as THREE from 'three';

export const LIGHT_RIG_DEFAULTS = Object.freeze({
  capacity: 8,   // lights the hook reads at once
});
export const LIGHT_RIG_LIMITS = Object.freeze({capacity: [1, 32]});
const NO_CONE = Object.freeze([-2, -1.5]);   // cosines no direction falls outside of: a point light
const MIN_SQUARED_DISTANCE = 1;              // m2: nearer than 1 m, a light counts no more for the choice
const LUMINANCE = Object.freeze([.2126, .7152, .0722]);   // Rec. 709

// `vec3 lightLocal(vec3 n, vec3 worldPosition, float wrap)` for the lighting hook. Falloff and cone are Three's
// (getDistanceAttenuation, getSpotLightInfo).
export const lightRigGLSL = capacity => /* glsl */`
#define LIGHT_RIG_CAPACITY ${capacity}
uniform int uRigCount;
uniform vec3 uRigPosition[LIGHT_RIG_CAPACITY];    // world position
uniform vec3 uRigColor[LIGHT_RIG_CAPACITY];       // colour x intensity
uniform vec3 uRigDirection[LIGHT_RIG_CAPACITY];   // from the target of a spot light toward the light
uniform vec4 uRigShape[LIGHT_RIG_CAPACITY];       // cutoff distance (0 = none), decay, cos(cone), cos(inner cone)
vec3 lightLocal(vec3 n, vec3 worldPosition, float wrap) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < LIGHT_RIG_CAPACITY; i++) {
    if (i >= uRigCount) break;
    vec3 toLight = uRigPosition[i] - worldPosition;
    float lightDistance = length(toLight);
    vec3 direction = toLight / max(lightDistance, 0.0001);
    vec4 shape = uRigShape[i];
    float falloff = 1.0 / max(pow(lightDistance, shape.y), 0.01);
    if (shape.x > 0.0) {
      float edge = lightDistance / shape.x;
      float inside = clamp(1.0 - edge * edge * edge * edge, 0.0, 1.0);
      falloff *= inside * inside;
    }
    float cone = smoothstep(shape.z, shape.w, dot(direction, uRigDirection[i]));
    float facing = max((dot(n, direction) + wrap) / (1.0 + wrap), 0.0);
    sum += uRigColor[i] * (falloff * cone * facing);
  }
  return sum;
}`;

// Returns {lights: {glsl, uniforms}, capacity, count, add(light) -> remove, remove(light), has(light),
// update(focus?) -> lights given to the hook, dispose()}.
export function createLightRig(overrides = {}) {
  const settings = {...LIGHT_RIG_DEFAULTS, ...overrides};
  const [min, max] = LIGHT_RIG_LIMITS.capacity, {capacity} = settings;
  if (!Number.isInteger(capacity) || capacity < min || capacity > max) throw new RangeError('Invalid light rig capacity');
  const vectors = () => Array.from({length: capacity}, () => new THREE.Vector3());
  const uniforms = {
    uRigCount: {value: 0}, uRigPosition: {value: vectors()}, uRigColor: {value: vectors()}, uRigDirection: {value: vectors()},
    uRigShape: {value: Array.from({length: capacity}, () => new THREE.Vector4())},
  };
  const lights = [];          // every light of the rig
  const weights = [];         // how much each one counts this frame, by its index in `lights`
  const chosen = [];          // indices of the ones the hook reads this frame, strongest first; at most `capacity`
  const position = new THREE.Vector3(), target = new THREE.Vector3();
  // How much a light counts at the focus: its luminance over the squared distance. Without a focus: its luminance.
  function weight(light, focus) {
    const {r, g, b} = light.color, luminance = (r * LUMINANCE[0] + g * LUMINANCE[1] + b * LUMINANCE[2]) * light.intensity;
    return focus ? luminance / Math.max(light.getWorldPosition(position).distanceToSquared(focus), MIN_SQUARED_DISTANCE) : luminance;
  }
  function write(index, light) {
    light.getWorldPosition(uniforms.uRigPosition.value[index]);
    uniforms.uRigColor.value[index].set(light.color.r, light.color.g, light.color.b).multiplyScalar(light.intensity);
    const spot = light.isSpotLight;
    if (spot) uniforms.uRigDirection.value[index].copy(uniforms.uRigPosition.value[index]).sub(light.target.getWorldPosition(target)).normalize();
    uniforms.uRigShape.value[index].set(light.distance, light.decay,
      spot ? Math.cos(light.angle) : NO_CONE[0], spot ? Math.cos(light.angle * (1 - light.penumbra)) : NO_CONE[1]);
  }
  const rig = {
    settings, capacity, lights: {glsl: lightRigGLSL(capacity), uniforms},
    // Lights in the rig (not all may reach the hook: see update).
    get count() { return lights.length; },
    has: light => lights.includes(light),
    // A Three PointLight or SpotLight, wherever it is in the scene. Returns the function that takes it out again.
    add(light) {
      if (!light?.isPointLight && !light?.isSpotLight) throw new TypeError('The light rig takes a Three PointLight or SpotLight');
      if (lights.includes(light)) throw Error('This light is already in the rig');
      lights.push(light);
      return () => rig.remove(light);
    },
    remove(light) { const index = lights.indexOf(light); if (index >= 0) lights.splice(index, 1); },
    // Once per frame, after the lights moved. focus: a world position (THREE.Vector3, e.g. the camera's) around which
    // the lights are chosen when the rig holds more than the hook reads. Lights that are hidden or dark are left out.
    update(focus) {
      if (focus !== undefined && !focus?.isVector3) throw new TypeError('Light rig focus must be a Vector3');
      chosen.length = 0;
      for (let index = 0; index < lights.length; index++) {
        const light = lights[index];
        if (!light.visible || light.intensity <= 0) continue;
        const counts = weights[index] = weight(light, focus);
        // Kept sorted, strongest first; the weakest falls out when the hook is full.
        let at = chosen.length;
        while (at > 0 && weights[chosen[at - 1]] < counts) at--;
        if (at >= capacity) continue;
        for (let slot = Math.min(chosen.length, capacity - 1); slot > at; slot--) chosen[slot] = chosen[slot - 1];
        chosen[at] = index;
      }
      for (let slot = 0; slot < chosen.length; slot++) write(slot, lights[chosen[slot]]);
      uniforms.uRigCount.value = chosen.length;
      return chosen.length;
    },
    dispose() { lights.length = weights.length = chosen.length = 0; uniforms.uRigCount.value = 0; },
  };
  return rig;
}
