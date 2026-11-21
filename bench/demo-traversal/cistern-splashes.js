import * as THREE from 'three';
import {createImpactSplash, createParticleDepthBinding, createSplashLook} from '../../src/particles/water/index.js';

const LOOK = {height: 1.4, size: .95, life: .65};
const BURST = {stepAmount: .52, landingAmount: 1.15, strengthGain: 1.2, chunkRadius: .16};
const FOAM = {radiusScale: 1.2, stepAmount: .36, landingAmount: .46};

export function createCisternSplashes({renderer, camera, pond, sky, level, foam}) {
 const scene = new THREE.Scene();
 const depth = createParticleDepthBinding({THREE, camera, depthTexture: pond.depthTexture, viewport: pond.viewport,
  waterPlane: new THREE.Vector4(0, 1, 0, -level)});
 const splash = createImpactSplash({THREE, scene, depth, look: {...createSplashLook(), ...LOOK},
  lighting: {direction: sky.uniforms.uSkySun.value, uniforms: {uSunCol: sky.uniforms.uSunCol, uFxAmbient: sky.uniforms.uAmb}}});
 splash.ready.catch(error => console.warn('Cistern splash crown could not load', error));
 // The shader reads the pond capture for occlusion. The screen depth can belong to the post pass.
 for (const mesh of splash.meshes) mesh.material.depthTest = false;
 const impact = new THREE.Vector3();
 const points = [new THREE.Vector3(), new THREE.Vector3()];
 const feet = points.map(() => ({previous: new THREE.Vector3(), planted: false, sprayed: false}));
 const probe = new THREE.Vector3(), normal = new THREE.Vector3();
 let sampled = false, pendingLanding;
 function emit(x, z, strength, radius, landing) {
  splash.show.crown = splash.show.jets = landing;
  splash.show.chunks = landing || radius > BURST.chunkRadius;
  splash.emit(impact.set(x, level, z), strength * BURST.strengthGain, radius,
   landing ? BURST.landingAmount : BURST.stepAmount);
  foam.deposit(x, z, radius * FOAM.radiusScale, strength * (landing ? FOAM.landingAmount : FOAM.stepAmount));
 }
 return {
  land(x, z, strength, radius) { pendingLanding = {x, z, strength, radius}; },
  trackFeet(avatar, groundAt, levelAt, profileAtDepth) {
   avatar?.sampleFeet(points);
   if (pendingLanding) {
    const {x, z, strength, radius} = pendingLanding;
    const wetFeet = avatar ? points.filter(point => point.y <= level && Number.isFinite(levelAt(point.x, point.z))) : [];
    const at = wetFeet.length === 2 && wetFeet[1].y < wetFeet[0].y ? wetFeet[1] : wetFeet[0] ?? {x, z};
    emit(at.x, at.z, strength, radius, true);
   }
   for (const [side, point] of points.entries()) {
    const foot = feet[side];
    if (!sampled || point.y > level || (foot.planted && !point.planted)) foot.sprayed = false;
    if (avatar && sampled && point.y <= level && !foot.sprayed) {
     const crossed = foot.previous.y > level;
     if (crossed || (point.planted && !foot.planted)) {
      const at = crossed ? probe.copy(foot.previous).lerp(point, (foot.previous.y - level) / (foot.previous.y - point.y)) : point;
      const surface = levelAt(at.x, at.z);
      if (Number.isFinite(surface)) {
       const depth = surface - groundAt(probe.set(at.x, surface, at.z), normal);
       if (depth > 0 && !pendingLanding) {
        const {strength, radius} = profileAtDepth(depth);
        emit(at.x, at.z, strength, radius, false);
       }
       foot.sprayed = depth > 0;
      }
     }
    }
    foot.previous.copy(point);
    foot.planted = point.planted;
   }
   sampled = Boolean(avatar);
   pendingLanding = undefined;
  },
  update(dt) { splash.update(dt); foam.update(dt); },
  clear() { splash.clear(); foam.clear(); sampled = false; pendingLanding = undefined; },
  draw() {
   if (!splash.active) return;
   depth.update();
   const autoClear = renderer.autoClear;
   renderer.autoClear = false;
   try { renderer.render(scene, camera); }
   finally { renderer.autoClear = autoClear; }
  },
  dispose: splash.dispose,
 };
}
