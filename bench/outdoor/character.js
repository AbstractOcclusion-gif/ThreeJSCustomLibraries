import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createFootPlacement} from './foot-placement.js';

const BODY = {
 hips: 'hips', spine: 'spine.001', spine1: 'spine.002', spine2: 'spine.003',
 neck: 'neck', head: 'head',
};
const LIMBS = {shoulder: 'shoulder', arm: 'upper_arm', forearm: 'forearm', hand: 'hand',
 upleg: 'thigh', leg: 'shin', foot: 'foot', toebase: 'toe'};
const CHARACTER_HEIGHT = 1.75;
const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land'];
const FADE_SECONDS = .1;

function retargetLocomotion(source, target) {
 const sourceBones = new Map(), targetBones = new Map();
 source.scene.traverse(node => { if (node.isBone) sourceBones.set(node.name, node); });
 target.scene.traverse(node => { if (node.isBone) targetBones.set(node.name.split('_JNT_')[0], node); });
 source.scene.updateMatrixWorld(true);
 target.scene.updateMatrixWorld(true);
 const bindings = new Map();
 function bind(targetName, sourceName) {
  const bone = targetBones.get(targetName);
  const donor = sourceBones.get(THREE.PropertyBinding.sanitizeNodeName('DEF-' + sourceName));
  if (!bone || !donor) throw Error('Missing retarget joint ' + targetName);
  bindings.set(donor.name, {
   bone,
   sourceRestInverse: donor.quaternion.clone().invert(),
   axes: bone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(donor.getWorldQuaternion(new THREE.Quaternion())),
  });
 }
 for (const [name, donor] of Object.entries(BODY)) bind(name, donor);
 for (const side of ['l', 'r']) {
  for (const [name, donor] of Object.entries(LIMBS)) bind(side + '_' + name, donor + '.' + side.toUpperCase());
 }

 // Transfer rotation relative to each bind pose, expressed in the target bone's axes.
 // Pelvis and root translations stay with the target rig and the physics body.
 return CLIPS.map(name => {
  const clip = THREE.AnimationClip.findByName(source.animations, name);
  if (!clip) throw Error('Missing locomotion clip ' + name);
  const tracks = [];
  for (const track of clip.tracks) {
   const {nodeName, propertyName} = THREE.PropertyBinding.parseTrackName(track.name);
   const binding = bindings.get(nodeName);
   if (!binding || propertyName !== 'quaternion') continue;
   const {bone, axes, sourceRestInverse} = binding;
   const inverseAxes = axes.clone().invert(), rotation = new THREE.Quaternion();
   const values = new Float32Array(track.values.length);
   for (let i = 0; i < values.length; i += 4) {
    rotation.fromArray(track.values, i).premultiply(sourceRestInverse).premultiply(axes)
     .multiply(inverseAxes).premultiply(bone.quaternion).normalize().toArray(values, i);
   }
   tracks.push(new THREE.QuaternionKeyframeTrack(bone.name + '.quaternion', track.times, values));
  }
  if (tracks.length < bindings.size - 2) throw Error('Incomplete locomotion tracks in ' + name);
  return new THREE.AnimationClip(name, clip.duration, tracks);
 });
}

export async function loadCharacter(mode) {
 const loader = new GLTFLoader();
 let gltf, idle, walk, takeoff, airborne, land, label;
 if (mode === 'sci-fi') {
  gltf = await loader.loadAsync('/outdoor/sci-fi_male_character.glb');
  const nativeWalk = THREE.AnimationClip.findByName(gltf.animations, 'Walk_Front');
  if (!nativeWalk) throw Error('Missing sci-fi walk clip');
  walk = new THREE.AnimationClip(nativeWalk.name, nativeWalk.duration, nativeWalk.tracks.filter(track => {
   const {nodeName, propertyName} = THREE.PropertyBinding.parseTrackName(track.name);
   return propertyName !== 'position' || !/^(_rootJoint|root_|pelvis_)/.test(nodeName);
  }));
  label = 'Sci-fi character · native walk';
 } else {
  const [target, source] = await Promise.all([
   loader.loadAsync('/outdoor/character_animated.glb'), loader.loadAsync('/outdoor/locomotion.glb'),
  ]);
  gltf = target;
  [idle, walk, takeoff, airborne, land] = retargetLocomotion(source, target);
  label = 'Character animated · Quaternius locomotion';
 }
 const model = new THREE.Group();
 const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
 const center = bounds.getCenter(new THREE.Vector3()), height = bounds.max.y - bounds.min.y;
 if (!Number.isFinite(height) || height <= 0) throw Error('Invalid character bounds');
 const scale = CHARACTER_HEIGHT / height;
 gltf.scene.scale.multiplyScalar(scale);
 gltf.scene.position.addScaledVector(new THREE.Vector3(center.x, bounds.min.y, center.z), -scale);
 gltf.scene.traverse(node => { if (node.isMesh) { node.castShadow = true; node.frustumCulled = false; } });
 model.add(gltf.scene);
 const mixer = new THREE.AnimationMixer(gltf.scene);
 const actions = Object.fromEntries(Object.entries({idle, walk, takeoff, airborne, land})
  .filter(([, clip]) => clip).map(([name, clip]) => [name, mixer.clipAction(clip)]));
 for (const action of [actions.takeoff, actions.land]) {
  if (!action) continue;
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
 }
 const feet = mode === 'sci-fi' ? null : createFootPlacement(gltf.scene);
 let active;
 let previousGround, finished = false;
 const fading = new Map();
 mixer.addEventListener('finished', ({action}) => { if (action === active) finished = true; });
 function select(next, immediate = false) {
  if (active !== next) {
   if (active && next && !immediate) {
    active.fadeOut(FADE_SECONDS);
    fading.set(active, FADE_SECONDS);
   } else active?.stop();
   fading.delete(next);
   next?.reset().play();
   if (next && active && !immediate) next.fadeIn(FADE_SECONDS);
   active = next;
   finished = false;
  }
 }
 return {model, label, hasIdle: Boolean(idle), reset() {
  feet?.restore();
  mixer.stopAllAction();
  fading.clear();
  active = previousGround = undefined;
  finished = false;
 }, update(dt, {moving, grounded, jumped, preview, groundAt}) {
  feet?.restore();
  const locomotion = actions[moving ? 'walk' : 'idle'];
  if (preview || !actions.airborne) select(locomotion, preview);
  else if (jumped) select(actions.takeoff);
  else if (!grounded) {
   if (active !== actions.takeoff || finished) select(actions.airborne);
  } else if (previousGround === false) select(actions.land);
  else if (active !== actions.land || finished) select(locomotion);
  previousGround = preview ? undefined : grounded;
  mixer.update(dt);
  for (const [action, remaining] of fading) {
   if (remaining <= dt) { action.stop(); fading.delete(action); }
   else fading.set(action, remaining - dt);
  }
  if (grounded && !preview) feet?.apply(groundAt, moving);
 }};
}
