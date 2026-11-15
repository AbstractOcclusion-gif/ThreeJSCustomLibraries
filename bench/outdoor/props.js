import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {createInteraction} from '../../src/interaction/index.js';
import {LeavedTrees} from '../../src/trees/index.js';

const GATE = {x: 0, z: 5, width: 2, height: 1.15, depth: .16};
const TREE = {x: -2, z: 8, h: 4, r: 1.4, trunk: .17, stump: .38, mass: 24};
const LEAF_TINT = new THREE.Color('#609846').toArray();
const REACH = 2.2;

export function createOutdoorProps({scene, world, field, stage, actor, prompt}) {
 const interaction = createInteraction(), wood = new THREE.MeshStandardMaterial({color: 0x795033});
 function solid(geometry, shape, x, y, z, mass = 0) {
  const mesh = new THREE.Mesh(geometry, wood);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const body = new CANNON.Body({mass, shape, position: new CANNON.Vec3(x, y, z)});
  world.addBody(body);
  return {mesh, body};
 }
 const gateY = field.heightAt(GATE.x, GATE.z);
 const panel = solid(new THREE.BoxGeometry(GATE.width, GATE.height, GATE.depth),
  new CANNON.Box(new CANNON.Vec3(GATE.width / 2, GATE.height / 2, GATE.depth / 2)),
  GATE.x, gateY + GATE.height / 2, GATE.z);
 const treeY = field.heightAt(TREE.x, TREE.z);
 const standing = new LeavedTrees({scene, lighting: stage.lighting});
 standing.setEnvironment(stage.environment);
 const standingPlacement = {...TREE, y: treeY, variant: 0, yaw: 0, tint: LEAF_TINT};
 standing.place([standingPlacement]);
 const trunkShape = height => new CANNON.Cylinder(TREE.trunk, TREE.trunk, height, 10);
 const standingBody = new CANNON.Body({shape: trunkShape(TREE.h), position: new CANNON.Vec3(TREE.x, treeY + TREE.h / 2, TREE.z)});
 world.addBody(standingBody);
 const up = new THREE.Vector3(0, 1, 0);
 let open = false, stump, fallen, crown, pivot;
 const distance = (x, z) => Math.hypot(actor.position.x - x, actor.position.z - z);
 function setGate(next) {
  // Keep a closing gate from overlapping the player in the doorway.
  if (!next && Math.abs(actor.position.x - GATE.x) < GATE.width / 2 + .35 && Math.abs(actor.position.z - GATE.z) < .45) return;
  open = next;
  panel.mesh.rotation.y = open ? Math.PI / 2 : 0;
  panel.mesh.position.x = GATE.x - (open ? GATE.width / 2 : 0);
  panel.mesh.position.z = GATE.z - (open ? GATE.width / 2 : 0);
  panel.body.position.copy(panel.mesh.position);
  panel.body.quaternion.copy(panel.mesh.quaternion);
  panel.body.aabbNeedsUpdate = true;
 }
 function fell() {
  if (fallen) return;
  standing.place([]);
  world.removeBody(standingBody);
  stump = solid(new THREE.CylinderGeometry(TREE.trunk, TREE.trunk, TREE.stump, 10),
   trunkShape(TREE.stump), TREE.x, treeY + TREE.stump / 2, TREE.z);
  const height = TREE.h - TREE.stump;
  fallen = new CANNON.Body({mass: TREE.mass, shape: trunkShape(height), angularDamping: .5,
   position: new CANNON.Vec3(TREE.x, treeY + TREE.stump + height / 2, TREE.z)});
  const away = new THREE.Vector3(TREE.x - actor.position.x, 0, TREE.z - actor.position.z).normalize();
  if (away.lengthSq() === 0) away.z = 1;
  const axis = new THREE.Vector3().crossVectors(up, away);
  fallen.quaternion.setFromAxisAngle(new CANNON.Vec3(...axis), .14);
  fallen.position.x += away.x * Math.sin(.14) * height / 2;
  fallen.position.z += away.z * Math.sin(.14) * height / 2;
  fallen.position.y = treeY + TREE.stump + Math.cos(.14) * height / 2;
  fallen.angularVelocity.set(axis.x, axis.y, axis.z);
  world.addBody(fallen);
  pivot = new CANNON.PointToPointConstraint(stump.body, new CANNON.Vec3(0, TREE.stump / 2, 0),
   fallen, new CANNON.Vec3(0, -height / 2, 0));
  pivot.collideConnected = false;
  world.addConstraint(pivot);
  crown = new LeavedTrees({scene, lighting: stage.lighting, leafTexture: standing.leafTexture,
   leafRect: standing.leafRect, barkTexture: standing.leafTexture, leafLuminance: standing.leafLuminance});
  crown.setEnvironment(stage.environment);
  crown.place([{x: 0, y: -height / 2, z: 0, h: height, r: TREE.r, variant: 0, yaw: 0, tint: LEAF_TINT}]);
 }
 interaction.register('gate', {prompt: 'Gate', activate: () => setGate(!open)});
 interaction.register('tree', {prompt: 'Fell tree', activate: fell});
 return {
  press() { interaction.press(); },
  release() { interaction.release(); },
  update(dt, enabled) {
   const gateDistance = distance(GATE.x, GATE.z), treeDistance = fallen ? Infinity : distance(TREE.x, TREE.z);
   interaction.focus(!enabled || Math.min(gateDistance, treeDistance) > REACH ? null : gateDistance < treeDistance ? 'gate' : 'tree');
   const id = interaction.status?.id;
   const message = id === 'gate' ? (open ? 'E · Close gate' : 'E · Open gate') : id === 'tree' ? 'E · Fell tree' : '';
   if (prompt.textContent !== message) prompt.textContent = message;
   standing.update(dt);
   if (fallen) {
    crown.group.position.copy(fallen.position);
    crown.group.quaternion.copy(fallen.quaternion);
    crown.update(dt);
   }
  },
  reset() {
   interaction.cancel();
   setGate(false);
   if (!fallen) return;
   world.removeConstraint(pivot);
   world.removeBody(fallen);
   world.removeBody(stump.body);
   stump.mesh.removeFromParent();
   stump.mesh.geometry.dispose();
   crown.dispose();
   stump = fallen = crown = pivot = undefined;
   world.addBody(standingBody);
   standing.place([standingPlacement]);
  },
  dispose() {
   crown?.dispose();
   standing.dispose();
  },
 };
}
