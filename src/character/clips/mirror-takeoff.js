import {AnimationClip, Quaternion} from 'three';

// Reflect joint deltas in rig space, then apply them to the opposite rest joint.
export function mirrorClip(clip, rig) {
 rig.updateMatrixWorld(true);
 const tracks = [];
 for (const track of clip.tracks) {
  const [name, property] = track.name.split('.');
  const counterpart = name.replace(/Left|Right/, side => side === 'Left' ? 'Right' : 'Left');
  const source = rig.getObjectByName(name), target = rig.getObjectByName(counterpart);
  if (!source || !target) continue;
  const reflected = track.clone();
  reflected.name = counterpart + '.' + property;
  if (property === 'quaternion') {
   const rest = source.quaternion.clone().invert();
   const axes = source.getWorldQuaternion(new Quaternion());
   const inverse = axes.clone().invert();
   const targetAxes = target.getWorldQuaternion(new Quaternion());
   const targetInverse = targetAxes.clone().invert();
   const q = new Quaternion();
   for (let i = 0; i < track.values.length; i += 4) {
    q.fromArray(track.values, i).premultiply(rest).premultiply(axes).multiply(inverse);
    q.set(q.x, -q.y, -q.z, q.w);
    q.premultiply(targetInverse).multiply(targetAxes).premultiply(target.quaternion)
     .normalize().toArray(reflected.values, i);
   }
  } else if (property === 'position') {
   for (let i = 0; i < track.values.length; i += 3) reflected.values[i] = 2 * source.position.x - track.values[i];
  }
  tracks.push(reflected);
 }
 return new AnimationClip(clip.name + '_Mirrored', clip.duration, tracks);
}
