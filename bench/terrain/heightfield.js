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
