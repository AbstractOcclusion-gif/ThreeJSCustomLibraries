// What wheels and feet leave on the ground: stamps in the valley's track mask, which the terrain material draws as
// tracks and the grass reads to lie down. Dry ground only; the pond bed keeps no marks.
import {FOOTSTEP_DEFAULTS} from '../terrain/footsteps.js';

export const MARKS = Object.freeze({
 // s between wheel stamps. Every stamp re-uploads the whole mask to the GPU, so the wheels are batched rather than
 // stamped every frame; the newest stretch of a rut is at most this far behind the wheel.
 interval: .1,
 minTravel: .05,     // m a wheel must roll before it marks again (a parked car does not restamp)
 tyreShare: .5,      // share of the tyre width pressed into the ground, as the stamp radius
 footStrength: .8,   // how deep a footprint reads next to a tyre rut (1)
});

// wheels: [{position: {x, z}, grounded}] (the vehicle module's). heightAt(x, z): ground height.
export function createMarks({tracks, heightAt, waterLevel, wheelWidth, wheelCount = 4, step = FOOTSTEP_DEFAULTS}) {
 const ruts = Array.from({length: wheelCount}, () => ({x: 0, z: 0, down: false})), at = {x: 0, z: 0};
 const heel = {x: 0, z: 0}, toe = {x: 0, z: 0};
 const dry = (x, z) => heightAt(x, z) >= waterLevel;
 let wait = 0, strideLeft = 0, side = 1;
 return {
  // Call every frame with the wheels' current poses.
  wheels(dt, wheels) {
   wait -= dt;
   if (wait > 0) return;
   wait = MARKS.interval;
   wheels.forEach((wheel, i) => {
    const rut = ruts[i], {x, z} = wheel.position;
    if (!wheel.grounded || !dry(x, z)) { rut.down = false; return; }
    if (rut.down && Math.hypot(x - rut.x, z - rut.z) < MARKS.minTravel) return;
    at.x = x; at.z = z;
    if (rut.down) tracks.stamp(rut, at, wheelWidth * MARKS.tyreShare);
    rut.x = x; rut.z = z; rut.down = true;
   });
  },
  // Call every frame while on foot: one print per stride, left and right in turn, pointing along `heading`.
  feet(dt, {x, z, heading, speed, grounded}) {
   if (!grounded) return;
   strideLeft -= speed * dt;
   if (strideLeft > 0) return;
   strideLeft = step.spacing;
   side = -side;
   const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
   // Left of the heading is (cos, -sin).
   const footX = x + forwardZ * side * step.offset, footZ = z - forwardX * side * step.offset;
   if (!dry(footX, footZ)) return;
   heel.x = footX - forwardX * step.heelOffset; heel.z = footZ - forwardZ * step.heelOffset;
   toe.x = footX + forwardX * step.toeOffset; toe.z = footZ + forwardZ * step.toeOffset;
   tracks.stamp(heel, toe, step.heelRadius, MARKS.footStrength);
   tracks.stamp(toe, toe, step.toeRadius, MARKS.footStrength);
  },
  reset() {
   for (const rut of ruts) rut.down = false;
   wait = strideLeft = 0;
   tracks.clear();
  },
 };
}
