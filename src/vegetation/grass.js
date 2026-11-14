import * as THREE from 'three';
import {createTrackMask} from '../core/track-mask.js';
import {addLightSlot} from '../core/light-slots.js';

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
uniform bool grassContactDirectional;
#ifdef GRASS_LIT
varying vec2 vGrassBlade;
#endif

vec3 bendGrass(vec3 position) {
  mat4 placement = modelMatrix * instanceMatrix;
  vec2 root = placement[3].xz;
  float phase = dot(root, vec2(1.71, 2.31));
  float wave = sin(grassTime * 1.7 - dot(root, vec2(0.47, 0.32)));
  vec2 bend = grassWind * (0.48 + grassGust * wave * 0.32
                          + 0.12 * sin(grassTime * 4.1 + phase));
  float contact = 0.0;
  vec2 lean = vec2(1.0, 0.0);
  if (grassContactActive) {
    vec2 uv = (root - grassContactBounds.xy) / grassContactBounds.zw;
    if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
      vec4 track = texture2D(grassContact, uv);
      contact = track.r;
      if (grassContactDirectional) {
        lean = track.gb * 2.0 - track.r;
        if (length(lean) > 0.012) {
          lean = normalize(lean);
          if (contact > 0.05 && contact < 0.85) {
            vec2 texel = 1.0 / vec2(textureSize(grassContact, 0));
            vec2 side = vec2(-lean.y, lean.x);
            vec2 stepUV = side * texel;
            float falloff = texture2D(grassContact, uv - stepUV).r
                          - texture2D(grassContact, uv + stepUV).r;
            lean = normalize(lean + side * clamp(falloff * 1.5, -0.55, 0.55));
          }
        } else {
          lean = vec2(1.0, 0.0);
        }
      }
    }
  }
  bend *= min(1.0, ${MAX_BEND} / max(length(bend), 0.001));
  float flatten = smoothstep(0.0, 0.8, contact);
#ifdef GRASS_LIT
  vGrassBlade = vec2(bendWeight, flatten);
#endif
  // Rotate about the root so a flattened blade keeps its length.
  float angle = 1.48 * flatten * bendWeight;
  // Placement has orthogonal axes (translation, yaw and uniform scale).
  vec3 x = placement[0].xyz, y = placement[1].xyz, z = placement[2].xyz;
  vec2 localLean = normalize(vec2(dot(x.xz, lean), dot(z.xz, lean)));
  float along = dot(position.xz, localLean);
  float c = cos(angle), s = sin(angle);
  position.xz += localLean * ((c - 1.0) * along + s * position.y);
  position.y = c * position.y - s * along;
  vec3 offset = vec3(bend.x, 0.0, bend.y) * bendWeight * (1.0 - flatten);
  return position + vec3(dot(x, offset), dot(y, offset), dot(z, offset)) / dot(x, x);
}`;

// Light through the blade, added after each directional light is applied (core light slot).
const backlight = `
  float grassBack = max(0.0, -dot(geometryNormal, directLight.direction));
  float grassForward = pow(max(0.0, dot(geometryViewDir, -directLight.direction)), 2.0);
  float grassThin = mix(0.3, 1.0, vGrassBlade.x);
  reflectedLight.directDiffuse += directLight.color * sqrt(max(material.diffuseColor, vec3(0.0)))
    * vec3(0.9, 1.0, 0.46) * grassTransmission * grassThin * RECIPROCAL_PI
    * grassBack * (0.35 + 0.65 * grassForward);
`;

function patchMaterial(material, uniforms, lit, flatColorMix) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = (lit ? '#define GRASS_LIT\n' : '') + bendSource + '\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', 'vec3 transformed = bendGrass(position);',
    );
    if (lit) {
      shader.fragmentShader = 'uniform float grassTransmission;\nvarying vec2 vGrassBlade;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuse, ${flatColorMix.toFixed(3)});`,
      ).replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.64, 1.10, vGrassBlade.x);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.63, 0.68, 0.51), vGrassBlade.y * 0.65);
      `);
    }
  };
  material.customProgramCacheKey = () => lit ? `vegetation-grass-lit-${flatColorMix}` : 'vegetation-grass-depth';
  if (lit) addLightSlot(material, {key: 'grass-backlight', directionalLit: backlight});
}

// Placements are world-space {x, y, z, yaw (radians), scale (>0), tint? [r, g, b] linear}.
// LOD geometries and map are borrowed. With followTracks, the host paints and clears the supplied mask.
const VIEW_DEFAULTS = Object.freeze({transmission: 1.45, lodDistance: 26, farDensity: .45, shadowDistance: 18, density: 1});
export function createGrassField({scene, geometries, map, color, placements, tileSize = 5, flatColorMix = 0, contactTracks, followTracks = false}) {
  const vectors = (length, Vector) => Array.from({length}, () => new Vector());
  const uniforms = {
    grassTime: {value: 0},
    grassWind: {value: new THREE.Vector2()},
    grassGust: {value: 0},
    grassTransmission: {value: 0},
    grassContact: {value: contactTracks?.texture ?? null},
    grassContactBounds: {value: contactTracks?.bounds ?? new THREE.Vector4()},
    grassContactActive: {value: Boolean(followTracks && contactTracks)},
    grassContactDirectional: {value: Boolean(contactTracks?.directional)},
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

  let heldEnvironment = null;
  return {
    stats,
    addSweep({fromX, fromZ, toX, toZ, radius}) {
      if (followTracks) return;
      if (!contactMask && !Number.isFinite(minX)) return;
      if (![fromX, fromZ, toX, toZ, radius].every(Number.isFinite) || radius <= 0) return;
      if (!contactMask) {
        contactMask = createTrackMask({origin: [minX - 1, minZ - 1], size: [maxX - minX + 2, maxZ - minZ + 2], resolution: 512, directional: true});
        uniforms.grassContact.value = contactMask.texture;
        uniforms.grassContactBounds.value.copy(contactMask.bounds);
        uniforms.grassContactDirectional.value = true;
      }
      sweeps.push({from: {x: fromX, z: fromZ}, to: {x: toX, z: toZ}, radius, age: 0});
    },
    clear() {
      sweeps.length = 0;
      if (!followTracks) {
        contactMask?.clear();
        uniforms.grassContactActive.value = false;
      }
      uniforms.grassTime.value = 0;
    },
    setCutoff(value) {
      material.alphaTest = depth.alphaTest = value;
    },
    // Optional shared environment (core/environment.js), held by reference; an `environment` passed to update() wins.
    setEnvironment(next) { heldEnvironment = next ?? null; },
    // Only `camera` is required. Wind comes from windX/windZ/gust, else from the environment (update's, else the held one), else calm.
    update(dt, {camera, environment = heldEnvironment, windX = environment?.wind.x ?? 0, windZ = environment?.wind.z ?? 0, gust = environment?.wind.gust ?? 0,
      transmission = VIEW_DEFAULTS.transmission * (environment?.daylight ?? 1), lodDistance = VIEW_DEFAULTS.lodDistance, farDensity = VIEW_DEFAULTS.farDensity,
      shadowDistance = VIEW_DEFAULTS.shadowDistance, density = VIEW_DEFAULTS.density, recoverySeconds = RECOVERY_SECONDS}) {
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
      uniforms.grassContactActive.value = followTracks ? Boolean(contactMask) : sweeps.length > 0;
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
      if (contactTracks) {
        if (!followTracks) contactTracks.clear();
      }
      else contactMask?.dispose();
      material.dispose();
      depth.dispose();
    },
  };
}
