import * as THREE from 'three';
import {CLOUD_GLSL} from './cloud-density.js';
import {addLightSlot} from '../../core/light-slots.js';

const boundMaterials = new WeakSet();
// The sun among the directional lights is the one with its direction and colour: its light is dimmed by the cloud cover
// above the fragment (core light slot).
const SLOT = 'weather-cloud-shadows';
const DECLARATIONS = `uniform vec3 uWeatherShadowSun, uWeatherShadowColor;
 uniform float uWeatherShadowStrength;
 ${CLOUD_GLSL}`;
const CLOUD_SHADOW = `
 if (uWeatherShadowStrength > 0.0 && directLight.visible &&
     dot(directLight.direction, transformDirection(uWeatherShadowSun, viewMatrix)) > 0.99999 &&
     distance(directLight.color, uWeatherShadowColor) < 0.0001) {
  float visibility = cloudGroundTransmittance(vLightWorld, uWeatherShadowSun);
  directLight.color *= mix(1.0, visibility, uWeatherShadowStrength);
 }`;

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
   const remove = addLightSlot(material, {key: SLOT, uniforms, worldPosition: true, declarations: DECLARATIONS, directional: CLOUD_SHADOW});
   const detach = () => {
    if (receivers.get(material) !== detach) return;
    remove();
    receivers.delete(material);
    boundMaterials.delete(material);
   };
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
