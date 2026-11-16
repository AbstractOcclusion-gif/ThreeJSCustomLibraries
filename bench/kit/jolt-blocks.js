// Boxes that are both scenery and physics, for the pages that stand a tool on the core Jolt host: each block becomes a
// body of the host and a mesh of the scene, from one description.
import * as THREE from 'three';

// blocks: [{halfExtents: [x, y, z], position: [x, y, z], pitch (rad about X, a ramp), mass (kg, 0 or absent = fixed),
// color}]. Returns {update() (moving blocks follow their bodies), dispose()}.
export function addJoltBlocks({host, scene, blocks, color, roughness = .9}) {
 const tilt = new THREE.Quaternion(), axis = new THREE.Vector3(1, 0, 0), materials = new Map(), moving = [], made = [];
 for (const {halfExtents, position, pitch = 0, mass = 0, color: own = color} of blocks) {
  tilt.setFromAxisAngle(axis, pitch);
  const body = host.addBox({halfExtents, position, quaternion: tilt.toArray(), mass});
  if (!materials.has(own)) materials.set(own, new THREE.MeshStandardMaterial({color: own, roughness}));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...halfExtents.map(half => half * 2)), materials.get(own));
  mesh.position.fromArray(position);
  mesh.quaternion.copy(tilt);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  made.push({body, mesh});
  if (mass > 0) moving.push({body, mesh});
 }
 return {
  update() { for (const {body, mesh} of moving) host.readPose(body, mesh.position, mesh.quaternion); },
  dispose() {
   for (const {body, mesh} of made) { host.remove(body); scene.remove(mesh); mesh.geometry.dispose(); }
   for (const material of materials.values()) material.dispose();
  },
 };
}
