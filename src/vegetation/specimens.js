import * as THREE from 'three';

const motionShader = `
attribute vec3 plantMotion;
uniform vec2 plantWind;
uniform float plantTime;
uniform float plantGust;
uniform vec4 plantSweep;

vec3 movePlant(vec3 vertex) {
  mat4 placement = modelMatrix * instanceMatrix;
  vec2 root = placement[3].xz;
  float phase = dot(root, vec2(0.47, 0.32));
  float sway = 0.5 + sin(plantTime * 1.9 - phase) * (0.22 + plantGust * 0.22);
  float flutter = sin(plantTime * 8.0 + dot(vertex, vec3(4.0, 5.0, 3.0)) + phase);
  vec2 offset = plantWind * (sway * plantMotion.x + flutter * plantMotion.y);
  float press = 0.0;
  if (plantMotion.z > 0.0 && plantSweep.z > 0.0) {
    float travel = plantSweep.x - root.x;
    float trailTime = max(0.0, travel) / plantSweep.w;
    press = (1.0 - smoothstep(0.0, 1.1, trailTime))
          * (1.0 - smoothstep(0.0, plantSweep.z, max(0.0, -travel)))
          * (1.0 - smoothstep(0.0, plantSweep.z + 0.5, abs(root.y - plantSweep.y)))
          * plantMotion.z;
  }
  offset.x += press * 0.88;
  vec3 displacement = vec3(offset.x, -press * 0.16, offset.y);
  vec3 x = placement[0].xyz, y = placement[1].xyz, z = placement[2].xyz;
  return vertex + vec3(dot(x, displacement), dot(y, displacement), dot(z, displacement)) / dot(x, x);
}
`;

function geometryFor(parts, atlasRects, {mode, height: plantHeight}) {
  const bush = mode === 'bush';
  const soft = mode === 'soft';
  const position = [], uv = [], motion = [];
  for (const part of parts) {
    const [u, v, width, height] = atlasRects[part.material];
    for (let i = 0; i < part.position.length / 3; i++) {
      const p = i * 3, t = i * 2;
      const y = part.position[p + 1];
      const weight = THREE.MathUtils.clamp(y / plantHeight, 0, 1);
      const crown = THREE.MathUtils.smoothstep(y, plantHeight * MOTION.crownFrom, plantHeight);
      const sway = soft ? weight * Math.min(MOTION.soft.max, plantHeight * MOTION.soft.heightShare)
        : bush ? weight ** MOTION.bush.power * MOTION.bush.gain : weight ** 2 * MOTION.tree.gain + crown * MOTION.tree.crownGain;
      const flutter = (part.foliage ?? part.material === 'leaf') ? weight * (bush ? MOTION.flutter.bush : MOTION.flutter.tree) : 0;
      position.push(part.position[p], y, part.position[p + 2]);
      uv.push(u + width * part.uv[t], v + height * part.uv[t + 1]);
      if (mode === 'static') motion.push(0, 0, 0);
      else motion.push(sway, flutter, bush ? weight ** MOTION.bush.bendPower : soft ? weight * Math.min(MOTION.soft.bendMax, plantHeight) : 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('plantMotion', new THREE.Float32BufferAttribute(motion, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// A single material and one instanced batch per species. The caller owns the atlas.
// Per-vertex motion weights by plant mode. crownFrom: share of the height where a tree's crown starts. soft plants sway
// weight x min(max, height x heightShare) and bend weight x min(bendMax, height); bushes and trees use powers of the height weight.
const MOTION = Object.freeze({crownFrom: 0.326, soft: {max: 0.48, heightShare: 0.7, bendMax: 0.55}, bush: {power: 1.6, gain: 0.8, bendPower: 1.4},
  tree: {gain: 0.24, crownGain: 0.65}, flutter: {bush: 0.035, tree: 0.22}});
const ROUGHNESS = 0.9;
const DEFAULT_PROFILES = Object.freeze({bush: {mode: 'bush', height: 2.7}, tree: {mode: 'tree', height: 4.6}});   // m
const WIND = Object.freeze({scale: 0.055, max: 0.7});   // shader wind = environment wind (m/s) x scale, clamped to max

export function createSpecimens({scene, parts, atlas, atlasRects, placements, profiles = {}}) {
  const uniforms = {
    plantTime: {value: 0}, plantGust: {value: 0},
    plantWind: {value: new THREE.Vector2()}, plantSweep: {value: new THREE.Vector4()},
  };
  const cutout = {map: atlas, alphaTest: 0.5, side: THREE.DoubleSide};
  const material = new THREE.MeshStandardMaterial({...cutout, roughness: ROUGHNESS, flatShading: true});
  const depth = new THREE.MeshDepthMaterial({...cutout, depthPacking: THREE.RGBADepthPacking});
  for (const shaderMaterial of [material, depth]) {
    shaderMaterial.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = motionShader + shader.vertexShader.replace(
        '#include <begin_vertex>', 'vec3 transformed = movePlant(position);',
      );
    };
    shaderMaterial.customProgramCacheKey = () => 'vegetation-specimen-motion';
  }
  const pose = new THREE.Object3D();
  const meshes = Object.entries(parts).map(([kind, geometryParts]) => {
    const entries = placements[kind];
    const profile = profiles[kind] ?? (kind === 'bush' ? DEFAULT_PROFILES.bush : DEFAULT_PROFILES.tree);
    const mesh = new THREE.InstancedMesh(geometryFor(geometryParts, atlasRects, profile), material, entries.length);
    mesh.name = kind;
    entries.forEach(({x, y, z, scale, yaw}, i) => {
      pose.position.set(x, y, z);
      pose.rotation.y = yaw;
      pose.scale.setScalar(scale);
      pose.updateMatrix();
      mesh.setMatrixAt(i, pose.matrix);
    });
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 2;
    mesh.count = 1;
    mesh.customDepthMaterial = depth;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });
  return {
    setCount(count, species = 'all') {
      for (const mesh of meshes) {
        mesh.count = species === 'all' || species === mesh.name ? Math.min(count, mesh.instanceMatrix.count) : 0;
        mesh.visible = mesh.count > 0;
      }
    },
    clear() {
      uniforms.plantTime.value = 0;
      uniforms.plantSweep.value.set(0, 0, 0, 1);
    },
    // Wind comes from windX/windZ/gust, else from an optional `environment` (core/environment.js), else calm.
    update(dt, {environment, windX = environment?.wind.x ?? 0, windZ = environment?.wind.z ?? 0, gust = environment?.wind.gust ?? 0, sweep} = {}) {
      uniforms.plantTime.value += dt;
      uniforms.plantWind.value.set(windX, windZ).multiplyScalar(WIND.scale).clampLength(0, WIND.max);
      uniforms.plantGust.value = gust;
      uniforms.plantSweep.value.set(sweep?.x ?? 0, sweep?.z ?? 0, sweep?.radius ?? 0, sweep?.speed ?? 1);
    },
    dispose() {
      for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.dispose();
      }
      material.dispose();
      depth.dispose();
    },
  };
}
