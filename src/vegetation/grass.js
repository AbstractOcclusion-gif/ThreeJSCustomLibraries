import * as THREE from 'three';

const MAX_SWEEPS = 8;
const RECOVERY_SECONDS = 0.9;
const MAX_BEND = 0.38;

const bendSource = `
attribute float bendWeight;
uniform float grassTime;
uniform vec2 grassWind;
uniform float grassGust;
uniform vec4 grassSweeps[${MAX_SWEEPS}];
uniform vec2 grassContact[${MAX_SWEEPS}];

vec3 bendGrass(vec3 position) {
  mat4 placement = modelMatrix * instanceMatrix;
  vec2 root = placement[3].xz;
  float phase = dot(root, vec2(1.71, 2.31));
  float wave = sin(grassTime * 1.7 - dot(root, vec2(0.47, 0.32)));
  vec2 bend = grassWind * (0.48 + grassGust * wave * 0.32
                          + 0.12 * sin(grassTime * 4.1 + phase));
  vec2 push = vec2(0.0);
  for (int i = 0; i < ${MAX_SWEEPS}; i++) {
    vec2 contact = grassContact[i];
    if (contact.y <= 0.0) continue;
    vec4 sweep = grassSweeps[i];
    vec2 path = sweep.zw - sweep.xy;
    float t = clamp(dot(root - sweep.xy, path) / max(dot(path, path), 0.00001), 0.0, 1.0);
    vec2 delta = root - (sweep.xy + t * path);
    float distanceToSweep = length(delta);
    float strength = contact.y * (1.0 - smoothstep(0.0, contact.x, distanceToSweep));
    vec2 direction = normalize(path + vec2(0.00001, 0.0));
    vec2 candidate = (direction * 0.75 + delta / max(contact.x, 0.001) * 0.65) * strength;
    if (dot(candidate, candidate) > dot(push, push)) push = candidate;
  }
  bend += push;
  bend *= min(1.0, ${MAX_BEND} / max(length(bend), 0.001));
  vec3 offset = vec3(bend.x, -dot(push, push) * 0.45, bend.y) * bendWeight;
  // Placement has orthogonal axes (translation, yaw and uniform scale).
  vec3 x = placement[0].xyz, y = placement[1].xyz, z = placement[2].xyz;
  return position + vec3(dot(x, offset), dot(y, offset), dot(z, offset)) / dot(x, x);
}`;

const directLights = THREE.ShaderChunk.lights_fragment_begin;
const directionalEnd = directLights.indexOf('#if ( NUM_RECT_AREA_LIGHTS');
const directionalCall = directLights.lastIndexOf('RE_Direct( directLight', directionalEnd);
const callEnd = directLights.indexOf(';', directionalCall) + 1;
const backlight = `
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor
    * vec3(0.95, 1.0, 0.55) * grassTransmission * RECIPROCAL_PI
    * max(0.0, -dot(geometryNormal, directLight.direction));
`;

function patchMaterial(material, uniforms, lit, flatColorMix) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = bendSource + '\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', 'vec3 transformed = bendGrass(position);',
    );
    if (lit) {
      shader.fragmentShader = 'uniform float grassTransmission;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuse, ${flatColorMix.toFixed(3)});`,
      ).replace(
        '#include <lights_fragment_begin>',
        directLights.slice(0, callEnd) + backlight + directLights.slice(callEnd),
      );
    }
  };
  material.customProgramCacheKey = () => lit ? `vegetation-grass-lit-${flatColorMix}` : 'vegetation-grass-depth';
}

// Placements are world-space {x, y, z, yaw (radians), scale (>0), tint? [r, g, b] linear}.
// LOD geometries and texture are borrowed. Tiles and materials belong to the field.
export function createGrassField({scene, geometries, map, color, placements, tileSize = 5, flatColorMix = 0}) {
  if (directionalCall < 0 || directionalEnd < 0 || callEnd <= directionalCall) {
    throw new Error('Unsupported Three.js directional lighting shader');
  }
  const vectors = (length, Vector) => Array.from({length}, () => new Vector());
  const uniforms = {
    grassTime: {value: 0},
    grassWind: {value: new THREE.Vector2()},
    grassGust: {value: 0},
    grassTransmission: {value: 0},
    grassSweeps: {value: vectors(MAX_SWEEPS, THREE.Vector4)},
    grassContact: {value: vectors(MAX_SWEEPS, THREE.Vector2)},
  };
  const sweeps = [];
  const cutout = {map, alphaTest: 0.5, side: THREE.DoubleSide};
  const material = new THREE.MeshStandardMaterial({...cutout, color, roughness: 1, flatShading: true});
  const depth = new THREE.MeshDepthMaterial({...cutout, depthPacking: THREE.RGBADepthPacking});
  patchMaterial(material, uniforms, true, flatColorMix);
  patchMaterial(depth, uniforms, false);

  const cells = new Map();
  for (const placement of placements) {
    const key = `${Math.floor(placement.x / tileSize)},${Math.floor(placement.z / tileSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(placement);
  }
  const pose = new THREE.Object3D();
  const tiles = Array.from(cells.values(), entries => {
    const matrices = new THREE.InstancedBufferAttribute(new Float32Array(entries.length * 16), 16);
    // A placement may carry a tint [r, g, b] (linear) that multiplies the material colour per instance (instanceColor).
    const tinted = entries.some(entry => entry.tint);
    const tints = tinted ? new THREE.InstancedBufferAttribute(new Float32Array(entries.length * 3), 3) : null;
    entries.forEach(({x, y, z, yaw, scale, tint}, index) => {
      if (tints) tints.array.set(tint ?? [1, 1, 1], index * 3);
      pose.position.set(x, y, z);
      pose.rotation.y = yaw;
      pose.scale.setScalar(scale);
      pose.updateMatrix();
      matrices.array.set(pose.matrix.elements, index * 16);
    });
    const meshes = geometries.map(geometry => {
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.instanceMatrix = matrices;
      if (tints) mesh.instanceColor = tints;
      mesh.customDepthMaterial = depth;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += MAX_BEND + 0.08;
      scene.add(mesh);
      return mesh;
    });
    return {meshes, count: entries.length, bounds: meshes[0].boundingSphere};
  });

  const frustum = new THREE.Frustum();
  const projection = new THREE.Matrix4();
  const stats = {visibleTiles: 0, visibleClumps: 0, shadowTiles: 0, activeSweeps: 0};

  return {
    stats,
    addSweep({fromX, fromZ, toX, toZ, radius}) {
      sweeps.unshift({fromX, fromZ, toX, toZ, radius, age: 0});
      if (sweeps.length > MAX_SWEEPS) sweeps.pop();
    },
    clear() {
      sweeps.length = 0;
      uniforms.grassTime.value = 0;
    },
    setCutoff(value) {
      material.alphaTest = depth.alphaTest = value;
    },
    update(dt, {camera, windX, windZ, gust, transmission, lodDistance, farDensity, shadowDistance, density}) {
      uniforms.grassTime.value += dt;
      uniforms.grassWind.value.set(windX, windZ).multiplyScalar(0.035).clampLength(0, MAX_BEND);
      uniforms.grassGust.value = gust;
      uniforms.grassTransmission.value = transmission;
      for (const sweep of sweeps) sweep.age += dt;
      while (sweeps.at(-1)?.age >= RECOVERY_SECONDS) sweeps.pop();
      for (let i = 0; i < MAX_SWEEPS; i++) {
        const sweep = sweeps[i];
        uniforms.grassContact.value[i].set(sweep?.radius ?? 1, sweep ? 0.48 * (1 - sweep.age / RECOVERY_SECONDS) ** 2 : 0);
        if (sweep) uniforms.grassSweeps.value[i].set(sweep.fromX, sweep.fromZ, sweep.toX, sweep.toZ);
      }
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      stats.visibleTiles = stats.visibleClumps = stats.shadowTiles = 0;
      stats.activeSweeps = sweeps.length;
      for (const {meshes, count, bounds} of tiles) {
        const distance = Math.max(0, bounds.center.distanceTo(camera.position) - bounds.radius);
        const lod = distance > lodDistance ? 1 : 0;
        const mesh = meshes[lod];
        mesh.count = Math.round(count * density * (lod === 1 ? farDensity : 1));
        meshes[1 - lod].visible = false;
        mesh.visible = mesh.count > 0;
        mesh.castShadow = mesh.visible && shadowDistance > 0 && distance < shadowDistance;
        if (mesh.castShadow) stats.shadowTiles++;
        if (mesh.visible && frustum.intersectsSphere(mesh.boundingSphere)) {
          stats.visibleTiles++;
          stats.visibleClumps += mesh.count;
        }
      }
    },
    dispose() {
      for (const {meshes} of tiles) for (const mesh of meshes) {
        scene.remove(mesh);
        mesh.dispose();
      }
      material.dispose();
      depth.dispose();
    },
  };
}
