import {Quaternion, QuaternionKeyframeTrack} from 'three';

// Trim the run-up before a catch and the anticipation before a drop (30 fps).
export const LEDGE_CLIPS = [
 {name: 'grab', file: 'Braced Hang', first: 8, last: 22},
 {name: 'hang', file: 'Hanging Idle'},
 {name: 'climb', file: 'Braced Hang To Crouch'},
 {name: 'drop', file: 'Braced Hang Drop', first: 10},
];

export function retargetRotationTrack(track, donor, target) {
 const fromRest = donor.quaternion.clone().invert();
 const axes = target.getWorldQuaternion(new Quaternion()).invert().multiply(donor.getWorldQuaternion(new Quaternion()));
 const inverse = axes.clone().invert();
 const values = new Float32Array(track.values.length), pose = new Quaternion();
 for (let i = 0; i < values.length; i += 4) {
  pose.fromArray(track.values, i).premultiply(fromRest).premultiply(axes)
   .multiply(inverse).premultiply(target.quaternion).normalize().toArray(values, i);
 }
 return new QuaternionKeyframeTrack(target.name + '.quaternion', track.times, values);
}
