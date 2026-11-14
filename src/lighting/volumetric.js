// Volumetric light: the air made visible. One pass marches each view ray through a thin fog and adds up the light the
// air sends toward the camera: the sun through the cascades (shafts between the shadows, tinted by glass), the point
// and spot lights of a light rig (cones and halos, with their shadows), and the sky. The sun and the sky fill the
// whole ray, so they are sampled all along it; a point or spot light only lights the air within its reach, so it gets
// samples of its own on the stretch of the ray that crosses it. The pass runs at a share of the screen and is laid
// back over the scene along its depth edges, smoothed over the dither that hides its steps. Each part is optional: without sun shadows the sun
// fills the air evenly, without a rig there are no local lights.
// The scene is drawn into the pass's own target first (or handed over as {color, depth}), then put on screen.
import * as THREE from 'three';
import {createRenderScope} from '../core/render-state.js';

export const VOLUMETRIC_DEFAULTS = Object.freeze({
  density: .005,       // 1 / m: how much of the light a metre of air takes and scatters
  heightBase: 0,       // m: up to this height the air is at full density
  heightFalloff: 0,    // m over which the density drops by e above the base; 0 = the same at every height
  anisotropy: .6,      // 0 = the air scatters evenly, toward 1 = mostly onward: bright looking into a light
  distance: 150,       // m from the camera where the march ends
  steps: 24,           // samples along a ray, for the sun and the sky
  lightSteps: 8,       // samples for each of the rig's lights, on the stretch of the ray within its reach
  scale: .5,           // share of the screen the march runs at, each way
  sun: 1,              // strength of the sun in the air
  lights: 1,           // strength of the rig's lights in the air
  ambient: 1,          // strength of the sky in the air
  color: 0xffffff,     // tint of the air
});
export const VOLUMETRIC_LIMITS = Object.freeze({
  density: [0, 1], heightBase: [-10000, 10000], heightFalloff: [0, 10000], anisotropy: [-.95, .95], distance: [1, 10000], steps: [1, 64], lightSteps: [1, 16], scale: [.1, 1],
  sun: [0, 16], lights: [0, 16], ambient: [0, 16],
});
const MAX_STEPS = VOLUMETRIC_LIMITS.steps[1], MAX_LIGHT_STEPS = VOLUMETRIC_LIMITS.lightSteps[1];
const WHOLE = ['steps', 'lightSteps'];
const STEP_POWER = 2;                   // samples sit at distance x (share of the ray) ^ this: closer together near the camera
const ISOTROPIC = 1 / (4 * Math.PI);    // phase of light that comes from everywhere (the sky)
const QUAD_VERTEX = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const VIEW_GLSL = /* glsl */`
uniform highp sampler2D tDepth;
uniform mat4 uInverseProjection;
float volumeViewDepth(float depth) { vec4 view = uInverseProjection * vec4(0.0, 0.0, depth * 2.0 - 1.0, 1.0); return -view.z / view.w; }`;

// sunGLSL: the read of the sun shadows; rigGLSL: the hook part of a light rig (with or without light shadows).
const marchFragment = (sunGLSL, rigGLSL) => /* glsl */`
#define VOLUME_MAX_STEPS ${MAX_STEPS}
#define VOLUME_MAX_LIGHT_STEPS ${MAX_LIGHT_STEPS}
// Golden ratio: shifts the dither from one light to the next, so their steps do not line up.
#define VOLUME_LIGHT_SHIFT 0.61803398875
#define VOLUME_STEP_POWER ${STEP_POWER.toFixed(1)}
varying vec2 vUv;
${VIEW_GLSL}
uniform mat4 uCameraWorld;
uniform vec3 uVolumeSun, uVolumeSunDirection, uVolumeAmbient, uVolumeColor;
uniform vec4 uVolumeMedium;   // density (1 / m), base height (m), height falloff (m, 0 = none), anisotropy
uniform vec4 uVolumeMarch;    // distance (m), steps, strength of the rig's lights, steps for each of them
${sunGLSL}
${rigGLSL}
// Henyey-Greenstein: the share of the light the air sends on at an angle from where it was going.
float volumePhase(float cosine, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566370614 * pow(max(1.0 + g2 - 2.0 * g * cosine, 0.0001), 1.5));
}
// Interleaved gradient noise: a fixed dither that hides the steps of the march.
float volumeNoise(vec2 pixel) { return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715)))); }
float volumeDensity(vec3 p) {
  float density = uVolumeMedium.x;
  if (uVolumeMedium.z > 0.0) density *= exp(-max(p.y - uVolumeMedium.y, 0.0) / uVolumeMedium.z);
  return density;
}
${rigGLSL ? /* glsl */`
// The light the rig's lights send along a ray, up to end metres. Each light is sampled on the stretch of the ray inside
// its cutoff distance (the whole ray when it has none): a light is small and bright next to the length of a ray, and
// the steps of the sun would miss it or catch it by chance.
vec3 volumeRigLights(vec3 origin, vec3 ray, float end, float jitter) {
  vec3 sum = vec3(0.0);
  float atCamera = volumeDensity(origin);
  int steps = int(uVolumeMarch.w);
  for (int i = 0; i < LIGHT_RIG_CAPACITY; i++) {
    if (i >= uRigCount) break;
    float start = 0.0, stop = end, cutoff = uRigShape[i].x;
    if (cutoff > 0.0) {
      vec3 toCentre = uRigPosition[i] - origin;
      float along = dot(toCentre, ray), inside = cutoff * cutoff - (dot(toCentre, toCentre) - along * along);
      if (inside <= 0.0) continue;
      float reach = sqrt(inside);
      start = max(along - reach, 0.0); stop = min(along + reach, end);
      if (stop <= start) continue;
    }
    float stepLength = (stop - start) / uVolumeMarch.w, shifted = fract(jitter + float(i) * VOLUME_LIGHT_SHIFT);
    for (int s = 0; s < VOLUME_MAX_LIGHT_STEPS; s++) {
      if (s >= steps) break;
      float travelled = start + (float(s) + shifted) * stepLength;
      vec3 p = origin + ray * travelled, toward;
      vec3 light = lightRigAt(i, p, toward);
      if (light == vec3(0.0)) continue;
      #ifdef LIGHT_SHADOWS
      if (uRigCaster[i] >= 0) light *= lightShadowRead(uRigCaster[i], p, vec3(0.0), 0);
      #endif
      // The air between the camera and the sample dims it: its density taken as the mean of both ends.
      float density = volumeDensity(p);
      sum += light * (volumePhase(dot(ray, toward), uVolumeMedium.w) * density * stepLength * exp(-0.5 * (atCamera + density) * travelled));
    }
  }
  return sum;
}` : ''}
void main() {
  float depth = texture2D(tDepth, vUv).r;
  vec4 view = uInverseProjection * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 toScene = mat3(uCameraWorld) * (view.xyz / view.w);
  float sceneDistance = length(toScene);
  vec3 ray = toScene / max(sceneDistance, 0.0001), origin = uCameraWorld[3].xyz;
  // The sky has no surface to stop at.
  float end = depth >= 1.0 ? uVolumeMarch.x : min(sceneDistance, uVolumeMarch.x);
  float jitter = volumeNoise(gl_FragCoord.xy);
  vec3 sunInAir = uVolumeSun * volumePhase(dot(ray, uVolumeSunDirection), uVolumeMedium.w);
  vec3 scattered = vec3(0.0);
  float transmittance = 1.0, previous = 0.0;
  int steps = int(uVolumeMarch.y);
  for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
    if (i >= steps) break;
    float next = end * pow(float(i + 1) / uVolumeMarch.y, VOLUME_STEP_POWER);
    float stepLength = next - previous;
    vec3 p = origin + ray * (previous + stepLength * jitter);
    previous = next;
    float density = volumeDensity(p);
    if (density <= 0.0) continue;
    vec3 light = uVolumeAmbient;
    ${sunGLSL ? 'light += sunInAir * sunShadowInAir(p);' : 'light += sunInAir;'}
    // What this stretch of air takes from the light behind it, it gives back lit.
    float through = exp(-density * stepLength);
    scattered += transmittance * (1.0 - through) * light * uVolumeColor;
    transmittance *= through;
    if (transmittance < 0.001) break;
  }
  ${rigGLSL ? 'scattered += volumeRigLights(origin, ray, end, jitter) * uVolumeColor * uVolumeMarch.z;' : ''}
  gl_FragColor = vec4(scattered, transmittance);
}`;

// Lays the march over the scene. Each pixel takes the 3 x 3 samples of the march around it, weighted as a smooth bump
// (a quadratic B-spline): that averages the dither of the march away. A sample only counts for a pixel at about the
// same depth, so the fog of the background does not bleed over the edge of what stands in front of it.
const COMPOSITE_FRAGMENT = /* glsl */`
// Relative depth difference at which a sample of the march counts half.
#define VOLUME_DEPTH_EDGE 0.02
varying vec2 vUv;
${VIEW_GLSL}
uniform sampler2D tScene, tVolume;
uniform vec2 uVolumeSize;   // texels of the march
void main() {
  vec2 texel = 1.0 / uVolumeSize, at = vUv * uVolumeSize - 0.5, nearest = floor(at + 0.5), off = at - nearest;
  // Weights of the sample before, at and after the nearest one, each way; they add up to 1.
  vec3 bumpX = vec3(0.5 * (0.5 - off.x) * (0.5 - off.x), 0.75 - off.x * off.x, 0.5 * (0.5 + off.x) * (0.5 + off.x));
  vec3 bumpY = vec3(0.5 * (0.5 - off.y) * (0.5 - off.y), 0.75 - off.y * off.y, 0.5 * (0.5 + off.y) * (0.5 + off.y));
  float centre = volumeViewDepth(texture2D(tDepth, vUv).r);
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int y = 0; y < 3; y++) for (int x = 0; x < 3; x++) {
    vec2 uv = clamp((nearest + vec2(float(x - 1), float(y - 1)) + 0.5) * texel, 0.5 * texel, 1.0 - 0.5 * texel);
    float weight = bumpX[x] * bumpY[y];
    float apart = abs(volumeViewDepth(texture2D(tDepth, uv).r) - centre) / max(centre, 0.001);
    weight *= VOLUME_DEPTH_EDGE / (VOLUME_DEPTH_EDGE + apart);
    sum += texture2D(tVolume, uv) * weight; total += weight;
  }
  vec4 volume = total > 0.0 ? sum / total : vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = vec4(texture2D(tScene, vUv).rgb * volume.a + volume.rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function validate(settings) {
  for (const [name, [min, max]] of Object.entries(VOLUMETRIC_LIMITS)) {
    const value = settings[name];
    if (!Number.isFinite(value) || value < min || value > max || (WHOLE.includes(name) && !Number.isInteger(value))) throw new RangeError(`Invalid volumetric ${name}`);
  }
}

// renderer: the THREE.WebGLRenderer. sunShadows: a createSunShadows() (optional). rig: a createLightRig() (optional).
// Every setting is live in `settings` (set(name, value) checks them).
// Returns {settings, set(name, value), render(scene, camera, environment, input?), dispose()}.
export function createVolumetricLight({renderer, sunShadows, rig, ...overrides} = {}) {
  if (typeof renderer?.render !== 'function') throw new TypeError('Volumetric light needs a renderer');
  if (sunShadows !== undefined && typeof sunShadows?.sun?.glsl !== 'string') throw new TypeError('Volumetric light takes the sun shadows of createSunShadows');
  if (rig !== undefined && typeof rig?.lights?.glsl !== 'string') throw new TypeError('Volumetric light takes the rig of createLightRig');
  const settings = {...VOLUMETRIC_DEFAULTS, ...overrides};
  validate(settings);
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthTexture: depth});
  const volumeTarget = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false});
  const view = {tDepth: {value: depth}, uInverseProjection: {value: new THREE.Matrix4()}};
  const marchUniforms = {
    ...view, uCameraWorld: {value: new THREE.Matrix4()},
    uVolumeSun: {value: new THREE.Color()}, uVolumeSunDirection: {value: new THREE.Vector3(0, 1, 0)}, uVolumeAmbient: {value: new THREE.Color()},
    uVolumeColor: {value: new THREE.Color()}, uVolumeMedium: {value: new THREE.Vector4()}, uVolumeMarch: {value: new THREE.Vector4()},
    ...sunShadows?.sun.uniforms, ...rig?.lights.uniforms,
  };
  const compositeUniforms = {...view, tScene: {value: sceneTarget.texture}, tVolume: {value: volumeTarget.texture}, uVolumeSize: {value: new THREE.Vector2(1, 1)}};
  const march = new THREE.ShaderMaterial({uniforms: marchUniforms, vertexShader: QUAD_VERTEX, fragmentShader: marchFragment(sunShadows?.sun.glsl ?? '', rig?.lights.glsl ?? ''), depthTest: false, depthWrite: false, toneMapped: false});
  const composite = new THREE.ShaderMaterial({uniforms: compositeUniforms, vertexShader: QUAD_VERTEX, fragmentShader: COMPOSITE_FRAGMENT, depthTest: false, depthWrite: false});
  const geometry = new THREE.PlaneGeometry(2, 2), quad = new THREE.Mesh(geometry, march), quadScene = new THREE.Scene(), quadCamera = new THREE.Camera();
  quad.frustumCulled = false; quadScene.add(quad);
  const scope = createRenderScope(renderer), size = new THREE.Vector2();
  let disposed = false;

  const volumetric = {
    settings,
    set(name, value) {
      if (!(name in VOLUMETRIC_DEFAULTS)) throw Error(`Unknown volumetric setting ${name}`);
      if (name in VOLUMETRIC_LIMITS) validate({...settings, [name]: value});
      settings[name] = value;
      return volumetric;
    },
    // Draws the scene with its lit air into the current render target (the screen). In place of
    // renderer.render(scene, camera), after the shadows of the frame are drawn. environment: core/environment.js (the
    // sun and the sky; e.g. stage.environment, view.environment). input: {color, depth} textures of a scene already
    // drawn at the size of the screen, when another pass has it.
    render(scene, camera, environment, input) {
      if (disposed) return;
      if (!camera?.isPerspectiveCamera) throw new TypeError('Volumetric light needs a perspective camera');
      if (!environment?.sun?.direction?.isVector3) throw new TypeError('Volumetric light needs an environment');
      renderer.getDrawingBufferSize(size);
      if (size.x === 0 || size.y === 0) return;
      const {density, heightBase, heightFalloff, anisotropy, distance, steps, lightSteps, scale, sun, lights, ambient, color} = settings;
      const width = Math.max(1, Math.round(size.x * scale)), height = Math.max(1, Math.round(size.y * scale));
      volumeTarget.setSize(width, height); compositeUniforms.uVolumeSize.value.set(width, height);
      camera.updateMatrixWorld();
      view.uInverseProjection.value.copy(camera.projectionMatrixInverse); marchUniforms.uCameraWorld.value.copy(camera.matrixWorld);
      view.tDepth.value = input?.depth ?? depth; compositeUniforms.tScene.value = input?.color ?? sceneTarget.texture;
      marchUniforms.uVolumeSun.value.copy(environment.sun.color).multiplyScalar(sun);
      marchUniforms.uVolumeSunDirection.value.copy(environment.sun.direction);
      marchUniforms.uVolumeAmbient.value.copy(environment.ambient.sky).multiplyScalar(ambient * ISOTROPIC);
      marchUniforms.uVolumeColor.value.set(color);
      marchUniforms.uVolumeMedium.value.set(density, heightBase, heightFalloff, anisotropy);
      marchUniforms.uVolumeMarch.value.set(distance, steps, lights, lightSteps);
      const screen = renderer.getRenderTarget();
      scope(() => {
        if (!input) { sceneTarget.setSize(size.x, size.y); renderer.setRenderTarget(sceneTarget); renderer.render(scene, camera); }
        quad.material = march; renderer.setRenderTarget(volumeTarget); renderer.render(quadScene, quadCamera);
        quad.material = composite; renderer.setRenderTarget(screen); renderer.render(quadScene, quadCamera);
      });
    },
    dispose() {
      if (disposed) return; disposed = true;
      sceneTarget.dispose(); volumeTarget.dispose(); depth.dispose(); march.dispose(); composite.dispose(); geometry.dispose();
    },
  };
  return volumetric;
}
