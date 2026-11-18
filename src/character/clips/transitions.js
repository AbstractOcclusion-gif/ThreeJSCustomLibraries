import {AnimationClip, AnimationMixer, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack} from 'three';

// Clips that carry her from one way of moving to another: a stop, a turn-around. They are played in place and matched to
// what the capsule really does (ALS-style): the frame shown is the one where the clip moves as fast as she does, so
// one clip serves any speed and her feet keep pace with the ground. A turn's own rotation is taken out of the clip and
// handed back as a curve, for the host to turn the model by.

const FORWARD = new Vector3(0, 0, 1), UP = new Vector3(0, 1, 0);
const shortest = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// source: the loaded FBX. rig: her skeleton. root: her pelvis position track at rest. first/last: frames kept.
// turn: whether the clip turns her round. sway: keep the pelvis' own drift over her feet (a turn on the spot shifts her
// weight from foot to foot). scale: m per rig unit.
// Returns {clip, times, speed (m/s along the way she first faces, signed), yaw (rad turned so far), pivot (index where
// she stops going forward, or -1), duration}.
export function prepareTransition(source, rig, name, root, {first = 0, last = Infinity, turn = false, sway = false, scale = 1} = {}) {
 const authored = source.animations[0];
 const sampledRig = source.sampleRig ?? source;
 const pelvisName = root.name.slice(0, -'.position'.length);
 const input = authored.tracks.find(track => track.name === root.name);
 const indices = Array.from(input.times.keys()).filter(i => i >= first && i <= last);
 const start = indices[0], end = indices.at(-1), from = input.times[start];
 const times = indices.map(i => input.times[i] - from), duration = times.at(-1);

 // Where the clip takes her, read off its own skeleton.
 const mixer = new AnimationMixer(sampledRig), action = mixer.clipAction(authored).play();
 const pelvis = sampledRig.getObjectByName(pelvisName), at = new Vector3(), facing = new Vector3(), turned = new Quaternion();
 const along = [], yaw = [];
 let heading = 0, origin = null, last_ = 0, total = 0;
 for (const [k, i] of indices.entries()) {
  action.time = Math.min(input.times[i], authored.duration - 1e-4);
  mixer.update(0);
  sampledRig.updateMatrixWorld(true);
  pelvis.getWorldPosition(at);
  facing.copy(FORWARD).applyQuaternion(pelvis.getWorldQuaternion(turned));
  const now = Math.atan2(facing.x, facing.z);
  if (k === 0) { heading = now; origin = at.clone(); } else total += shortest(now - last_);
  last_ = now;
  yaw.push(total);
  along.push(((at.x - origin.x) * Math.sin(heading) + (at.z - origin.z) * Math.cos(heading)) * scale);
 }
 mixer.stopAllAction();
 mixer.uncacheRoot(sampledRig);
 sampledRig.updateMatrixWorld(true);
 // Speed between neighbouring frames, lightly smoothed.
 const raw = along.map((_, k) => { const a = Math.max(0, k - 1), b = Math.min(along.length - 1, k + 1); return (along[b] - along[a]) / (times[b] - times[a]); });
 const speed = raw.map((_, k) => (raw[Math.max(0, k - 1)] + raw[k] * 2 + raw[Math.min(raw.length - 1, k + 1)]) / 4);
 const farthest = along.indexOf(Math.max(...along));
 const pivot = turn && farthest > 0 && farthest < along.length - 1 ? farthest : -1;

 const tracks = [];
 const parent = rig.getObjectByName(pelvisName).parent.getWorldQuaternion(new Quaternion()), toParent = parent.clone().invert();
 const q = new Quaternion(), undo = new Quaternion();
 for (const track of authored.tracks) {
  if (!track.name.endsWith('.quaternion') || !rig.getObjectByName(track.name.slice(0, -'.quaternion'.length))) continue;
  const copy = track.clone();
  copy.trim(from - .0001, input.times[end] + .0001).shift(-from);
  if (turn && track.name === pelvisName + '.quaternion') {
   // Take the turn out of the pelvis, in world space: the host turns the whole model by `yaw` instead.
   for (let k = 0; k < copy.times.length; k++) {
    const turnedBy = sample(times, yaw, copy.times[k]);
    undo.setFromAxisAngle(UP, -turnedBy);
    q.fromArray(copy.values, k * 4).premultiply(parent).premultiply(undo).premultiply(toParent).normalize().toArray(copy.values, k * 4);
   }
  }
  tracks.push(copy);
 }
 // In place: the pelvis keeps its rise and fall; its travel belongs to the capsule.
 // With sway, its drift is kept too, turned back by the turn taken out, so it stays over her feet.
 const drift = new Vector3();
 const values = indices.flatMap((i, k) => {
  drift.set(0, 0, 0);
  if (sway) drift.set(input.values[i * 3] - input.values[start * 3], 0, input.values[i * 3 + 2] - input.values[start * 3 + 2]).applyQuaternion(parent).applyAxisAngle(UP, -yaw[k]).applyQuaternion(toParent);
  return [root.values[0] + drift.x, root.values[1] + input.values[i * 3 + 1] - input.values[start * 3 + 1], root.values[2] + drift.z];
 });
 tracks.push(new VectorKeyframeTrack(root.name, times, values));
 return {clip: new AnimationClip(name, duration, tracks), times, speed, yaw, pivot, duration};
}

// Linear read of a curve at a time.
export function sample(times, values, time) {
 if (time <= times[0]) return values[0];
 for (let k = 1; k < times.length; k++) if (time <= times[k]) return values[k - 1] + (values[k] - values[k - 1]) * (time - times[k - 1]) / (times[k] - times[k - 1]);
 return values.at(-1);
}

// The first time between two frames of the clip where its speed crosses `wanted`: the frame that keeps pace with her.
// When the clip never goes that fast or that slow there, returns the frame that comes nearest to it.
export function timeAtSpeed({times, speed}, wanted, from, to) {
 for (let k = from; k < to; k++) {
  const a = speed[k] - wanted, b = speed[k + 1] - wanted;
  if (a === 0) return times[k];
  if (a * b < 0) return times[k] + (times[k + 1] - times[k]) * a / (a - b);
 }
 let nearest = from;
 for (let k = from + 1; k <= to; k++) if (Math.abs(speed[k] - wanted) < Math.abs(speed[nearest] - wanted)) nearest = k;
 return times[nearest];
}

// The first time the clip has turned her by `turned` rad (unsigned), or its end if it never turns that far.
export function timeAtTurn({times, yaw}, turned) {
 for (let k = 1; k < times.length; k++) {
  const a = Math.abs(yaw[k - 1]), b = Math.abs(yaw[k]);
  if (b >= turned) return b === a ? times[k] : times[k - 1] + (times[k] - times[k - 1]) * Math.max(0, turned - a) / (b - a);
 }
 return times.at(-1);
}
