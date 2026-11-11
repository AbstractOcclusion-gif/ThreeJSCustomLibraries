import {BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3} from 'three';

// A winding downhill channel: control sections [x, z, width, depth, speed] along +X, Catmull-Rom between them.
// Metres and m/s; profiles below are shares of the half width (|across| > 1 is bank).
export const DEFAULT_SECTIONS = [
 [-34, -7, 2.5, .55, 2.1],
 [-23, -10, 2.8, .7, 1.8],
 [-12, -4, 3.3, .85, 1.5],
 [0, 7, 3.5, .95, 1.4],
 [12, 8, 5, 1.25, .95],
 [24, 1, 8.2, 1.8, .48],
 [37, -2, 8.5, 1.9, .42],
];
const SECTION = Object.freeze({width: 2, depth: 3, speed: 4});   // column of each value in a section row
const ROWS = 120;                    // cross sections sampled along the curve
const DROP_CURVE = 1.65;             // height = drop x (1 - t)^this: steep upstream, flattening toward the outlet
const RIVER = Object.freeze({speed: .72, width: 1.45, depth: 1.35});   // the river preset scales the stream sections
const BED_POWER = 4;                 // depth x (1 - |across|^this): a flat-bottomed U across the wet width
const BANK = Object.freeze({slope: 2.5, maxHeight: 3, belowWater: .012});   // m per unit beyond the edge; m; m (no z-fight at the edge)
// Vertex colours: dry bank grass beyond grassFrom (share of the half width), wet bed inside, with a faint stripe pattern.
const COLORS = Object.freeze({grass: [.105, .145, .077], bed: [.235, .198, .139], grassFrom: 1.1,
  stripe: {base: .94, amount: .06, along: 2.3, across: 12}});
const lerp = (a, b, t) => a + (b - a) * t;
const bedOffset = (across, depth) => -depth * Math.max(0, 1 - Math.abs(across) ** BED_POWER);
const wetProfile = [-1, -.85, -.6, 0, .6, .85, 1];
const bankProfile = [-2.4, -1.35, ...wetProfile, 1.35, 2.4];

export function createChannel({width = 1, depth = 1, drop = 3, river = false, sections = DEFAULT_SECTIONS} = {}) {
 const curve = new CatmullRomCurve3(sections.map(([x, z]) => new Vector3(x, 0, z)));
 const count = ROWS;
 const rows = [];
 let distance = 0;
 let travel = 0;
 for (let i = 0; i <= count; i++) {
  const t = i / count;
  const centre = curve.getPoint(t);
  const segment = Math.min(sections.length - 2, Math.floor(t * (sections.length - 1)));
  const fraction = t * (sections.length - 1) - segment;
  const sectionValue = index => lerp(sections[segment][index], sections[segment + 1][index], fraction);
  const speed = sectionValue(SECTION.speed) * (river ? RIVER.speed : 1);
  if (i > 0) {
   const previous = rows[i - 1];
   const length = centre.distanceTo(previous.centre);
   distance += length;
   travel += 2 * length / (speed + previous.speed);
  }
  rows.push({
   centre, distance, travel, speed,
   height: drop * Math.pow(1 - t, DROP_CURVE),
   width: sectionValue(SECTION.width) * width * (river ? RIVER.width : 1),
   depth: sectionValue(SECTION.depth) * depth * (river ? RIVER.depth : 1),
  });
 }

 function geometry(water) {
  const profile = water ? wetProfile : bankProfile;
  const positions = [], flow = [], colors = [], indices = [];
  for (const row of rows) {
   for (const across of profile) {
    const edge = Math.abs(across);
    const bed = bedOffset(across, row.depth);
    const bank = edge > 1 ? Math.min(BANK.maxHeight, (edge - 1) * BANK.slope) : 0;
    // Cross sections keep a shared X so wide banks cannot fold over tight bends.
    positions.push(row.centre.x,
      row.height + (water ? 0 : bed + bank - BANK.belowWater),
      row.centre.z + row.width * across);
    flow.push(row.travel, across, row.distance);
    const {stripe} = COLORS, variation = stripe.base + stripe.amount * Math.cos(row.distance * stripe.along + across * stripe.across);
    const ground = edge > COLORS.grassFrom ? COLORS.grass : COLORS.bed;
    colors.push(...ground.map(component => component * variation));
   }
  }
  const stride = profile.length;
  for (let row = 0; row < count; row++) {
   for (let column = 0; column < stride - 1; column++) {
    const a = row * stride + column;
    indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
   }
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('flow', new Float32BufferAttribute(flow, 3));
  result.setAttribute('color', new Float32BufferAttribute(colors, 3));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
 }

 function sample(seconds, across, out) {
  const time = ((seconds % travel) + travel) % travel;
  const upper = rows.findIndex(row => row.travel > time);
  const a = rows[upper - 1], b = rows[upper];
  const fraction = (time - a.travel) / (b.travel - a.travel);
  const widthAtSample = lerp(a.width, b.width, fraction) * across;
  return out.set(
   lerp(a.centre.x, b.centre.x, fraction),
   lerp(a.height, b.height, fraction),
   lerp(a.centre.z, b.centre.z, fraction) + widthAtSample,
  );
 }

 function sectionAt(x) {
  if (x < rows[0].centre.x || x > rows[count].centre.x) return null;
  let low = 0, high = count;
  while (high - low > 1) {
   const middle = (low + high) >> 1;
   if (rows[middle].centre.x > x) high = middle;
   else low = middle;
  }
  const a = rows[low], b = rows[high];
  const fraction = (x - a.centre.x) / (b.centre.x - a.centre.x);
  return {
   centre: lerp(a.centre.z, b.centre.z, fraction),
   width: lerp(a.width, b.width, fraction),
   height: lerp(a.height, b.height, fraction),
   speed: lerp(a.speed, b.speed, fraction),
   depth: lerp(a.depth, b.depth, fraction),
   slope: (b.centre.z - a.centre.z) / (b.centre.x - a.centre.x),
  };
 }

 function bedHeightAt(x, z) {
  const section = sectionAt(x);
  if (!section) return undefined;
  const across = Math.abs(z - section.centre) / section.width;
  const bank = Math.min(BANK.maxHeight, Math.max(0, across - 1) * BANK.slope);
  return section.height + bedOffset(across, section.depth) + bank - BANK.belowWater;
 }
 return {surface: geometry(true), bed: geometry(false), duration: travel, sample, sectionAt, bedHeightAt};
}
