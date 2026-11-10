import {MathUtils} from 'three';

function rimRadius(fracture, angle) {
 return fracture.radius * (1 + .045 * Math.sin(7 * angle + fracture.phase) + .035 * Math.sin(13 * angle - fracture.phase));
}

export function iceFractureDistance(fracture, x, z) {
 const dx = x - fracture.x, dz = z - fracture.z;
 return Math.hypot(dx, dz) - rimRadius(fracture, Math.atan2(dz, dx));
}

// Adapt Glider's plaster facade radial sheet: shared vertices on irregular
// spokes and connecting rings. The open center remains one rounded breach.
export function createIceFracture(x, z, radius) {
 const sectors = 14, rings = 3;
 let seed = (Math.round(x * 1000) ^ Math.imul(Math.round(z * 1000), 997)) >>> 0;
 const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
 };
 const fracture = {x, z, radius, phase: random() * 2 * Math.PI, segments: []};
 const spokes = Array.from({length: sectors}, (_, i) => ({
  angle: fracture.phase + 2 * Math.PI * (i + (random() - .5) * .36) / sectors,
  phase: (random() * 2 - 1) * Math.PI,
  length: radius * MathUtils.lerp(.75, 1.55, random()),
 }));
 const levels = Array.from({length: rings + 1}, (_, ring) => spokes.map(spoke => {
  const envelope = Math.sin(Math.PI * ring / rings);
  const t = ring + envelope * ((random() - .5) * .48 + .35 * Math.sin(spoke.phase + ring * .7));
  const angle = spoke.angle + .055 * Math.sin(spoke.phase + ring * 1.1) * envelope;
  const r = rimRadius(fracture, angle) + .025 + spoke.length * t / rings;
  return {x: x + Math.cos(angle) * r, z: z + Math.sin(angle) * r};
 }));
 for (let ring = 0; ring < rings; ring++) for (let i = 0; i < sectors; i++) {
  const width = MathUtils.lerp(.058, .024, ring / (rings - 1));
  fracture.segments.push({a: levels[ring][i], b: levels[ring + 1][i], width});
  if (ring < rings - 1 && (ring === 0 || random() > .35)) {
   fracture.segments.push({a: levels[ring + 1][i], b: levels[ring + 1][(i + 1) % sectors], width: width * .65});
  }
 }
 return fracture;
}
