// Metres: stride, half stance width, heel and toe offsets along the stride and print radii.
// load is the share of the packable snow depth a foot presses out (field.compactSnow).
export const FOOTSTEP_DEFAULTS = Object.freeze({
  spacing: .68, offset: .19, heelOffset: .10, toeOffset: .12,
  heelRadius: .19, toeRadius: .23, load: .55,
});

export function stampFootstepTrail({field, tracks, from, to, onSample, step = FOOTSTEP_DEFAULTS}) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return;
  const forwardX = dx / length, forwardZ = dz / length;
  let side = -1;
  for (let distance = 0; distance <= length; distance += step.spacing) {
    const offset = side * step.offset;
    const x = from.x + forwardX * distance - forwardZ * offset;
    const z = from.z + forwardZ * distance + forwardX * offset;
    const heel = {x: x - forwardX * step.heelOffset, z: z - forwardZ * step.heelOffset};
    const toe = {x: x + forwardX * step.toeOffset, z: z + forwardZ * step.toeOffset};
    tracks.stamp(heel, toe, step.heelRadius);
    tracks.stamp(toe, toe, step.toeRadius);
    field.compactSnow(heel.x, heel.z, step.heelRadius, step.load, onSample);
    field.compactSnow(toe.x, toe.z, step.toeRadius, step.load, onSample);
    side = -side;
  }
}
