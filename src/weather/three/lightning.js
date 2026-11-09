import * as THREE from 'three';

export function createLightning(group) {
 const geometry = new THREE.BufferGeometry();
 const positions = new THREE.Float32BufferAttribute(new Float32Array(30 * 36), 3);
 geometry.setAttribute('position', positions);
 const material = new THREE.MeshBasicMaterial({color: new THREE.Color(3, 4, 7), toneMapped: false, side: THREE.DoubleSide});
 const bolt = new THREE.Mesh(geometry, material);
 const light = new THREE.PointLight(0xb6d2ff, 0, 85);
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
   const maxSpread = Math.min(22, start.distanceTo(hit) * .06);
   let previous = start;
   for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const point = start.clone().lerp(hit, t);
    const spread = i === 24 ? 0 : Math.sin(Math.PI * t) * maxSpread;
    point.x += (Math.random() - .5) * spread;
    point.z += (Math.random() - .5) * spread;
    segment(vertices, previous, point, .32 - .18 * t);
    if (i % 5 === 0 && i < 20) {
     const bend = point.clone().add(new THREE.Vector3((Math.random() - .5) * 45, -18, (Math.random() - .5) * 45));
     segment(vertices, point, bend, .10);
     segment(vertices, bend, bend.clone().lerp(point, -.55).add(new THREE.Vector3(0, -10, 0)), .05);
    }
    previous = point;
   }
   positions.array.set(vertices);
   positions.needsUpdate = true;
   light.position.copy(hit);
   light.position.y += 2;
  },
  update(energy) {
   bolt.visible = energy > 0;
   light.visible = bolt.visible;
   light.intensity = energy * 650;
  },
  dispose() {
   group.remove(bolt, light);
   geometry.dispose();
   material.dispose();
   light.dispose();
  },
 };
}
