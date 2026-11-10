import {STRUCTURE_MATERIALS} from './material-profiles.js';
import {readPartMetadata} from './part-metadata.js';
/**
 * Pure-data reader for the Blender destructible export (metres, +Y).
 * Collider vertices remain relative to their piece pivot, with rotation/scale
 * already baked by the exporter. Neither a renderer nor a physics world is used.
 */
export const DESTRUCTIBLE_MATERIALS = Object.freeze({
  // Gameplay tensile/cohesive strengths in Pa (N/m²), not certified engineering data.
  stone: Object.freeze({ strengthPa: 2e6 }),
  concrete: Object.freeze({ strengthPa: 2e6 }),
  glass: Object.freeze({ strengthPa: 4e5 }),
  wood: Object.freeze({ strengthPa: 1e6 }),
  metal: Object.freeze({ strengthPa: 5e6 }),
  brick: Object.freeze({ strengthPa: 1e6 }),
});

const HULL_EPS = 2e-5; // Matches the existing exported-hull verifier, including 8-decimal rounding.
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(...a);
const unit = a => mul(a, 1 / length(a));
const fail = (path, message) => { throw new Error(`Invalid destructible ${path}: ${message}`); };

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value;
}

function string(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a non-empty string');
  return value;
}

function number(value, path, min = -Infinity, max = Infinity, exclusiveMin = false) {
  if (!Number.isFinite(value) || (exclusiveMin ? value <= min : value < min) || value > max) {
    fail(path, `expected a finite number ${exclusiveMin ? '>' : '>='} ${min} and <= ${max}`);
  }
  return value;
}

function vector(value, path) {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'expected [x, y, z]');
  return value.map((v, i) => number(v, `${path}[${i}]`));
}

function mean(vertices) {
  return mul(vertices.reduce((sum, v) => add(sum, v), [0, 0, 0]), 1 / vertices.length);
}

function boundsOf(vertices) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], v[i]);
    max[i] = Math.max(max[i], v[i]);
  }
  return { min, max };
}

function hull(value, path, position, warnings) {
  object(value, path);
  if (value.type !== 'convex') fail(`${path}.type`, 'expected convex');
  if (!Array.isArray(value.vertices) || value.vertices.length < 4 || value.vertices.length > 64) {
    fail(`${path}.vertices`, 'a convex collider requires 4 to 64 vertices');
  }
  const vertices = value.vertices.map((v, i) => vector(v, `${path}.vertices[${i}]`));
  const keys = new Set(vertices.map(v => v.join(',')));
  if (keys.size !== vertices.length) fail(`${path}.vertices`, 'duplicate vertices');
  if (!Array.isArray(value.faces) || value.faces.length < 4) fail(`${path}.faces`, 'a closed convex hull requires at least four faces');
  const faces = [], normals = [], edgeMap = new Map(), used = new Set(), centre = mean(vertices);
  let volume = 0;
  for (let f = 0; f < value.faces.length; f++) {
    const indices = value.faces[f], facePath = `${path}.faces[${f}]`;
    if (!Array.isArray(indices) || indices.length < 3) fail(facePath, 'expected at least three vertex indices');
    if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= vertices.length)) fail(facePath, 'invalid vertex index');
    if (new Set(indices).size !== indices.length) fail(facePath, 'duplicate face indices');
    const points = indices.map(i => vertices[i]);
    let normal = [0, 0, 0];
    for (let j = 0; j < points.length; j++) normal = add(normal, cross(sub(points[j], centre), sub(points[(j + 1) % points.length], centre)));
    if (!Number.isFinite(length(normal))) fail(facePath, 'collider exceeds the supported numeric range');
    if (length(normal) < 1e-12) fail(facePath, 'degenerate face');
    normal = unit(normal);
    const plane = dot(normal, points[0]);
    if (points.some(v => Math.abs(dot(normal, v) - plane) > HULL_EPS)) fail(facePath, 'face is not planar');
    if (dot(normal, sub(points[0], centre)) <= 0) fail(facePath, 'face winding must point outward');
    if (vertices.some(v => dot(normal, v) - plane > HULL_EPS)) fail(facePath, 'collider must be convex with outward faces');
    for (let j = 0; j < indices.length; j++) {
      const a = indices[j], b = indices[(j + 1) % indices.length], edge = sub(vertices[b], vertices[a]);
      if (length(edge) < 1e-12) fail(facePath, 'zero-length edge');
      if (points.some(v => dot(cross(edge, sub(v, vertices[a])), normal) < -HULL_EPS * length(edge))) {
        fail(facePath, 'face vertices must describe an ordered convex polygon');
      }
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const entry = edgeMap.get(key) || { a, b, count: 0, winding: 0 };
      entry.count++;
      entry.winding += a < b ? 1 : -1;
      edgeMap.set(key, entry);
      used.add(a);
    }
    for (let j = 1; j < points.length - 1; j++) {
      volume += dot(sub(points[0], centre), cross(sub(points[j], centre), sub(points[j + 1], centre))) / 6;
    }
    faces.push(indices.slice());
    normals.push(normal);
  }
  if (used.size !== vertices.length) fail(`${path}.vertices`, 'every vertex must belong to the hull surface');
  if ([...edgeMap.values()].some(e => e.count !== 2 || e.winding !== 0)) fail(`${path}.faces`, 'collider must be a closed manifold with consistent outward winding');
  if (!Number.isFinite(volume)) fail(path, 'collider exceeds the supported numeric range');
  if (volume < 1e-9) fail(path, 'collider must enclose a non-zero volume (at least 1e-9 m³)');
  const collider = { type: 'convex', vertices, faces };
  if (value.authorShape != null) {
    collider.authorShape = string(value.authorShape, `${path}.authorShape`);
    if (value.authorShape === 'BOX_FALLBACK') warnings.push(`${path}: authoring used an enclosing box fallback; contact area is approximate.`);
  }
  const worldVertices = vertices.map(v => add(v, position));
  if (worldVertices.some(v => !v.every(Number.isFinite))) fail(path, 'positioned collider exceeds the supported numeric range');
  return {
    collider,
    geometry: { vertices: worldVertices, normals, edges: [...edgeMap.values()].map(e => [e.a, e.b]), bounds: boundsOf(worldVertices) },
  };
}

function readManifest(input) {
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch (error) { fail('JSON', error.message); }
  }
  object(input, 'root');
  if (input.schema !== 'impact-club.destructible') fail('schema', 'expected impact-club.destructible');
  if (![1, 2].includes(input.version)) fail('version', 'only versions 1 and 2 are supported');
  if (input.units !== 'm') fail('units', 'expected m; convert authored data to metres before importing');
  if (input.upAxis !== 'Y') fail('upAxis', 'expected Y; convert authored data to +Y before importing');
  const assetId = string(input.assetId, 'assetId');
  if (!/^[a-z0-9_]+$/.test(assetId)) fail('assetId', 'expected lowercase letters, digits and underscores');
  const asset = {
    schema: input.schema, version: input.version, assetId, model: string(input.model, 'model'),
    units: 'm', upAxis: 'Y', material: string(input.material, 'material'),
    anchoring: input.anchoring, breakMode: input.breakMode,
    massKg: number(input.massKg, 'massKg', 0, Infinity, true),
    breakEnergyJ: number(input.breakEnergyJ, 'breakEnergyJ', 0, Infinity, true),
    friction: number(input.friction, 'friction', 0, 1),
    restitution: number(input.restitution, 'restitution', 0, 1),
  };
  if (!['loose', 'anchored'].includes(asset.anchoring)) fail('anchoring', 'expected loose or anchored');
  if (!['full', 'sections'].includes(asset.breakMode)) fail('breakMode', 'expected full or sections');
  for (const key of ['kind', 'fxProfile', 'sourceNote']) if (input[key] != null) {
    if (typeof input[key] !== 'string') fail(key, 'expected a string');
    asset[key] = input[key];
  }
  const warnings = [], nodes = new Set(), ids = new Set(), geometries = new Map();
  const node = (value, path, shared = false) => {
    value = string(value, path);
    if (nodes.has(value) && !shared) fail(path, `duplicate render node ${value}`);
    nodes.add(value);
    return value;
  };
  object(input.intact, 'intact');
  if (!Array.isArray(input.intact.nodes) || !input.intact.nodes.length) fail('intact.nodes', 'at least one intact render node is required');
  if (!Array.isArray(input.intact.colliders) || input.intact.colliders.length !== input.intact.nodes.length) {
    fail('intact.colliders', 'exactly one collider per intact render node is required');
  }
  asset.intact = {
    nodes: input.intact.nodes.map((n, i) => node(n, `intact.nodes[${i}]`)),
    colliders: input.intact.colliders.map((c, i) => {
      object(c, `intact.colliders[${i}]`);
      const position = vector(c.position, `intact.colliders[${i}].position`);
      return { ...hull(c, `intact.colliders[${i}]`, position, warnings).collider, position };
    }),
  };
  if (!Array.isArray(input.pieces) || !input.pieces.length) fail('pieces', 'at least one physical piece is required');
  let totalMass = 0, physicalCount = 0;
  asset.pieces = input.pieces.map((p, i) => {
    const path = `pieces[${i}]`;
    object(p, path);
    const id = string(p.id, `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, `duplicate piece ID ${id}`);
    ids.add(id);
    const piece = {
      id, node: node(p.node, `${path}.node`, input.version === 2 && input.masonry != null), section: string(p.section, `${path}.section`),
      mode: p.mode, massKg: number(p.massKg, `${path}.massKg`, 0), position: vector(p.position, `${path}.position`), collider: null,
    };
    if (!['dynamic', 'anchored', 'cosmetic'].includes(piece.mode)) fail(`${path}.mode`, 'expected dynamic, anchored or cosmetic');
    if (piece.mode === 'cosmetic') {
      if (piece.massKg !== 0 || p.collider !== null) fail(path, 'cosmetic pieces require massKg 0 and collider null');
    } else {
      if (piece.massKg === 0) fail(`${path}.massKg`, 'physical pieces require positive mass');
      const result = hull(p.collider, `${path}.collider`, piece.position, warnings);
      piece.collider = result.collider;
      geometries.set(id, result.geometry);
      totalMass += piece.massKg;
      physicalCount++;
    }
    return piece;
  });
  if (!physicalCount) fail('pieces', 'at least one physical piece is required');
  if (Math.abs(totalMass - asset.massKg) > 1e-5) {
    fail('massKg', `physical piece mass sum ${totalMass} differs from asset mass ${asset.massKg}`);
  }
  if (asset.version === 2) { const metadata = readPartMetadata(input, asset); delete metadata.profile; Object.assign(asset, metadata); }
  return { asset, geometries, warnings };
}

/** Validate and clone a manifest without creating bodies or deriving bonds. Throws on malformed data. */
export function validateDestructible(input) {
  return readManifest(input).asset;
}

function uniqueDirections(vectors) {
  const result = [];
  for (const v of vectors) {
    const size = length(v);
    if (size > 1e-10) {
      const direction = mul(v, 1 / size);
      if (!result.some(n => Math.abs(dot(n, direction)) > 1 - 1e-8)) result.push(direction);
    }
  }
  return result;
}

function interval(vertices, axis) {
  let min = Infinity, max = -Infinity;
  for (const v of vertices) { const d = dot(v, axis); min = Math.min(min, d); max = Math.max(max, d); }
  return { min, max };
}

function separatingAxis(a, b, tolerance) {
  for (let i = 0; i < 3; i++) if (Math.max(a.bounds.min[i] - b.bounds.max[i], b.bounds.min[i] - a.bounds.max[i]) > tolerance) return null;
  const edgesA = uniqueDirections(a.edges.map(([i, j]) => sub(a.vertices[j], a.vertices[i])));
  const edgesB = uniqueDirections(b.edges.map(([i, j]) => sub(b.vertices[j], b.vertices[i])));
  const axes = uniqueDirections([...a.normals, ...b.normals, ...edgesA.flatMap(e => edgesB.map(f => cross(e, f)))]);
  let closest = null;
  for (const axis of axes) {
    const ia = interval(a.vertices, axis), ib = interval(b.vertices, axis);
    const forward = ib.min - ia.max, reverse = ia.min - ib.max;
    const gap = Math.max(forward, reverse);
    if (gap > tolerance + 1e-10) return null;
    if (!closest || gap > closest.gap + 1e-9) closest = { normal: forward >= reverse ? axis : mul(axis, -1), gap };
  }
  return closest;
}

function tangentBasis(normal) {
  const other = Math.abs(normal[0]) < .8 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(normal, other));
  return [u, cross(normal, u)];
}

// Intersect a convex hull with a plane. This also accepts its face/edge/vertex
// support features; the area test below prevents edges/corners from becoming glue.
function sectionPoints(geometry, normal, plane, epsilon) {
  const distances = geometry.vertices.map(v => dot(normal, v) - plane);
  const points = geometry.vertices.filter((_, i) => Math.abs(distances[i]) <= epsilon);
  for (const [i, j] of geometry.edges) {
    if ((distances[i] < -epsilon && distances[j] > epsilon) || (distances[j] < -epsilon && distances[i] > epsilon)) {
      const t = distances[i] / (distances[i] - distances[j]);
      points.push(add(geometry.vertices[i], mul(sub(geometry.vertices[j], geometry.vertices[i]), t)));
    }
  }
  return points;
}

function rectangle(points, u, v, epsilon) {
  if (points.length < 3) return null;
  const projected = points.map(p => [dot(p, u), dot(p, v)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower = [], upper = [];
  for (const p of projected) {
    while (lower.length >= 2 && turn(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of projected.slice().reverse()) {
    while (upper.length >= 2 && turn(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  const polygon = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  if (Math.abs(area) * .5 <= epsilon * epsilon) return null;
  return {
    min: [Math.min(...projected.map(p => p[0])), Math.min(...projected.map(p => p[1]))],
    max: [Math.max(...projected.map(p => p[0])), Math.max(...projected.map(p => p[1]))],
    polygon,
  };
}

function positiveFaceOverlap(a, b, epsilon) {
  // Bounding rectangles estimate strength only after the actual convex faces
  // overlap with positive area. Triangular faces can have overlapping rectangles
  // while their polygons meet at just a point or an edge.
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const size = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (size <= epsilon) continue;
    const axis = [(p[1] - q[1]) / size, (q[0] - p[0]) / size];
    const projectedA = a.map(v => v[0] * axis[0] + v[1] * axis[1]);
    const projectedB = b.map(v => v[0] * axis[0] + v[1] * axis[1]);
    if (Math.min(Math.max(...projectedA), Math.max(...projectedB)) - Math.max(Math.min(...projectedA), Math.min(...projectedB)) <= epsilon) return false;
  }
  return true;
}

function contact(a, b, tolerance) {
  const separation = separatingAxis(a, b, tolerance);
  if (!separation) return null;
  const { normal, gap } = separation, ia = interval(a.vertices, normal), ib = interval(b.vertices, normal);
  const [u, v] = tangentBasis(normal);
  const span = Math.max(...a.bounds.max.map((x, i) => x - a.bounds.min[i]), ...b.bounds.max.map((x, i) => x - b.bounds.min[i]), 1);
  const epsilon = span * 1e-7;
  // For near-separated faces use their own support planes; for true overlap use
  // a common interior cross-section. Enclosing fallback boxes can legitimately overlap.
  const touching = gap >= -HULL_EPS;
  const plane = touching ? (ia.max + ib.min) * .5 : (Math.max(ia.min, ib.min) + Math.min(ia.max, ib.max)) * .5;
  const pointsA = sectionPoints(a, normal, touching ? ia.max : plane, touching ? HULL_EPS : epsilon);
  const pointsB = sectionPoints(b, normal, touching ? ib.min : plane, touching ? HULL_EPS : epsilon);
  const ra = rectangle(pointsA, u, v, epsilon), rb = rectangle(pointsB, u, v, epsilon);
  if (!ra || !rb) return null;
  if (!positiveFaceOverlap(ra.polygon, rb.polygon, epsilon)) return null;
  const min = ra.min.map((x, i) => Math.max(x, rb.min[i])), max = ra.max.map((x, i) => Math.min(x, rb.max[i]));
  const width = max[0] - min[0], height = max[1] - min[1];
  if (width <= epsilon || height <= epsilon) return null;
  const clean = values => values.map(value => value === 0 ? 0 : value);
  return {
    area: width * height, normal: clean(normal),
    position: clean(add(mul(normal, plane), add(mul(u, (min[0] + max[0]) * .5), mul(v, (min[1] + max[1]) * .5)))),
  };
}

function countComponents(pieces, bonds) {
  const adjacent = new Map(pieces.map(p => [p.id, []]));
  for (const bond of bonds) { adjacent.get(bond.a).push(bond.b); adjacent.get(bond.b).push(bond.a); }
  const visited = new Set();
  let count = 0;
  for (const piece of pieces) if (!visited.has(piece.id)) {
    count++;
    const pending = [piece.id];
    visited.add(piece.id);
    while (pending.length) for (const neighbor of adjacent.get(pending.pop())) if (!visited.has(neighbor)) {
      visited.add(neighbor);
      pending.push(neighbor);
    }
  }
  return count;
}

/**
 * Read an authored manifest and derive a static cohesive graph once at import.
 * Full convex SAT excludes disjoint hulls even when their AABBs overlap. Contact
 * area is an estimate from projected touching-face bounding rectangles; overlap
 * uses an interior section, never another persistent constraint or collider.
 *
 * capacity [N] = area [m²] × material.strengthPa [N/m²]. The authored breakEnergyJ
 * is distributed across all bonds in proportion to capacity, so it remains the
 * whole asset's fracture-energy budget rather than an unbounded per-bond multiplier.
 * Material presets are gameplay defaults and may be overridden with a Pa number
 * or {strengthPa}. Input arrays/objects are never retained or mutated.
 */
export function importDestructible(input, { tolerance = .02, materials = {} } = {}) {
  number(tolerance, 'options.tolerance', 0);
  object(materials, 'options.materials');
  const { asset, geometries, warnings } = readManifest(input);
  const material = Object.hasOwn(materials, asset.material) ? materials[asset.material] : (asset.version === 2 ? STRUCTURE_MATERIALS[asset.material] : DESTRUCTIBLE_MATERIALS[asset.material]);
  if (material == null) fail('material', `unknown material ${asset.material}; supply materials.${asset.material}.strengthPa`);
  const strengthPa = number(typeof material === 'number' ? material : material.strengthPa, `materials.${asset.material}.strengthPa`, 0, Infinity, true);
  const physical = asset.pieces.filter(p => p.mode !== 'cosmetic'), bonds = [];
  if (asset.version === 2) {
    for (const b of asset.bonds) bonds.push({...b, area: b.areaM2, capacity: b.areaM2 * strengthPa, energyJ: 0});
  } else for (let i = 0; i < physical.length; i++) for (let j = i + 1; j < physical.length; j++) {
    const a = physical[i], b = physical[j], touching = contact(geometries.get(a.id), geometries.get(b.id), tolerance);
    if (touching) {
      const capacity = touching.area * strengthPa;
      if (!Number.isFinite(capacity) || capacity <= 0 || !touching.position.every(Number.isFinite)) fail('bonds', 'contact area, position or capacity exceeds the supported numeric range');
      bonds.push({ id: `bond_${bonds.length}`, a: a.id, b: b.id, ...touching, capacity, energyJ: 0 });
    }
  }
  if (bonds.some(b => !Number.isFinite(b.capacity) || b.capacity <= 0)) fail('bonds', 'capacity exceeds the supported numeric range');
  // Scale before summation so many large but finite capacities cannot overflow.
  const fractureBonds = bonds.filter(b => b.breakable !== false && b.fractureLevel !== 2);
  for(const bond of bonds)if(bond.breakable!==false&&bond.fractureLevel===2){bond.energyJ=bond.area*STRUCTURE_MATERIALS[asset.material].fractureEnergyJPerM2;if(!Number.isFinite(bond.energyJ)||bond.energyJ<=0)fail('bonds','invalid secondary fracture energy');}
  const maxCapacity = fractureBonds.reduce((max, bond) => Math.max(max, bond.capacity), 0);
  const totalWeight = fractureBonds.reduce((sum, bond) => sum + bond.capacity / maxCapacity, 0);
  let assignedEnergy = 0;
  for (let i = 0; i < fractureBonds.length; i++) {
    fractureBonds[i].energyJ = i === fractureBonds.length - 1 ? Math.max(0, asset.breakEnergyJ - assignedEnergy) : asset.breakEnergyJ * ((fractureBonds[i].capacity / maxCapacity) / totalWeight);
    assignedEnergy += fractureBonds[i].energyJ;
  }
  const componentCount = countComponents(physical, bonds);
  if (asset.version === 2 && componentCount !== asset.validation.connectedComponents) fail('validation.connectedComponents', 'does not match authored bonds');
  if (componentCount > 1) warnings.push(`Physical bond graph has ${componentCount} disconnected components; these groups begin separated.`);
  const dynamic = physical.filter(p => p.mode === 'dynamic');
  // A purely anchored asset has no moving follower; use its nearest bearing.
  const followers = dynamic.length ? dynamic : physical;
  for (const p of asset.pieces) if (p.mode === 'cosmetic') {
    p.followPieceId = followers.reduce((nearest, candidate) => dot(sub(candidate.position, p.position), sub(candidate.position, p.position)) < dot(sub(nearest.position, p.position), sub(nearest.position, p.position)) ? candidate : nearest).id;
  }
  return {
    ...asset, id: asset.assetId, bonds, bearings: physical.filter(p => p.mode === 'anchored').map(p => p.id),
    bounds: boundsOf([...geometries.values()].flatMap(g => g.vertices)), tolerance, materialStrengthPa: strengthPa, componentCount, warnings,
  };
}
