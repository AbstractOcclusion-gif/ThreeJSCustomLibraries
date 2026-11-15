import * as C from 'cannon-es';

const v = a => new C.Vec3(...a);
const scaled = (a, s) => a.map((n, i) => n * s[i]);
const AXIS_TOLERANCE = 1e-10;
const PARTITION_ABSOLUTE_TOLERANCE = 1e-8;
const PARTITION_RELATIVE_TOLERANCE = 1e-7;
const PARTITION_VOLUME_TOLERANCE = 2e-6;

// Integrate tetrahedra about an interior reference point. The resulting centroid
// and inertia use the actual scaled convex volume, including products of inertia.
export function convexMassProperties(collider, scale, mass) {
  const vertices = collider.vertices.map(p => v(scaled(p, scale)));
  const origin = vertices.reduce((sum, p) => { sum.vadd(p, sum); return sum; }, new C.Vec3()).scale(1 / vertices.length);
  let volume = 0;
  const first = new C.Vec3(), second = Array(9).fill(0);
  for (const face of collider.faces) for (let j = 1; j < face.length - 1; j++) {
    const points = [vertices[face[0]], vertices[face[j]], vertices[face[j + 1]]].map(p => p.vsub(origin));
    const amount = points[0].dot(points[1].cross(points[2])) / 6;
    const sum = points.reduce((a, p) => { a.vadd(p, a); return a; }, new C.Vec3());
    first.vadd(sum.scale(amount / 4), first);
    const coordinates = points.map(p => p.toArray()), totals = sum.toArray();
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      second[a * 3 + b] += amount / 20 * (totals[a] * totals[b] + coordinates.reduce((s, p) => s + p[a] * p[b], 0));
    }
    volume += amount;
  }
  const relative = first.scale(1 / volume), centroid = origin.vadd(relative), c = relative.toArray();
  const centred = second.map((n, i) => n - volume * c[Math.floor(i / 3)] * c[i % 3]);
  const trace = centred[0] + centred[4] + centred[8];
  const tensor = centred.map((n, i) => mass / volume * ((i % 4 === 0 ? trace : 0) - n));
  return { vertices, centroid, tensor, volume, radius: Math.sqrt(Math.max(...vertices.map(p => p.distanceSquared(centroid)))) };
}

export function createConvexCollider(collider, vertices = collider.vertices.map(v), compactAxes = false, omitFaceDiagonals = false) {
  const hull = new C.ConvexPolyhedron({ vertices, faces: collider.faces.map(face => face.slice()) });
  if (compactAxes) {
    // Cannon tests every triangle normal and both edge directions. Bevelled
    // stones amplify that work. Parallel/opposite directions test the same
    // separating plane; retain all geometry and full faces for contact clipping.
    const unique = vectors => vectors.filter((direction, index) => !vectors.slice(0, index).some(other =>
      other.almostEquals(direction, AXIS_TOLERANCE) || other.x === -direction.x && other.y === -direction.y && other.z === -direction.z));
    hull.uniqueAxes = unique(hull.faceNormals);
    hull.uniqueEdges = unique(hull.uniqueEdges);
    if (omitFaceDiagonals) {
      // Coplanar triangulation diagonals are not polyhedron edges. Their cross
      // products add redundant SAT work; keep every true boundary direction.
      const edges = new Map();
      for (const [i, face] of hull.faces.entries()) for (let j = 0; j < face.length; j++) {
        const a = face[j], b = face[(j + 1) % face.length], key = [a,b].sort((a,b) => a-b).join(':');
        if (!edges.has(key)) edges.set(key, { a, b, normals: [] });
        edges.get(key).normals.push(hull.faceNormals[i]);
      }
      const physical = [...edges.values()].filter(e => e.normals.length === 1 || e.normals.some(n => !n.almostEquals(e.normals[0], AXIS_TOLERANCE)))
        .map(e => hull.vertices[e.a].vsub(hull.vertices[e.b]).unit());
      hull.uniqueEdges = hull.uniqueEdges.filter(v => physical.some(u => u.almostEquals(v, AXIS_TOLERANCE) || u.negate().almostEquals(v, AXIS_TOLERANCE)));
    }
  }
  return hull;
}

function hullsOverlap(a, b, identity, axis, epsilon) {
  return a.shape.findSeparatingAxis(b.shape, a.position, identity, b.position, identity, axis) && a.shape.testSepAxis(axis, b.shape, a.position, identity, b.position, identity) > epsilon;
}

// A safe automatic proxy is a convex partition, not merely a matching AABB or
// volume: overlapping pieces could otherwise hide an equal-sized missing hole.
// Reuse Cannon's complete face/edge SAT once per asset, never during a step.
export function certifyIntactPartition(asset) {
  if (asset.intact.colliders.length !== 1) return certifyCompoundIntactPartition(asset);
  const intact = asset.intact.colliders[0], origin = v(intact.position), unitScale = [1, 1, 1];
  const shape = convexMassProperties(intact, unitScale, 1), hull = createConvexCollider(intact, shape.vertices.map(p => p.vsub(shape.centroid))), position = origin.vadd(shape.centroid);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of shape.vertices) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], point.toArray()[i]); max[i] = Math.max(max[i], point.toArray()[i]); }
  const span = Math.max(...max.map((n, i) => n - min[i])), epsilon = Math.max(PARTITION_ABSOLUTE_TOLERANCE, span * PARTITION_RELATIVE_TOLERANCE);
  const physical = [];
  let volume = 0;
  for (const piece of asset.pieces) if (piece.mode !== 'cosmetic') {
    if (piece.collider.authorShape === 'BOX_FALLBACK') return { certified: false, reason: 'piece uses an enclosing box fallback' };
    const part = convexMassProperties(piece.collider, unitScale, 1), pivot = v(piece.position);
    for (const point of part.vertices) {
      const local = pivot.vadd(point).vsub(position);
      for (let face = 0; face < hull.faces.length; face++) if (hull.faceNormals[face].dot(local.vsub(hull.vertices[hull.faces[face][0]])) > epsilon) return { certified: false, reason: 'piece extends beyond intact collider' };
    }
    physical.push({ shape: createConvexCollider(piece.collider, part.vertices.map(p => p.vsub(part.centroid))), position: pivot.vadd(part.centroid) });
    volume += part.volume;
  }
  if (Math.abs(volume - shape.volume) > shape.volume * PARTITION_VOLUME_TOLERANCE) return { certified: false, reason: 'piece volume differs from intact volume' };
  const identity = new C.Quaternion(), axis = new C.Vec3();
  for (let i = 0; i < physical.length; i++) for (let j = i + 1; j < physical.length; j++) {
    const a = physical[i], b = physical[j];
    if (hullsOverlap(a, b, identity, axis, epsilon)) return { certified: false, reason: 'piece interiors overlap' };
  }
  return { certified: true, reason: 'contained, non-overlapping convex partition with matching volume' };
}

// Whole walls with openings have several convex intact regions, but ONE body.
// Certify the two partitions before using those coarse regions as colliders.
function certifyCompoundIntactPartition(asset) {
  const cooked = (collider, pivot) => {
    const data = convexMassProperties(collider, [1, 1, 1], 1);
    return { ...data, shape: createConvexCollider(collider, data.vertices.map(p => p.vsub(data.centroid))), position: v(pivot).vadd(data.centroid), pivot: v(pivot) };
  };
  const intact = asset.intact.colliders.map(c => cooked(c, c.position));
  const physical = asset.pieces.filter(p => p.mode !== 'cosmetic').map(p => cooked(p.collider, p.position));
  if (asset.pieces.some(p => p.collider?.authorShape === 'BOX_FALLBACK')) return { certified: false, reason: 'piece uses an enclosing box fallback' };
  const points = intact.flatMap(s => s.vertices.map(p => p.vadd(s.pivot))), min = [0,1,2].map(i => Math.min(...points.map(p => p.toArray()[i]))), max = [0,1,2].map(i => Math.max(...points.map(p => p.toArray()[i])));
  const epsilon = Math.max(PARTITION_ABSOLUTE_TOLERANCE, Math.max(...max.map((n, i) => n - min[i])) * PARTITION_RELATIVE_TOLERANCE);
  for (const part of physical) {
    const contained = intact.some(region => part.vertices.every(point => {
      const local = point.vadd(part.pivot).vsub(region.position);
      return region.shape.faces.every((face, i) => region.shape.faceNormals[i].dot(local.vsub(region.shape.vertices[face[0]])) <= epsilon);
    }));
    if (!contained) return { certified: false, reason: 'piece is not contained in an intact convex region' };
  }
  const total = shapes => shapes.reduce((sum, s) => sum + s.volume, 0), volume = total(intact);
  if (Math.abs(total(physical) - volume) > volume * PARTITION_VOLUME_TOLERANCE) return { certified: false, reason: 'piece volume differs from intact regions' };
  const identity = new C.Quaternion(), axis = new C.Vec3();
  for (const shapes of [intact, physical]) for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    const a = shapes[i], b = shapes[j];
    if (hullsOverlap(a, b, identity, axis, epsilon)) return { certified: false, reason: 'partition interiors overlap' };
  }
  return { certified: true, reason: 'matching non-overlapping convex partitions preserve authored openings' };
}

export function intactGeometry(asset, scale) {
  return asset.intact.colliders.map(collider => {
    const shape = convexMassProperties(collider, scale, 1), centre = v(scaled(collider.position, scale)).vadd(shape.centroid);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const point of shape.vertices) { const p = point.toArray(); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); } }
    const epsilon = Math.max(...max.map((n, i) => n - min[i])) * PARTITION_RELATIVE_TOLERANCE, corners = new Set();
    for (const point of shape.vertices) {
      const p = point.toArray(); let corner = 0;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(p[i] - min[i]) <= epsilon) continue;
        if (Math.abs(p[i] - max[i]) <= epsilon) corner |= 1 << i;
        else { corner = -1; break; }
      }
      if (corner >= 0) corners.add(corner);
    }
    if (shape.vertices.length === 8 && corners.size === 8) return { kind: 'box', centre: v(scaled(collider.position, scale)).vadd(v(min.map((n, i) => (n + max[i]) / 2))), halfExtents: max.map((n, i) => (n - min[i]) / 2) };
    return { kind: 'convex', centre, vertices: shape.vertices.map(p => p.vsub(shape.centroid)), faces: collider.faces };
  });
}

function pointTriangle(point, a, b, c) {
  const ab = b.vsub(a), ac = c.vsub(a), ap = point.vsub(a), d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = point.vsub(b), d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return a.vadd(ab.scale(d1 / (d1 - d3)));
  const cp = point.vsub(c), d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return a.vadd(ac.scale(d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return b.vadd(c.vsub(b).scale((d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denominator = 1 / (va + vb + vc);
  return a.vadd(ab.scale(vb * denominator)).vadd(ac.scale(vc * denominator));
}

export function distanceToHull(point, geometry) {
  const local = point.vsub(geometry.pivot);
  let inside = true, distance = Infinity;
  for (const face of geometry.piece.collider.faces) {
    const a = geometry.vertices[face[0]], b = geometry.vertices[face[1]], c = geometry.vertices[face[2]];
    if (b.vsub(a).cross(c.vsub(a)).dot(local.vsub(a)) > PARTITION_ABSOLUTE_TOLERANCE) inside = false;
    for (let j = 1; j < face.length - 1; j++) distance = Math.min(distance, local.distanceTo(pointTriangle(local, a, geometry.vertices[face[j]], geometry.vertices[face[j + 1]])));
  }
  return inside ? 0 : distance;
}
