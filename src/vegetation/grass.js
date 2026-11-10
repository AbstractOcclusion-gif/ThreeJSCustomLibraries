import * as THREE from 'three';
import {createTrackMask} from '../surface/tracks.js';

const RECOVERY_SECONDS = 0.9;
const MAX_BEND = 0.38;

const bendSource = `
attribute float bendWeight;
uniform float grassTime;
uniform vec2 grassWind;
uniform float grassGust;
uniform sampler2D grassContact;
uniform vec4 grassContactBounds;
uniform bool grassContactActive;

vec3 bendGrass(vec3 position) {
  mat4 placement = modelMatrix * instanceMatrix;
  vec2 root = placement[3].xz;
  float phase = dot(root, vec2(1.71, 2.31));
  float wave = sin(grassTime * 1.7 - dot(root, vec2(0.47, 0.32)));
  vec2 bend = grassWind * (0.48 + grassGust * wave * 0.32
                          + 0.12 * sin(grassTime * 4.1 + phase));
  float contact = 0.0;
  if (grassContactActive) {
    vec2 uv = (root - grassContactBounds.xy) / grassContactBounds.zw;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      contact = texture2D(grassContact, uv).r;
    }
  }
  bend *= min(1.0, ${MAX_BEND} / max(length(bend), 0.001));
  float flatten = smoothstep(0.0, 0.8, contact);
  // Rotate about the root so a flattened blade keeps its length.
  float angle = 1.48 * flatten * bendWeight;
  float bladeY = position.y;
  float bladeX = position.x;
  position.x = cos(angle) * bladeX + sin(angle) * bladeY;
  position.y = cos(angle) * bladeY - sin(angle) * bladeX;
  vec3 offset = vec3(bend.x, 0.0, bend.y) * bendWeight * (1.0 - flatten);
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
// LOD geometries and map are borrowed. An optional contact mask is borrowed exclusively for this field's trail.
export function createGrassField({scene, geometries, map, color, placements, tileSize = 5, flatColorMix = 0, contactTracks}) {
  if (directionalCall < 0 || directionalEnd < 0 || callEnd <= directionalCall) {
    throw new Error('Unsupported Three.js directional lighting shader');
  }
  const vectors = (length, Vector) => Array.from({length}, () => new Vector());
  const uniforms = {
    grassTime: {value: 0},
    grassWind: {value: new THREE.Vector2()},
    grassGust: {value: 0},
    grassTransmission: {value: 0},
    grassContact: {value: contactTracks?.texture ?? null},
    grassContactBounds: {value: contactTracks?.bounds ?? new THREE.Vector4()},
    grassContactActive: {value: false},
  };
  const sweeps = [];
  let contactMask = contactTracks;
  const cutout = {map, alphaTest: 0.5, side: THREE.DoubleSide};
  const material = new THREE.MeshStandardMaterial({...cutout, color, roughness: 1, flatShading: true});
  const depth = new THREE.MeshDepthMaterial({...cutout, depthPacking: THREE.RGBADepthPacking});
  patchMaterial(material, uniforms, true, flatColorMix);
  patchMaterial(depth, uniforms, false);

  const cells = new Map();
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const placement of placements) {
    minX = Math.min(minX, placement.x); maxX = Math.max(maxX, placement.x);
    minZ = Math.min(minZ, placement.z); maxZ = Math.max(maxZ, placement.z);
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
      if (!contactMask && !Number.isFinite(minX)) return;
      if (![fromX, fromZ, toX, toZ, radius].every(Number.isFinite) || radius <= 0) return;
      if (!contactMask) {
        contactMask = createTrackMask({origin: [minX - 1, minZ - 1], size: [maxX - minX + 2, maxZ - minZ + 2], resolution: 512});
        uniforms.grassContact.value = contactMask.texture;
        uniforms.grassContactBounds.value.copy(contactMask.bounds);
      }
      sweeps.push({from: {x: fromX, z: fromZ}, to: {x: toX, z: toZ}, radius, age: 0});
    },
    clear() {
      sweeps.length = 0;
      contactMask?.clear();
      uniforms.grassContactActive.value = false;
      uniforms.grassTime.value = 0;
    },
    setCutoff(value) {
      material.alphaTest = depth.alphaTest = value;
    },
    update(dt, {camera, windX, windZ, gust, transmission, lodDistance, farDensity, shadowDistance, density, recoverySeconds = RECOVERY_SECONDS}) {
      uniforms.grassTime.value += dt;
      uniforms.grassWind.value.set(windX, windZ).multiplyScalar(0.035).clampLength(0, MAX_BEND);
      uniforms.grassGust.value = gust;
      uniforms.grassTransmission.value = transmission;
      if (sweeps.length) {
        const recovery = Math.max(.01, Number.isFinite(recoverySeconds) ? recoverySeconds : RECOVERY_SECONDS);
        for (const sweep of sweeps) sweep.age += dt;
        let expired = 0;
        while (expired < sweeps.length && sweeps[expired].age >= recovery) expired++;
        if (expired) sweeps.splice(0, expired);
        contactMask.clear();
        for (const sweep of sweeps) {
          const strength = 1 - THREE.MathUtils.smoothstep(sweep.age, 0, recovery);
          contactMask.stamp(sweep.from, sweep.to, sweep.radius, strength);
        }
      }
      uniforms.grassContactActive.value = sweeps.length > 0;
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
      if (contactTracks) contactTracks.clear();
      else contactMask?.dispose();
      material.dispose();
      depth.dispose();
    },
  };
}
