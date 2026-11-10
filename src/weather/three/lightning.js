import * as THREE from 'three';

// Bolt: `segments` steps from cloud to hit, jittered by up to spreadShare of the length (at most maxSpread m) mid-way;
// ribbon width [start, loss toward the hit] m. Every branchEvery steps before branchUntil a branch reaches [sideways, down] m,
// then a twig doubles back twigShare of it and drops twigDrop m. Room: 24 steps + 3 branches x 2 = 30 ribbon pairs.
const BOLT = Object.freeze({segments: 24, maxSpread: 22, spreadShare: .06, width: [.32, .18], branchEvery: 5, branchUntil: 20,
  branchReach: [45, 18], branchWidth: .10, twigShare: .55, twigDrop: 10, twigWidth: .05});
const MAX_SEGMENTS = 30, SEGMENT_FLOATS = 36;   // two crossed ribbons x 2 triangles x 3 vertices x xyz
// Flash: HDR bolt colour (over 1, so it blooms), point light colour, range (m), height over the hit (m), intensity per energy.
const FLASH = Object.freeze({boltColor: [3, 4, 7], lightColor: 0xb6d2ff, range: 85, lift: 2, intensity: 650});

export function createLightning(group) {
 const geometry = new THREE.BufferGeometry();
 const positions = new THREE.Float32BufferAttribute(new Float32Array(MAX_SEGMENTS * SEGMENT_FLOATS), 3);
 geometry.setAttribute('position', positions);
 const material = new THREE.MeshBasicMaterial({color: new THREE.Color(...FLASH.boltColor), toneMapped: false, side: THREE.DoubleSide});
 const bolt = new THREE.Mesh(geometry, material);
 const light = new THREE.PointLight(FLASH.lightColor, 0, FLASH.range);
 bolt.frustumCulled = false;
 bolt.visible = false;
 light.visible = false;
 group.add(bolt, light);

 function segment(vertices, a, b, width) {
  // Crossed ribbons give the bolt a visible core from different camera angles.
  for (const [x, z] of [[width, 0], [0, width]]) {
   vertices.push(a.x-x,a.y,a.z-z, b.x-x,b.y,b.z-z, b.x+x,b.y,b.z+z,
    a.x-x,a.y,a.z-z, b.x+x,b.y,b.z+z, a.x+x,a.y,a.z+z);
  }
 }
 return {
  strike(start, hit) {
   const vertices = [];
   const maxSpread = Math.min(BOLT.maxSpread, start.distanceTo(hit) * BOLT.spreadShare);
   let previous = start;
   for (let i = 1; i <= BOLT.segments; i++) {
    const t = i / BOLT.segments;
    const point = start.clone().lerp(hit, t);
    const spread = i === BOLT.segments ? 0 : Math.sin(Math.PI * t) * maxSpread;
    point.x += (Math.random() - .5) * spread;
    point.z += (Math.random() - .5) * spread;
    segment(vertices, previous, point, BOLT.width[0] - BOLT.width[1] * t);
    if (i % BOLT.branchEvery === 0 && i < BOLT.branchUntil) {
     const [side, down] = BOLT.branchReach;
     const bend = point.clone().add(new THREE.Vector3((Math.random() - .5) * side, -down, (Math.random() - .5) * side));
     segment(vertices, point, bend, BOLT.branchWidth);
     segment(vertices, bend, bend.clone().lerp(point, -BOLT.twigShare).add(new THREE.Vector3(0, -BOLT.twigDrop, 0)), BOLT.twigWidth);
    }
    previous = point;
   }
   positions.array.set(vertices);
   positions.needsUpdate = true;
   light.position.copy(hit);
   light.position.y += FLASH.lift;
  },
  update(energy) {
   bolt.visible = energy > 0;
   light.visible = bolt.visible;
   light.intensity = energy * FLASH.intensity;
  },
  dispose() {
   group.remove(bolt, light);
   geometry.dispose();
   material.dispose();
   light.dispose();
  },
 };
}
