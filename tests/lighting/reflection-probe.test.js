import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createReflectionProbe} from '../../src/lighting/reflection-probe.js';

test('a reflection probe checks what it is given and captures only when invalidated, past its cooldown', () => {
  const renderer = {render() {}}, scene = new THREE.Scene(), position = new THREE.Vector3(1, 1, 1);
  assert.throws(() => createReflectionProbe(), TypeError);
  assert.throws(() => createReflectionProbe({renderer, scene}), TypeError);
  assert.throws(() => createReflectionProbe({renderer, scene, position, resolution: 3}), RangeError);
  assert.throws(() => createReflectionProbe({renderer, scene, position, near: 2, far: 1}), RangeError);
  assert.throws(() => createReflectionProbe({renderer, scene, position, colour: 1}), /Unknown/);
  const probe = createReflectionProbe({renderer, scene, position, cooldown: .5});
  let captures = 0;
  probe.capture = () => { captures++; return null; };   // the GPU part is out of reach here: count the captures
  assert.equal(probe.texture, null);
  assert.equal(probe.update(0), true);                   // a new probe captures at once
  assert.equal(probe.update(.1), false);                 // nothing changed
  probe.invalidate();
  assert.equal(probe.update(.1), false);                 // changed, but within the cooldown
  assert.equal(probe.update(.35), true);                 // past it
  probe.invalidate(); probe.invalidate();
  assert.equal(probe.update(.6), true); assert.equal(probe.update(.6), false);
  assert.equal(captures, 3);
  probe.dispose?.();
});
