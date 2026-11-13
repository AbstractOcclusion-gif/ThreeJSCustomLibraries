import * as THREE from 'three';

export const VALLEY_WATER = Object.freeze({
  Dry: null,
  Pond: {width: 12, length: 18, centerZ: -33, level: 1.3, depth: 2},
  Lake: {width: 30, length: 43, centerZ: 21, level: 2, depth: 5},
  Stream: {width: 5, length: 102, centerZ: 0, level: .7, depth: 1.4, ribbon: true},
  Ocean: {width: 128, length: 40, centerZ: 88, level: 1.5, depth: 8, coast: true},
});
const LOOK = {color: 0x4a92a4, roughness: .34, segments: 64, transition: .45};

export function createValleyWater(valley, kind) {
  const water = VALLEY_WATER[kind];
  if (!water) return {heightAt: valley.heightAt, contains: () => false};
  const {width, length, centerZ, level, depth, ribbon, coast} = water;
  const centerX = z => coast ? 0 : valley.routeX(ribbon ? z : centerZ);
  function distance(x, z) {
    const u = Math.abs(x - centerX(z)) / width, v = (z - centerZ) / length;
    if (coast) return Math.max(u, -v);
    return ribbon ? Math.max(u, Math.abs(v)) : Math.hypot(u, v);
  }
  function heightAt(x, z) {
    const land = valley.heightAt(x, z);
    const d = distance(x, z);
    if (d >= 1 + LOOK.transition) return land;
    const edge = THREE.MathUtils.smoothstep(d, 1, 1 + LOOK.transition);
    const bed = level - depth * Math.max(0, 1 - d ** 2);
    return THREE.MathUtils.lerp(Math.min(land, bed), land, edge);
  }
  function contains(x, z) { return distance(x, z) < 1 && heightAt(x, z) < level; }
  function makeMesh() {
    const geometry = coast || ribbon
      ? new THREE.PlaneGeometry(width * 2, length * 2, 1, LOOK.segments)
      : new THREE.CircleGeometry(1, LOOK.segments).scale(width, length, 1);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i) + centerZ;
      position.setXYZ(i, position.getX(i) + centerX(z), level, z);
    }
    const material = new THREE.MeshStandardMaterial({color: LOOK.color, roughness: LOOK.roughness});
    return new THREE.Mesh(geometry, material);
  }
  return {heightAt, contains, makeMesh};
}
