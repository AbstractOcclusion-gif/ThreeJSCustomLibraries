import {BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3} from 'three';

// A winding downhill channel: control sections [x, z, width, depth, speed] along +X, Catmull-Rom between them.
export const DEFAULT_SECTIONS = [
 [-34, -7, 2.5, .55, 2.1],
 [-23, -10, 2.8, .7, 1.8],
 [-12, -4, 3.3, .85, 1.5],
 [0, 7, 3.5, .95, 1.4],
 [12, 8, 5, 1.25, .95],
 [24, 1, 8.2, 1.8, .48],
 [37, -2, 8.5, 1.9, .42],
];
const lerp = (a, b, t) => a + (b - a) * t;
const wetProfile = [-1, -.85, -.6, 0, .6, .85, 1];
const bankProfile = [-2.4, -1.35, ...wetProfile, 1.35, 2.4];

export function createChannel({width = 1, depth = 1, drop = 3, river = false, sections = DEFAULT_SECTIONS} = {}) {
 const curve = new CatmullRomCurve3(sections.map(([x, z]) => new Vector3(x, 0, z)));
 const count = 120;
 const rows = [];
 let distance = 0;
 let travel = 0;
 for (let i = 0; i <= count; i++) {
  const t = i / count;
  const centre = curve.getPoint(t);
  const segment = Math.min(sections.length - 2, Math.floor(t * (sections.length - 1)));
  const fraction = t * (sections.length - 1) - segment;
  const sectionValue = index => lerp(sections[segment][index], sections[segment + 1][index], fraction);
  const speed = sectionValue(4) * (river ? .72 : 1);
  if (i > 0) {
   const previous = rows[i - 1];
   const length = centre.distanceTo(previous.centre);
   distance += length;
   travel += 2 * length / (speed + previous.speed);
  }
  rows.push({
   centre, distance, travel, speed,
   height: drop * Math.pow(1 - t, 1.65),
   width: sectionValue(2) * width * (river ? 1.45 : 1),
   depth: sectionValue(3) * depth * (river ? 1.35 : 1),
  });
 }

 function geometry(water) {
  const profile = water ? wetProfile : bankProfile;
  const positions = [], flow = [], colors = [], indices = [];
  for (const row of rows) {
   for (const across of profile) {
    const edge = Math.abs(across);
    const bed = -row.depth * Math.max(0, 1 - edge ** 4);
    const bank = edge > 1 ? Math.min(3, (edge - 1) * 2.5) : 0;
    // Cross sections keep a shared X so wide banks cannot fold over tight bends.
    positions.push(row.centre.x,
      row.height + (water ? 0 : bed + bank - .012),
      row.centre.z + row.width * across);
    flow.push(row.travel, across, row.distance);
    const variation = .94 + .06 * Math.cos(row.distance * 2.3 + across * 12);
    const ground = edge > 1.1 ? [.105, .145, .077] : [.235, .198, .139];
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
   slope: (b.centre.z - a.centre.z) / (b.centre.x - a.centre.x),
  };
 }

 return {surface: geometry(true), bed: geometry(false), duration: travel, sample, sectionAt};
}
