// The core Jolt host: boxes fall onto fixed scenery and rest on it, rays find what lies on their way, removed bodies are gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import initJolt from 'jolt-physics';
import {createJoltHost, JOLT_LAYERS} from '../../src/core/index.js';

const J = await initJolt();
const STEP = 1 / 60, SETTLE_STEPS = 240;   // 4 s of physics
const FLOOR = {halfExtents: [20, .5, 20], position: [0, -.5, 0]};   // top at y = 0
const SLOP = .03;   // m a resting body may sink: Jolt's penetration slop is 2 cm

test('a dynamic box falls onto fixed scenery and rests on it', () => {
  const host = createJoltHost(J);
  host.addBox(FLOOR);
  const box = host.addBox({halfExtents: [.5, .5, .5], position: [0, 4, 0], mass: 50});
  for (let i = 0; i < SETTLE_STEPS; i++) host.step(STEP);
  const position = {}, quaternion = {};
  host.readPose(box, position, quaternion);
  assert.ok(Math.abs(position.y - .5) < SLOP, `rests on the floor top: ${position.y}`);
  assert.ok(Math.abs(position.x) < .01 && Math.abs(position.z) < .01, 'falls straight down');
  host.dispose();
});

test('raycast finds the nearest hit with its normal, and nothing once the body is removed', () => {
  const host = createJoltHost(J);
  const floor = host.addBox(FLOOR);
  const hit = host.raycast({x: 1, y: 5, z: 2}, {x: 1, y: -5, z: 2});
  assert.ok(hit, 'the ray hits the floor');
  assert.ok(Math.abs(hit.point.y) < 1e-3 && Math.abs(hit.distance - 5) < 1e-3, `hits its top: ${hit.point.y}, ${hit.distance}`);
  assert.ok(hit.normal.y > .99, 'the normal points up');
  assert.equal(host.raycast({x: 1, y: 5, z: 2}, {x: 1, y: 2, z: 2}), null, 'a ray that stops short misses');
  host.remove(floor);
  assert.equal(host.raycast({x: 1, y: 5, z: 2}, {x: 1, y: -5, z: 2}), null, 'a removed body is not hit');
  host.dispose();
});

test('a body carried over the ground moves at the speed given and keeps to it', () => {
  const host = createJoltHost(J);
  host.addBox({halfExtents: [10, .5, 10], position: [0, -.5, 0]});
  const crate = host.addBox({halfExtents: [.5, .5, .5], position: [0, .5, 0], mass: 50});
  const at = {x: 0, y: 0, z: 0}, turn = {x: 0, y: 0, z: 0, w: 1}, step = 1 / 120;
  for (let i = 0; i < 120; i++) { host.setGroundVelocity(crate, 1, 0); host.step(step); }
  host.readPose(crate, at, turn);
  assert.ok(Math.abs(at.x - 1) < .05, 'one second at 1 m/s carries it 1 m, got ' + at.x);
  assert.ok(Math.abs(at.y - .5) < .02 && Math.abs(at.z) < .01, 'it stays on the ground and on its line');
  assert.ok(Math.abs(turn.w) > .999, 'it does not spin');
  host.dispose();
});

test('a kinematic box goes where the host takes it, at the pace of the steps', () => {
  const host = createJoltHost(J);
  const lift = host.addBox({halfExtents: [1, .1, 1], position: [0, 0, 0], kinematic: true});
  const at = {x: 0, y: 0, z: 0}, turn = {x: 0, y: 0, z: 0, w: 1}, step = 1 / 120;
  for (let i = 1; i <= 120; i++) { host.moveTo(lift, [0, i / 120, 0], step); host.step(step); }
  host.readPose(lift, at, turn);
  assert.ok(Math.abs(at.y - 1) < .01 && Math.abs(at.x) < 1e-6, 'it rose 1 m in a second, got ' + at.y);
  assert.throws(() => host.addBox({halfExtents: [1, 1, 1], mass: 5, kinematic: true}), /kinematic/);
  assert.throws(() => host.moveTo(lift, [0, 2, 0], 0), /step/);
  host.dispose();
});

test('the host exposes its layers and the native objects a tool builds on', () => {
  const host = createJoltHost(J);
  assert.deepEqual(host.layers, JOLT_LAYERS);
  assert.ok(host.jolt && host.system && host.bodies, 'interface, system and body interface');
  host.dispose();
});
