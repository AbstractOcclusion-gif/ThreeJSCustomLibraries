// Volumetric light: the air made visible. One pass marches each view ray through a thin fog and adds up the light the
// air sends toward the camera: the sun through the cascades (shafts between the shadows, tinted by glass), the point
// and spot lights of a light rig (cones and halos, with their shadows), and the sky. The sun and the sky fill the
// whole ray, so they are sampled all along it; a point or spot light only lights the air within its reach, so it gets
// samples of its own on the stretch of the ray that crosses it, and brings a little air of its own with it (Luminex's
// local density), so a beam shows in air that is otherwise clear. The pass runs at a share of the screen and is laid
// back over the scene along its depth edges, smoothed over the dither that hides its steps. Each part is optional: without sun shadows the sun
// fills the air evenly, without a rig there are no local lights.
// The scene is drawn into the pass's own target first (or handed over as {color, depth}), then put on screen, or
// kept in a texture for the next pass of the frame (capture(): the weather's own pass, a water composite).
// The air ends at the water: a pass that knows where the water is hands over its plane and its distance.
import * as THREE from 'three';
import {createRenderScope} from '../core/render-state.js';
import {sunCovers} from '../core/lighting.js';

export const VOLUMETRIC_DEFAULTS = Object.freeze({
  density: .005,       // 1 / m: how much of the light a metre of air takes and scatters
  heightBase: 0,       // m: up to this height the air is at full density
  heightFalloff: 0,    // m over which the density drops by e above the base; 0 = the same at every height
  anisotropy: .6,      // 0 = the air scatters evenly, toward 1 = mostly onward: bright looking into a light
  distance: 150,       // m from the camera where the march ends
  steps: 24,           // samples along a ray, for the sun and the sky
  lightSteps: 8,       // samples for each of the rig's lights, on the stretch of the ray within its reach
  lightDensity: .02,   // 1 / m: air the rig's lights bring with them, so their beams show even in clear air (density 0)
  lightDensityFalloff: 1.5,   // how fast that air thins toward the cutoff distance of the light: 1 = evenly, 3 = held near the light
  scale: .5,           // share of the screen the march runs at, each way
  sun: 1,              // strength of the sun in the air
  lights: 1,           // strength of the rig's lights in the air
  ambient: 1,          // strength of the sky in the air
  color: 0xffffff,     // tint of the air
});
export const VOLUMETRIC_LIMITS = Object.freeze({
  density: [0, 1], heightBase: [-10000, 10000], heightFalloff: [0, 10000], anisotropy: [-.95, .95], distance: [1, 10000], steps: [1, 64], lightSteps: [1, 16], lightDensity: [0, 1], lightDensityFalloff: [.5, 3], scale: [.1, 1],
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

// sunGLSL: the GLSL of the sun covers; sunRead: what they let through at worldPosition, as a GLSL expression ('' = no
// cover); rigGLSL: the hook part of a light rig (with or without light shadows).
const marchFragment = (sunGLSL, sunRead, rigGLSL) => /* glsl */`
#define VOLUME_MAX_STEPS ${MAX_STEPS}
#define VOLUME_MAX_LIGHT_STEPS ${MAX_LIGHT_STEPS}
// Golden ratio: shifts the dither from one light to the next, so their steps do not line up.
#define VOLUME_LIGHT_SHIFT 0.61803398875
#define VOLUME_STEP_POWER ${STEP_POWER.toFixed(1)}
varying vec2 vUv;
${VIEW_GLSL}
uniform mat4 uCameraWorld;
uniform vec3 uVolumeSun, uVolumeSunDirection, uVolumeAmbient, uVolumeColor;
uniform float uVolumeSunStrength;
uniform vec4 uVolumeMedium;   // density (1 / m), base height (m), height falloff (m, 0 = none), anisotropy
uniform vec4 uVolumeMarch;    // distance (m), steps, strength of the rig's lights, steps for each of them
uniform vec2 uVolumeLightAir; // air the rig's lights bring with them: density (1 / m), falloff toward their cutoff
uniform vec4 uVolumeWater;    // plane of the water: normal and offset, under it below zero
uniform highp sampler2D tVolumeWater;   // a: distance from the camera to the water along the view ray, 0 = none
uniform vec2 uVolumeHasWater; // 1: there is a plane; 1: there is a distance texture
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
// Narrowest cone (cosine of its half angle) a ray is clipped to: wider ones keep the whole stretch within the cutoff.
#define VOLUME_CONE_MIN_COSINE 0.05
// Metres: nearest a ray is taken to pass by a light, so the samples do not all fall on one point.
#define VOLUME_LIGHT_MIN_MISS 0.05
bool volumeInCone(vec3 p, vec3 apex, vec3 axis, float cosine) {
  vec3 toPoint = p - apex;
  return dot(toPoint, axis) > length(toPoint) * cosine;
}
// Narrows [start, stop] to the stretch of a ray inside the cone of a spot light. false: the ray misses the cone.
// The two crossings of the cone's surface (and of its mirror image behind the apex) cut the ray in three; the cone
// is convex, so the stretch inside it is exactly one of them: the one whose middle is inside.
bool volumeConeStretch(vec3 origin, vec3 ray, vec3 apex, vec3 axis, float cosine, inout float start, inout float stop) {
  vec3 fromApex = origin - apex;
  float rayAlong = dot(ray, axis), originAlong = dot(fromApex, axis), c2 = cosine * cosine;
  float a = rayAlong * rayAlong - c2, b = 2.0 * (rayAlong * originAlong - c2 * dot(ray, fromApex)), c = originAlong * originAlong - c2 * dot(fromApex, fromApex);
  float discriminant = b * b - 4.0 * a * c;
  if (abs(a) < 0.000001 || discriminant <= 0.0) return volumeInCone(origin + ray * (0.5 * (start + stop)), apex, axis, cosine);
  float root = sqrt(discriminant), first = (-b - root) / (2.0 * a), second = (-b + root) / (2.0 * a);
  float low = clamp(min(first, second), start, stop), high = clamp(max(first, second), start, stop);
  if (low > start && volumeInCone(origin + ray * (0.5 * (start + low)), apex, axis, cosine)) { stop = low; return true; }
  if (high > low && volumeInCone(origin + ray * (0.5 * (low + high)), apex, axis, cosine)) { start = low; stop = high; return true; }
  if (stop > high && volumeInCone(origin + ray * (0.5 * (high + stop)), apex, axis, cosine)) { start = high; return true; }
  return false;
}
// The light the rig's lights send along a ray, up to end metres. Each light is sampled on the stretch of the ray inside
// its cutoff distance (the whole ray when it has none) and, for a spot, inside its cone: a light is small and bright
// next to the length of a ray, and the steps of the sun would miss it or catch it by chance. On that stretch the
// samples sit at even angles seen from the light (equi-angular sampling), close together where the ray passes
// nearest the light and the light is strongest, which is what keeps a halo smooth.
vec3 volumeRigLights(vec3 origin, vec3 ray, float begin, float end, float jitter) {
  vec3 sum = vec3(0.0);
  float atCamera = volumeDensity(origin);
  int steps = int(uVolumeMarch.w);
  for (int i = 0; i < LIGHT_RIG_CAPACITY; i++) {
    if (i >= uRigCount) break;
    float start = begin, stop = end, cutoff = uRigShape[i].x;
    if (cutoff > 0.0) {
      vec3 toCentre = uRigPosition[i] - origin;
      float along = dot(toCentre, ray), inside = cutoff * cutoff - (dot(toCentre, toCentre) - along * along);
      if (inside <= 0.0) continue;
      float reach = sqrt(inside);
      start = max(along - reach, begin); stop = min(along + reach, end);
      if (stop <= start) continue;
    }
    float cone = uRigShape[i].z;
    if (cone > VOLUME_CONE_MIN_COSINE && !volumeConeStretch(origin, ray, uRigPosition[i], -uRigDirection[i], cone, start, stop)) continue;
    // Where the ray passes nearest the light, how far it misses it by, and the angles of both ends seen from the light.
    vec3 toLight = uRigPosition[i] - origin;
    float nearest = dot(toLight, ray), miss = max(length(toLight - ray * nearest), VOLUME_LIGHT_MIN_MISS);
    float angleStart = atan((start - nearest) / miss), angleSpan = atan((stop - nearest) / miss) - angleStart;
    float shifted = fract(jitter + float(i) * VOLUME_LIGHT_SHIFT);
    for (int s = 0; s < VOLUME_MAX_LIGHT_STEPS; s++) {
      if (s >= steps) break;
      float fromNearest = miss * tan(angleStart + angleSpan * (float(s) + shifted) / uVolumeMarch.w);
      float travelled = nearest + fromNearest;
      // The length of ray this sample stands for: long far from the light, short near it.
      float stepLength = angleSpan * (miss * miss + fromNearest * fromNearest) / (miss * uVolumeMarch.w);
      vec3 p = origin + ray * travelled, toward;
      vec3 light = lightRigAt(i, p, toward);
      if (light == vec3(0.0)) continue;
      #ifdef LIGHT_SHADOWS
      if (uRigCaster[i] >= 0) light *= lightShadowRead(uRigCaster[i], p, vec3(0.0), 0);
      #endif
      // The air between the camera and the sample dims it: its density taken as the mean of both ends.
      float density = volumeDensity(p);
      float dimmed = exp(-0.5 * (atCamera + density) * travelled);
      // The light's own air: full at the light, gone at its cutoff distance (everywhere, for a light without one).
      float within = 1.0;
      if (cutoff > 0.0) {
        float edge = distance(p, uRigPosition[i]) / cutoff;
        within = clamp(1.0 - edge * edge * edge * edge, 0.0, 1.0);
      }
      density += uVolumeLightAir.x * pow(within, uVolumeLightAir.y);
      sum += light * (volumePhase(dot(ray, toward), uVolumeMedium.w) * density * stepLength * dimmed);
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
  float begin = 0.0, end = depth >= 1.0 ? uVolumeMarch.x : min(sceneDistance, uVolumeMarch.x);
  // Only the air is marched: the ray stops where it enters the water, or starts where it leaves it.
  if (uVolumeHasWater.x > 0.5) {
    float side = dot(uVolumeWater.xyz, origin) + uVolumeWater.w, slope = dot(uVolumeWater.xyz, ray);
    if (side >= 0.0) { if (uVolumeHasWater.y < 0.5 && slope < -0.00001) end = min(end, -side / slope); }
    else begin = slope > 0.00001 ? min(-side / slope, end) : end;
    if (side >= 0.0 && uVolumeHasWater.y > 0.5) {
      float water = texture2D(tVolumeWater, vUv).a;
      if (water > 0.0) end = min(end, water);
    }
  }
  float jitter = volumeNoise(gl_FragCoord.xy);
  vec3 sunInAir = uVolumeSun * (uVolumeSunStrength * volumePhase(dot(ray, uVolumeSunDirection), uVolumeMedium.w));
  vec3 scattered = vec3(0.0);
  float transmittance = 1.0, previous = 0.0;
  int steps = int(uVolumeMarch.y);
  for (int i = 0; i < VOLUME_MAX_STEPS; i++) {
    if (i >= steps) break;
    float next = (end - begin) * pow(float(i + 1) / uVolumeMarch.y, VOLUME_STEP_POWER);
    float stepLength = next - previous;
    vec3 p = origin + ray * (begin + previous + stepLength * jitter);
    previous = next;
    float density = volumeDensity(p);
    if (density <= 0.0) continue;
    vec3 light = uVolumeAmbient;
    ${sunRead ? `vec3 worldPosition = p, n = vec3(0.0);
    light += sunInAir * ${sunRead};` : 'light += sunInAir;'}
    // What this stretch of air takes from the light behind it, it gives back lit.
    float through = exp(-density * stepLength);
    scattered += transmittance * (1.0 - through) * light * uVolumeColor;
    transmittance *= through;
    if (transmittance < 0.001) break;
  }
  ${rigGLSL ? 'scattered += volumeRigLights(origin, ray, begin, end, jitter) * uVolumeColor * uVolumeMarch.z;' : ''}
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

// renderer: the THREE.WebGLRenderer. sun: one sun cover or a list (core/lighting.js): what stands between the sun and
// the air, e.g. shadows.sun of createSunShadows, view.sunCover of the weather (optional). rig: a createLightRig()
// (optional). Every setting is live in `settings` (set(name, value) checks them).
// Returns {settings, set(name, value), render(scene, camera, environment, input?),
// capture(scene, camera, environment, input?) -> {color, depth}, dispose()}.
export function createVolumetricLight({renderer, sun, rig, ...overrides} = {}) {
  if (typeof renderer?.render !== 'function') throw new TypeError('Volumetric light needs a renderer');
  const covers = sunCovers(sun);
  if (rig !== undefined && typeof rig?.lights?.glsl !== 'string') throw new TypeError('Volumetric light takes the rig of createLightRig');
  const settings = {...VOLUMETRIC_DEFAULTS, ...overrides};
  validate(settings);
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthTexture: depth});
  const volumeTarget = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false});
  let outputTarget = null;   // the scene with its lit air, for capture(): made on first use
  const view = {tDepth: {value: depth}, uInverseProjection: {value: new THREE.Matrix4()}};
  const marchUniforms = {
    ...view, uCameraWorld: {value: new THREE.Matrix4()},
    uVolumeSun: {value: null}, uVolumeSunDirection: {value: null}, uVolumeSunStrength: {value: settings.sun}, uVolumeAmbient: {value: new THREE.Color()},
    uVolumeColor: {value: new THREE.Color()}, uVolumeMedium: {value: new THREE.Vector4()}, uVolumeMarch: {value: new THREE.Vector4()}, uVolumeLightAir: {value: new THREE.Vector2()},
    uVolumeWater: {value: new THREE.Vector4()}, tVolumeWater: {value: null}, uVolumeHasWater: {value: new THREE.Vector2()},
    ...rig?.lights.uniforms,
  };
  for (const cover of covers) Object.assign(marchUniforms, cover.uniforms);
  const sunRead = covers.map(cover => `(${cover.air ?? cover.read})`).join(' * ');
  const compositeUniforms = {...view, tScene: {value: sceneTarget.texture}, tVolume: {value: volumeTarget.texture}, uVolumeSize: {value: new THREE.Vector2(1, 1)}};
  const march = new THREE.ShaderMaterial({uniforms: marchUniforms, vertexShader: QUAD_VERTEX, fragmentShader: marchFragment(covers.map(cover => cover.glsl).join('\n'), sunRead, rig?.lights.glsl ?? ''), depthTest: false, depthWrite: false, toneMapped: false});
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
    // drawn at the size of the screen, when another pass has it; and where the water is, so the air stops at it:
    // waterPlane (THREE.Vector4: normal and offset, under it below zero), waterDistance (texture, a: distance from the
    // camera to the water along the view ray, 0 = none).
    render(scene, camera, environment, input) { draw(scene, camera, environment, input, renderer.getRenderTarget()); },
    // The same into a texture of the pass, for the next pass of the frame: returns {color, depth, airLit: true}, the
    // input that pass takes (weather view.render(input), which then leaves the sun's shafts to this pass).
    capture(scene, camera, environment, input) {
      if (disposed) return null;
      outputTarget ??= new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthBuffer: false});
      renderer.getDrawingBufferSize(size); outputTarget.setSize(Math.max(size.x, 1), Math.max(size.y, 1));
      draw(scene, camera, environment, input, outputTarget);
      captured.color = outputTarget.texture; captured.depth = input?.depth ?? depth;
      captured.waterPlane = input?.waterPlane; captured.waterDistance = input?.waterDistance;
      return captured;
    },
    dispose() {
      if (disposed) return; disposed = true;
      sceneTarget.dispose(); volumeTarget.dispose(); outputTarget?.dispose(); depth.dispose(); march.dispose(); composite.dispose(); geometry.dispose();
    },
  };
  const captured = {color: null, depth: null, airLit: true, waterPlane: undefined, waterDistance: undefined};
  function draw(scene, camera, environment, input, destination) {
    if (disposed) return;
    if (!camera?.isPerspectiveCamera) throw new TypeError('Volumetric light needs a perspective camera');
    if (!environment?.sun?.direction?.isVector3) throw new TypeError('Volumetric light needs an environment');
    renderer.getDrawingBufferSize(size);
    if (size.x === 0 || size.y === 0) return;
    const {density, heightBase, heightFalloff, anisotropy, distance, steps, lightSteps, lightDensity, lightDensityFalloff, scale, sun, lights, ambient, color} = settings;
    const width = Math.max(1, Math.round(size.x * scale)), height = Math.max(1, Math.round(size.y * scale));
    volumeTarget.setSize(width, height); compositeUniforms.uVolumeSize.value.set(width, height);
    camera.updateMatrixWorld();
    view.uInverseProjection.value.copy(camera.projectionMatrixInverse); marchUniforms.uCameraWorld.value.copy(camera.matrixWorld);
    view.tDepth.value = input?.depth ?? depth; compositeUniforms.tScene.value = input?.color ?? sceneTarget.texture;
    marchUniforms.uVolumeSun.value = environment.sun.color;
    marchUniforms.uVolumeSunDirection.value = environment.sun.direction;
    marchUniforms.uVolumeSunStrength.value = sun;
    marchUniforms.uVolumeAmbient.value.copy(environment.ambient.sky).multiplyScalar(ambient * ISOTROPIC);
    marchUniforms.uVolumeColor.value.set(color);
    marchUniforms.uVolumeMedium.value.set(density, heightBase, heightFalloff, anisotropy);
    marchUniforms.uVolumeMarch.value.set(distance, steps, lights, lightSteps);
    marchUniforms.uVolumeLightAir.value.set(lightDensity, lightDensityFalloff);
    marchUniforms.uVolumeHasWater.value.set(input?.waterPlane ? 1 : 0, input?.waterDistance ? 1 : 0);
    if (input?.waterPlane) marchUniforms.uVolumeWater.value.copy(input.waterPlane);
    marchUniforms.tVolumeWater.value = input?.waterDistance ?? null;
    scope(() => {
      if (!input?.color) { sceneTarget.setSize(size.x, size.y); renderer.setRenderTarget(sceneTarget); renderer.render(scene, camera); }
      quad.material = march; renderer.setRenderTarget(volumeTarget); renderer.render(quadScene, quadCamera);
      quad.material = composite; renderer.setRenderTarget(destination); renderer.render(quadScene, quadCamera);
    });
  }
  return volumetric;
}
