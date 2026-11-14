import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const models = {
  pine: new URL('../../assets/trees/pine.glb', import.meta.url).href,
  spruce: new URL('../../assets/trees/spruce.glb', import.meta.url).href,
  'ez-oak': new URL('../../assets/trees/ez-oak.glb', import.meta.url).href,
  'ez-spruce': new URL('../../assets/trees/ez-spruce.glb', import.meta.url).href,
  'ez-birch': new URL('../../assets/trees/ez-birch.glb', import.meta.url).href,
  'ez-bush': new URL('../../assets/trees/ez-bush.glb', import.meta.url).href,
};
const WIND = {maximum: 3, perSpeed: .08, perGust: .1, travel: .16};
const TURN = Math.PI * 2;
const distantModels = {
  'ez-oak': new URL('../../assets/trees/ez-oak-lod2.glb', import.meta.url).href,
  'ez-spruce': new URL('../../assets/trees/ez-spruce-lod2.glb', import.meta.url).href,
  'ez-birch': new URL('../../assets/trees/ez-birch-lod2.glb', import.meta.url).href,
  'ez-bush': new URL('../../assets/trees/ez-bush-lod2.glb', import.meta.url).href,
};
const LOD_HYSTERESIS = .08;

function collectResources(model, geometries, materials, textures) {
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
    for (const value of Object.values(mesh.material)) if (value?.isTexture) textures.add(value);
  });
}

export async function loadTreeModels({scene, profile, items, environment, distanceTest = false}) {
  const loader = new GLTFLoader();
  const {scene: model} = await loader.loadAsync(models[profile]);
  const bounds = new THREE.Box3().setFromObject(model);
  const centre = bounds.getCenter(new THREE.Vector3());
  const height = bounds.max.y - bounds.min.y;
  const group = new THREE.Group();
  const time = {value: 0}, wind = {value: new THREE.Vector2()};
  const materials = new Set(), geometries = new Set(), textures = new Set();
  const batches = [];
  function dispose() {
    group.removeFromParent();
    for (const {mesh} of batches) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }
  collectResources(model, geometries, materials, textures);
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.receiveShadow = true;
  });
  for (const material of materials) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {treeTime: time, treeWind: wind});
      shader.vertexShader = `
        uniform float treeTime;
        uniform vec2 treeWind;
        ${shader.vertexShader}
      `.replace('#include <project_vertex>', `
        #include <project_vertex>
        vec3 treeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float weight = smoothstep(0.0, 5.0, treeWorld.y);
        float wave = sin(treeTime * 1.4 + dot(treeWorld.xz, vec2(.27, .19)));
        mvPosition.xyz += (viewMatrix * vec4(treeWind.x * wave * weight, 0.0, treeWind.y * wave * weight, 0.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
      `);
    };
  }
  model.position.set(-centre.x, -bounds.min.y, -centre.z);
  const placements = [];
  for (const {x, z, h, variant} of items) {
    const placement = new THREE.Group();
    placement.position.set(x, 0, z);
    placement.scale.setScalar(h / height);
    placement.rotation.y = variant * TURN / items.length;
    placement.add(model.clone());
    placement.updateMatrix();
    placements.push(placement);
    group.add(placement);
  }
  if (distanceTest) {
    let far;
    try {
      ({scene: far} = await loader.loadAsync(distantModels[profile]));
    } catch (error) {
      dispose();
      throw error;
    }
    collectResources(far, geometries, materials, textures);
    // Anchor both levels in the full model's coordinate system.
    far.position.copy(model.position);
    far.updateMatrixWorld(true);
    far.traverse(source => {
      if (!source.isMesh) return;
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, placements.length);
      mesh.count = 0;
      group.add(mesh);
      batches.push({mesh, local: source.matrixWorld.clone()});
    });
  }
  const distant = new Array(placements.length).fill(false);
  const matrix = new THREE.Matrix4();
  let distanceInitialized = false;
  let nearCount = placements.length;
  scene.add(group);
  return {
    group,
    get nearCount() { return nearCount; },
    get farCount() { return placements.length - nearCount; },
    updateDistance(camera, threshold) {
      let changed = !distanceInitialized;
      nearCount = 0;
      for (const [index, placement] of placements.entries()) {
        const distance = camera.position.distanceTo(placement.position);
        const boundary = distanceInitialized && distant[index] ? threshold * (1 - LOD_HYSTERESIS) : threshold;
        const next = distance >= boundary;
        changed ||= next !== distant[index];
        distant[index] = next;
        placement.visible = !next;
        nearCount += Number(!next);
      }
      if (!changed) return;
      distanceInitialized = true;
      for (const {mesh, local} of batches) {
        let slot = 0;
        for (const [index, placement] of placements.entries()) {
          if (distant[index]) mesh.setMatrixAt(slot++, matrix.multiplyMatrices(placement.matrix, local));
        }
        mesh.count = slot;
        mesh.visible = slot > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (slot) mesh.computeBoundingSphere();
      }
    },
    update(dt) {
      if (!nearCount) return;
      time.value += dt;
      const {speed, gust, x, z} = environment.wind;
      const strength = Math.min(WIND.maximum, speed * (WIND.perSpeed + gust * WIND.perGust));
      wind.value.set(x, z).normalize().multiplyScalar(strength * WIND.travel);
    },
    dispose,
  };
}
