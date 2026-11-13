import * as THREE from 'three';
import {ConvexGeometry} from 'three/addons/geometries/ConvexGeometry.js';
import {seededRandom} from '../core/hash.js';

const profile = (size, rings, sides, taper, irregularity, lean) => Object.freeze({
  size: Object.freeze(size), rings: Object.freeze(rings.map(Object.freeze)), sides, taper, irregularity, lean,
});

// Rings contain [relative height, relative radius], from the buried foot to the crown.
export const ROCK_PROFILES = Object.freeze({
  alpine: profile([1, .8, .76], [[0,.54],[.24,1],[.68,.77],[1,.32]], 7, .14, .3, .19),
  desert: profile([1, .62, .77], [[0,.8],[.22,1],[.64,.91],[1,.67]], 8, .08, .15, .1),
  coast: profile([1, .48, .82], [[0,.64],[.31,1],[.71,.88],[1,.45]], 9, .22, .14, .07),
  woodland: profile([1, .68, .92], [[0,.72],[.28,1],[.73,.82],[1,.48]], 8, .16, .22, .13),
});

export const ROCK_DEFAULTS = Object.freeze({
  seed: 1, environment: 'alpine', mode: 'boulder', count: 24, span: 12, burial: .12,
});
const MODES = Object.freeze({
  stone: {size: [.45,.33,.43], scale: [.75,1.25]},
  boulder: {size: [2.5,2.25,2.3], scale: [.8,1.2]},
  scatter: {size: [.95,.71,.9], scale: [.24,1.35]},
  cliff: {size: [1,4.6,2.8], scale: [.7,1.25], overlap: .28, setback: .18},
});
const TURN = Math.PI * 2;
const HALF = .5;
const sample = (random, [min, max]) => THREE.MathUtils.lerp(min, max, random());
const signed = random => sample(random, [-1, 1]);

function rockGeometry(shape, dimensions, random) {
  const phase = random() * TURN;
  const leanX = signed(random) * shape.lean;
  const leanZ = signed(random) * shape.lean;
  const ribs = Array.from({length: shape.sides}, () => 1 + signed(random) * shape.irregularity);
  const points = [];
  for (const [height, radius] of shape.rings) {
    const ringTwist = signed(random) * shape.taper;
    for (const [side, rib] of ribs.entries()) {
      const angle = phase + (side + ringTwist) * TURN / shape.sides;
      const edge = radius * rib * (1 + signed(random) * shape.irregularity * HALF);
      const y = height === 0 ? 0 : height + signed(random) * shape.taper * HALF;
      points.push(new THREE.Vector3(
        (Math.cos(angle) * edge * HALF + height * leanX) * dimensions[0],
        y * dimensions[1],
        (Math.sin(angle) * edge * HALF + height * leanZ) * dimensions[2],
      ));
    }
  }
  const geometry = new ConvexGeometry(points);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uv = [];
  // Use a metric planar projection per triangle. Preserve the hull's flat normals.
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const nx = normals.getX(i), ny = normals.getY(i), nz = normals.getZ(i);
    if (Math.abs(ny) >= Math.max(Math.abs(nx), Math.abs(nz))) uv.push(x, -Math.sign(ny) * z);
    else if (Math.abs(nx) >= Math.abs(nz)) uv.push(-Math.sign(nx) * z, y);
    else uv.push(Math.sign(nz) * x, y);
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeBoundingBox();
  return geometry;
}

/** Static meshes in metres, +Y up. The caller owns supplied materials and placement. */
export function createRocks({material, heightAt = () => 0, ...options} = {}) {
  const {seed, environment, mode, count, span, burial} = {...ROCK_DEFAULTS, ...options};
  if (!Object.hasOwn(ROCK_PROFILES, environment) || !Object.hasOwn(MODES, mode)) throw new RangeError('Unknown rock environment or mode');
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(count) || count < 1 ||
      !Number.isFinite(span) || span <= 0 || !Number.isFinite(burial) || burial < 0 || burial > 1) {
    throw new RangeError('Invalid rock seed, count, span or burial');
  }

  const shape = ROCK_PROFILES[environment];
  const layout = MODES[mode];
  const placementRandom = seededRandom(seed);
  const shapeRandom = seededRandom(seed);
  const group = new THREE.Group();
  group.name = mode;
  const ownsMaterial = material == null;
  const rockMaterial = material ?? new THREE.MeshStandardMaterial();
  const multiple = mode === 'scatter' || mode === 'cliff';
  const step = span / count;
  function dispose() {
    group.removeFromParent();
    for (const mesh of group.children) mesh.geometry.dispose();
    group.clear();
    if (ownsMaterial) rockMaterial.dispose();
  }

  try {
    for (let index = 0; index < (multiple ? count : 1); index++) {
      const scale = sample(placementRandom, layout.scale);
      const dimensions = layout.size.map((value, axis) => value * scale * shape.size[axis]);
      let x = 0, z = 0;
      if (mode === 'scatter') {
        x = signed(placementRandom) * span * HALF;
        z = signed(placementRandom) * span * HALF;
      } else if (mode === 'cliff') {
        x = (index + HALF) * step - span * HALF;
        z = signed(placementRandom) * step * layout.setback;
        dimensions[0] = step * (1 + layout.overlap);
      }
      const y = heightAt(x, z);
      if (!Number.isFinite(y)) throw new RangeError('Rock ground height must be finite');
      const mesh = new THREE.Mesh(rockGeometry(shape, dimensions, shapeRandom), rockMaterial);
      mesh.name = `${mode}_${index + 1}`;
      mesh.position.set(x, y - dimensions[1] * burial, z);
      mesh.rotation.y = mode === 'cliff' ? signed(placementRandom) * shape.taper : placementRandom() * TURN;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {group, dispose};
}
