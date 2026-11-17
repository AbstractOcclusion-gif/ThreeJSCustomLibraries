// The vehicle tool on the core Jolt host: it settles on its wheels, drives under throttle, slows when let go, and its
// hook tells where its wheels roll.
import test from 'node:test';
import assert from 'node:assert/strict';
import initJolt from 'jolt-physics';
import {createJoltHost} from '../../src/core/index.js';
import {createVehicle} from '../../src/vehicle/index.js';

const J = await initJolt();
const STEP = 1 / 60;
const FLOOR = {halfExtents: [200, .5, 200], position: [0, -.5, 0]};   // top at y = 0
const CHASSIS = {halfExtents: [.9, .25, 2.1], mass: 1500, drop: 1.2};   // m, kg, m above the floor
function world() {
  const host = createJoltHost(J);
  host.addBox(FLOOR);
  const body = host.addBox({halfExtents: CHASSIS.halfExtents, position: [0, CHASSIS.drop, 0], mass: CHASSIS.mass});
  const vehicle = createVehicle({J, jolt: host.jolt, body, layer: host.layers.moving});
  const position = {}, quaternion = {};
  const run = (seconds, input = {}) => {
    for (let t = 0; t < seconds; t += STEP) {
      vehicle.update(input);
      host.step(STEP);
      vehicle.readWheels();
    }
    host.readPose(body, position, quaternion);
    return position;
  };
  return {vehicle, run, dispose() { vehicle.dispose(); host.dispose(); }};
}

test('it settles on its four wheels', () => {
  const {vehicle, run, dispose} = world();
  const at = run(3);
  assert.equal(vehicle.wheels.length, 4);
  assert.ok(vehicle.wheels.every(wheel => wheel.grounded), 'all four wheels on the ground');
  assert.ok(at.y > 0 && at.y < CHASSIS.drop, `chassis held above the floor: ${at.y}`);
  assert.ok(Math.abs(vehicle.speed) < .1, 'at rest');
  dispose();
});

test('it drives under throttle, slows when let go, and tells its wheel tracks', () => {
  const {vehicle, run, dispose} = world();
  let tracks = 0;
  const stop = vehicle.subscribe(event => { if (event.type === 'vehicle:track') tracks++; });
  run(2);
  const start = {...run(0)};
  run(4, {throttle: 1});
  const fast = vehicle.speed, moved = run(0);
  assert.ok(fast > 5, `speed after 4 s: ${fast} m/s`);
  assert.ok(Math.hypot(moved.x - start.x, moved.z - start.z) > 8, 'it moved');
  assert.ok(tracks > 10, `track events: ${tracks}`);
  run(4);
  assert.ok(vehicle.speed < fast * .7, `coasting slows it: ${vehicle.speed} from ${fast}`);
  stop();
  dispose();
});
