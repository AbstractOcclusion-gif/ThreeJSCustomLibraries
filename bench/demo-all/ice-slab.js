import * as THREE from 'three';
import {ICE_MAP_SCALE, ICE_PATTERN_GLSL, createIceLook, iceLookUniforms} from '../../src/water/freeze.js';
import {iceFractureDistance} from './ice-fracture.js';

export const ICE_TOP = .05;
export const ICE_THICKNESS = .16;
const CELL = .25;

export function createIceSlab(scene, freezeMap, look = createIceLook()) {
 const material = new THREE.MeshPhysicalMaterial({
  color: '#ffffff', roughness: .33, ior: 1.31, clearcoat: .5,
  clearcoatRoughness: .14, bumpMap: freezeMap, bumpScale: .012, vertexColors: true,
 });
 material.onBeforeCompile = shader => {
  // The same pattern as the water surface's ice (freeze.js), so the slab matches it where it takes over.
  Object.assign(shader.uniforms, iceLookUniforms(look));
  shader.fragmentShader = shader.fragmentShader
   .replace('#include <common>', `#include <common>\n${ICE_PATTERN_GLSL}`)
   .replace('#include <color_fragment>', `#include <color_fragment>
    vec2 icePoint = vBumpMapUv / ${ICE_MAP_SCALE};
    vec3 iceView = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
    float frost, cracks, deepCracks, bubbles, iceOpacity;
    icePattern(icePoint, iceView, 1.0, bumpMap, frost, cracks, deepCracks, bubbles);
    // The material colour tints the ice; the vertex tint darkens the walls and the underside of the slab.
    diffuseColor.rgb = iceBody(frost, cracks, deepCracks, bubbles, iceOpacity) * diffuse * vColor.rgb;`)
   .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
    // Clear ice is glassy and frost is matte, around the material's own roughness.
    roughnessFactor = clamp(roughnessFactor * mix(.2, 2.4, frost), .04, 1.0);`);
 };
 const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
 mesh.receiveShadow = true;
 mesh.visible = false;
 scene.add(mesh);

 function rebuild(field, level, holes, bounds) {
  const positions = [], uvs = [], colors = [];
  const bottom = ICE_TOP - ICE_THICKNESS;
  const geometry = new THREE.BufferGeometry();
  function insideAt(x, z) {
   const bed = field.heightAt(x, z);
   if (bed === undefined) return -CELL;
   let inside = level - bed - .002;
   for (const hole of holes) inside = Math.min(inside, iceFractureDistance(hole, x, z));
   return inside;
  }

  function vertex(p, y, tint) {
   positions.push(p.x, y, p.z);
   uvs.push(p.x * ICE_MAP_SCALE, p.z * ICE_MAP_SCALE);
   colors.push(tint, tint, tint);
  }

  // Clip each triangle to the wet footprint minus the rounded breaches.
  // The same crossings join the top and bottom faces to a vertical ice wall.
  function slice(a, b, c) {
   if (a.inside <= 0 && b.inside <= 0 && c.inside <= 0) return;
   const polygon = [];
   let previous = c;
   for (const p of [a, b, c]) {
    if ((previous.inside > 0) !== (p.inside > 0)) {
     const t = previous.inside / (previous.inside - p.inside);
     polygon.push({x: THREE.MathUtils.lerp(previous.x, p.x, t), z: THREE.MathUtils.lerp(previous.z, p.z, t), rim: true});
    }
    if (p.inside > 0) polygon.push(p);
    previous = p;
   }
   for (let i = 1; i < polygon.length - 1; i++) {
    const u = polygon[0], v = polygon[i], w = polygon[i + 1];
    for (const p of [u, v, w]) vertex(p, ICE_TOP, p.rim ? 1 : .86);
    for (const p of [u, w, v]) vertex(p, bottom, .65);
   }
   for (let i = 0; i < polygon.length; i++) {
    const u = polygon[i], v = polygon[(i + 1) % polygon.length];
    if (!u.rim || !v.rim) continue;
    vertex(u, ICE_TOP, 1); vertex(u, bottom, .58); vertex(v, bottom, .58);
    vertex(u, ICE_TOP, 1); vertex(v, bottom, .58); vertex(v, ICE_TOP, 1);
   }
  }

  if (bounds) {
   const columns = Math.ceil((bounds.right - bounds.left) / CELL);
   const rows = Math.ceil((bounds.back - bounds.front) / CELL);
   function rowAt(z) {
    return Array.from({length: columns + 1}, (_, column) => {
     const x = bounds.left + column * CELL;
     return {x, z, inside: insideAt(x, z)};
    });
   }
   let row = rowAt(bounds.front);
   for (let j = 0; j < rows; j++) {
    const next = rowAt(bounds.front + (j + 1) * CELL);
    for (let i = 0; i < columns; i++) {
     slice(row[i], next[i], row[i + 1]);
     slice(next[i], next[i + 1], row[i + 1]);
    }
    row = next;
   }
  }
  // Give cracks real width in world space. Clip the ribbons at other holes and
  // the shoreline, so the web never draws over open water or the bank.
  for (const hole of holes) for (const {a, b, width} of hole.segments) {
   const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
   if (length <= .001) continue;
   const steps = Math.ceil(length / (CELL * .5));
   const offsetX = -dz * width / (2 * length), offsetZ = dx * width / (2 * length);
   for (let i = 0; i < steps; i++) {
    const x = a.x + dx * i / steps, z = a.z + dz * i / steps;
    const endX = a.x + dx * (i + 1) / steps, endZ = a.z + dz * (i + 1) / steps;
    const left = {x: x + offsetX, z: z + offsetZ}, right = {x: x - offsetX, z: z - offsetZ};
    const nextLeft = {x: endX + offsetX, z: endZ + offsetZ}, nextRight = {x: endX - offsetX, z: endZ - offsetZ};
    if ([left, right, nextLeft, nextRight].some(p => insideAt(p.x, p.z) < .008)) continue;
    for (const p of [left, nextLeft, right, right, nextLeft, nextRight]) vertex(p, ICE_TOP + .002, .23);
   }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  mesh.geometry.dispose();
  mesh.geometry = geometry;
  mesh.position.y = level;
  mesh.visible = positions.length > 0;
 }

 return {material, mesh, rebuild, dispose() { mesh.removeFromParent(); mesh.geometry.dispose(); material.dispose(); }};
}
