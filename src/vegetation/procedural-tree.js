import {Vector3} from 'three';

// Shapes are authored data: metres at width = depth = crownHeight = 1; radii in metres; angles in radians; sides = ring
// vertices. The sin/cos multipliers in `phase` only decorrelate one branch or stem from the next (no physical meaning).
const LEAF_CARDS = 3;          // crossed cards per leaf cluster, fanned over half a turn
const LEAF_CARD_LEAN = 0.35;   // sideways lean of each card's up axis, as a share of its height
const GOLDEN_ANGLE = 2.39996;  // rad, pi * (3 - sqrt(5)): even spacing of the bush stems around the root
const MEADOW_TREE = Object.freeze({
  crownBase: 3,   // m: crownHeight scales heights above this
  trunk: {points: [[0, -0.06, 0], [0, 0.45, 0], [0.15, 2.55, 0.03]], top: [-0.12, 0.15], topRise: 2.4, radii: [0.57, 0.4, 0.25, 0.07], sides: 6},
  branches: {count: 7, jitter: 0.24, lift: 0.45, liftAsymmetry: 0.32, phase: {jitter: 1.7, lift: 2.3},
    root: [0.04, 2.7, 0.06], fork: [1.3, 3.8], tip: [3.05, 4.95], inner: [1.65, 5.65],   // [reach, height]
    radii: [0.17, 0.115, 0.025], innerRadii: [0.085, 0.018], sides: 4},
  leaves: {tipRaise: 0.33, tip: [1.55, 1.14], inner: [1.4, 1.16], innerTurn: 0.45},  // [radius, height]
  top: {x: -0.15, xAsymmetry: 0.33, rise: 3.18, z: 0.18, radius: 1.55, height: 1.34, turn: 0.25},
});
const MEADOW_BUSH = Object.freeze({
  stems: 6, spreadVariation: 0.22, lift: 0.28, phase: {spread: 1.7, lift: 2.1},
  root: [0.13, -0.06], fork: [0.7, 0.64], forkLiftShare: 0.5, tip: [1.64, 1.24],   // [reach, height]
  radii: [0.12, 0.085, 0.018], sides: 4,
  leaves: {tip: [0.93, 0.65], forkToTip: 0.35, forkRaise: 0.32, fork: [0.82, 0.79], forkTurn: 0.5},  // [radius, height]
});

function triangle(part, a, b, c, ua, ub, uc) {
  part.position.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  part.uv.push(...ua, ...ub, ...uc);
}

function taperedStem(part, points, radii, sides, swatch) {
  const direction = points.at(-1).clone().sub(points[0]).normalize();
  const right = new Vector3(0, 0, 1).cross(direction).normalize();
  const forward = direction.clone().cross(right);
  const rings = points.map((point, ring) => Array.from({length: sides}, (_, i) => {
    const angle = i / sides * Math.PI * 2;
    return point.clone().addScaledVector(right, Math.cos(angle) * radii[ring])
      .addScaledVector(forward, Math.sin(angle) * radii[ring]);
  }));
  for (let ring = 1; ring < rings.length; ring++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      triangle(part, rings[ring - 1][i], rings[ring - 1][j], rings[ring][i], swatch, swatch, swatch);
      triangle(part, rings[ring - 1][j], rings[ring][j], rings[ring][i], swatch, swatch, swatch);
    }
  }
}

function leafCluster(part, center, radius, height, phase) {
  for (let i = 0; i < LEAF_CARDS; i++) {
    const angle = phase + i * Math.PI / LEAF_CARDS;
    const right = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(radius);
    const up = new Vector3(-Math.sin(angle) * LEAF_CARD_LEAN, 1, Math.cos(angle) * LEAF_CARD_LEAN).multiplyScalar(height);
    const a = center.clone().sub(right).sub(up);
    const b = center.clone().add(right).sub(up);
    const c = center.clone().add(right).add(up);
    const d = center.clone().sub(right).add(up);
    triangle(part, a, b, c, [0, 0], [1, 0], [1, 1]);
    triangle(part, a, c, d, [0, 0], [1, 1], [0, 1]);
  }
}

// Read the same bark swatch and foliage atlas rect for both specimen shapes.
function plantParts(reference) {
  const bark = reference.parts.find(part => !part.foliage);
  const leaves = reference.parts.find(part => part.foliage);
  const wood = {material: bark.material, foliage: false, position: [], uv: []};
  const canopy = {material: leaves.material, foliage: true, position: [], uv: []};
  const swatch = Array.from(bark.uv.slice(0, 2));
  return {wood, canopy, swatch};
}

export function createProceduralMeadowTree(reference, {
  width = 1, depth = 1, crownHeight = 1, asymmetry = 0,
} = {}) {
  const {wood, canopy, swatch} = plantParts(reference);
  const {crownBase, trunk, branches: B, leaves, top} = MEADOW_TREE;
  const at = (x, y, z) => new Vector3(x, y, z);
  taperedStem(wood, [...trunk.points.map(point => at(...point)), at(trunk.top[0], crownBase + trunk.topRise * crownHeight, trunk.top[1])],
    trunk.radii, trunk.sides, swatch);

  for (let i = 0; i < B.count; i++) {
    const angle = i * Math.PI * 2 / B.count + Math.sin(i * B.phase.jitter) * asymmetry * B.jitter;
    const radial = (distance, y) => at(
      Math.cos(angle) * distance * width, crownBase + (y - crownBase) * crownHeight, Math.sin(angle) * distance * depth,
    );
    const lift = Math.sin(i * B.phase.lift + asymmetry) * (B.lift + Math.abs(asymmetry) * B.liftAsymmetry);
    const fork = radial(B.fork[0], B.fork[1] + lift);
    const tip = radial(B.tip[0] + lift, B.tip[1] + lift);
    const inner = radial(B.inner[0], B.inner[1] + lift);
    taperedStem(wood, [at(B.root[0], B.root[1] + lift, B.root[2]), fork, tip], B.radii, B.sides, swatch);
    taperedStem(wood, [fork, inner], B.innerRadii, B.sides, swatch);
    const spread = Math.sqrt(width * depth);
    leafCluster(canopy, tip.clone().add(at(0, leaves.tipRaise, 0)), leaves.tip[0] * spread, leaves.tip[1] * crownHeight, angle);
    leafCluster(canopy, inner, leaves.inner[0] * spread, leaves.inner[1] * crownHeight, angle + leaves.innerTurn);
  }
  leafCluster(canopy, at(top.x + asymmetry * top.xAsymmetry, crownBase + top.rise * crownHeight, top.z),
    top.radius * Math.sqrt(width * depth), top.height * crownHeight, top.turn);
  return [wood, canopy];
}

// A broad shrub with several stems starting at ground level. Uses the same
// atlas parts and wind/shadow pipeline as the meadow tree.
export function createProceduralMeadowBush(reference) {
  const {wood, canopy, swatch} = plantParts(reference);
  const S = MEADOW_BUSH, L = S.leaves;
  for (let i = 0; i < S.stems; i++) {
    const angle = i * GOLDEN_ANGLE;
    const spread = 1 + S.spreadVariation * Math.sin(i * S.phase.spread);
    const lift = S.lift * Math.cos(i * S.phase.lift);
    const at = (r, y) => new Vector3(Math.cos(angle) * r * spread, y, Math.sin(angle) * r * spread);
    const fork = at(S.fork[0], S.fork[1] + lift * S.forkLiftShare);
    const tip = at(S.tip[0], S.tip[1] + lift);
    taperedStem(wood, [at(...S.root), fork, tip], S.radii, S.sides, swatch);
    leafCluster(canopy, tip, L.tip[0] * spread, L.tip[1], angle);
    leafCluster(canopy, fork.clone().lerp(tip, L.forkToTip).add(new Vector3(0, L.forkRaise, 0)), L.fork[0], L.fork[1], angle + L.forkTurn);
  }
  return [wood, canopy];
}
