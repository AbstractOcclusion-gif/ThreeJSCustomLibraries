// Geometry helpers for runs: headings, module repetition along legs, spaced placements, electric spans with sag.
import {distance} from './layout.js';

export const heading = (a, b) => Math.atan2(a[1] - b[1], b[0] - a[0]);

// Repeat a module of `length` metres along every leg; each module gets {x, z, yaw, scaleX} (stretched to fit the leg).
export function repeatModules(route, length, visit) {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], span = distance(a, b), count = Math.max(1, Math.ceil(span / length));
    for (let j = 0; j < count; j++) {
      const t = (j + .5) / count;
      visit({x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, yaw: heading(a, b), scaleX: span / (count * length), leg: i - 1, t});
    }
  }
}
// Place items every `spacing` metres along the whole route (continuous across corners); visit({x, z, yaw, leg, t, distance}).
export function walkRun(route, spacing, visit) {
  let carry = 0, total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], span = distance(a, b), yaw = heading(a, b);
    for (let d = carry; d < span; d += spacing) {
      const t = d / span; visit({x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, yaw, leg: i - 1, t, distance: total + d});
      carry = d + spacing - span;
    }
    if (carry < 0 || route.length === 2) carry = Math.max(0, carry);
    total += span;
  }
}
// Pole yaw at each route point (half-angle at corners) and the conductor mounts: phases = [[height, lateralOffset], ...].
export function electricMounts(route, phases) {
  const angles = route.map((point, i) => {
    if (route.length === 1) return 0;
    const incoming = i ? heading(route[i - 1], point) : heading(point, route[i + 1]);
    if (!i || i === route.length - 1) return incoming;
    const outgoing = heading(point, route[i + 1]);
    return incoming + Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)) / 2;
  });
  const mounts = route.map(([x, z], i) => phases.map(([height, offset]) => [x + offset * Math.sin(angles[i]), height, z + offset * Math.cos(angles[i])]));
  return {angles, mounts};
}
// Sampled catenary-ish conductor between two mounts: sag = min(maxSag, span * sagPerMetre).
export function conductorPoints(start, end, {steps = 12, sagPerMetre = .045, maxSag = 2} = {}) {
  const span = Math.hypot(end[0] - start[0], end[2] - start[2]), sag = Math.min(maxSag, span * sagPerMetre), out = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps; out.push([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t - 4 * sag * t * (1 - t), start[2] + (end[2] - start[2]) * t]); }
  return out;
}
