import * as C from 'cannon-es';
import { importDestructible } from './destructible.js';

const v = a => new C.Vec3(...a);
const scaled = (a, s) => a.map((n, i) => n * s[i]);
const lookup = (assets, id) => assets instanceof Map ? assets.get(id) : assets?.[id];

// Integrate tetrahedra about an interior reference point. The resulting centroid
// and inertia use the actual scaled convex volume, including products of inertia.
// Game-tuned masonry response per asset material, not engineering calibration.
// Materials without an entry keep the original rules: fixed breach radius,
// whole authored clusters, and released chunks that stay rigid on landing.
const MASONRY_RESPONSE = Object.freeze({
  brick: Object.freeze({
    breachRadiusM: [.12, .45], breachFullEnergyJ: 20000, // standing-wall hole radius grows with impact energy
    clusterEnergyJ: 3000,                               // below this a hit only loosens the units it reaches
    landingMinSpeed: 2.5, landingEfficiency: .25,        // released chunks crack on hard contacts
    landingRadiusM: [.18, .5], landingFullEnergyJ: 3000,
    impulseTransfer: .8,                                 // share of the impactor's speed passed to the chunks it releases (0 disables)
    maxGroups: 48,                                       // rigid bodies per wall that landing damage may create
    punchBonds: 120,                                     // mortar bonds one hit may break around its contact point
  }),
});
const energyRadius = ([min, max], energy, full) => min + (max - min) * Math.sqrt(Math.min(1, Math.max(0, energy) / full));

function properties(collider, scale, mass) {
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

function convex(collider, vertices = collider.vertices.map(v), compactAxes = false, omitFaceDiagonals = false) {
  const hull = new C.ConvexPolyhedron({ vertices, faces: collider.faces.map(face => face.slice()) });
  if (compactAxes) {
    // Cannon tests every triangle normal and both edge directions. Bevelled
    // stones amplify that work. Parallel/opposite directions test the same
    // separating plane; retain all geometry and full faces for contact clipping.
    const unique = vectors => vectors.filter((direction, index) => !vectors.slice(0, index).some(other =>
      other.almostEquals(direction, 1e-10) || other.x === -direction.x && other.y === -direction.y && other.z === -direction.z));
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
      const physical = [...edges.values()].filter(e => e.normals.length === 1 || e.normals.some(n => !n.almostEquals(e.normals[0], 1e-10)))
        .map(e => hull.vertices[e.a].vsub(hull.vertices[e.b]).unit());
      hull.uniqueEdges = hull.uniqueEdges.filter(v => physical.some(u => u.almostEquals(v, 1e-10) || u.negate().almostEquals(v, 1e-10)));
    }
  }
  return hull;
}

// A safe automatic proxy is a convex partition, not merely a matching AABB or
// volume: overlapping pieces could otherwise hide an equal-sized missing hole.
// Reuse Cannon's complete face/edge SAT once per asset, never during a step.
function certifyIntactPartition(asset) {
  if (asset.intact.colliders.length !== 1) return certifyCompoundIntactPartition(asset);
  const intact = asset.intact.colliders[0], origin = v(intact.position), unitScale = [1, 1, 1];
  const shape = properties(intact, unitScale, 1), hull = convex(intact, shape.vertices.map(p => p.vsub(shape.centroid))), position = origin.vadd(shape.centroid);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of shape.vertices) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], point.toArray()[i]); max[i] = Math.max(max[i], point.toArray()[i]); }
  const span = Math.max(...max.map((n, i) => n - min[i])), epsilon = Math.max(1e-8, span * 1e-7);
  const physical = [];
  let volume = 0;
  for (const piece of asset.pieces) if (piece.mode !== 'cosmetic') {
    if (piece.collider.authorShape === 'BOX_FALLBACK') return { certified: false, reason: 'piece uses an enclosing box fallback' };
    const part = properties(piece.collider, unitScale, 1), pivot = v(piece.position);
    for (const point of part.vertices) {
      const local = pivot.vadd(point).vsub(position);
      for (let face = 0; face < hull.faces.length; face++) if (hull.faceNormals[face].dot(local.vsub(hull.vertices[hull.faces[face][0]])) > epsilon) return { certified: false, reason: 'piece extends beyond intact collider' };
    }
    physical.push({ shape: convex(piece.collider, part.vertices.map(p => p.vsub(part.centroid))), position: pivot.vadd(part.centroid) });
    volume += part.volume;
  }
  if (Math.abs(volume - shape.volume) > shape.volume * 2e-6) return { certified: false, reason: 'piece volume differs from intact volume' };
  const identity = new C.Quaternion(), axis = new C.Vec3();
  for (let i = 0; i < physical.length; i++) for (let j = i + 1; j < physical.length; j++) {
    const a = physical[i], b = physical[j];
    if (a.shape.findSeparatingAxis(b.shape, a.position, identity, b.position, identity, axis) && a.shape.testSepAxis(axis, b.shape, a.position, identity, b.position, identity) > epsilon) return { certified: false, reason: 'piece interiors overlap' };
  }
  return { certified: true, reason: 'contained, non-overlapping convex partition with matching volume' };
}

// Whole walls with openings have several convex intact regions, but ONE body.
// Certify the two partitions before using those coarse regions as colliders.
function certifyCompoundIntactPartition(asset) {
  const cooked = (collider, pivot) => {
    const data = properties(collider, [1, 1, 1], 1);
    return { ...data, shape: convex(collider, data.vertices.map(p => p.vsub(data.centroid))), position: v(pivot).vadd(data.centroid), pivot: v(pivot) };
  };
  const intact = asset.intact.colliders.map(c => cooked(c, c.position));
  const physical = asset.pieces.filter(p => p.mode !== 'cosmetic').map(p => cooked(p.collider, p.position));
  if (asset.pieces.some(p => p.collider?.authorShape === 'BOX_FALLBACK')) return { certified: false, reason: 'piece uses an enclosing box fallback' };
  const points = intact.flatMap(s => s.vertices.map(p => p.vadd(s.pivot))), min = [0,1,2].map(i => Math.min(...points.map(p => p.toArray()[i]))), max = [0,1,2].map(i => Math.max(...points.map(p => p.toArray()[i])));
  const epsilon = Math.max(1e-8, Math.max(...max.map((n, i) => n - min[i])) * 1e-7);
  for (const part of physical) {
    const contained = intact.some(region => part.vertices.every(point => {
      const local = point.vadd(part.pivot).vsub(region.position);
      return region.shape.faces.every((face, i) => region.shape.faceNormals[i].dot(local.vsub(region.shape.vertices[face[0]])) <= epsilon);
    }));
    if (!contained) return { certified: false, reason: 'piece is not contained in an intact convex region' };
  }
  const total = shapes => shapes.reduce((sum, s) => sum + s.volume, 0), volume = total(intact);
  if (Math.abs(total(physical) - volume) > volume * 2e-6) return { certified: false, reason: 'piece volume differs from intact regions' };
  const identity = new C.Quaternion(), axis = new C.Vec3();
  for (const shapes of [intact, physical]) for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    const a = shapes[i], b = shapes[j];
    if (a.shape.findSeparatingAxis(b.shape, a.position, identity, b.position, identity, axis) && a.shape.testSepAxis(axis, b.shape, a.position, identity, b.position, identity) > epsilon) return { certified: false, reason: 'partition interiors overlap' };
  }
  return { certified: true, reason: 'matching non-overlapping convex partitions preserve authored openings' };
}

function intactGeometry(asset, scale) {
  return asset.intact.colliders.map(collider => {
    const shape = properties(collider, scale, 1), centre = v(scaled(collider.position, scale)).vadd(shape.centroid);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const point of shape.vertices) { const p = point.toArray(); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); } }
    const epsilon = Math.max(...max.map((n, i) => n - min[i])) * 1e-7, corners = new Set();
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

function distanceToHull(point, geometry) {
  const local = point.vsub(geometry.pivot);
  let inside = true, distance = Infinity;
  for (const face of geometry.piece.collider.faces) {
    const a = geometry.vertices[face[0]], b = geometry.vertices[face[1]], c = geometry.vertices[face[2]];
    if (b.vsub(a).cross(c.vsub(a)).dot(local.vsub(a)) > 1e-8) inside = false;
    for (let j = 1; j < face.length - 1; j++) distance = Math.min(distance, local.distanceTo(pointTriangle(local, a, geometry.vertices[face[j]], geometry.vertices[face[j + 1]])));
  }
  return inside ? 0 : distance;
}

/** Resolve/validate every referenced asset before the host mutates its world. */
export function prepareFracturedRows(rows, assets = {}) {
  const loaded = new Map(), certificates = new Map(), result = new Map();
  for (const row of rows) {
    if (!row.assetId || !lookup(assets, row.assetId)) continue;
    if (!loaded.has(row.assetId)) {
      const source = lookup(assets, row.assetId);
      loaded.set(row.assetId, importDestructible(source, {
        tolerance: source.tolerance ?? .02,
        materials: source.materialStrengthPa != null ? { [source.material]: source.materialStrengthPa } : {},
      }));
    }
    const asset = loaded.get(row.assetId), scale = row.assetScale ?? [1, 1, 1], massScale = row.mass / asset.massKg;
    if (asset.masonry && scale.some(n => n !== 1)) throw Error('Masonry requires authored dimensions; runtime fitting is unsupported');
    const requested = row.collisionLOD ?? 'detailed';
    if (requested !== 'detailed' && !certificates.has(row.assetId)) certificates.set(row.assetId, certifyIntactPartition(asset));
    const certificate = certificates.get(row.assetId) ?? { certified: false, reason: 'detailed collision requested' };
    const collisionLOD = { requested, certified: certificate.certified, eligible: requested === 'intact' || requested === 'auto' && certificate.certified, reason: certificate.reason };
    const quaternion = row.quaternion ? new C.Quaternion(...row.quaternion) : new C.Quaternion();
    quaternion.normalize();
    if (asset.masonry && quaternion.vmult(new C.Vec3(0,1,0)).distanceTo(new C.Vec3(0,1,0)) > 1e-6) throw Error('Masonry directional support requires an upright wall');
    const geometry = new Map();
    for (const piece of asset.pieces) if (piece.mode !== 'cosmetic') {
      const mass = piece.massKg * massScale, shape = properties(piece.collider, scale, mass), pivot = v(scaled(piece.position, scale));
      if (!(mass > 0) || !Number.isFinite(mass) || !shape.tensor.every(Number.isFinite) || !shape.centroid.toArray().every(Number.isFinite)) throw Error('Invalid floor asset: scaled mass or collider exceeds numeric range');
      geometry.set(piece.id, { ...shape, piece, pivot, centre: pivot.vadd(shape.centroid), mass });
    }
    const bindingSpecs = [];
    for (let index = 0; index < row.bearings.length; index++) {
      const bearing = row.bearings[index], local = quaternion.conjugate().vmult(v(bearing.point).vsub(v(row.position)));
      for (const [pieceId, shape] of geometry) if (distanceToHull(local, shape) <= (row.bearingTolerance ?? asset.tolerance) + 1e-7) bindingSpecs.push({ index, bearing, pieceId, assetPoint: local });
      if (!bindingSpecs.some(binding => binding.index === index)) throw Error(`Invalid floor bearing: ${row.assetId} has no piece within bearing tolerance of bearing ${index}`);
    }
    result.set(row, { asset, scale: scale.slice(), quaternion, geometry, bindingSpecs, collisionLOD, intactShapes: collisionLOD.eligible ? intactGeometry(asset, scale) : [] });
  }
  return result;
}

function components(ids, bonds) {
  const adjacent = new Map(ids.map(id => [id, []]));
  for (const bond of bonds) if (bond.alive && adjacent.has(bond.a) && adjacent.has(bond.b)) { adjacent.get(bond.a).push(bond.b); adjacent.get(bond.b).push(bond.a); }
  const seen = new Set(), groups = [];
  for (const id of ids) if (!seen.has(id)) {
    const pending = [id], group = [];
    seen.add(id);
    while (pending.length) { const next = pending.pop(); group.push(next); for (const n of adjacent.get(next)) if (!seen.has(n)) { seen.add(n); pending.push(n); } }
    groups.push(group);
  }
  return groups;
}

/** One imported panel. Rendering remains a consumer of the serializable transforms. */
export function createFracturedPanel({ world, row, id, prepared, members, bonds, onEvent, wake, topology }) {
  const { asset, geometry, scale, quaternion } = prepared;
  const physicalIds = [...geometry.keys()], attachments = [], queued = [], failedPieces = new Set();
  const masonry = asset.masonry, unitMap = new Map(masonry?.units.map(u => [u.id,u]) ?? []), released = new Set();
  const supportOrder = [...unitMap.values()].sort((a,b) => masonry.pattern === 'rubble_stone'
    ? a.bounds[0][1]+a.bounds[1][1]-b.bounds[0][1]-b.bounds[1][1] : a.bounds[0][1] - b.bounds[0][1]);
  const consumedImpactors = new WeakSet(), response = masonry ? MASONRY_RESPONSE[asset.material] : undefined;
  const miniClusters = masonry?.clusters.filter(c => c.miniParent) ?? [], miniDue = new Map();
  let foundationReleased = false, launch = null;
  let masonryGrounding = null;
  const retiredGroups = new Map();
  const useAssetAnchors = !row.bearings.length && !row.neighbours.length;
  const anchors = new Set(useAssetAnchors ? asset.bearings : []);
  const material = new C.Material({ friction: asset.friction, restitution: asset.restitution });
  let nextGroup = 0, disposed = false, fractureEnabled = true, damageEnabled = true, initializing = true;
  const panel = { id, row, assetId: asset.assetId, asset, collisionLOD: prepared.collisionLOD, bonds: [], groups: [], chips: [], broken: false, damage: 0, revision: 0, attachments, internalBonds: asset.bonds.map(b => {
    const normal = b.normal.map((n, i) => n / scale[i]), areaScale = scale.reduce((p, n) => p * n, 1) * Math.hypot(...normal);
    return { ...b, position: scaled(b.position, scale), capacity: b.capacity * areaScale, energyJ: b.energyJ * row.breakEnergy / asset.breakEnergyJ, damageJ: 0, alive: true };
  }) };
  panel.frozen = [];
  Object.defineProperties(panel, {
    bodies: { get: () => panel.groups.map(g => g.body) },
    fragments: { get: () => panel.broken ? panel.groups : [] },
  });
  const changed = () => { panel.revision++; topology(); };
  const removeBond = bond => { if (!bond?.alive) return; bond.alive = false; world.removeConstraint(bond.joint); };
  const attached = group => anchors.size && group.pieceIds.some(id => anchors.has(id)) || group.bonds.some(b => b.alive);

  function makeGroup(pieceIds, parent = null) {
    const mass = pieceIds.reduce((sum, id) => sum + geometry.get(id).mass, 0), centre = new C.Vec3();
    for (const id of pieceIds) centre.vadd(geometry.get(id).centre.scale(geometry.get(id).mass / mass), centre);
    const position = parent ? parent.body.pointToWorldFrame(centre.vsub(v(parent.assetCentre))) : v(row.position).vadd(quaternion.vmult(centre));
    const fixed = masonry ? pieceIds.every(id => !released.has(id)) : pieceIds.some(id => anchors.has(id));
    const body = new C.Body({ mass: fixed ? 0 : mass, position, quaternion: parent ? parent.body.quaternion.clone() : quaternion.clone(), material,
      collisionFilterGroup: 2, collisionFilterMask: 3, linearDamping: .03, angularDamping: .06, allowSleep: false, sleepSpeedLimit: .12, sleepTimeLimit: 1 });
    const tensor = Array(9).fill(0), bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const intactCollision = prepared.collisionLOD.eligible && pieceIds.length === physicalIds.length;
    let damageRadius = 0;
    const append = (shape, offset) => { body.shapes.push(shape); body.shapeOffsets.push(offset); body.shapeOrientations.push(new C.Quaternion()); shape.body = body; };
    for (const id of pieceIds) {
      const shape = geometry.get(id), offset = shape.centre.vsub(centre), r = offset.toArray(), r2 = offset.lengthSquared();
      damageRadius = Math.max(damageRadius, offset.length() + shape.radius);
      if (!intactCollision) append(convex(shape.piece.collider, shape.vertices.map(p => p.vsub(shape.centroid)), masonry?.pattern === 'coursed_stone' || masonry?.pattern === 'rubble_stone' || row.compactCollisionAxes === true, row.compactCollisionAxes === true), offset);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) tensor[a * 3 + b] += shape.tensor[a * 3 + b] + shape.mass * ((a === b ? r2 : 0) - r[a] * r[b]);
      for (const point of shape.vertices) {
        const local = point.vadd(shape.pivot).vsub(centre).toArray();
        for (let a = 0; a < 3; a++) { bounds.min[a] = Math.min(bounds.min[a], local[a]); bounds.max[a] = Math.max(bounds.max[a], local[a]); }
      }
    }
    if (intactCollision) for (const shape of prepared.intactShapes) append(shape.kind === 'box' ? new C.Box(v(shape.halfExtents)) : convex({ faces: shape.faces }, shape.vertices.map(p => p.clone()), row.compactCollisionAxes === true, row.compactCollisionAxes === true), shape.centre.vsub(centre));
    // Match the established cluster compound assembly: preserve child ownership,
    // but finalize bounds/mass once instead of for every growing prefix.
    body.updateMassProperties(); body.updateBoundingRadius(); body.aabbNeedsUpdate = true;
    body._massTensor = tensor;
    body.fractureMass = mass;
    if (fixed) body.retiredMass = mass;
    body.inertia.set(tensor[0], tensor[4], tensor[8]);
    body.invInertia.set(fixed ? 0 : 1 / tensor[0], fixed ? 0 : 1 / tensor[4], fixed ? 0 : 1 / tensor[8]);
    body.updateInertiaWorld(true);
    if (parent) { parent.body.getVelocityAtWorldPoint(position, body.velocity); body.angularVelocity.copy(parent.body.angularVelocity); }
    // The standing wall is static, so the impactor's momentum never reaches the
    // chunks it knocks out. Hand them an inelastic share, fading with distance.
    if (launch && !fixed) {
      const share = Math.exp(-position.distanceTo(launch.point) / launch.reach);
      body.velocity.vadd(launch.direction.scale(response.impulseTransfer * launch.speed * launch.mass / (launch.mass + mass) * share), body.velocity);
      launch.absorbed += mass * share;
    }
    const group = { id: `${id}:${nextGroup++}`, panel, body, pieceIds: pieceIds.slice(), assetCentre: centre.toArray(), mass, damageRadius, collisionLOD: intactCollision ? 'intact' : 'pieces', bearings: [], bonds: [], detached: false,
      halfExtents: bounds.max.map((n, i) => Math.max(Math.abs(n), Math.abs(bounds.min[i]))), localPieceTransforms: [] };
    const included = new Set(pieceIds);
    for (const p of asset.pieces) if (included.has(p.id) || p.mode === 'cosmetic' && included.has(p.followPieceId)) group.localPieceTransforms.push({
      id: p.id, node: p.node, mode: p.mode, position: scaled(p.position, scale).map((n, i) => n - group.assetCentre[i]), quaternion: [0, 0, 0, 1], scale: scale.slice(), ...(p.followPieceId ? { followPieceId: p.followPieceId } : {}),
    });
    body.addEventListener('collide', event => {
      const speed = Math.abs(event.contact.getImpactVelocityAlongNormal());
      // Cosmetic observation only: landing dust must not enter the damage path
      // or wake/retire bodies. Native contacts supply an owner-relative normal;
      // Cannon supplies ni from bi toward bj.
      const contact = event.contact, normalY = contact.normal?.y ?? (contact.bi === body ? contact.ni?.y : -contact.ni?.y);
      if (asset.material === 'brick' && group.detached && speed >= 1.5 && normalY < -.4 && world.time - (group.lastDustLanding ?? -Infinity) >= .25) {
        group.lastDustLanding = world.time;
        const point = contact.point?.clone?.() ?? body.position.vadd(contact.bi === body ? contact.ri : contact.rj);
        onEvent({type:'floor:landing',time:world.time,panelId:id,groupId:group.id,kind:row.kind,mass,energy:.5*mass*speed*speed,speed,point:point.toArray()});
      }
      if (speed > .5) wake(body);
      if (!damageEnabled || !fractureEnabled || speed < 1) return;
      if (masonry && consumedImpactors.has(event.body)) return;
      // A released chunk hitting anything but a projectile: only materials with a
      // landing response crack, and only within the wall's rigid-body budget.
      const landing = masonry && group.detached && event.body.structureImpact !== true;
      if (landing && !(response && pieceIds.length > 1 && speed >= response.landingMinSpeed && panel.groups.length < response.maxGroups)) return;
      const otherMass = event.body.mass || event.body.retiredMass || 0, reduced = otherMass > 0 ? mass * otherMass / (mass + otherMass) : mass, energy = .5 * reduced * speed * speed;
      const point = contact.point?.clone?.() ?? (contact.bi === body ? body.position.vadd(contact.ri) : body.position.vadd(contact.rj));
      if (landing) queued.push({ energy: energy * response.landingEfficiency, point, body, radius: energyRadius(response.landingRadiusM, energy, response.landingFullEnergyJ), reason: 'landing', landing: true });
      else if (energy > row.breakEnergy * .02) {
        // Owner-to-other normal (native contacts supply it; Cannon gives ni from bi to bj).
        const outward = response && otherMass > 0 ? contact.normal ?? (contact.bi === body ? contact.ni : contact.ni?.negate()) : null;
        queued.push({ energy, point, body, source: event.body, push: outward ? { direction: outward.negate(), speed, mass: otherMass } : null });
      }
    });
    world.addBody(body);
    return group;
  }

  function connect(attachment, group) {
    const target = attachment.target, pointA = attachment.assetPoint.vsub(v(group.assetCentre));
    const joint = new C.PointToPointConstraint(group.body, pointA, target, attachment.targetPivot, 1e8);
    joint.collideConnected = false;
    world.addConstraint(joint);
    const bond = { a: panel, b: null, joint, alive: true, kind: 'support', group, pieceId: attachment.pieceId, bearing: attachment.bearing, member: attachment.member, capacity: attachment.capacity, attachment };
    bonds.push(bond); panel.bonds.push(bond);
    attachment.group = group; attachment.bond = bond;
    group.bearings.push(attachment); group.bonds.push(bond);
  }

  panel.groups.push(makeGroup(physicalIds));
  panel.body = panel.groups[0].body;
  for (const spec of prepared.bindingSpecs) {
    const member = members[spec.bearing.member], point = v(spec.bearing.point);
    const target = member.segments.reduce((best, segment) => segment.body.position.distanceTo(point) < best.position.distanceTo(point) ? segment.body : best, member.segments[0].body);
    const count = prepared.bindingSpecs.filter(s => s.index === spec.index).length;
    const attachment = { ...spec, member, target, targetPivot: target.pointToLocalFrame(point), capacity: row.breakForce / count };
    attachments.push(attachment); connect(attachment, panel.groups[0]);
  }

  function refreshDetached() {
    let difference = false;
    for (const group of panel.groups) {
      const locallyDetached = masonry ? group.pieceIds.every(id => released.has(id)) : !attached(group);
      const lostLocalSupport = group.locallyDetached === false && locallyDetached;
      group.locallyDetached = locallyDetached;
      // The assembly owns foundation connectivity and island sleeping. Do not
      // reattach one of its released islands merely because an internal bearing
      // or neighbouring panel lock still exists in that falling island.
      if (locallyDetached || initializing) { group.body.detached = locallyDetached; group.body.allowSleep = locallyDetached; }
      // Losing a sleeping neighbour's last support must release it into gravity.
      // Promote its flags first so the host's wake listener wakes only this island.
      if (!initializing && lostLocalSupport) group.body.wakeUp();
      const detached = locallyDetached || group.body.detached === true;
      if (group.detached !== detached) { group.detached = detached; difference = true; }
      const states = group.supportStates ??= [];
      let supportChanged = states.length !== group.bonds.length;
      for (let i = 0; i < group.bonds.length; i++) if (states[i] !== group.bonds[i].alive) { states[i] = group.bonds[i].alive; supportChanged = true; }
      if (supportChanged) { group.loadPlan = null; group.loadValidated = false; }
    }
    if (difference) changed();
  }

  // Directional support belongs only to standing masonry. Released compounds
  // remain rigid until another impact breaks their pre-authored fine interfaces.
  function releaseMasonry(ids, reason = 'masonry:impact') {
    const priorReleased = new Set(released);
    for (const id of ids) released.add(id);
    for (const mini of miniClusters) if (!miniDue.has(mini.id) && masonry.clusters.find(c => c.id === mini.miniParent)?.unitIds.some(id => released.has(id))) miniDue.set(mini.id,world.time+mini.releaseDelay);
    // A delayed mini-cluster may briefly remain visible in place, but cannot
    // become an anchor for the wall above it. Support must reach a foundation.
    const grounded = masonryGrounding ? masonryGrounding() : new Set();
    if (!masonryGrounding) for (const unit of supportOrder) if (!released.has(unit.id) &&
        (unit.foundation && !foundationReleased || unit.supports.some(id => grounded.has(id)))) grounded.add(unit.id);
    for (const unit of supportOrder) if (!released.has(unit.id) && !grounded.has(unit.id)) {
      if (unit.miniParent) {
        const mini = miniClusters.find(c => c.id === unit.clusterId);
        if (!miniDue.has(mini.id)) miniDue.set(mini.id, world.time + mini.releaseDelay);
        if (world.time < miniDue.get(mini.id)) continue;
      }
      released.add(unit.id);
    }
    for (const mini of miniClusters) if (!miniDue.has(mini.id) && masonry.clusters.find(c => c.id === mini.miniParent)?.unitIds.some(id => released.has(id))) miniDue.set(mini.id,world.time+mini.releaseDelay);
    for (const bond of panel.internalBonds) if (released.has(bond.a) !== released.has(bond.b)) {
      bond.alive = false; bond.damageJ = bond.energyJ;
    }
    // Distinct released coarse clusters become independent rigid compounds.
    for (const bond of panel.internalBonds) if (released.has(bond.a) && released.has(bond.b) &&
        unitMap.get(bond.a).clusterId !== unitMap.get(bond.b).clusterId) {
      bond.alive = false; bond.damageJ = bond.energyJ;
    }
    // Even a whole-wall release needs a fresh dynamic body, not its static parent.
    // Released units cannot retain footing joints to their retired static body.
    for (const attachment of attachments) if (!attachment.disabled &&
        (foundationReleased || released.has(attachment.pieceId))) {
      attachment.disabled = true; removeBond(attachment.bond);
    }
    for (const group of panel.groups) if (group.body.mass === 0 && group.pieceIds.every(id => released.has(id))) {
      const replacement = makeGroup(group.pieceIds, group);
      panel.groups[panel.groups.indexOf(group)] = replacement;
      world.removeBody(group.body);
    }
    fracture(reason, [...released].filter(id => !priorReleased.has(id)));
  }

  function fracture(reason = 'impact', pieces = physicalIds) {
    if (!panel.broken) panel.broken = true;
    for (const group of panel.groups) { wake(group.body); group.body.wakeUp(); }
    for (const bond of panel.bonds) if (bond.kind === 'tile') removeBond(bond);
    const next = [];
    let split = false;
    for (const group of panel.groups) {
      const parts = components(group.pieceIds, panel.internalBonds);
      if (parts.length === 1) { next.push(group); continue; }
      split = true;
      for (const bearing of group.bearings) removeBond(bearing.bond);
      // Components lighter than the row's chip threshold leave the simulation: their mass folds into the
      // heaviest surviving piece (conserved across later splits) and the host renders them as particles.
      const threshold = row.chipsBelowKg ?? 0, kept = [], shed = [];
      for (const ids of parts) (ids.reduce((sum, id) => sum + geometry.get(id).mass, 0) < threshold && !ids.some(id => anchors.has(id)) ? shed : kept).push(ids);
      if (!kept.length) kept.push(shed.pop());
      if (shed.length) {
        const heaviest = kept.flat().reduce((best, id) => geometry.get(id).mass > geometry.get(best).mass ? id : best);
        for (const ids of shed) {
          const mass = ids.reduce((sum, id) => sum + geometry.get(id).mass, 0), centre = new C.Vec3();
          for (const id of ids) centre.vadd(geometry.get(id).centre.scale(geometry.get(id).mass / mass), centre);
          const point = group.body.pointToWorldFrame(centre.vsub(v(group.assetCentre))), velocity = group.body.getVelocityAtWorldPoint(point, new C.Vec3());
          geometry.get(heaviest).mass += mass; panel.chips.push(...ids);
          onEvent({ type: 'floor:chips', time: world.time, floor: row.storey, panelId: id, kind: row.kind, mass, pieces: ids.slice(), point: point.toArray(), velocity: velocity.toArray() });
        }
      }
      for (const ids of kept) next.push(makeGroup(ids, group));
      world.removeBody(group.body);
    }
    panel.groups = next;
    if (masonry) panel.body = next[0]?.body ?? null;
    for (const group of next) { group.loadPlan = null; group.loadValidated = false; }
    if (split) for (const attachment of attachments) if (!attachment.disabled && !attachment.bond.alive) { const owner = next.find(group => group.pieceIds.includes(attachment.pieceId)); if (owner) connect(attachment, owner); else attachment.disabled = true; }
    refreshDetached(); changed();
    onEvent({ type: 'floor:fractured', time: world.time, floor: row.storey, panelId: id, kind: row.kind, mass: masonry ? pieces.reduce((sum,id) => sum + (geometry.get(id)?.mass ?? 0),0) : row.mass, pieces: pieces.slice(), revision: panel.revision, reason, point: next[0]?.body.position.toArray() ?? null, velocity: next[0]?.body.velocity.toArray() ?? null });
  }

  // Spend impact energy on the nearest live bonds inside `reach`. Each broken
  // bond adds at most one rigid body, so `budget` bounds the resulting split.
  function spendOnBonds(owned, local, reach, energy, fineEnabled, budget = Infinity) {
    const candidates = panel.internalBonds.filter(b => b.alive && b.breakable !== false && (b.fractureLevel !== 2 || fineEnabled) && owned.has(b.a) && owned.has(b.b)).map(b => ({ bond: b, distance: v(b.position).distanceTo(local) })).filter(x => x.distance <= reach).sort((a, b) => a.distance - b.distance || a.bond.capacity - b.bond.capacity);
    let remaining = energy;
    const affected = new Set();
    for (const { bond } of candidates) {
      if (budget <= 0) break;
      const amount = Math.min(remaining, Math.max(0, bond.energyJ - bond.damageJ));
      bond.damageJ += amount; remaining -= amount;
      if (bond.damageJ >= bond.energyJ - 1e-10) { bond.alive = false; budget--; affected.add(bond.a); affected.add(bond.b); }
      if (remaining <= 0) break;
    }
    panel.damage += (energy - remaining) / row.breakEnergy;
    return affected;
  }

  function impact({ point, energy, radius, body, source, reason = 'impact', landing = false, push = null } = {}) {
    if (disposed || !damageEnabled || !fractureEnabled || !(Number.isFinite(energy) && energy > 0)) return false;
    if (!panel.groups.length) return false;
    const hit = point ? point instanceof C.Vec3 ? point : v(point) : body?.position ?? panel.groups[0].body.position;
    const target = body ? panel.groups.find(g => g.body === body) : panel.groups.reduce((best, g) => g.body.position.distanceTo(hit) < best.body.position.distanceTo(hit) ? g : best);
    if (!target) return false;
    if (masonry && source?.structureImpact === true) {
      if (consumedImpactors.has(source)) return false;
      consumedImpactors.add(source);
    }
    if (energy > 5000) onEvent({ type: 'floor:impact', time: world.time, energy, kind:row.kind, velocity:source?.velocity?.toArray()??[0,0,0], storey: row.storey, panelId: id, pieces: target.pieceIds.slice(), point: hit.toArray() });
    const local = target.body.pointToLocalFrame(hit).vadd(v(target.assetCentre)), owned = new Set(target.pieceIds);
    if (masonry && !target.detached) {
      const closest = target.pieceIds.reduce((best,id) => distanceToHull(local,geometry.get(id)) < distanceToHull(local,geometry.get(best)) ? id : best);
      const explicit = Number.isFinite(radius) && radius >= 0, reach = explicit ? radius : response ? energyRadius(response.breachRadiusM, energy, response.breachFullEnergyJ) : .12;
      launch = push && response?.impulseTransfer > 0 ? { ...push, point: hit.clone(), reach: Math.max(reach, .01), absorbed: 0 } : null;
      try {
        // Punch-through: the same energy also loosens individual units around the
        // contact, so the impactor knocks bricks out instead of one rigid slab.
        if (response && !explicit) spendOnBonds(owned, local, reach, energy, true, response.punchBonds);
        if (response && !explicit && energy < response.clusterEnergyJ) {
          releaseMasonry(target.pieceIds.filter(id => id === closest || distanceToHull(local,geometry.get(id)) <= reach));
          return true;
        }
        const clusters = new Set([unitMap.get(closest).clusterId]);
        for (const id of target.pieceIds) if (!unitMap.get(id).miniParent && distanceToHull(local,geometry.get(id)) <= reach) clusters.add(unitMap.get(id).clusterId);
        releaseMasonry(target.pieceIds.filter(id => clusters.has(unitMap.get(id).clusterId)));
        return true;
      } finally {
        // The static wall stopped the impactor during the solve. Once it has opened a
        // breach, let it carry on with what an inelastic hit on the launched mass leaves.
        if (launch?.absorbed > 0 && source?.mass > 0) {
          const along = launch.direction, kept = launch.speed * launch.mass / (launch.mass + launch.absorbed);
          source.velocity.vadd(along.scale(kept - source.velocity.dot(along)), source.velocity); source.wakeUp();
        }
        launch = null;
      }
    }
    const reach = radius ?? (masonry ? Math.max(.18,masonry.pattern!=='running_bond'?masonry.settings.unitSizeM[0]*.6:0) : Math.max(.2, target.damageRadius));
    const fineEnabled = target.detached && !panel.internalBonds.some(b => b.alive && b.breakable !== false && b.fractureLevel !== 2 && owned.has(b.a) && owned.has(b.b));
    const affected = spendOnBonds(owned, local, reach, energy, fineEnabled, landing ? Math.max(0, response.maxGroups - panel.groups.length) : Infinity);
    if (affected.size) fracture(reason, [...affected]);
    return affected.size > 0;
  }

  function loadPlan(group) {
    if (group.loadPlan) return group.loadPlan;
    const owned = new Set(group.pieceIds), adjacent = new Map(group.pieceIds.map(id => [id, []])), seeds = new Set();
    for (const id of group.pieceIds) if (anchors.has(id)) seeds.add(id);
    for (const attachment of group.bearings) if (attachment.bond.alive) seeds.add(attachment.pieceId);
    for (const bond of group.bonds) if (bond.alive && bond.kind === 'tile') {
      const point = group.body.pointToLocalFrame(bond.joint.bodyA.pointToWorldFrame(bond.joint.pivotA)).vadd(v(group.assetCentre));
      seeds.add(group.pieceIds.reduce((best, id) => distanceToHull(point, geometry.get(id)) < distanceToHull(point, geometry.get(best)) ? id : best));
    }
    // In a freely moving compound this reference simply routes its balanced
    // inertial loads; it does not create a support, force, joint or world anchor.
    if (!seeds.size) seeds.add(group.pieceIds.reduce((best, id) => geometry.get(id).centre.distanceTo(v(group.assetCentre)) < geometry.get(best).centre.distanceTo(v(group.assetCentre)) ? id : best));
    for (const bond of panel.internalBonds) if (bond.alive && owned.has(bond.a) && owned.has(bond.b)) { adjacent.get(bond.a).push({ id: bond.b, bond }); adjacent.get(bond.b).push({ id: bond.a, bond }); }
    const distances = new Map([...seeds].map(id => [id, 0])), pending = [...seeds];
    for (let i = 0; i < pending.length; i++) for (const edge of adjacent.get(pending[i])) if (!distances.has(edge.id)) { distances.set(edge.id, distances.get(pending[i]) + 1); pending.push(edge.id); }
    const order = group.pieceIds.slice().sort((a, b) => distances.get(b) - distances.get(a)), routes = new Map();
    const loads = new Map(group.pieceIds.map(id => [id, new C.Vec3()])), edgeLoads = new Map(), offsets = new Map();
    for (const id of order) {
      const edges = adjacent.get(id).filter(edge => distances.get(edge.id) < distances.get(id)), total = edges.reduce((sum, edge) => sum + edge.bond.capacity, 0);
      for (const edge of edges) {
        if (!edgeLoads.has(edge.bond)) edgeLoads.set(edge.bond, new C.Vec3());
        edge.share = edge.bond.capacity / total; edge.parentLoad = loads.get(edge.id); edge.force = edgeLoads.get(edge.bond);
      }
      routes.set(id, edges); offsets.set(id, geometry.get(id).centre.vsub(v(group.assetCentre)));
    }
    return group.loadPlan = { order, routes, loads, edgeLoads, offsets, acceleration: new C.Vec3(), alpha: new C.Vec3(), offset: new C.Vec3(), spinCross: new C.Vec3(), centripetal: new C.Vec3(), force: new C.Vec3() };
  }

  function checkInternalLoads() {
    const failed = failedPieces, gravity = world.gravity.toString();
    failed.clear();
    for (const group of panel.groups) {
      if (group.pieceIds.length < 2) continue;
      const body = group.body;
      if (body.sleepState === C.Body.SLEEPING && group.loadValidated && group.loadGravity === gravity) continue;
      const owned = new Set(group.pieceIds), fineEnabled = group.detached && !panel.internalBonds.some(b => b.alive && b.breakable !== false && b.fractureLevel !== 2 && owned.has(b.a) && owned.has(b.b));
      const plan = loadPlan(group), { acceleration, alpha, loads, edgeLoads, offset, spinCross, centripetal, force } = plan;
      // A panel riding on anchored structure that a host moves as one block (a dynamic-frame zone) sees
      // the block's whole jolt at once, which no single fixing experiences: its bonds carry self-weight.
      const framed = body._structureFramed === true;
      if (group.previousVelocity && !framed) { body.velocity.vsub(group.previousVelocity, acceleration); acceleration.scale(1 / group.stepDt, acceleration); } else acceleration.setZero();
      if (group.previousSpin && !framed) { body.angularVelocity.vsub(group.previousSpin, alpha); alpha.scale(1 / group.stepDt, alpha); } else alpha.setZero();
      for (const load of edgeLoads.values()) load.setZero();
      for (const id of group.pieceIds) {
        const load = loads.get(id);
        body.quaternion.vmult(plan.offsets.get(id), offset); alpha.cross(offset, force);
        body.angularVelocity.cross(offset, spinCross); body.angularVelocity.cross(spinCross, centripetal);
        acceleration.vadd(force, load); load.vadd(centripetal, load); load.vsub(world.gravity, load); load.scale(geometry.get(id).mass, load);
      }
      for (const id of plan.order) {
        for (const edge of plan.routes.get(id)) {
          loads.get(id).scale(edge.share, force);
          edge.parentLoad.vadd(force, edge.parentLoad); edge.force.vadd(force, edge.force);
        }
      }
      for (const [bond, force] of edgeLoads) if (bond.breakable !== false && (bond.fractureLevel !== 2 || fineEnabled) && force.length() > bond.capacity) { bond.alive = false; bond.damageJ = bond.energyJ; failed.add(bond.a); failed.add(bond.b); }
      group.loadValidated = true; group.loadGravity = gravity;
    }
    if (failed.size) fracture('bond:force', [...failed]);
  }

  refreshDetached();
  return Object.assign(panel, {
    impact,
    masonrySupportState() { return {released, foundationAvailable: !foundationReleased}; },
    setMasonryGrounding(resolve) { masonryGrounding = resolve; },
    refreshMasonrySupport() {
      if (!masonryGrounding || !damageEnabled || !fractureEnabled || disposed) return;
      const grounded = masonryGrounding();
      if (supportOrder.some(u => !released.has(u.id) && !grounded.has(u.id))) releaseMasonry([], 'masonry:corner-support-lost');
    },
    addExternalBond(bond) { if (!panel.bonds.includes(bond)) panel.bonds.push(bond); panel.groups[0].bonds.push(bond); panel.groups[0].loadPlan = null; refreshDetached(); },
    finishSetup() { initializing = false; },
    beforeStep(dt) { if (!damageEnabled || !fractureEnabled) return; for (const group of panel.groups) if (group.pieceIds.length > 1) { group.previousVelocity ??= new C.Vec3(); group.previousSpin ??= new C.Vec3(); group.previousVelocity.copy(group.body.velocity); group.previousSpin.copy(group.body.angularVelocity); group.stepDt = dt; } },
    afterStep() {
      if (disposed || !damageEnabled || !fractureEnabled) { queued.length = 0; return; }
      let lost = false;
      for (const attachment of attachments) if (!attachment.disabled && attachment.bond.alive) {
        const equations = attachment.bond.joint.equations, force = Math.hypot(equations[0].multiplier, equations[1].multiplier, equations[2].multiplier);
        if (attachment.member.hinges?.some(h => h.broken) || attachment.member.broken > 0 || force > attachment.capacity) {
          attachment.disabled = true; removeBond(attachment.bond); lost = true;
        }
      }
      if (lost) fracture('bearing:lost');
      for (let i = 0; i < queued.length; i++) impact(queued[i]);
      queued.length = 0;
      if (masonry) {
        const due = miniClusters.filter(c => miniDue.has(c.id) && world.time >= miniDue.get(c.id) && c.unitIds.some(id => !released.has(id)));
        if (due.length) releaseMasonry(due.flatMap(c => c.unitIds), 'masonry:border-delayed');
      }
      if (!masonry) checkInternalLoads();
      refreshDetached();
    },
    shatter(details) {
      if (!damageEnabled || !fractureEnabled || disposed) return false;
      if (masonry && details?.energy == null) { foundationReleased = true; releaseMasonry(physicalIds,details?.reason ?? 'shatter'); return true; }
      if (details?.energy != null) return impact(details);
      let any = false;
      for (const b of panel.internalBonds) if (b.alive && b.breakable !== false && b.fractureLevel !== 2) { b.alive = false; b.damageJ = b.energyJ; any = true; }
      for (const attachment of attachments) { attachment.disabled = true; removeBond(attachment.bond); }
      if (any || !panel.broken) fracture(details?.reason ?? 'shatter');
      return any;
    },
    setFracture(enabled) { fractureEnabled = enabled; },
    setDamage(enabled) { damageEnabled = enabled; if (!enabled) queued.length = 0; },
    releaseFoundation() { if (masonry) { foundationReleased = true; releaseMasonry([], 'foundation:released'); } },
    retire(group) {
      if (!panel.groups.includes(group) || !group.detached || group.body.sleepState !== C.Body.SLEEPING || group.bonds.some(b => b.alive)) return null;
      group.body.island=null;
      world.removeBody(group.body);
      panel.groups.splice(panel.groups.indexOf(group),1);
      if (masonry && panel.body === group.body) panel.body = panel.groups[0]?.body ?? null;
      const entry={id:group.id,bodyId:group.body.id,panelId:panel.id,pieceIds:group.pieceIds.slice(),assetCentre:group.assetCentre.slice(),mass:group.mass,halfExtents:group.halfExtents.slice(),position:group.body.position.toArray(),quaternion:group.body.quaternion.toArray(),time:world.time};
      // Transfer authored collision children, preserving their COM-relative
      // offsets. A symmetric enclosing box can invent ledges around stepped
      // chunks and make the next sleeping piece appear suspended in mid-air.
      entry.physics={shapes:group.body.shapes.slice(),offsets:group.body.shapeOffsets.map(p=>p.clone()),orientations:group.body.shapeOrientations.map(q=>q.clone())};
      retiredGroups.set(entry,group);panel.frozen.push(entry); changed(); return entry;
    },
    reactivate(entry) {
      const group=retiredGroups.get(entry),index=panel.frozen.indexOf(entry);if(disposed||!group||index<0)return null;
      const body=group.body;body.position.copy(v(entry.position));body.quaternion.copy(new C.Quaternion(...entry.quaternion));body.velocity.setZero();body.angularVelocity.setZero();body.force.setZero();body.torque.setZero();
      for(const shape of body.shapes)shape.body=body;
      body.aabbNeedsUpdate=true;world.addBody(body);body.wakeUp();
      retiredGroups.delete(entry);panel.frozen.splice(index,1);panel.groups.push(group);if(!panel.body)panel.body=body;changed();return group;
    },
    discardFrozen(entry) { retiredGroups.delete(entry);const index=panel.frozen.indexOf(entry);if(index>=0){panel.frozen.splice(index,1);changed();} },
    dispose() { if (disposed) return; disposed = true; for (const bond of panel.bonds) removeBond(bond); for (const group of panel.groups) world.removeBody(group.body); retiredGroups.clear();queued.length = 0; },
  });
}
