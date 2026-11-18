// The course's light, wired as the lighting tool's bench wires it: the kit's sun shadows and a rig of lamps on the basic
// stage, the air lit by both (the kit's settings for a world: WORLD_LIGHT), and the camera tool's post over the frame.
// How much of it is drawn is the tier's choice (quality.js): all of it on a desktop, a lean set on a phone.
import * as THREE from 'three';
import {createBasicStage} from '../../src/stage/index.js';
import {createCameraPost} from '../../src/camera/index.js';
import {createLightRig, createSunShadows, createVolumetricLight} from '../../src/lighting/index.js';
import {createShadowReceivers} from '../kit/shadow-receivers.js';
import {WORLD_LIGHT} from '../kit/world-settings.js';
import {GYM_LAMPS} from './gymnasium.js';

// The air: its colour, and how fast things fade into it with distance (1/m).
const AIR = {color: 0x889799, fog: .018};
const MS = 1000;

// size: the course's side (m). quality: pickQuality()'s tier.
export function createCourseLight({renderer, scene, quality, size}) {
 const rig = createLightRig(quality.lampShadows ? {shadows: {renderer}} : {}), sunShadows = createSunShadows({renderer, ...quality.sunShadows});
 const stage = createBasicStage({scene, groundSize: size, ground: false, lights: rig.lights, sun: sunShadows.sun});
 const volumetric = quality.air ? createVolumetricLight({renderer, sun: sunShadows.sun, rig, density: WORLD_LIGHT.airDensity}) : null;
 volumetric?.set('sun', WORLD_LIGHT.sunInAir);
 const post = createCameraPost(renderer);
 post.settings.enabled = quality.post;
 post.settings.ao = quality.ao;
 const receivers = createShadowReceivers(scene, sunShadows, null, quality.lampShadows ? rig : null);
 const lamps = GYM_LAMPS.at.map(([x, z]) => {
  const lamp = new THREE.PointLight(GYM_LAMPS.color, GYM_LAMPS.intensity, GYM_LAMPS.distance, GYM_LAMPS.decay);
  lamp.position.set(x, GYM_LAMPS.height, z);
  scene.add(lamp);
  rig.add(lamp, {shadow: quality.lampShadows});
  return lamp;
 });
 scene.background = new THREE.Color(AIR.color);
 scene.fog = new THREE.FogExp2(AIR.color, AIR.fog);
 stage.setSun(38, 42);
 stage.setGround(new THREE.Color(0x67543e), .65);
 let lastScan = -Infinity;   // ms: when lit materials were last looked for (the avatar's arrive once it is loaded)
 return {
  stage, rig, sunShadows, volumetric, post, lamps,
  // Before the frame's own updates: the stage follows the camera, and new lit materials are looked for now and then.
  prepare(camera, now) {
   stage.update(camera);
   if (now - lastScan >= WORLD_LIGHT.scanSeconds * MS) { lastScan = now; receivers.update(); }
  },
  shadows(camera) {
   rig.update(camera.position);
   sunShadows.render(scene, camera, stage.environment.sun.direction);
   if (quality.lampShadows) rig.renderShadows(scene);
  },
  present(camera, dt) { post.render(scene, camera, dt, volumetric?.capture(scene, camera, stage.environment)); },
  dispose() {
   receivers.dispose(); post.dispose(); volumetric?.dispose(); sunShadows.dispose(); rig.dispose();
   for (const lamp of lamps) { scene.remove(lamp); lamp.dispose(); }
   stage.dispose();
  },
 };
}
