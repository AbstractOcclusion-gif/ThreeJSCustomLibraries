import * as THREE from 'three';
import {CLOUD_GLSL} from './cloud-density.js';

const boundMaterials = new WeakSet();
const directionalLight = 'getDirectionalLightInfo( directionalLight, directLight );';
const surfaceLighting = THREE.ShaderChunk.lights_fragment_begin.replace(directionalLight, `${directionalLight}
 if (uWeatherShadowStrength > 0.0 && directLight.visible &&
     dot(directLight.direction, transformDirection(uWeatherShadowSun, viewMatrix)) > 0.99999 &&
     distance(directLight.color, uWeatherShadowColor) < 0.0001) {
  float visibility = cloudGroundTransmittance(vWeatherShadowPosition, uWeatherShadowSun);
  directLight.color *= mix(1.0, visibility, uWeatherShadowStrength);
 }
`);

export function createCloudShadows(cloudUniforms) {
 const receivers = new Map();
 const direction = new THREE.Vector3(), target = new THREE.Vector3(), color = new THREE.Color();
 const strength = {value: 0};
 const uniforms = {...cloudUniforms, uWeatherShadowSun: {value: direction}, uWeatherShadowColor: {value: color}, uWeatherShadowStrength: strength};
 return {
  add(material) {
   if (!material?.isMeshStandardMaterial) throw Error('Cloud shadows need a Three.js standard or physical material');
   if (receivers.has(material)) return receivers.get(material);
   if (boundMaterials.has(material)) throw Error('Cloud shadow material already belongs to another weather view');
   const previousCompile = material.onBeforeCompile;
   const previousKey = material.customProgramCacheKey;
   const compile = function(shader, renderer) {
    previousCompile.call(this, shader, renderer);
    const projection = '#include <project_vertex>';
    const lighting = '#include <lights_fragment_begin>';
    if (!shader.vertexShader.includes(projection) || !shader.fragmentShader.includes(lighting)) {
     throw Error('Cloud shadow receiver must retain the standard Three.js projection and lighting chunks');
    }
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vWeatherShadowPosition;\n' + shader.vertexShader.replace(projection, `${projection}
     vec4 weatherPosition = vec4(transformed, 1.0);
     #ifdef USE_BATCHING
      weatherPosition = batchingMatrix * weatherPosition;
     #endif
     #ifdef USE_INSTANCING
      weatherPosition = instanceMatrix * weatherPosition;
     #endif
     vWeatherShadowPosition = (modelMatrix * weatherPosition).xyz;
    `);
    shader.fragmentShader = `varying vec3 vWeatherShadowPosition;
     uniform vec3 uWeatherShadowSun, uWeatherShadowColor;
     uniform float uWeatherShadowStrength;
     ${CLOUD_GLSL}
    ` + shader.fragmentShader.replace(lighting, surfaceLighting);
   };
   const key = function() {
    const base = previousKey === THREE.Material.prototype.customProgramCacheKey ? previousCompile.toString() : previousKey.call(this);
    return `${base}:weather-cloud-shadows`;
   };
   const detach = () => {
    if (receivers.get(material) !== detach) return;
    material.onBeforeCompile = previousCompile;
    material.customProgramCacheKey = previousKey;
    material.needsUpdate = true;
    receivers.delete(material);
    boundMaterials.delete(material);
   };
   material.onBeforeCompile = compile;
   material.customProgramCacheKey = key;
   material.needsUpdate = true;
   receivers.set(material, detach);
   boundMaterials.add(material);
   return detach;
  },
  update(sun, amount) {
   strength.value = receivers.size ? amount : 0;
   if (strength.value === 0) return;
   sun.getWorldPosition(direction).sub(sun.target.getWorldPosition(target)).normalize();
   color.copy(sun.color).multiplyScalar(sun.intensity);
  },
  dispose() {
   for (const detach of receivers.values()) detach();
  },
 };
}
