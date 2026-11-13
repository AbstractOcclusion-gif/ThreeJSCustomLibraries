import {Body, Heightfield, Vec3} from 'cannon-es';

export function createTerrainCollider(field) {
 const {data, width, height} = field.heightMap.image;
 const shape = new Heightfield(Array.from({length: height}, (_, z) => Array.from(data.subarray(z * width, (z + 1) * width))), {
  elementSize: field.bounds.z / (width - 1),
  minValue: field.geometry.boundingBox.min.y,
  maxValue: field.geometry.boundingBox.max.y,
 });
 const body = new Body({mass: 0, shape, position: new Vec3(field.bounds.x, 0, field.bounds.y)});
 // Cannon's local X/Y follow world Z/X, preserving the render mesh's triangle diagonals.
 body.quaternion.setFromAxisAngle(new Vec3(1, 1, 1).unit(), -2 * Math.PI / 3);
 return body;
}

// Coarse ground for bodies that leave the field: a square of the world's relief around a point, sampled every `cell`
// m. Samples inside `hole` ({x, z, size}: the field) are sunk by `sink` m, so the field's own collider carries the
// bodies there and its edge meets this one at the same height. `lift` raises it all (lying snow).
export function createSurroundCollider({heightAt, center, size, cell, hole, sink, lift = 0}) {
 const count = Math.round(size / cell) + 1;
 const originX = Math.round((center.x - size / 2) / cell) * cell, originZ = Math.round((center.z - size / 2) / cell) * cell;
 let low = Infinity, high = -Infinity;
 const data = Array.from({length: count}, (_, row) => Array.from({length: count}, (_, column) => {
  const x = originX + column * cell, z = originZ + row * cell;
  const inside = hole && x > hole.x && x < hole.x + hole.size && z > hole.z && z < hole.z + hole.size;
  const height = heightAt(x, z) + lift - (inside ? sink : 0);
  low = Math.min(low, height); high = Math.max(high, height);
  return height;
 }));
 const body = new Body({mass: 0, shape: new Heightfield(data, {elementSize: cell, minValue: low, maxValue: high}), position: new Vec3(originX, 0, originZ)});
 body.quaternion.setFromAxisAngle(new Vec3(1, 1, 1).unit(), -2 * Math.PI / 3);
 return {body, low,
  // Distance from a point to the nearest edge; negative outside.
  inset: (x, z) => Math.min(x - originX, originX + size - x, z - originZ, originZ + size - z)};
}
