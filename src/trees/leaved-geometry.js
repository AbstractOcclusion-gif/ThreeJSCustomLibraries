// Leaved tree template: opaque noisy core lobes under a shell of alpha-cut leaf-cluster cards, optional trunk. Ported from
// InvestorsJourney's baked-crown recipe; every constant now comes from a profile (profiles.js).
import * as THREE from 'three';
import {hash2} from '../core/hash.js';
import {resolveProfile} from './profiles.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Lobe surface noise: two sine products; phases decorrelate seeds, stretches skew the pattern off the axes.
const LOBE_NOISE = Object.freeze({phase: [17, 9, 31], stretchY: 1.3, stretchZ: .9, crossX: 1.3});
const LEAF_SWAY = Object.freeze({base: .35, gain: .65});   // wind sway weight of a leaf card, bottom to top of the crown
const VARIANT_SEED = Object.freeze({step: 7.31, bush: 101});   // seed per variant; bushes use a separate seed range
const LOBE_ANGLE_JITTER = 1.2;   // rad: random turn added to each side lobe's even spacing

function push(out, position, normal, uv, shade, sway, leaf) {
  out.positions.push(position.x, position.y, position.z); out.normals.push(normal.x, normal.y, normal.z);
  out.uvs.push(uv[0], uv[1]); out.colors.push(shade.r, shade.g, shade.b); out.sway.push(sway); out.leaf.push(leaf);
}
const bandOf = (y, bottom, top) => THREE.MathUtils.clamp((y - bottom) / (top - bottom), 0, 1);

function makeNoise({noiseAmplitude: A, noiseFrequency: F}) {
  const [px, py, pz] = LOBE_NOISE.phase, {stretchY, stretchZ, crossX} = LOBE_NOISE;
  return (x, y, z, seed) => 1 + A * (Math.sin(x * F + seed * px) * Math.cos(y * F * stretchY + seed * py) * .5 + Math.sin(z * F * stretchZ + x * crossX + seed * pz) * .5);
}

function appendCore(out, P, noise, centre, radius, squash, seed, band) {
  const sphere = new THREE.IcosahedronGeometry(1, P.core.detail), source = sphere.attributes.position;
  const base = out.positions.length / 3, shade = new THREE.Color(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let v = 0; v < source.count; v++) {
    const x = source.getX(v), z = source.getZ(v); let y = source.getY(v);
    const k = noise(x, y, z, seed); n.set(x, y, z);
    if (y < 0) y *= P.crown.bottomFlatten;
    p.set(centre.x + x * radius * P.core.radiusShare * k, centre.y + y * radius * squash * P.core.radiusShare * k, centre.z + z * radius * P.core.radiusShare * k);
    const s = THREE.MathUtils.lerp(P.shade.bottom, P.shade.top, band(p.y)) * P.core.shade;
    push(out, p, n, [0, 0], shade.setScalar(s), P.branches ? band(p.y) : band(p.y) * .5, 0);
  }
  const corners = sphere.index ? Array.from(sphere.index.array) : Array.from({length: source.count}, (_, i) => i);
  for (const i of corners) out.index.push(base + i);
  sphere.dispose();
}

function appendCards(out, P, noise, centre, radius, squash, seed, tintJitter, band, leafRect) {
  const C = P.cards, area = 4 * Math.PI * radius * radius * squash, count = Math.max(6, Math.round(area * C.perUnitArea));
  const n = new THREE.Vector3(), p = new THREE.Vector3(), tangent = new THREE.Vector3(), bitangent = new THREE.Vector3(), corner = new THREE.Vector3();
  const spin = new THREE.Quaternion(), tilt = new THREE.Quaternion(), shade = new THREE.Color();
  const [ru, rv, rw, rh] = leafRect, cellW = rw / C.subcells, cellH = rh / C.subcells;
  for (let k = 0; k < count; k++) {
    const y = 1 - (2 * (k + .5)) / count, ring = Math.sqrt(1 - y * y), angle = GOLDEN_ANGLE * k + seed;
    const sx = Math.cos(angle) * ring, sz = Math.sin(angle) * ring; let sy = y;
    n.set(sx, sy, sz).normalize();
    const shell = radius * noise(sx, sy, sz, seed) - C.sink;
    if (sy < 0) sy *= P.crown.bottomFlatten;
    p.set(centre.x + sx * shell, centre.y + sy * shell * squash, centre.z + sz * shell);
    tangent.set(-n.z, 0, n.x).normalize(); if (tangent.lengthSq() < 1e-4) tangent.set(1, 0, 0);
    bitangent.crossVectors(n, tangent).normalize();
    spin.setFromAxisAngle(n, hash2(k, seed, 1) * Math.PI * 2);
    tilt.setFromAxisAngle(tangent, (hash2(k, seed, 2) * 2 - 1) * C.tilt);
    const size = THREE.MathUtils.lerp(C.size[0], C.size[1], hash2(k, seed, 3)) * C.scale;
    const u0 = ru + Math.floor(hash2(k, seed, 4) * C.subcells) * cellW, v0 = rv + Math.floor(hash2(k, seed, 5) * C.subcells) * cellH;
    shade.setScalar(THREE.MathUtils.lerp(P.shade.bottom, P.shade.top, band(p.y)) * tintJitter * (1 + C.tintJitter * (hash2(k, seed, 6) * 2 - 1)));
    const sway = P.branches ? band(p.y) : LEAF_SWAY.base + LEAF_SWAY.gain * band(p.y);
    const base = out.positions.length / 3;
    for (const [cx, cy, u, v] of [[-.5, -.5, u0, v0], [.5, -.5, u0 + cellW, v0], [.5, .5, u0 + cellW, v0 + cellH], [-.5, .5, u0, v0 + cellH]]) {
      corner.copy(tangent).multiplyScalar(cx * size).addScaledVector(bitangent, cy * size).applyQuaternion(tilt).applyQuaternion(spin);
      corner.y *= C.yCompensation; corner.add(p);
      push(out, corner, n, [u, v], shade, sway, 1);
    }
    out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function appendTrunk(out, T, topY, textured) {
  const base = out.positions.length / 3, color = new THREE.Color(T.color).convertSRGBToLinear(), p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let s = 0; s < T.sides + Number(textured); s++) {
    const a = (s / T.sides) * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a); n.set(cx, 0, cz);
    push(out, p.set(cx * T.radiusBottom, -T.belowGround, cz * T.radiusBottom), n, [s / T.sides, 0], color, 0, textured ? -1 : 0);
    push(out, p.set(cx * T.radiusTop, topY, cz * T.radiusTop), n, [s / T.sides, 1], color, 0, textured ? -1 : 0);
  }
  for (let s = 0; s < T.sides; s++) { const a0 = base + s * 2, a1 = base + (textured ? s + 1 : (s + 1) % T.sides) * 2; out.index.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1); }
}

function appendBranch(out, profile, lobe, band) {
  const {branches, trunk} = profile;
  const tip = lobe.centre;
  const originY = THREE.MathUtils.lerp(...branches.origin, hash2(lobe.seed, 0, 9));
  const root = new THREE.Vector3(0, Math.min(originY, tip.y), 0);
  const elbow = root.clone().lerp(tip, .62);
  elbow.y = Math.min(elbow.y + branches.bend, tip.y);
  const color = new THREE.Color(trunk.color).convertSRGBToLinear();
  const sides = trunk.sides;
  const stride = sides + 1;
  const base = out.positions.length / 3;
  const points = [root, elbow, tip];
  const radii = [branches.radius, Math.sqrt(branches.radius * branches.tipRadius), branches.tipRadius];
  const axis = new THREE.Vector3();
  const across = new THREE.Vector3();
  const around = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const position = new THREE.Vector3();
  for (const [ring, point] of points.entries()) {
    axis.subVectors(points[Math.min(ring + 1, points.length - 1)], points[Math.max(ring - 1, 0)]).normalize();
    across.crossVectors(up, axis).normalize();
    if (across.lengthSq() === 0) across.set(1, 0, 0);
    around.crossVectors(axis, across);
    for (let side = 0; side <= sides; side++) {
      const angle = side / sides * Math.PI * 2;
      normal.copy(across).multiplyScalar(Math.cos(angle)).addScaledVector(around, Math.sin(angle));
      position.copy(point).addScaledVector(normal, radii[ring]);
      push(out, position, normal, [side / sides, ring / (points.length - 1)], color, ring === 0 ? 0 : band(point.y), -1);
      if (ring === 0 || side === sides) continue;
      const a = base + (ring - 1) * stride + side;
      const b = a + 1;
      out.index.push(a, b, a + stride, b, b + stride, a + stride);
    }
  }
}

// variant: integer silhouette index; leafRect: [u, v, w, h] of the leaf-cluster region in the leaf texture.
export function leavedTreeGeometry(profile, variant, leafRect = [0, 0, 1, 1]) {
  const P = resolveProfile(profile), noise = makeNoise(P.lobes);
  const out = {positions: [], normals: [], uvs: [], colors: [], sway: [], leaf: [], index: []};
  const depth = P.crown.depth, crownTopY = 1, crownBottomY = 1 - depth, crownHalf = depth / 2, crownCentreY = crownBottomY + crownHalf;
  const band = y => bandOf(y, crownBottomY, crownTopY);
  const seed = variant * VARIANT_SEED.step + (P.name === 'bush' ? VARIANT_SEED.bush : 0);
  const squash = P.crown.fixedSquash ?? (crownHalf / P.crown.mainRadius) * P.crown.mainSquash;
  const lobes = [{centre: new THREE.Vector3(0, P.crown.mainCentreY ?? crownCentreY, 0), radius: P.crown.mainRadius, seed, tint: 1}];
  const L = P.lobes, count = Math.round(THREE.MathUtils.lerp(L.count[0], L.count[1], hash2(variant, 1, 3)));
  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2 + hash2(variant, k, 4) * LOBE_ANGLE_JITTER;
    const radius = THREE.MathUtils.lerp(L.radius[0], L.radius[1], hash2(variant, k, 5));
    const offset = THREE.MathUtils.lerp(L.offset[0], L.offset[1], hash2(variant, k, 6)) * L.spread;
    const drop = THREE.MathUtils.lerp(L.drop[0], L.drop[1], hash2(variant, k, 7)) * depth * L.dropScale;
    lobes.push({centre: new THREE.Vector3(Math.cos(angle) * offset, (L.baseY ?? crownCentreY) - drop * L.dropShare, Math.sin(angle) * offset), radius,
      seed: seed + k + 1, tint: 1 + L.tintJitter * (hash2(variant, k, 8) * 2 - 1)});
  }
  for (const [tierIndex, {height, reach, radius, branches}] of (L.tiers ?? []).entries()) {
    for (let i = 0; i < branches; i++) {
      const angle = (i / branches) * Math.PI * 2 + tierIndex * GOLDEN_ANGLE + hash2(variant, i, tierIndex) * LOBE_ANGLE_JITTER;
      lobes.push({
        centre: new THREE.Vector3(Math.cos(angle) * reach, height, Math.sin(angle) * reach),
        radius, seed: seed + lobes.length, tint: 1,
      });
    }
  }
  for (const lobe of lobes) appendCore(out, P, noise, lobe.centre, lobe.radius, squash, lobe.seed, band);
  for (const lobe of lobes) appendCards(out, P, noise, lobe.centre, lobe.radius, squash, lobe.seed, lobe.tint, band, leafRect);
  if (P.branches) {
    const limbLobes = lobes.slice(P.trunk.enabled ? 1 : 0);
    const count = Math.min(P.branches.count ?? limbLobes.length, limbLobes.length);
    for (let i = 0; i < count; i++) appendBranch(out, P, limbLobes[Math.floor(i * limbLobes.length / count)], band);
  }
  if (P.trunk.enabled) appendTrunk(out, P.trunk, crownBottomY + depth * P.trunk.topIntoCrown, Boolean(P.branches));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(out.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(out.uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(out.colors, 3));
  geometry.setAttribute('sway', new THREE.Float32BufferAttribute(out.sway, 1));
  geometry.setAttribute('leaf', new THREE.Float32BufferAttribute(out.leaf, 1));
  geometry.setIndex(out.index);
  return geometry;
}
