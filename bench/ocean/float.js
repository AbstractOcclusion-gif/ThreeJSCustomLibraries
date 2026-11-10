import * as THREE from 'three';
import {Body, Box, Vec3, World} from 'cannon-es';
import {Buoyancy, SphereInteractor, SurfaceProbes} from '../../src/water/index.js';
import {SprayPump} from '../../src/particles/water/index.js';

// Translate WebAquarium's acceleration-based body interface into Cannon forces.
function cannonBody(body) {
 const force = new Vec3(), point = new Vec3(), result = new Vec3();
 const rotation = new THREE.Quaternion(), inverse = new THREE.Quaternion();
 const angular = new THREE.Vector3();
 return {
  velocity: body.velocity,
  angularVelocity: body.angularVelocity,
  localToWorldPoint(local, out) {
   body.pointToWorldFrame(point.copy(local), result);
   return out.copy(result);
  },
  localToWorldDirection(local, out) { return out.copy(local).applyQuaternion(rotation.copy(body.quaternion)); },
  worldToLocalDirection(world, out) { return out.copy(world).applyQuaternion(inverse.copy(body.quaternion).invert()); },
  getPointVelocity(world, out) {
   body.getVelocityAtWorldPoint(point.copy(world), result);
   return out.copy(result);
  },
  addForce(acceleration) { body.applyForce(force.copy(acceleration).scale(body.mass, force)); },
  addForceAtPosition(acceleration, position) {
   point.set(position.x - body.position.x, position.y - body.position.y, position.z - body.position.z);
   body.applyForce(force.copy(acceleration).scale(body.mass, force), point);
  },
  addTorque(acceleration) {
   rotation.copy(body.quaternion);
   inverse.copy(rotation).invert();
   angular.copy(acceleration).applyQuaternion(inverse).multiply(body.inertia).applyQuaternion(rotation);
   body.applyTorque(force.copy(angular));
  },
 };
}

export function createOceanFloat(scene, ocean, emitSplash) {
 const world = new World({gravity: new Vec3(0, -9.81, 0)});
 const size = new THREE.Vector3(2.1, 1.2, 2.6), half = size.clone().multiplyScalar(.5);
 const body = new Body({mass: 15, shape: new Box(new Vec3(half.x, half.y, half.z))});
 const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z),
  new THREE.MeshStandardMaterial({color: 0xf1a240, roughness: .7}));
 mesh.visible = false;
 scene.add(mesh);
 const adapter = cannonBody(body);
 const buoyancy = new Buoyancy(adapter, new THREE.Vector3(), size, {}, 1,
  count => new SurfaceProbes(ocean.fft, count));
 const interactor = new SphereInteractor(mesh, new THREE.Vector3(0, 0, half.z), half,
  {radius: .55, strength: .8, wakeFadeSpeed: 4});
 const pump = new SprayPump(adapter, [{outwardLocal: new THREE.Vector3(0, 0, 1)}], {continuous: false}, emitSplash);
 const direction = new THREE.Vector3();
 let active = false, accumulator = 0, mode = 'sphere', removeFootprint;
 function syncFootprint() {
  if (active && mode === 'footprint') {
   removeFootprint ??= ocean.obstacles.add(mesh.geometry, mesh, () => {
    const sample = buoyancy.extraSample(0);
    return sample.valid ? sample.height : undefined;
   });
  } else if (removeFootprint) {
   removeFootprint();
   removeFootprint = undefined;
  }
 }
 return {
  get active() { return active; },
  get submergedFraction() { return buoyancy.submergedFraction; },
  setMode(value) {
   mode = value;
   interactor.primed = false;
   syncFootprint();
  },
  drop(camera) {
   camera.getWorldDirection(direction);
   body.position.set(camera.position.x + direction.x * 13, 2.8, camera.position.z + direction.z * 13);
   body.velocity.set(direction.x * 1.5, 0, direction.z * 1.5);
   body.angularVelocity.set(0, .1, 0);
   body.quaternion.setFromEuler(.12, Math.atan2(direction.x, direction.z), -.1);
   if (!active) world.addBody(body);
   active = mesh.visible = true;
   accumulator = 0;
   interactor.primed = false;
   mesh.position.copy(body.position);
   mesh.quaternion.copy(body.quaternion);
   syncFootprint();
  },
  step(dt) {
   if (!active) return;
   buoyancy.probes.collect();
   accumulator += dt;
   const fixed = 1 / 120;
   while (accumulator >= fixed) {
    buoyancy.step();
    world.step(fixed);
    accumulator -= fixed;
   }
   mesh.position.copy(body.position);
   mesh.quaternion.copy(body.quaternion);
   const sample = buoyancy.extraSample(0);
   if (mode === 'sphere') interactor.update(ocean.wake, dt, sample.valid ? sample.height : undefined);
   pump.step(dt, () => sample, (_, out) => mesh.localToWorld(out.copy(interactor.centerOffset)), body.angularVelocity.y * 180 / Math.PI);
  },
  issue(time, cameraPosition) {
   if (!active) return;
   buoyancy.updateProbePoints();
   mesh.localToWorld(buoyancy.extraProbe(0).copy(interactor.centerOffset));
   buoyancy.probes.issue(time, cameraPosition);
  },
  dispose() {
   removeFootprint?.();
   buoyancy.dispose();
   if (active) world.removeBody(body);
   scene.remove(mesh);
   mesh.geometry.dispose();
   mesh.material.dispose();
  },
 };
}
