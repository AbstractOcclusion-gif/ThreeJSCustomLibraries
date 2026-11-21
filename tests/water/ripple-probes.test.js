import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createRipples} from '../../src/water/ripples.js';
import {createRippleProbes} from '../../src/water/ripple-probes.js';
import {RigidBody} from '../../src/water/ocean/rigid-body.js';
import {Buoyancy} from '../../src/water/ocean/buoyancy.js';

test('the field reads between its cells', () => {
  const ripples = createRipples({origin: [0, 0], size: [4, 4], cell: 1});
  ripples.splash(1.5, 1.5, 1, 1.2); ripples.update(1 / 60);
  assert.equal(ripples.heightAt(-5, 0), 0);
  const a = ripples.heightAt(1.5, 1.5), b = ripples.heightAt(2.5, 1.5), mid = ripples.heightAt(2, 1.5);
  assert.ok(Math.abs(mid - (a + b) / 2) < 1e-9);
});

test('ripple probes give the buoyancy the surface under its points, and a cube floats at its level', () => {
  const ripples = createRipples({origin: [-.05, -.05], size: [20, 20], cell: .005});
  const surface = new THREE.Object3D(); surface.position.set(0, .8, 0);
  assert.throws(() => createRippleProbes({ripples: {}, surface}), TypeError);
  assert.throws(() => createRippleProbes({ripples, surface, heightScale: 0}), RangeError);
  const probes = createRippleProbes({ripples, surface, heightScale: .004});
  const size = new THREE.Vector3(.025, .025, .025), body = new RigidBody({mass: 1, boxSize: size});
  body.position.set(0, .85, 0);
  const buoyancy = new Buoyancy(body, new THREE.Vector3(), size, {buoyancy: 1 / .9, waterLinearDamping: 4, verticalSettleDamping: 4}, 0, probes.factory);
  const dt = 1 / 120;
  for (let i = 0; i < 1200; i++) { buoyancy.updateProbePoints(); probes.update(dt); buoyancy.step(); body.integrate(dt); }
  // It came down into the liquid and stays, mostly under the surface.
  assert.ok(body.position.y < .8 && body.position.y > .8 - .025, 'rests in the surface: ' + body.position.y);
  assert.ok(Math.abs(body.velocity.y) < .01);
  assert.equal(probes.factory(2).points.length, 2);
});
