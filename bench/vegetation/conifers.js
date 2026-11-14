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

export async function loadTreeModels({scene, profile, items, environment}) {
  const {scene: model} = await new GLTFLoader().loadAsync(models[profile]);
  const bounds = new THREE.Box3().setFromObject(model);
  const centre = bounds.getCenter(new THREE.Vector3());
  const height = bounds.max.y - bounds.min.y;
  const group = new THREE.Group();
  const time = {value: 0}, wind = {value: new THREE.Vector2()};
  const materials = new Set(), geometries = new Set(), textures = new Set();
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
    mesh.receiveShadow = true;
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
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
  for (const {x, z, h, variant} of items) {
    const placement = new THREE.Group();
    placement.position.set(x, 0, z);
    placement.scale.setScalar(h / height);
    placement.rotation.y = variant * TURN / items.length;
    placement.add(model.clone());
    group.add(placement);
  }
  scene.add(group);
  return {
    group,
    update(dt) {
      time.value += dt;
      const {speed, gust, x, z} = environment.wind;
      const strength = Math.min(WIND.maximum, speed * (WIND.perSpeed + gust * WIND.perGust));
      wind.value.set(x, z).normalize().multiplyScalar(strength * WIND.travel);
    },
    dispose() {
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
