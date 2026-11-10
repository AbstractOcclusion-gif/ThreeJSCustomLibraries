// Bench-only: probe for an optional local asset (private-assets/ in dev) so a demo can fall back to its free default.
export async function detectAssets(probeUrl, base) {
  try { const r = await fetch(probeUrl, {method: 'HEAD'}); return r.ok && (r.headers.get('content-type') || '').startsWith('image') ? base : undefined; } catch { return undefined; }
}
