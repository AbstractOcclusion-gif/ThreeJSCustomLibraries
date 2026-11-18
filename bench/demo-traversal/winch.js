import * as C from 'cannon-es';
import * as THREE from 'three';
import {createCable, createThreeCableView} from '../../src/cable/index.js';
import {addJoltBlocks} from '../kit/jolt-blocks.js';

// A winch: a capstan's turns wind a rope that runs from its drum up to a pulley and down to a platform, which rises
// with it. The rope is the library's cable (src/cable), in a physics world of its own as her ropes are: one run from
// the drum to the pulley, whose length never changes, and one from the pulley down to the platform, reeled in and out
// (cable.setLength) as the platform moves. The platform is one of the kit's blocks, moved by the host (moveTo), so
// she can stand on it and is carried. It listens to the capstan ('capstan:turned'); nothing else ties the two.
// Lengths in m.
const UNBREAKABLE = 1e9;   // N: its rope is never cut by its load
export const WINCH_DEFAULTS = Object.freeze({
 perTurn: 4,          // rope wound by one turn of the capstan: geared, so that part of a turn lifts the platform
 slack: 1.02,         // rope length as a share of the distance it spans
 segments: 16,        // links of each run
 iterations: 32,      // solver passes per step
 radius: .02,         // how thick the rope is drawn
 wheel: Object.freeze({radius: .16, width: .08, color: 0x3d3227}),   // the pulley
 hook: .02,           // the rope ends this far above the platform's top
});

// capstan: the capstan that works it (capstan.js). drum: [x, y, z], where the rope leaves it. pulley: [x, y, z], the
// middle of the wheel. platform: {halfExtents, x, z, low, high (its top, down and up), hook: [x, z] (where the rope
// holds it, from its middle: at an edge, clear of where she stands), color}. gravity: m/s2.
// way: -1 when the capstan winds as its angle goes down, 1 as it goes up.
export function createWinch({host, scene, style, capstan, drum, pulley, platform, gravity, way = 1, ...options}) {
 const unknown = Object.keys(options).filter(key => !(key in WINCH_DEFAULTS));
 if (unknown.length) throw Error('Unknown winch option: ' + unknown.join(', '));
 const o = {...WINCH_DEFAULTS, ...options};
 const {halfExtents, x, z, low, high, hook: [hookX, hookZ] = [0, 0], color} = platform, travel = high - low;
 if (!(travel > 0)) throw Error('The winch platform has to end higher than it starts');
 const centre = top => [x, top - halfExtents[1], z], hookAt = top => [x + hookX, top + o.hook, z + hookZ];
 const world = new C.World({gravity: new C.Vec3(0, -gravity, 0)});
 world.solver.iterations = o.iterations;
 const blocks = addJoltBlocks({host, scene, style, blocks: [{halfExtents, position: centre(low), kinematic: true, color}]});
 const body = blocks.entries[0].body;
 // The rope leaves the wheel at its rim, toward the drum on one side and straight down on the other.
 const rim = [pulley[0], pulley[1] - o.wheel.radius, pulley[2]];
 const span = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
 const run = (from, to, kind) => createCable({world, endpoints: [{kind: 'fixed', position: from}, {kind, position: to}],
  length: span(from, to) * o.slack, segments: o.segments, preset: 'rope', breakStrength: UNBREAKABLE});
 const haul = run(drum, pulley, 'fixed'), fall = run(rim, hookAt(low), 'driven');
 for (const cable of [haul, fall]) cable.setFracture(false);
 const views = [haul, fall].map(cable => createThreeCableView({scene, cable: {links: cable.links, profile: {...cable.profile, radius: o.radius}}}));
 const wheelMaterial = new THREE.MeshStandardMaterial({color: o.wheel.color, roughness: .8});
 const wheel = new THREE.Mesh(new THREE.CylinderGeometry(o.wheel.radius, o.wheel.radius, o.wheel.width, 20).rotateX(Math.PI / 2), wheelMaterial);
 wheel.position.fromArray(pulley);
 wheel.castShadow = true;
 scene.add(wheel);
 let wound = 0, top = low, hung = low;   // rope wound on the drum (0..travel), where the platform's top is now, and where the rope last had it
 const unsubscribe = capstan.subscribe(event => { wound = THREE.MathUtils.clamp(way * event.turns * o.perTurn, 0, travel); });
 return {
  travel,
  get wound() { return wound; },   // m of rope on the drum
  get top() { return top; },       // the height of the platform's top
  // One physics step, before the host's own: the platform goes where the rope has it, and the rope follows.
  step(dt) {
   top = low + wound;
   host.moveTo(body, centre(top), dt);
   // The rope is only worked while the platform moves: at rest it is left to settle and sleep.
   if (top !== hung) {
    const hook = hookAt(top);
    fall.moveEndpoint(1, hook);
    fall.setLength(span(rim, hook) * o.slack);
    hung = top;
   }
   for (const cable of [haul, fall]) cable.beforeStep(dt);
   world.step(dt);
   for (const cable of [haul, fall]) cable.afterStep(dt);
   wheel.rotation.z = way * wound / o.wheel.radius;
  },
  draw(camera) { blocks.update(); for (const view of views) view.update(camera); },
  dispose() {
   unsubscribe();
   for (const view of views) view.dispose();
   for (const cable of [haul, fall]) cable.dispose();
   blocks.dispose();
   scene.remove(wheel); wheel.geometry.dispose(); wheelMaterial.dispose();
  },
 };
}
