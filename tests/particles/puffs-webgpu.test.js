import test from 'node:test';
import assert from 'node:assert/strict';
import * as Three from 'three';
import {createPuffs} from '../../src/particles/puffs.js';
import {EMIT_DEFAULTS, PRESETS, RING_FRAMES, emitSettings, planBurst} from '../../src/particles/puff-config.js';
import {createSlots, writePuff, uploadSlots, killAll, PUFF_ROWS, ROW_SIZE, DEAD} from '../../src/particles/webgpu/slots.js';

const loadTexture = async () => {
  const texture = new Three.Texture();
  texture.image = {width: 64, height: 64};
  return texture;
};

test('emit settings: dust falls and is fainter, other masks hang; call options win', () => {
  assert.deepEqual(emitSettings('dust'), {gravity: EMIT_DEFAULTS.dustGravity, grow: EMIT_DEFAULTS.grow, peak: EMIT_DEFAULTS.dustOpacity, aspect: 1, fadeIn: 0, wind: 1});
  assert.equal(emitSettings('smoke').gravity, EMIT_DEFAULTS.gravity);
  assert.equal(emitSettings('smoke').peak, EMIT_DEFAULTS.opacity);
  assert.deepEqual(emitSettings('dust', {gravity: -1, grow: 2, opacity: .3, aspect: .5, fadeIn: .2, wind: .4}),
    {gravity: -1, grow: 2, peak: .3, aspect: .5, fadeIn: .2, wind: .4});
});

test('a burst plans its ring then its cloud, cycling the ring frames', () => {
  const calls = [];
  planBurst(2, PRESETS.mortar, (...args) => calls.push(args));
  assert.equal(calls.length, PRESETS.mortar.ring.count + 1);
  assert.deepEqual(calls.slice(0, -1).map(call => call[4]), calls.slice(0, -1).map((_, i) => i % RING_FRAMES));
  const cloud = calls.at(-1);
  assert.equal(cloud[0], 'dust-soft');
  assert.deepEqual(cloud[1], [0, PRESETS.mortar.cloud.up, 0]);
  assert.equal(cloud[2], 2 * PRESETS.mortar.cloud.scale);
  assert.equal(PRESETS.smoke.cloud, undefined);
});

test('WebGL puffs still emit presets from the shared config', async () => {
  const scene = new Three.Scene();
  const puffs = await createPuffs(scene, {pool: 16, loadTexture});
  puffs.mortar(new Three.Vector3(), 1);
  assert.equal(puffs.active, PRESETS.mortar.ring.count + 1);
  puffs.update(PRESETS.mortar.cloud.life + .01);
  assert.equal(puffs.active, 0);
  puffs.dispose();
});

test('slots: first free slot, none when full, freed once the life has run', () => {
  const slots = createSlots(3);
  assert.deepEqual([slots.claim(1), slots.claim(2), slots.claim(1)], [0, 1, 2]);
  assert.equal(slots.claim(1), -1);
  assert.equal(slots.active, 3);
  slots.advance(1);
  assert.equal(slots.active, 1);
  assert.equal(slots.claim(5), 0);
  assert.ok(slots.alive(0) && slots.alive(1) && !slots.alive(2));
  slots.clear();
  assert.equal(slots.active, 0);
  assert.throws(() => createSlots(0));
});

test('uploads cover only the written slots, one range per run', () => {
  const attribute = () => ({ranges: [], needsUpdate: false, addUpdateRange(start, count) { this.ranges.push([start, count]); }});
  const rows = [attribute(), attribute()];
  assert.deepEqual(uploadSlots(rows, [7, 3, 4, 9, 8, 3]), [[3, 4], [7, 9]]);
  for (const row of rows) {
    assert.deepEqual(row.ranges, [[3 * ROW_SIZE, 2 * ROW_SIZE], [7 * ROW_SIZE, 3 * ROW_SIZE]]);
    assert.equal(row.needsUpdate, true);
  }
  assert.deepEqual(uploadSlots(rows, []), []);
});

test('a puff record lands in its rows; clearing kills every slot', () => {
  const rows = Object.fromEntries(PUFF_ROWS.map(name => [name, new Float32Array(2 * ROW_SIZE)]));
  writePuff(rows, 1, {position: {x: 1, y: 2, z: 3}, velocity: [4, 5, 6], life: 2, size: .5, grow: .8, gravity: 1, peak: .4,
    aspect: 2, fadeIn: .1, wind: .5, rotation: .25, color: {r: .5, g: .25, b: 1}, lit: true, sheet: 3, frame: 2, additive: true});
  assert.deepEqual([...rows.motion.subarray(4)], [1, 2, 3, 0]);
  assert.deepEqual([...rows.velocity.subarray(4)], [4, 5, 6, 2]);
  assert.deepEqual([...rows.shape.subarray(4)].map(v => +v.toFixed(3)), [.5, .8, 1, .4]);
  assert.deepEqual([...rows.draw.subarray(4)], [3, 2, 1, 0]);
  assert.equal(rows.tint[7], 1);
  killAll(rows);
  assert.equal(rows.velocity[7], DEAD);
});
