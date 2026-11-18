import {AnimationClip, Matrix3, Vector3, VectorKeyframeTrack} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadTraversalAvatar} from './avatar.js';
import {retargetRotationTrack} from '../../src/character/clips/traversal-clips.js';

const BOT = new URL('../../assets/character/mixamo-bot-lowpoly.glb', import.meta.url).href;
const HIPS = 'mixamorigHips';
const LEG = ['mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot'];
const canonicalName = name => name.replace(/^mixamorig:?/, 'mixamorig').replace(/_\d+$/, '');

export async function loadBotRig(loadModel = url => new GLTFLoader().loadAsync(url)) {
 const {scene: rig} = await loadModel(BOT);
 rig.traverse(node => {
  if (node.isBone && node.name.startsWith('mixamorig')) node.name = canonicalName(node.name);
 });
 return {rig};
}

function legLength(rig) {
 const joints = LEG.map(name => rig.getObjectByName(name)?.getWorldPosition(new Vector3()));
 if (joints.some(joint => !joint)) throw Error('Mixamo clip or bot is missing a leg joint');
 return joints[0].distanceTo(joints[1]) + joints[1].distanceTo(joints[2]);
}

export function adaptMixamoToBot(source, rig) {
 const clip = source.animations[0];
 source.updateMatrixWorld(true);
 rig.updateMatrixWorld(true);
 const donorHips = source.getObjectByName(HIPS), targetHips = rig.getObjectByName(HIPS);
 const donorToWorld = new Matrix3().setFromMatrix4(donorHips.parent.matrixWorld);
 const worldToTarget = new Matrix3().setFromMatrix4(targetHips.parent.matrixWorld).invert();
 const ratio = legLength(rig) / legLength(source);
 const tracks = [], position = new Vector3();
 for (const track of clip.tracks) {
  const [joint, property] = track.name.split('.');
  const donor = source.getObjectByName(joint), target = rig.getObjectByName(canonicalName(joint));
  if (!donor || !target) continue;
  if (property === 'quaternion') tracks.push(retargetRotationTrack(track, donor, target));
  if (property !== 'position' || donor !== donorHips) continue;
  const values = new Float32Array(track.values.length);
  for (let i = 0; i < values.length; i += 3) {
   position.fromArray(track.values, i).sub(donorHips.position).applyMatrix3(donorToWorld)
    .multiplyScalar(ratio).applyMatrix3(worldToTarget).add(targetHips.position).toArray(values, i);
  }
  tracks.push(new VectorKeyframeTrack(HIPS + '.position', track.times, values));
 }
 return {animations: [new AnimationClip(clip.name, clip.duration, tracks)], sampleRig: rig};
}

export function loadTraversalBot(height, groundAt, probe) {
 return loadTraversalAvatar(height, groundAt, probe, {loadRig: loadBotRig, adaptMixamo: adaptMixamoToBot});
}
