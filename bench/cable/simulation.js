import * as C from 'cannon-es';
import {createCable} from '../../src/cable/index.js';
import {BENCH_WORLD, SETUPS} from './setups.js';

const vector = values => new C.Vec3(...values);

export function createCableSetup(settings) {
  const setup = SETUPS[settings.setup];
  const world = new C.World({gravity: new C.Vec3(0, BENCH_WORLD.gravity, 0)});
  world.solver.iterations = BENCH_WORLD.solverIterations;
  const ground = new C.Body({shape: new C.Plane()});
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  const bodies = new Map((setup.bodies ?? []).map(spec => {
    const body = new C.Body({mass: spec.mass ?? 0, position: vector(spec.position), fixedRotation: spec.fixedRotation ?? false});
    if (spec.boxes) {
      for (const {size, offset} of spec.boxes) body.addShape(new C.Box(vector(size).scale(.5)), vector(offset));
    } else {
      body.addShape(new C.Cylinder(spec.radius, spec.radius, spec.height, BENCH_WORLD.postSides));
    }
    world.addBody(body);
    return [spec.name, {body, spec}];
  }));
  const cables = setup.ropes(settings).map(spec => {
    const endpoints = spec.endpoints.map(end => end.kind === 'body'
      ? {kind: 'body', body: bodies.get(end.name).body, localPoint: end.localPoint}
      : end);
    const [start, end] = endpoints.map(endpoint => endpoint.kind === 'body'
      ? endpoint.body.pointToWorldFrame(vector(endpoint.localPoint)) : vector(endpoint.position));
    const length = start.distanceTo(end) * (spec.slack ?? settings.slack);
    return createCable({world, endpoints, length, preset: settings.preset,
      breakStrength: settings.breakStrength, segments: settings.segments});
  });
  const owners = new Map(cables.flatMap(cable => cable.links.map(({body}) => [body, cable])));
  const objects = new Set([...bodies.values()].map(({body}) => body));
  const drive = setup.drive;
  const drivenCable = drive && cables[drive.cable];
  const starts = drive?.ends.map(end => drivenCable.attachments[end].body.position.clone());
  const offset = drive && vector(drive.offset);
  const moved = new C.Vec3();
  let stroke = 0;
  let ropeContacts = 0;
  let objectContacts = 0;

  return {
    world, cables, bodies, setup,
    get readings() {
      const gate = setup.gate && bodies.get(setup.gate.body).body;
      const height = gate?.position.y;
      const twist = setup.action?.angularVelocity && bodies.get(setup.action.body).body.angularVelocity.y;
      return {
        ropeContacts, objectContacts, height, twist,
        gateOpen: gate && height >= setup.gate.clearHeight && Boolean(drivenCable.attachments[0] && drivenCable.attachments[1]),
      };
    },
    step(dt) {
      if (drive && settings.pull !== stroke) {
        const delta = settings.pull - stroke;
        stroke += Math.sign(delta) * Math.min(Math.abs(delta), BENCH_WORLD.strokePerSecond * dt);
        drive.ends.forEach((end, index) => {
          if (!drivenCable.attachments[end]) return;
          starts[index].vadd(offset.scale(stroke, moved), moved);
          drivenCable.moveEndpoint(end, moved.toArray());
        });
      }
      for (const cable of cables) cable.beforeStep(dt);
      world.step(dt);
      for (const cable of cables) cable.afterStep(dt);
      for (const {bi, bj} of world.contacts) {
        const a = owners.get(bi), b = owners.get(bj);
        if (a && b && a !== b) ropeContacts++;
        if ((a && objects.has(bj)) || (b && objects.has(bi))) objectContacts++;
      }
    },
    act() {
      const {body: name, impulse, angularVelocity} = setup.action;
      const {body} = bodies.get(name);
      body.wakeUp();
      if (impulse) body.applyImpulse(vector(impulse));
      if (angularVelocity) body.angularVelocity.set(...angularVelocity);
    },
    dispose() {
      for (const cable of cables) cable.dispose();
      for (const {body} of bodies.values()) world.removeBody(body);
      world.removeBody(ground);
    },
  };
}
