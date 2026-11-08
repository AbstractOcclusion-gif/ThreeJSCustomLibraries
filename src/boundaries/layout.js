// Boundary layout document: runs of ordered X/Z control points (metres) with a kind and an optional asset id.
export const LAYOUT_SCHEMA = 'three-kit.boundary-layout';
export const DEFAULT_KINDS = Object.freeze(['hedge', 'fence', 'wall', 'electric']);
export const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function validateLayout(value, {kinds = DEFAULT_KINDS, limit = 40, extent = 40, maxMetres = 400, maxSpans = 80, minSpacing = 1} = {}) {
  if ((value?.schema !== LAYOUT_SCHEMA && value?.schema !== 'glider.boundary-layout') || value.version !== 1 ||
      !Array.isArray(value.runs) || value.runs.length > limit) throw Error('Invalid boundary layout.');
  const ids = new Set();
  let metres = 0, spans = 0;
  for (const run of value.runs) {
    if (!run || typeof run.id !== 'string' || !run.id || ids.has(run.id) || !kinds.includes(run.kind) ||
        (run.asset !== undefined && typeof run.asset !== 'string') ||
        !Array.isArray(run.points) || run.points.length < 2 || run.points.length > limit) throw Error('Invalid run.');
    ids.add(run.id);
    for (const [index, point] of run.points.entries()) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(n => Number.isFinite(n) && Math.abs(n) <= extent) ||
          (index && distance(run.points[index - 1], point) < minSpacing)) throw Error('Invalid route point.');
      if (index) { if (run.kind === 'electric') spans++; else metres += distance(run.points[index - 1], point); }
    }
  }
  if (metres > maxMetres || spans > maxSpans) throw Error(`Layout limit is ${maxMetres} m of boundaries and ${maxSpans} electric spans.`);
  return value.runs;
}
export const layout = runs => ({schema: LAYOUT_SCHEMA, version: 1, runs});
export const makeRun = (kind, points, asset) => ({id: (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)), kind, points, ...(asset ? {asset} : {})});
