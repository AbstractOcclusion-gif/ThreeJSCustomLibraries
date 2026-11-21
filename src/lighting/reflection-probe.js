// Reflection probe: what a shiny object sees around it, for its own reflections only. The scene is drawn once into a
// cube around a point (THREE.CubeCamera) and filtered for rough and smooth surfaces (THREE.PMREMGenerator); a material
// takes it as its envMap, so a glass or a liquid reflects the room (a window, a lamp) while the rest of the scene keeps
// its lighting. Drawn again only when asked (invalidate), at most once per `cooldown`: a room changes rarely.
import * as THREE from 'three';

export const REFLECTION_PROBE_DEFAULTS = Object.freeze({
  resolution: 128,   // texels across a face of the cube
  near: .01,         // m: nearest thing drawn
  far: 20,           // m: farthest thing drawn
  cooldown: .5,      // s between two captures, however often it is invalidated
});
export const REFLECTION_PROBE_LIMITS = Object.freeze({resolution: [8, 2048], near: [1e-4, 100], far: [.01, 1e5], cooldown: [0, 60]});

// renderer, scene; position: where the probe stands (a Vector3, kept). hide: objects left out of the capture (the
// object that reflects it: it must not see itself). Settings: REFLECTION_PROBE_DEFAULTS. Returns {settings, texture,
// capture(), invalidate(), update(dt) -> captured, dispose()}; texture: the filtered cube (null before the first capture).
export function createReflectionProbe({renderer, scene, position, hide = [], ...overrides} = {}) {
  if (typeof renderer?.render !== 'function') throw new TypeError('A reflection probe needs the renderer');
  if (!scene?.isScene) throw new TypeError('A reflection probe captures a scene');
  if (!position?.isVector3) throw new TypeError('A reflection probe needs its position (Vector3)');
  const settings = {...REFLECTION_PROBE_DEFAULTS};
  for (const [key, value] of Object.entries(overrides)) {
    const range = REFLECTION_PROBE_LIMITS[key];
    if (!range) throw Error('Unknown reflection probe setting: ' + key);
    if (!Number.isFinite(value) || value < range[0] || value > range[1] || (key === 'resolution' && !Number.isInteger(value))) throw new RangeError('Invalid reflection probe ' + key);
    settings[key] = value;
  }
  if (settings.near >= settings.far) throw new RangeError('A reflection probe sees from near to far');
  const cube = new THREE.WebGLCubeRenderTarget(settings.resolution, {type: THREE.HalfFloatType});
  const camera = new THREE.CubeCamera(settings.near, settings.far, cube);
  camera.position.copy(position);
  let pmrem = null;   // made at the first capture (it compiles its shaders when made)
  let filtered = null, dirty = true, wait = 0;
  const probe = {
    settings,
    get texture() { return filtered?.texture ?? null; },
    // Draws the cube now (the objects in `hide` left out) and filters it.
    capture() {
      const shown = hide.map(object => object.visible);
      hide.forEach(object => { object.visible = false; });
      camera.updateMatrixWorld(true);
      camera.update(renderer, scene);
      hide.forEach((object, index) => { object.visible = shown[index]; });
      pmrem ??= new THREE.PMREMGenerator(renderer);
      const next = pmrem.fromCubemap(cube.texture);
      filtered?.dispose();
      filtered = next;
      dirty = false; wait = settings.cooldown;
      return probe.texture;
    },
    // Something the probe sees has changed: capture again (at the next update past the cooldown).
    invalidate() { dirty = true; },
    // Once per frame: captures when invalidated and the cooldown has run out. Returns true when it did.
    update(dt) {
      wait = Math.max(0, wait - dt);
      if (!dirty || wait > 0) return false;
      dirty = false; wait = settings.cooldown;
      probe.capture();
      return true;
    },
    dispose() { filtered?.dispose(); cube.dispose(); pmrem?.dispose(); },
  };
  return probe;
}
