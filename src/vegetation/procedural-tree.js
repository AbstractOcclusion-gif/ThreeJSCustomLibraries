import {Vector3} from 'three';

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
  for (let i = 0; i < 3; i++) {
    const angle = phase + i * Math.PI / 3;
    const right = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(radius);
    const up = new Vector3(-Math.sin(angle) * 0.35, 1, Math.cos(angle) * 0.35).multiplyScalar(height);
    const a = center.clone().sub(right).sub(up);
    const b = center.clone().add(right).sub(up);
    const c = center.clone().add(right).add(up);
    const d = center.clone().sub(right).add(up);
    triangle(part, a, b, c, [0, 0], [1, 0], [1, 1]);
    triangle(part, a, c, d, [0, 0], [1, 1], [0, 1]);
  }
}

// reference.parts: [{material, foliage, uv, position}] — one bark part (a uv swatch is read from its first vertex) and one
// foliage part whose material names the leaf-cluster atlas rect. free-assets.js createProceduralReference() supplies one.
export function createProceduralMeadowTree(reference, {
  width = 1, depth = 1, crownHeight = 1, asymmetry = 0,
} = {}) {
  const bark = reference.parts.find(part => !part.foliage);
  const leaves = reference.parts.find(part => part.foliage);
  const wood = {material: bark.material, foliage: false, position: [], uv: []};
  const canopy = {material: leaves.material, foliage: true, position: [], uv: []};
  const swatch = Array.from(bark.uv.slice(0, 2));
  const at = (x, y, z) => new Vector3(x, y, z);
  taperedStem(wood, [at(0, -0.06, 0), at(0, 0.45, 0), at(0.15, 2.55, 0.03), at(-0.12, 5.4, 0.15)],
    [0.57, 0.4, 0.25, 0.07], 6, swatch);

  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7 + Math.sin(i * 1.7) * asymmetry * 0.24;
    const radial = (distance, y) => at(
      Math.cos(angle) * distance * width, 3 + (y - 3) * crownHeight, Math.sin(angle) * distance * depth,
    );
    const lift = Math.sin(i * 2.3 + asymmetry) * (0.45 + Math.abs(asymmetry) * 0.32);
    const fork = radial(1.3, 3.8 + lift);
    const tip = radial(3.05 + lift, 4.95 + lift);
    taperedStem(wood, [at(0.04, 2.7 + lift, 0.06), fork, tip], [0.17, 0.115, 0.025], 4, swatch);
    const spread = Math.sqrt(width * depth);
    leafCluster(canopy, tip.clone().add(at(0, 0.33, 0)), 1.55 * spread, 1.14 * crownHeight, angle);
    leafCluster(canopy, radial(1.65, 5.65 + lift), 1.4 * spread, 1.16 * crownHeight, angle + 0.45);
  }
  leafCluster(canopy, at(-0.15 + asymmetry * 0.33, 3 + 3.18 * crownHeight, 0.18),
    1.55 * Math.sqrt(width * depth), 1.34 * crownHeight, 0.25);
  return [wood, canopy];
}
