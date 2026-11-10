import {Body, Box, Cylinder, Sphere, Vec3, World} from 'cannon-es';
import {BoxGeometry, Mesh, MeshStandardMaterial, SphereGeometry} from 'three';
import {createTerrainCollider} from '../terrain/heightfield.js';

export function createRollingBodies({scene, field, onContact}) {
  const world = new World({gravity: new Vec3(0, -9.82, 0), allowSleep: true});
  world.defaultContactMaterial.friction = .35;
  world.defaultContactMaterial.restitution = .38;
  const ground = createTerrainCollider(field);
  world.addBody(ground);
  const sphereGeometry = new SphereGeometry(1, 24, 16);
  const boxGeometry = new BoxGeometry(2, 2, 2);
  const material = new MeshStandardMaterial({color: 0xd9b36a, roughness: .6});
  const bodies = new Map();
  const trunks = [];

  function remove(body) {
    bodies.get(body).mesh.removeFromParent();
    bodies.delete(body);
    world.removeBody(body);
  }

  world.addEventListener('postStep', () => {
    const contacts = new Map();
    for (const contact of world.contacts) {
      if (!contact.enabled || contact.multiplier <= 0) continue;
      const body = contact.bi === ground ? contact.bj : contact.bj === ground ? contact.bi : null;
      if (!bodies.has(body)) continue;
      if (!contacts.has(body)) contacts.set(body, []);
      contacts.get(body).push(contact);
    }
    for (const [body, entry] of bodies) {
      const hits = contacts.get(body);
      if (!hits) { entry.last = null; continue; }
      const point = {x: body.position.x, z: body.position.z};
      const distance = entry.last ? Math.hypot(point.x - entry.last.x, point.z - entry.last.z) : Infinity;
      if (distance < .2) continue;
      const continuous = distance < Math.max(.4, 2 * body.boundingRadius);
      const dx = continuous ? entry.last.x - point.x : 0;
      const dz = continuous ? entry.last.z - point.z : 0;
      for (const hit of hits) {
        const groundFirst = hit.bi === ground;
        const offset = groundFirst ? hit.ri : hit.rj;
        // Cannon can report a convex proxy for a box on a heightfield.
        const shape = body.shapes.length === 1 ? body.shapes[0] : groundFirst ? hit.sj : hit.si;
        const to = {x: ground.position.x + offset.x, z: ground.position.z + offset.z};
        onContact({x: to.x + dx, z: to.z + dz}, to, shape);
      }
      entry.last = point;
    }
  });

  function add(body, mesh) {
    if (bodies.size >= 8) remove(bodies.keys().next().value);
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    mesh.castShadow = true;
    scene.add(mesh);
    bodies.set(body, {mesh, last: null});
    world.addBody(body);
    return body;
  }

  return {
    add,
    setTrunks(trees) {
      for (const body of trunks) world.removeBody(body);
      trunks.length = 0;
      const {trunk, crown} = trees.profile;
      if (!trunk.enabled) return;
      for (const {x, z, h, r} of trees.items) {
        const top = h * (1 - crown.depth + crown.depth * trunk.topIntoCrown);
        const bottom = -h * trunk.belowGround;
        const shape = new Cylinder(r * trunk.radiusTop, r * trunk.radiusBottom, top - bottom, trunk.sides);
        const body = new Body({mass: 0, shape, position: new Vec3(x, field.heightAt(x, z) + (top + bottom) * .5, z)});
        trunks.push(body);
        world.addBody(body);
      }
    },
    launch({x, z, radius, speed, box = false}) {
      const shape = box ? new Box(new Vec3(radius, radius * .65, radius)) : new Sphere(radius);
      const body = new Body({
        mass: 22, shape, linearDamping: .14, angularDamping: .12,
        position: new Vec3(x, field.heightAt(x, z) + radius + .08, z),
        velocity: new Vec3(-speed, 0, 0), angularVelocity: new Vec3(0, 0, box ? 0 : speed / radius),
      });
      const mesh = new Mesh(box ? boxGeometry : sphereGeometry, material);
      mesh.scale.set(radius, box ? radius * .65 : radius, radius);
      return add(body, mesh);
    },
    update(dt) {
      if (!bodies.size) return;
      world.step(1 / 120, dt, 6);
      for (const [body, {mesh}] of bodies) {
        if (body.position.y < -12) { remove(body); continue; }
        mesh.position.copy(body.interpolatedPosition);
        mesh.quaternion.copy(body.interpolatedQuaternion);
      }
    },
  };
}
