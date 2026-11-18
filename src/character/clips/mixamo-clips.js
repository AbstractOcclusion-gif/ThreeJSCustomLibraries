import {AnimationClip, Quaternion, Vector3, VectorKeyframeTrack} from 'three';

const UP = new Vector3(0, 1, 0);

// These clips were made for the character's own skeleton, so their joint rotations are played as authored: re-aiming them from
// each file's stored rest pose (as the traversal clips from another rig need) splays her legs and turns her feet.
export function prepareMixamo(source, rig, name, root, {first = 0, last = Infinity, airborne = false, carried = false, centred = false, yaw = 0} = {}) {
 const authored = source.animations[0];
 const input = authored.tracks.find(track => track.name === root.name);
 const indices = Array.from(input.times.keys()).filter(i => i >= first && i <= last);
 const start = indices[0], end = indices.at(-1);
 const duration = input.times[end] - input.times[start];
 const times = indices.map(i => input.times[i] - input.times[start]);
 const travel = [0, 1, 2].map(axis => input.values[end * 3 + axis] - input.values[start * 3 + axis]);
 // A whole clip keeps where its own first frame puts the pelvis over the feet (a standing pose leans on one leg); a
 // cut-out piece starts mid-travel, so it takes her pelvis at rest instead. The height is always hers.
 // centred: a clip authored away from the origin (a ladder climb: the origin is under its ladder, she hangs back from
 // it and to one side) takes her pelvis at rest as well, so the point she is carried by stays under her.
 const base = first === 0 && !centred ? [input.values[0], root.values[1], input.values[2]] : root.values;
 const values = indices.flatMap((i, frame) => [0, 1, 2].map(axis => {
  const delta = input.values[i * 3 + axis] - input.values[start * 3 + axis];
  // carried: she is taken up at a steady speed (a rope climb), so the clip's own rise is left out and only its bob kept.
  return base[axis] + (airborne ? 0 : axis === 1 && !carried ? delta : delta - travel[axis] * times[frame] / duration);
 }));
 // yaw: turns the whole clip about the vertical (rad), for one authored facing another way than her own clips: her
 // pelvis goes round the origin, and turns with it.
 const turn = new Quaternion().setFromAxisAngle(UP, yaw), pose = new Quaternion(), place = new Vector3();
 if (yaw) for (let i = 0; i < values.length; i += 3) place.fromArray(values, i).applyQuaternion(turn).toArray(values, i);
 const pelvisTurn = root.name.replace('.position', '.quaternion');
 const tracks = authored.tracks.filter(track => track.name.endsWith('.quaternion') && rig.getObjectByName(track.name.slice(0, -'.quaternion'.length))).map(track => {
  const copy = track.clone();
  copy.trim(input.times[start] - .0001, input.times[end] + .0001).shift(-input.times[start]);
  if (yaw && copy.name === pelvisTurn) for (let i = 0; i < copy.values.length; i += 4) pose.fromArray(copy.values, i).premultiply(turn).toArray(copy.values, i);
  return copy;
 });
 tracks.push(new VectorKeyframeTrack(root.name, times, values));
 return {clip: new AnimationClip(name, duration, tracks), stride: Math.hypot(travel[0], travel[2]), rise: travel[1]};
}
