import {MathUtils, Quaternion, Vector3, VectorKeyframeTrack} from 'three';
import {prepareMixamo} from '../../src/character/clips/mixamo-clips.js';
import {createFootPlacement} from '../../src/character/ik/foot-placement.js';
import {createGrounder} from '../../src/character/ik/grounder.js';

const GAIT = {blendSeconds: .24, movingSpeed: .12};
const JOINTS = {hips: 'Hips', l_upleg: 'LeftUpLeg', l_leg: 'LeftLeg', l_foot: 'LeftFoot', l_toebase: 'LeftToeBase',
 r_upleg: 'RightUpLeg', r_leg: 'RightLeg', r_foot: 'RightFoot', r_toebase: 'RightToeBase'};

export function createSnowGait(avatar, source, groundAt) {
 const {model} = avatar;
 const bones = new Map(Object.entries(JOINTS).map(([key, name]) => [key, model.getObjectByName('mixamorig' + name)]));
 const hips = bones.get('hips'), feet = [bones.get('l_foot'), bones.get('r_foot')];
 const ankle = new Vector3(), rotation = new Quaternion(), offset = new Vector3();
 const root = new VectorKeyframeTrack(hips.name + '.position', [0], hips.position.toArray());
 const {clip, stride} = prepareMixamo(source, model, 'deep snow walk', root, {centred: true});
 const channels = clip.tracks.filter(track => track.name.endsWith('.quaternion')).map(track => ({
  joint: model.getObjectByName(track.name.slice(0, -'.quaternion'.length)), curve: track.createInterpolant(),
 }));
 const pelvis = clip.tracks.find(track => track.name === root.name).createInterpolant();
 const scale = hips.parent.getWorldScale(ankle).y;
 const distance = stride * scale;
 const points = feet.map(() => new Vector3());
 avatar.sampleFeet(points);
 const soleHeight = feet[0].getWorldPosition(ankle).y - points[0].y;
 const grounder = createGrounder({bones, footIK: createFootPlacement(bones, soleHeight), soleHeight, groundAt});
 let time = 0, weight = 0, lift = 0;

 function pose(at, blend) {
  for (const {joint, curve} of channels) joint.quaternion.slerp(rotation.fromArray(curve.evaluate(at)), blend);
  offset.fromArray(pelvis.evaluate(at));
  offset.y += lift;
  hips.position.lerp(offset, blend);
 }
 // Align the new clip's stance to the same sole plane as the regular walk.
 const stance = [Infinity, Infinity];
 for (const at of clip.tracks.at(-1).times) {
  pose(at, 1);
  feet.forEach((foot, side) => { stance[side] = Math.min(stance[side], foot.getWorldPosition(ankle).y); });
 }
 lift = (soleHeight - Math.max(...stance)) / scale;
 avatar.reset();

 return {
  reset() { grounder.reset(); time = weight = 0; },
  sampleFeet(points) {
   if (weight < .5) return avatar.sampleFeet(points);
   const contacts = grounder.state.feet;
   for (const [side, point] of points.entries()) {
    feet[side].getWorldPosition(point);
    point.y -= soleHeight;
    point.planted = contacts[side].planted;
   }
  },
  update(dt, controller, jumped, wish, deepSnow, updateBase, landing) {
   grounder.restore();
   const moving = deepSnow && !wish.run && Boolean(wish.x || wish.z) && controller.speed >= GAIT.movingSpeed;
   const active = moving && controller.grounded && !jumped && !landing && !controller.committed;
   const previous = weight;
   weight = jumped || !controller.grounded || landing ? 0 :
    MathUtils.clamp(weight + (active ? 1 : -1) * dt / GAIT.blendSeconds, 0, 1);
   if (previous === 1 && weight < 1) avatar.reset();
   if (weight < 1) updateBase(dt, controller, jumped, wish, landing);
   if (!weight) {
    if (previous) grounder.reset();
    return;
   }
   time = (time + dt * controller.speed * clip.duration / distance) % clip.duration;
   const blend = MathUtils.smoothstep(weight, 0, 1);
   pose(time, blend);
   model.rotation.y *= 1 - blend;
   model.rotation.z *= 1 - blend;
   grounder.update(dt, controller.position.y, controller.grounded, active);
  },
 };
}
