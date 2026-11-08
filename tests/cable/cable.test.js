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
