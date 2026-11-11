const FOOTSTEP = {
  spacing: .68, offset: .19, heelOffset: .10, toeOffset: .12,
  heelRadius: .19, toeRadius: .23, depth: .095,
};

export function stampFootstepTrail({field, tracks, from, to, onSample}) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return;
  const forwardX = dx / length, forwardZ = dz / length;
  let side = -1;
  for (let distance = 0; distance <= length; distance += FOOTSTEP.spacing) {
    const offset = side * FOOTSTEP.offset;
    const x = from.x + forwardX * distance - forwardZ * offset;
    const z = from.z + forwardZ * distance + forwardX * offset;
    const heel = {x: x - forwardX * FOOTSTEP.heelOffset, z: z - forwardZ * FOOTSTEP.heelOffset};
    const toe = {x: x + forwardX * FOOTSTEP.toeOffset, z: z + forwardZ * FOOTSTEP.toeOffset};
    tracks.stamp(heel, toe, FOOTSTEP.heelRadius);
    tracks.stamp(toe, toe, FOOTSTEP.toeRadius);
    field.deform(heel.x, heel.z, FOOTSTEP.heelRadius, FOOTSTEP.depth, onSample);
    field.deform(toe.x, toe.z, FOOTSTEP.toeRadius, FOOTSTEP.depth, onSample);
    side = -side;
  }
}
