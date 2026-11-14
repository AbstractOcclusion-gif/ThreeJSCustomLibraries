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
const FADE_HALF_WIDTH = .1; // fraction of the switch distance on either side

function addDistanceFade(shader, far) {
  shader.vertexShader = `attribute float treeBlend; varying float vTreeBlend;\n${shader.vertexShader}`
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTreeBlend = treeBlend;');
  shader.fragmentShader = `varying float vTreeBlend;\n${shader.fragmentShader}`
    .replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      // Both levels use the same screen-space threshold and complementary masks.
      float threshold = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
      if (${far ? 'threshold >= vTreeBlend' : 'threshold < vTreeBlend'}) discard;
    `);
}

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
        vec4 treePosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          treePosition = instanceMatrix * treePosition;
        #endif
        vec3 treeWorld = (modelMatrix * treePosition).xyz;
        float weight = smoothstep(0.0, 5.0, treeWorld.y);
        ${distanceTest ? 'weight *= 1.0 - treeBlend;' : ''}
        float wave = sin(treeTime * 1.4 + dot(treeWorld.xz, vec2(.27, .19)));
        mvPosition.xyz += (viewMatrix * vec4(treeWind.x * wave * weight, 0.0, treeWind.y * wave * weight, 0.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
      `);
      if (distanceTest) addDistanceFade(shader, false);
    };
    material.customProgramCacheKey = () => distanceTest ? 'tree-wind-and-fade' : 'tree-wind';
  }
  model.position.set(-centre.x, -bounds.min.y, -centre.z);
  const placements = [];
  for (const {x, z, h, variant} of items) {
    const placement = new THREE.Group();
    placement.position.set(x, 0, z);
    placement.scale.setScalar(h / height);
    placement.rotation.y = variant * TURN / items.length;
    if (!distanceTest) placement.add(model.clone());
    placement.updateMatrix();
    placements.push(placement);
    if (!distanceTest) group.add(placement);
  }
  function addBatches(sourceModel, far) {
    sourceModel.updateMatrixWorld(true);
    sourceModel.traverse(source => {
      if (!source.isMesh) return;
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, placements.length);
      const blend = new THREE.InstancedBufferAttribute(new Float32Array(placements.length), 1).setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('treeBlend', blend);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.visible = false;
      mesh.count = 0;
      mesh.receiveShadow = !far;
      group.add(mesh);
      batches.push({mesh, blend, local: source.matrixWorld.clone(), far});
    });
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
    far.traverse(source => {
      if (!source.isMesh) return;
      source.material.onBeforeCompile = shader => addDistanceFade(shader, true);
      source.material.customProgramCacheKey = () => 'static-tree-fade';
    });
    addBatches(model, false);
    addBatches(far, true);
  }
  const blendValues = new Float32Array(placements.length);
  const matrix = new THREE.Matrix4();
  let lastCount = -1;
  let farCount = 0;
  let transitionCount = 0;
  let nearCount = placements.length;
  scene.add(group);
  return {
    group,
    get nearCount() { return nearCount; },
    get farCount() { return farCount; },
    get transitionCount() { return transitionCount; },
    updateDistance(camera, threshold, count) {
      let changed = count !== lastCount;
      lastCount = count;
      nearCount = 0;
      farCount = 0;
      transitionCount = 0;
      for (let index = 0; index < count; index++) {
        const distance = camera.position.distanceTo(placements[index].position);
        const blend = Math.fround(THREE.MathUtils.smoothstep(distance, threshold * (1 - FADE_HALF_WIDTH), threshold * (1 + FADE_HALF_WIDTH)));
        changed ||= blendValues[index] !== blend;
        blendValues[index] = blend;
        if (blend === 0) nearCount++;
        else if (blend === 1) farCount++;
        else transitionCount++;
      }
      if (!changed) return;
      for (const {mesh, blend, local, far} of batches) {
        let slot = 0;
        for (let index = 0; index < count; index++) {
          const value = blendValues[index];
          if (far ? value === 0 : value === 1) continue;
          mesh.setMatrixAt(slot, matrix.multiplyMatrices(placements[index].matrix, local));
          blend.setX(slot++, value);
        }
        mesh.count = slot;
        mesh.visible = slot > 0;
        mesh.instanceMatrix.needsUpdate = true;
        blend.needsUpdate = true;
        if (slot) mesh.computeBoundingSphere();
      }
    },
    update(dt) {
      if (!nearCount && !transitionCount) return;
      time.value += dt;
      const {speed, gust, x, z} = environment.wind;
      const strength = Math.min(WIND.maximum, speed * (WIND.perSpeed + gust * WIND.perGust));
      wind.value.set(x, z).normalize().multiplyScalar(strength * WIND.travel);
    },
    dispose,
  };
}
