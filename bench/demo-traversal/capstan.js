import * as THREE from 'three';
import {addJoltBlocks} from '../kit/jolt-blocks.js';

// A capstan: a post with an arm she takes hold of and walks round it (push.js, a turning thing). It only turns and
// tells how far: what that does (a gate, a winch) is the host's, through subscribe(). The post is one of the kit's
// blocks; the arm is drawn only, so she can step through it. Lengths in m, angles in rad.
export const CAPSTAN_DEFAULTS = Object.freeze({
 post: Object.freeze({halfWidth: .16, height: 1.05}),
 arm: Object.freeze({length: 1.9, thickness: .1, height: .95}),   // from the pivot to its end, and how high it is held
 grip: 1.6,           // how far from the pivot she holds it
 reach: 1.1,          // she can take it from this far from that point
 range: null,         // [least, most]: how far it can turn from where it starts (rad), or null: it turns freely
 color: 0x4f3d2a,
});

// at: [x, y, z], the foot of the post. angle: the way the arm points at first, along (sin, cos) of it.
export function createCapstan({host, scene, style, at: [x, y, z], angle: first = 0, ...options}) {
 const unknown = Object.keys(options).filter(key => !(key in CAPSTAN_DEFAULTS));
 if (unknown.length) throw Error('Unknown capstan option: ' + unknown.join(', '));
 const o = {...CAPSTAN_DEFAULTS, ...options}, {post, arm} = o;
 const blocks = addJoltBlocks({host, scene, style, blocks: [{halfExtents: [post.halfWidth, post.height / 2, post.halfWidth], position: [x, y + post.height / 2, z], color: o.color}]});
 const material = new THREE.MeshStandardMaterial({color: o.color, roughness: .9});
 const beam = new THREE.Mesh(new THREE.BoxGeometry(arm.thickness, arm.thickness, arm.length), material);
 beam.position.z = arm.length / 2;   // it runs from the pivot along the group's +Z
 beam.castShadow = beam.receiveShadow = true;
 const group = new THREE.Group();
 group.position.set(x, y + arm.height, z);
 group.add(beam);
 scene.add(group);
 const listeners = new Set();
 let angle = first;
 group.rotation.y = angle;
 const capstan = {
  pivot: {x, z}, radius: o.grip, thickness: arm.thickness,
  get angle() { return angle; },
  get turns() { return (angle - first) / (Math.PI * 2); },   // whole turns since the start, either way
  // Turns it by `by`; returns how far it really turned. Tells its listeners 'capstan:turned'.
  turn(by) {
   if (!Number.isFinite(by)) throw Error('Capstan turn must be a finite angle');
   const to = o.range ? THREE.MathUtils.clamp(angle + by, first + o.range[0], first + o.range[1]) : angle + by;
   by = to - angle;
   if (by === 0) return 0;
   angle = to;
   group.rotation.y = angle;
   for (const listener of listeners) listener({type: 'capstan:turned', angle, turns: capstan.turns});
   return by;
  },
  // Whether a point {x, z} is near enough to where its arm is held to take it.
  near(point) { return Math.hypot(point.x - (x + Math.sin(angle) * o.grip), point.z - (z + Math.cos(angle) * o.grip)) <= o.reach; },
  subscribe(listener) {
   if (typeof listener !== 'function') throw Error('Capstan listener must be a function');
   listeners.add(listener);
   return () => listeners.delete(listener);
  },
  reset() { capstan.turn(first - angle); },
  dispose() { listeners.clear(); blocks.dispose(); scene.remove(group); beam.geometry.dispose(); material.dispose(); },
 };
 return capstan;
}
