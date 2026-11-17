import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from 'cannon-es';
import * as THREE from 'three';
import {createCable, createThreeCableView, CABLE_PRESETS} from '../../src/cable/index.js';

test('cable builds links between fixed anchors, steps, cuts into sections and disposes cleanly', () => {
 const world = new C.World({gravity: new C.Vec3(0, -9.82, 0)});
 const cable = createCable({world, endpoints: [{kind: 'fixed', position: [-4, 3, 0]}, {kind: 'fixed', position: [4, 3, 0]}], length: 8.8, breakStrength: 1e6});
 assert.equal(cable.links.length, 16);
 assert.equal(world.bodies.length, 18);     // 16 links + 2 owned anchors
 const events = []; cable.subscribe(e => events.push(e.type));
 for (let i = 0; i < 30; i++) { cable.beforeStep(1 / 120); world.step(1 / 120); cable.afterStep(1 / 120); }
 assert.equal(cable.snapshot().sections.length, 1);
 cable.breakAt(7);
 assert.equal(cable.snapshot().sections.length, 2);
 assert.ok(events.includes('cable:broken'));
 const scene = new THREE.Scene();
 const view = createThreeCableView({scene, cable: {links: cable.links, profile: cable.profile, get sections() { return cable.snapshot().sections; }}});
 view.update();
 assert.ok(view.vertexCount > 0);
 assert.equal(cable.profile, CABLE_PRESETS.rope);
 view.dispose(); cable.dispose();
 assert.equal(world.bodies.length, 0);
 assert.equal(scene.children.length, 0);
});

test('a cable is reeled in and paid out: its links share the new length and its attachments hold', () => {
 const world = new C.World({gravity: new C.Vec3(0, -9.82, 0)});
 world.solver.iterations = 32;
 // A rope hanging from a fixed point to a hook that is raised, as a winch does.
 const cable = createCable({world, endpoints: [{kind: 'fixed', position: [0, 8, 0]}, {kind: 'driven', position: [0, 2, 0]}], length: 6.1, breakStrength: 1e6});
 const events = []; cable.subscribe(event => events.push(event.type));
 const settle = steps => { for (let i = 0; i < steps; i++) { cable.beforeStep(1 / 120); world.step(1 / 120); cable.afterStep(1 / 120); } };
 settle(60);
 for (let i = 1; i <= 240; i++) {
  const hook = 2 + 3 * i / 240;   // up 3 m in two seconds
  cable.moveEndpoint(1, [0, hook, 0]);
  cable.setLength((8 - hook) * 1.01);
  settle(1);
 }
 settle(120);
 assert.ok(Math.abs(cable.length - 3.03) < 1e-9, 'the cable is as long as asked');
 assert.ok(Math.abs(cable.links.reduce((sum, link) => sum + link.length, 0) - cable.length) < 1e-9, 'its links add up to that length');
 assert.ok(events.includes('cable:reeled'));
 const top = cable.links[0].body, tip = top.pointToWorldFrame(new C.Vec3(-cable.links[0].length / 2, 0, 0));
 assert.ok(tip.distanceTo(new C.Vec3(0, 8, 0)) < .05, 'it still hangs from its fixing');
 const last = cable.links.at(-1), end = last.body.pointToWorldFrame(new C.Vec3(last.length / 2, 0, 0));
 assert.ok(end.distanceTo(new C.Vec3(0, 5, 0)) < .05, 'and still holds the hook, 3 m higher');
 assert.ok(cable.links.every(link => link.body.position.y > 4.9 && link.body.position.y < 8.1 && Math.hypot(link.body.position.x, link.body.position.z) < .4), 'the rope stayed between the two, near its line');
 cable.setLength(4);
 assert.equal(cable.length, 4, 'it can be paid out again');
 assert.throws(() => cable.setLength(.1), /at least/);
 cable.breakAt(3);
 assert.throws(() => cable.setLength(3.5), /cut/);
 cable.dispose();
});
