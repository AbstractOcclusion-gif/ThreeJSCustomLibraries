// The character tool's action set and crouch: which action carries her, in what order they run, and when she is low.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionSet} from '../../src/character/actions/action-set.js';
import {createCrouch, CROUCH_DEFAULTS} from '../../src/character/crouch.js';

function action(log, name, carries = false) {
  return {state: 'free', carries, update(dt, input, step) { log.push(name); step?.(); return this.carries; }, reset() { this.state = 'free'; log.push(name + ':reset'); }};
}

test('the first action that holds her is the carrier, else the last one added', () => {
  const log = [], rope = action(log, 'rope'), ledge = action(log, 'ledge');
  const set = createActionSet().add('rope', rope).add('ledge', ledge);
  assert.equal(set.carrier, ledge);
  assert.ok(set.free);
  rope.state = 'rope';
  assert.equal(set.carrier, rope);
  assert.ok(!set.free);
});

test('an action that carries her stops the ones after it, and nothing takes her then', () => {
  const log = [], rope = action(log, 'rope', true), ledge = action(log, 'ledge');
  rope.state = 'rope';
  const set = createActionSet().add('rope', rope, {take: () => { log.push('take'); return true; }}).add('ledge', ledge);
  assert.equal(set.update(1 / 60, {}), 'rope');
  assert.deepEqual(log, ['rope']);
});

test('free, the last action steps her and the takes are tried in order until one catches her', () => {
  const log = [], rope = action(log, 'rope'), ladder = action(log, 'ladder'), ledge = action(log, 'ledge');
  const set = createActionSet()
    .add('rope', rope, {take: () => { log.push('take rope'); return true; }})
    .add('ladder', ladder, {take: () => { log.push('take ladder'); return true; }})
    .add('ledge', ledge, {input: intent => ({jump: intent.jump})});
  assert.equal(set.update(1 / 60, {jump: true}, () => log.push('step')), null);
  assert.deepEqual(log, ['rope', 'step', 'ladder', 'step', 'ledge', 'step', 'take rope']);
  set.reset();
  assert.deepEqual(log.slice(-3), ['rope:reset', 'ladder:reset', 'ledge:reset']);
});

test('an action without the contract is refused by name', () => {
  assert.throws(() => createActionSet().add('swim', {state: 'free', update() {}}), /"swim" has no reset/);
  assert.throws(() => createActionSet().add('swim', {update() {}, reset() {}}), /"swim" has no state/);
  const set = createActionSet().add('a', action([], 'a'));
  assert.throws(() => set.add('a', action([], 'a')), /already added/);
});

function body(standing) {
  return {height: standing, grounded: true, committed: 0, speed: 0, room: true, commits: [],
    setHeight(height) { if (height > this.height && !this.room) return false; this.height = height; return true; },
    commit(seconds, speed) { this.commits.push([seconds, speed]); }};
}

test('crouch lowers her, keeps her low under something, and stands her up with room', () => {
  const controller = body(1.75), crouch = createCrouch({controller, standing: 1.75});
  crouch.toggle(); crouch.update(1 / 60, true);
  assert.equal(controller.height, CROUCH_DEFAULTS.height);
  assert.ok(crouch.low);
  controller.room = false;
  crouch.toggle(); crouch.update(1 / 60, true);
  assert.ok(crouch.low, 'no room: she stays down');
  controller.room = true;
  crouch.toggle(); crouch.update(1 / 60, true);
  assert.ok(!crouch.low);
});

test('asked at a run she slides for the length given, then stands; carried, she is never low', () => {
  const controller = body(1.75), crouch = createCrouch({controller, standing: 1.75});
  controller.speed = 4.4;
  crouch.toggle({seconds: .5, speed: 4.7});
  assert.deepEqual(controller.commits, [[.5, 4.7]]);
  crouch.update(.25, true);
  assert.ok(crouch.sliding && crouch.low);
  crouch.update(.3, true);
  assert.ok(!crouch.sliding && !crouch.low);
  controller.speed = 0;
  crouch.toggle(); crouch.update(1 / 60, true);
  crouch.update(1 / 60, false);
  assert.ok(!crouch.low, 'something else carries her');
  assert.throws(() => createCrouch({controller, standing: 1.75, height: 2}), /under the standing height/);
});
