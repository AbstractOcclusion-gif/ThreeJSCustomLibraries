import {Vector3} from 'three';

// Reads the stairs she is on: walks the ground ahead of her and behind her along the way she faces, notes where it steps
// up or down, and returns how deep one tread is (m), or 0 when she is not on stairs. Lengths in m.
export const STAIR_SENSE = Object.freeze({
 ahead: 1.3,     // how far ahead of her the ground is read
 behind: .6,     // ... and behind
 spacing: .075,  // between two readings
 riser: .04,     // a change of height between two readings larger than this is a step
 least: .15,     // treads shallower than this are a slope or rubble, not stairs
});

// groundAt(point, normal): the ground height under a world point, or NaN.
export function createStairSense(groundAt, options = {}) {
 const o = {...STAIR_SENSE, ...options};
 const probe = new Vector3(), normal = new Vector3(), risers = [];
 return (position, heading) => {
  const sin = Math.sin(heading), cos = Math.cos(heading);
  risers.length = 0;
  for (const [way, reach] of [[1, o.ahead], [-1, o.behind]]) {
   let level = position.y;
   for (let along = o.spacing; along <= reach; along += o.spacing) {
    // Each reading starts from the height of the last one, so a flight is followed however far it climbs.
    const ground = groundAt(probe.set(position.x + sin * along * way, level, position.z + cos * along * way), normal);
    if (!Number.isFinite(ground)) break;
    if (Math.abs(ground - level) > o.riser) risers.push(along * way);
    level = ground;
   }
  }
  risers.sort((a, b) => a - b);
  let tread = Infinity;
  for (let i = 1; i < risers.length; i++) if (risers[i] - risers[i - 1] >= o.least) tread = Math.min(tread, risers[i] - risers[i - 1]);
  return Number.isFinite(tread) ? tread : 0;
 };
}
