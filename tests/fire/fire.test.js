import test from 'node:test';
import assert from 'node:assert/strict';
import {createFireSystem} from '../../src/fire/index.js';

test('fire spreads one step at a time, runs out of fuel, and leaves distant objects alone', () => {
  const system = createFireSystem({spreadRadius: 2, maxCatchUp: Infinity});
  const position = x => ({x, y: 0, z: 0});
  const first = system.add({position: position(0), burnSeconds: 1, heatOutput: 8});
  const middle = system.add({position: position(1.5), ignitionHeat: 0.01});
  const last = system.add({position: position(3), ignitionHeat: 0.001});
  const distant = system.add({position: position(6)});
  assert.equal(first.ignite(), true);
  system.tick(1 / 30);
  assert.equal(middle.phase, 'burning');
  assert.equal(last.phase, 'unlit');
  system.tick(1 / 30);
  assert.equal(last.phase, 'burning');
  system.tick(11);
  assert.deepEqual([first.phase, middle.phase, last.phase], ['burned', 'burned', 'burned']);
  assert.equal(first.fuel, 0);
  assert.equal(first.ignite(), false);
  assert.equal(distant.heat, 0);
  system.reset();
  assert.deepEqual([first.phase, first.fuel, first.heat], ['unlit', 1, 0]);
});
