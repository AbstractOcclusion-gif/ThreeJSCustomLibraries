// Cascade maths of the sun shadows: where the view is cut into slices, and the light camera of each slice.
// A slice is wrapped in a sphere, so its shadow keeps the same size whichever way the view turns, and the light camera
// moves by whole texels, so the shadow does not crawl when the view moves.
import * as THREE from 'three';

const CORNERS = 8;                      // of a slice of the view: 4 near, 4 far
const RADIUS_STEP = 1 / 16;             // m: the radius of a sphere is rounded up to this, so it does not flicker
const LIGHT_NEAR = .1;                  // m: near plane of the light cameras
const UP = new THREE.Vector3(0, 1, 0), SIDE = new THREE.Vector3(0, 0, 1);
const UP_LIMIT = .99;                   // |y| of the sun direction above which the light camera rolls around +Z instead of +Y

// Distances from the camera at which the slices end: `count` of them, the last at `far`. lambda blends an even cut
// (0) with a logarithmic one (1: thin slices near the camera, where the detail is). Written into target.
export function cascadeSplits(near, far, count, lambda, target = []) {
  if (!(near > 0) || !(far > near)) throw new RangeError('Cascade splits need 0 < near < far');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Cascade splits need a whole count of at least 1');
  if (!(lambda >= 0 && lambda <= 1)) throw new RangeError('Cascade lambda must be between 0 and 1');
  target.length = count;
  for (let index = 0; index < count; index++) {
    const share = (index + 1) / count;
    target[index] = lambda * near * (far / near) ** share + (1 - lambda) * (near + (far - near) * share);
  }
  target[count - 1] = far;
  return target;
}

// One fitter per shadow system: holds its scratch vectors, so a fit allocates nothing.
export function createCascadeFitter() {
  const corners = Array.from({length: CORNERS}, () => new THREE.Vector3());
  const centre = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), back = new THREE.Vector3();
  const forward = new THREE.Vector3(), eye = new THREE.Vector3(), basis = new THREE.Matrix4(), toLight = new THREE.Matrix4();
  return {
    // Fits `lightCamera` (a THREE.OrthographicCamera) around the slice [near, far] of `camera` (a PerspectiveCamera with
    // its world matrix up to date). sunDirection: unit vector toward the sun. resolution: texels across the shadow.
    // reach: m toward the sun, outside the sphere, from which casters still fall in. Returns the metres per texel.
    fit(lightCamera, camera, near, far, sunDirection, resolution, reach) {
      if (!camera?.isPerspectiveCamera) throw new TypeError('Sun cascades need a perspective camera');
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom;
      camera.matrixWorld.extractBasis(right, up, back);
      eye.setFromMatrixPosition(camera.matrixWorld); forward.copy(back).negate();
      centre.set(0, 0, 0);
      for (let index = 0; index < CORNERS; index++) {
        const distance = index < CORNERS / 2 ? near : far, height = tangent * distance, width = height * camera.aspect;
        corners[index].copy(eye).addScaledVector(forward, distance)
          .addScaledVector(right, index & 1 ? width : -width).addScaledVector(up, index & 2 ? height : -height);
        centre.add(corners[index]);
      }
      centre.divideScalar(CORNERS);
      let radius = 0;
      for (const corner of corners) radius = Math.max(radius, corner.distanceTo(centre));
      radius = Math.ceil(radius / RADIUS_STEP) * RADIUS_STEP;
      const texel = 2 * radius / resolution;
      // The light's own axes depend on the sun alone, never on the view: the snap below needs a grid that stays put.
      back.copy(sunDirection).normalize();
      right.crossVectors(Math.abs(back.y) > UP_LIMIT ? SIDE : UP, back).normalize();
      up.crossVectors(back, right);
      basis.makeBasis(right, up, back); toLight.copy(basis).transpose();
      // On all three axes: a centre that slid along the light would shift every depth compare.
      centre.applyMatrix4(toLight);
      centre.set(Math.floor(centre.x / texel) * texel, Math.floor(centre.y / texel) * texel, Math.floor(centre.z / texel) * texel);
      centre.applyMatrix4(basis);
      lightCamera.left = lightCamera.bottom = -radius; lightCamera.right = lightCamera.top = radius;
      lightCamera.near = LIGHT_NEAR; lightCamera.far = reach + 2 * radius;
      lightCamera.position.copy(centre).addScaledVector(back, reach + radius);
      lightCamera.quaternion.setFromRotationMatrix(basis);
      lightCamera.updateProjectionMatrix(); lightCamera.updateMatrixWorld(true);
      return texel;
    },
  };
}
