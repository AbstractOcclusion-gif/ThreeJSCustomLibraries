// The character tool on the core Jolt host: it stands, walks where it is told, jumps and lands, and its hooks tell what
// it does to the ground; water slows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import initJolt from 'jolt-physics';
import {createJoltHost} from '../../src/core/index.js';
import {createCharacterController, CHARACTER_DEFAULTS} from '../../src/character/index.js';

const J = await initJolt();
const STEP = 1 / 60;
const FLOOR = {halfExtents: [40, .5, 40], position: [0, -.5, 0]};   // top at y = 0
function world(options = {}) {
  const host = createJoltHost(J);
  host.addBox(FLOOR);
  const controller = createCharacterController({J, jolt: host.jolt, layer: host.layers.moving, position: [0, .05, 0], ...options});
  const run = (seconds, input = {}) => {
    for (let t = 0; t < seconds; t += STEP) {
      controller.update(STEP, input);
      host.step(STEP);
    }
  };
  return {host, controller, run, dispose() { controller.dispose(); host.dispose(); }};
}

test('it stands on the ground', () => {
  const {controller, run, dispose} = world();
  run(1);
  assert.ok(controller.grounded, 'grounded');
  assert.ok(Math.abs(controller.position.y) < .05, `feet on the floor: ${controller.position.y}`);
  dispose();
});

test('it walks the way it is told, at its walking speed, and its strides reach the hooks', () => {
  const {controller, run, dispose} = world();
  const tracks = [];
  const stop = controller.subscribe(event => { if (event.type === 'character:track') tracks.push(event); });
  run(.5);
  const start = controller.position.z;
  run(3, {moveZ: 1});
  const covered = controller.position.z - start;
  assert.ok(covered > CHARACTER_DEFAULTS.walkSpeed * 2 && covered < CHARACTER_DEFAULTS.walkSpeed * 3.2, `walked ${covered} m in 3 s`);
  assert.ok(Math.abs(controller.position.x) < .05, 'straight along +Z');
  assert.ok(tracks.length >= 2, `strides told: ${tracks.length}`);
  assert.ok(Object.isFrozen(tracks[0]) || typeof tracks[0] === 'object');
  stop();
  dispose();
});

test('it jumps and lands, telling both', () => {
  const {controller, run, dispose} = world();
  const types = [];
  controller.subscribe(event => types.push(event.type));
  run(.5);
  // Held: the full jump (a tap is cut short, the variable jump height).
  let highest = 0;
  for (let i = 0; i < 40; i++) { run(STEP, {jump: true}); highest = Math.max(highest, controller.position.y); }
  for (let i = 0; i < 120; i++) { run(STEP); highest = Math.max(highest, controller.position.y); }
  const full = CHARACTER_DEFAULTS.jumpSpeed ** 2 / (2 * 9.81);
  assert.ok(highest > full * .8 && highest < full * 1.2, `rose ${highest} m, full jump ${full} m`);
  assert.ok(types.includes('character:jump') && types.includes('character:land'), `told: ${[...new Set(types)]}`);
  assert.ok(controller.grounded, 'back on the ground');
  dispose();
});

test('deep water slows it', () => {
  const dry = world();
  dry.run(.5); const dryStart = dry.controller.position.z; dry.run(2, {moveZ: 1, run: true});
  const dryCovered = dry.controller.position.z - dryStart; dry.dispose();
  const wet = world({waterLevelAt: () => 1});
  wet.run(.5); const wetStart = wet.controller.position.z; wet.run(2, {moveZ: 1, run: true});
  const wetCovered = wet.controller.position.z - wetStart; wet.dispose();
  assert.ok(wetCovered < dryCovered * .8, `wading ${wetCovered} m against ${dryCovered} m dry`);
});

test('braking stops it shorter than its acceleration alone', () => {
  const slide = options => {
    const {controller, run, dispose} = world(options);
    run(2, {moveZ: 1, run: true});
    const from = controller.position.z;
    run(1);
    const covered = controller.position.z - from;
    dispose();
    return covered;
  };
  const soft = slide(), hard = slide({braking: CHARACTER_DEFAULTS.acceleration * 3});
  assert.ok(hard < soft * .5, `slid ${hard} m against ${soft} m`);
});

test('with no air control a jump keeps its speed when the move is released, and a standing jump still travels', () => {
  const {controller, run, dispose} = world({airControl: 0, jumpLaunch: 2});
  run(2, {moveZ: 1, run: true});
  run(STEP, {moveZ: 1, run: true, jump: true});
  run(.3, {jump: true});
  assert.ok(!controller.grounded, 'airborne');
  assert.ok(controller.velocity.z > CHARACTER_DEFAULTS.runSpeed * .9, `kept ${controller.velocity.z} m/s in the air`);
  controller.teleport(0, .05, 0, 0);
  run(.5);
  run(STEP, {moveZ: 1, jump: true});
  run(.2, {jump: true});
  assert.ok(controller.velocity.z > 1.5 && controller.velocity.z <= 2.01, `standing jump launched at ${controller.velocity.z} m/s`);
  dispose();
});

test('turn coupling slows it into a turn-around instead of sliding backwards; a hard landing costs speed', () => {
  const {controller, run, dispose} = world({turnCoupling: 1, landingLoss: 1, landingSoft: 1, landingHard: 2});
  run(2, {moveZ: 1, run: true});
  run(2 * STEP, {moveZ: -1, run: true});
  assert.ok(controller.velocity.z > 0 && controller.velocity.z < CHARACTER_DEFAULTS.runSpeed, `still going forward, slower: ${controller.velocity.z}`);
  run(1.5, {moveZ: -1, run: true});
  assert.ok(controller.velocity.z < -CHARACTER_DEFAULTS.runSpeed * .9, 'then runs the other way');
  run(STEP, {moveZ: -1, run: true, jump: true});
  let landing = Infinity;
  for (let t = 0; t < 2 && landing === Infinity; t += STEP) {
    const was = controller.grounded;
    run(STEP, {moveZ: -1, run: true, jump: true});
    if (!was && controller.grounded) landing = Math.abs(controller.velocity.z);
  }
  assert.ok(landing < .2, `landed at ${landing} m/s over the ground`);
  dispose();
});

test('it tells how hard it lands and how long it was in the air; a commit takes the controls away', () => {
  const {controller, run, dispose} = world();
  run(.5);
  controller.teleport(0, 3, 0, 0);
  let landed = 0, longest = 0;
  for (let t = 0; t < 2; t += STEP) { run(STEP); landed = Math.max(landed, controller.landed); longest = Math.max(longest, controller.airTime); }
  assert.ok(landed > 5 && landed < 9, `landed at ${landed} m/s from 3 m`);
  assert.ok(longest > .5 && controller.airTime === 0 && controller.landed === 0, `air time ${longest} s, cleared on the ground`);
  controller.commit(.5);
  run(.4, {moveZ: 1, run: true, jump: true});
  assert.ok(controller.grounded && Math.abs(controller.position.z) < .01, 'held still, no jump');
  controller.commit(.5, 2);
  const from = controller.position.z;
  run(.5, {moveX: 1});
  assert.ok(controller.position.z - from > .7 && Math.abs(controller.position.x) < .01, 'travels the way it faces whatever is asked');
  run(.2);
  assert.equal(controller.committed, 0);
  dispose();
});

test('with turnFirst it turns on the spot before setting off the other way, at its standing turn speed', () => {
  const {controller, run, dispose} = world({turnFirst: .6, standTurnSpeed: 4});
  run(.5);
  run(.3, {moveZ: -1});
  assert.ok(controller.rooted, 'still turning');
  assert.ok(Math.abs(controller.position.z) < .01 && Math.abs(controller.position.x) < .01, 'has not moved yet');
  assert.ok(Math.abs(Math.abs(controller.heading) - 1.2) < .15, `turned ${controller.heading} rad in 0.3 s`);
  run(1.2, {moveZ: -1});
  assert.ok(!controller.rooted && controller.position.z < -.5, 'then walks off');
  dispose();
});

test('launched in the air with no air control, it keeps the speed it was given over the ground', () => {
  const {controller, run, dispose} = world({airControl: 0});
  controller.teleport(0, 3, 0, 0);
  controller.launch(2, 1, -3);
  run(.3);
  assert.equal(controller.grounded, false);
  assert.ok(Math.abs(controller.velocity.x - 2) < .05 && Math.abs(controller.velocity.z + 3) < .05, 'it kept its speed over the ground');
  assert.ok(Math.abs(controller.position.x - .6) < .08 && Math.abs(controller.position.z + .9) < .08, 'and travelled with it');
  assert.throws(() => controller.launch(NaN, 0, 0));
  dispose();
});

test('it lowers its capsule to pass under what it cannot stand under, and only stands up where there is room', () => {
  const scene = world();
  // A slab 1.2 m over the floor, from z = 2 to z = 6.
  scene.host.addBox({halfExtents: [3, .2, 2], position: [0, 1.4, 4]});
  scene.run(.5);
  scene.run(4, {moveZ: 1});
  assert.ok(scene.controller.position.z < 2, 'standing, the slab stops it: z = ' + scene.controller.position.z);
  assert.equal(scene.controller.setHeight(1), true, 'it can always lower itself');
  assert.equal(scene.controller.height, 1);
  scene.run(1.2, {moveZ: 1});
  assert.ok(scene.controller.position.z > 2.5 && scene.controller.position.z < 5.5, 'crouched, it goes under: z = ' + scene.controller.position.z);
  assert.equal(scene.controller.setHeight(CHARACTER_DEFAULTS.height), false, 'under the slab there is no room to stand');
  assert.equal(scene.controller.height, 1, 'so it stays low');
  scene.run(4, {moveZ: 1});
  assert.ok(scene.controller.position.z > 6.5, 'it comes out the far side');
  assert.equal(scene.controller.setHeight(CHARACTER_DEFAULTS.height), true, 'and stands up again in the open');
  assert.ok(Math.abs(scene.controller.position.y) < .05, 'its feet stayed on the floor');
  assert.throws(() => scene.controller.setHeight(.4), /height/);
  scene.dispose();
});
