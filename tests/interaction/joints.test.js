import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createJoint, pivotAt, JOINT_DEFAULTS} from '../../src/interaction/joints.js';

const run = (joint, seconds = 5, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) joint.update(dt); return joint; };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + ' != ' + b);

test('joints check what they are given', () => {
  const object = new THREE.Object3D();
  assert.throws(() => createJoint(), TypeError);
  assert.throws(() => createJoint({object, kind: 'twist', axis: 'x', open: 1}), TypeError);
  assert.throws(() => createJoint({object, kind: 'slide', axis: 'x'}), RangeError);
  assert.throws(() => createJoint({object, kind: 'slide', axis: 'w', open: 1}), TypeError);
  assert.throws(() => createJoint({object, kind: 'slide', axis: [0, 0, 0], open: 1}), RangeError);
  assert.throws(() => createJoint({object, kind: 'spin', axis: 'z', speed: 0}), RangeError);
  assert.throws(() => createJoint({object, kind: 'spin', axis: 'z'}).update(-1), RangeError);
  assert.equal(JOINT_DEFAULTS.speed > 0, true);
});

test('a slide eases out along its own axis, settles once, and closes back to rest', () => {
  const object = new THREE.Object3D();
  object.position.set(1, 2, 3);
  object.rotation.y = Math.PI / 2;   // its +z points along the parent's +x
  let settled = 0;
  const drawer = createJoint({object, kind: 'slide', axis: 'z', open: .4, onSettle: () => settled++});
  drawer.toggle();
  assert.equal(drawer.isOpen, true);
  drawer.update(1 / 60);
  assert.ok(drawer.value > 0 && drawer.value < .4 && drawer.moving);
  run(drawer);
  assert.equal(drawer.value, .4); assert.equal(drawer.moving, false); assert.equal(settled, 1);
  near(object.position.x, 1.4); near(object.position.y, 2); near(object.position.z, 3);
  drawer.toggle(); run(drawer);
  assert.equal(drawer.isOpen, false);
  near(object.position.x, 1);
  drawer.set(9); assert.equal(drawer.goal, .4);
  drawer.set(-9); assert.equal(drawer.goal, 0);
});

test('the easing does not depend on the frame rate', () => {
  const a = createJoint({object: new THREE.Object3D(), kind: 'slide', axis: 'x', open: 1}).open();
  const b = createJoint({object: new THREE.Object3D(), kind: 'slide', axis: 'x', open: 1}).open();
  for (let i = 0; i < 30; i++) a.update(1 / 120);
  for (let i = 0; i < 15; i++) b.update(1 / 60);
  near(a.value, b.value, 1e-9);
});

test('a hinge turns about its axis, with a negative open amount as well', () => {
  const object = new THREE.Object3D();
  const door = createJoint({object, kind: 'hinge', axis: 'y', open: -Math.PI / 2});
  run(door.open());
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion);
  near(front.x, -1); near(front.z, 0);
  run(door.close());
  near(object.quaternion.w, 1);
});

test('a spin has no ends, snaps to its steps and reports each new one', () => {
  const object = new THREE.Object3D(), steps = [];
  const dial = createJoint({object, kind: 'spin', axis: 'z', step: Math.PI / 50, onStep: index => steps.push(index)});
  dial.turn(Math.PI / 50 * 2.4);
  assert.equal(dial.goal, Math.PI / 50 * 2);
  run(dial);
  assert.deepEqual(steps, [1, 2]); assert.equal(dial.step, 2);
  dial.turn(-Math.PI * 4); run(dial);
  assert.equal(dial.step, -198);   // 2 - 4pi / (pi / 50)
  dial.reset(); assert.equal(dial.value, 0); near(object.quaternion.w, 1);
});

test('pivotAt hangs an object from a point without moving it, so a hinge swings it about that point', () => {
  const parent = new THREE.Group(), door = new THREE.Mesh();
  door.position.set(2, 0, 0); door.rotation.y = .3;
  parent.add(door); parent.updateMatrixWorld(true);
  const before = door.getWorldPosition(new THREE.Vector3());
  const pivot = pivotAt(door, new THREE.Vector3(1.5, 0, 0));
  assert.equal(door.parent, pivot); assert.equal(pivot.parent, parent);
  pivot.updateMatrixWorld(true);
  assert.ok(door.getWorldPosition(new THREE.Vector3()).distanceTo(before) < 1e-9);
  const hinge = createJoint({object: pivot, kind: 'hinge', axis: 'y', open: Math.PI});
  run(hinge.open()); parent.updateMatrixWorld(true);
  const after = door.getWorldPosition(new THREE.Vector3());
  near(after.distanceTo(new THREE.Vector3(1.5, 0, 0)), .5);   // still half a metre from the hinge
  near(after.x, 1);                                          // on the other side of it
  assert.throws(() => pivotAt(new THREE.Object3D(), new THREE.Vector3()), TypeError);
});
