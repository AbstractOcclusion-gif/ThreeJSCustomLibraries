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
const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Jog_Fwd_Loop', 'Sprint_Loop'];
const FADE_SECONDS = .1;
const AIR_STATES = ['takeoff', 'airborne', 'land'];
// Gait blending. startSpeed (m/s): below it the idle takes over. minRate / maxRate: how far a clip may be slowed or
// sped up to match the ground speed. samples: poses read per clip to measure its stride. minStride (m/s): a slower
// measure means the feet could not be read, and the clips then play at their own rate. stretch: a gait is kept on its
// own, played faster, up to this many times its stride speed before the next gait starts to blend in (quicker steps
// rather than longer ones).
const GAIT = {startSpeed: .5, minRate: .5, maxRate: 1.6, samples: 48, minStride: .1, stretch: 1.2};
const FOOT_BONES = ['l_foot', 'r_foot'];

// Ground speed an in-place gait clip was animated for: the planted (lower) foot slides back under the body at that speed.
function strideSpeed(mixer, action, root, feet) {
 if (feet.some(foot => !foot)) return null;
 const duration = action.getClip().duration, last = feet.map(() => new THREE.Vector3()), now = feet.map(() => new THREE.Vector3());
 let travelled = 0;
 action.reset().setEffectiveWeight(1).play();
 for (let i = 0; i <= GAIT.samples; i++) {
  action.time = i / GAIT.samples * duration;
  mixer.update(0);
  root.updateMatrixWorld(true);
  feet.forEach((foot, side) => foot.getWorldPosition(now[side]));
  const planted = now[0].y < now[1].y ? 0 : 1;
  if (i > 0) travelled += Math.hypot(now[planted].x - last[planted].x, now[planted].z - last[planted].z);
  feet.forEach((foot, side) => last[side].copy(now[side]));
 }
 action.stop();
 const speed = travelled / duration;
 return speed > GAIT.minStride ? speed : null;
}
// 0 at `from`, 1 at `to`; 1 when the two coincide.
const ramp = (from, to, value) => to > from ? THREE.MathUtils.clamp((value - from) / (to - from), 0, 1) : 1;

// Characters that take the Quaternius locomotion clips. `bot` ships with the repo (assets/character/README.md); the
// others are local drop-ins served from private-assets.
const RIGS = {
 bot: {model: new URL('../../assets/character/mixamo-bot-lowpoly.glb', import.meta.url).href,
  locomotion: new URL('../../assets/character/locomotion.glb', import.meta.url).href, label: 'Mixamo bot · Quaternius locomotion'},
 preferred: {model: '/outdoor/character_animated.glb', locomotion: '/outdoor/locomotion.glb', label: 'Character animated · Quaternius locomotion'},
};

// One name per joint whatever the rig calls it: 'l_upleg_JNT_12' and 'mixamorigLeftUpLeg_047' both give 'l_upleg'.
function jointKey(name) {
 return name.split('_JNT_')[0].replace(/^mixamorig:?/, '').replace(/_\d+$/, '')
  .replace(/^(Left|Right)/, side => side[0].toLowerCase() + '_').toLowerCase();
}

function retargetLocomotion(source, target) {
 const sourceBones = new Map(), targetBones = new Map();
 source.scene.traverse(node => { if (node.isBone) sourceBones.set(node.name, node); });
 target.scene.traverse(node => { if (node.isBone) targetBones.set(jointKey(node.name), node); });
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

 // Pelvis travel. The gaits bend the knees and count on the pelvis dropping with them (left at standing height, the
 // feet hang in the air), and a walk without its side-to-side sway reads as stiff. The clips are in place, so the
 // whole travel is taken, scaled by leg length; the physics body still owns where the character is.
 const pelvis = targetBones.get('hips'), donorPelvis = sourceBones.get(THREE.PropertyBinding.sanitizeNodeName('DEF-hips'));
 const from = new THREE.Vector3(), to = new THREE.Vector3();
 const legLength = joints => joints.reduce((length, joint, i) => i ? length + joints[i - 1].getWorldPosition(from).distanceTo(joint.getWorldPosition(to)) : 0, 0);
 const legRatio = legLength(['l_upleg', 'l_leg', 'l_foot'].map(name => targetBones.get(name)))
  / legLength(['thigh.L', 'shin.L', 'foot.L'].map(name => sourceBones.get(THREE.PropertyBinding.sanitizeNodeName('DEF-' + name))));
 const donorToWorld = new THREE.Matrix3().setFromMatrix4(donorPelvis.parent.matrixWorld);
 const worldToPelvis = new THREE.Matrix3().setFromMatrix4(pelvis.parent.matrixWorld).invert();

 // Transfer rotation relative to each bind pose, expressed in the target bone's axes.
 return CLIPS.map(name => {
  const clip = THREE.AnimationClip.findByName(source.animations, name);
  if (!clip) throw Error('Missing locomotion clip ' + name);
  const tracks = [];
  for (const track of clip.tracks) {
   const {nodeName, propertyName} = THREE.PropertyBinding.parseTrackName(track.name);
   const binding = bindings.get(nodeName);
   if (nodeName === donorPelvis.name && propertyName === 'position') {
    const values = new Float32Array(track.values.length), travel = new THREE.Vector3();
    for (let i = 0; i < values.length; i += 3) {
     travel.fromArray(track.values, i).sub(donorPelvis.position).applyMatrix3(donorToWorld).multiplyScalar(legRatio)
      .applyMatrix3(worldToPelvis).add(pelvis.position).toArray(values, i);
    }
    tracks.push(new THREE.VectorKeyframeTrack(pelvis.name + '.position', track.times, values));
    continue;
   }
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
 let gltf, idle, walk, takeoff, airborne, land, jog, sprint, label;
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
  const rig = RIGS[mode];
  if (!rig) throw Error('Unknown character ' + mode);
  const [target, source] = await Promise.all([loader.loadAsync(rig.model), loader.loadAsync(rig.locomotion)]);
  gltf = target;
  [idle, walk, takeoff, airborne, land, jog, sprint] = retargetLocomotion(source, target);
  label = rig.label;
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
 const actions = Object.fromEntries(Object.entries({idle, walk, jog, sprint, takeoff, airborne, land})
  .filter(([, clip]) => clip).map(([name, clip]) => [name, mixer.clipAction(clip)]));
 for (const action of [actions.takeoff, actions.land]) {
  if (!action) continue;
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
 }
 const bones = new Map();
 gltf.scene.traverse(node => { if (node.isBone) bones.set(jointKey(node.name), node); });
 // Ankle height above the sole, read on the bind pose: the model stands on y = 0 here.
 gltf.scene.updateMatrixWorld(true);
 const ankle = bones.get(FOOT_BONES[0])?.getWorldPosition(new THREE.Vector3()).y;
 const feet = mode === 'sci-fi' ? null : createFootPlacement(bones, ankle);
 const soles = FOOT_BONES.map(name => bones.get(name));
 // Slowest first. Calibrated: every gait's stride speed could be measured, so playback can follow the ground speed.
 const gaits = [actions.walk, actions.jog, actions.sprint].filter(Boolean)
  .map(action => ({action, duration: action.getClip().duration, speed: strideSpeed(mixer, action, gltf.scene, soles), weight: 0}));
 const calibrated = gaits.length > 0 && gaits.every(gait => gait.speed);
 if (calibrated) gaits.sort((a, b) => a.speed - b.speed);
 // Gait clips are placed by `phase` (0..1 of a stride) so blended gaits stay in step; the mixer never advances them.
 for (const gait of gaits) gait.action.timeScale = 0;
 const air = Object.fromEntries(AIR_STATES.map(name => [name, 0]));
 let state = 'ground', ground = 1, phase = 0, previousGround, finished = false;
 mixer.addEventListener('finished', ({action}) => { if (action === actions[state]) finished = true; });
 function start() {
  mixer.stopAllAction();
  for (const action of [actions.idle, ...gaits.map(gait => gait.action)]) action?.setEffectiveWeight(0).play();
  for (const gait of gaits) gait.weight = 0;
  for (const name of AIR_STATES) air[name] = 0;
  state = 'ground'; ground = 1; phase = 0; previousGround = undefined; finished = false;
 }
 start();
 return {model, label, hasIdle: Boolean(idle), gaitSpeeds: gaits.map(gait => gait.speed), reset() {
  feet?.restore();
  start();
 }, update(dt, {moving, speed = 0, grounded, jumped, preview, groundAt}) {
  feet?.restore();
  // Landing on the move goes straight back to the gait: the landing clip stands still, and the body would slide under it.
  const pace = preview ? (moving ? gaits[0]?.speed ?? GAIT.startSpeed : 0) : speed, travelling = pace >= GAIT.startSpeed;
  let next = state;
  if (preview || !actions.airborne) next = 'ground';
  else if (jumped) next = 'takeoff';
  else if (!grounded) { if (state !== 'takeoff' || finished) next = 'airborne'; }
  else if (previousGround === false) next = travelling ? 'ground' : 'land';
  else if (state !== 'land' || finished || travelling) next = 'ground';
  previousGround = preview ? undefined : grounded;
  if (next !== state) {
   state = next;
   finished = false;
   if (state !== 'ground') actions[state]?.reset().play();
  }
  // Every weight moves toward its target over FADE_SECONDS; previews cut.
  const step = preview ? 1 : dt / FADE_SECONDS;
  const approach = (value, target) => value + THREE.MathUtils.clamp(target - value, -step, step);
  for (const name of AIR_STATES) {
   const action = actions[name];
   if (!action) continue;
   const before = air[name];
   air[name] = approach(before, state === name ? 1 : 0);
   action.setEffectiveWeight(air[name]);
   if (before > 0 && air[name] === 0) action.stop();
  }
  ground = approach(ground, state === 'ground' ? 1 : 0);

  // Ground speed picks the gaits: each one is at full weight from its own stride speed up to the handover speed, where
  // the next gait blends in; the handover never passes the midpoint between two gaits.
  const handover = (slow, fast) => Math.min(slow.speed * GAIT.stretch, (slow.speed + fast.speed) / 2);
  const moveShare = gaits.length ? Math.min(1, pace / GAIT.startSpeed) : 0;
  let total = 0;
  gaits.forEach((gait, i) => {
   const slower = gaits[i - 1], faster = gaits[i + 1];
   const share = !calibrated ? Number(i === 0)
    : pace <= gait.speed ? (slower ? ramp(handover(slower, gait), gait.speed, pace) : 1)
    : (faster ? 1 - ramp(handover(gait, faster), faster.speed, pace) : 1);
   gait.weight = approach(gait.weight, share);
   total += gait.weight;
  });
  let stride = 0, cycle = 0;
  for (const gait of gaits) {
   const share = total > 0 ? gait.weight / total : 0;
   stride += share * (gait.speed ?? 0);
   cycle += share * gait.duration;
  }
  const rate = calibrated && stride > 0 ? THREE.MathUtils.clamp(pace / stride, GAIT.minRate, GAIT.maxRate) : 1;
  if (cycle > 0) phase = (phase + dt * rate / cycle) % 1;
  for (const gait of gaits) {
   gait.action.time = phase * gait.duration;
   gait.action.setEffectiveWeight(total > 0 ? ground * moveShare * gait.weight / total : 0);
  }
  actions.idle?.setEffectiveWeight(ground * (1 - moveShare));
  mixer.update(dt);
  if (grounded && !preview) feet?.apply(groundAt, moving);
 }};
}
