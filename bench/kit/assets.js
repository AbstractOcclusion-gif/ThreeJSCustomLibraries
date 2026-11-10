import {TextureLoader} from 'three';

// Bench-only: probe for an optional local asset (private-assets/ in dev) so a demo can fall back to its free default.
export async function detectAssets(probeUrl, base) {
  try { const r = await fetch(probeUrl, {method: 'HEAD'}); return r.ok && (r.headers.get('content-type') || '').startsWith('image') ? base : undefined; } catch { return undefined; }
}

// The ocean pages' foam lace: the staged WebAquarium sheet when present, else the bundled copy, else undefined (the ocean
// then generates its own). Also returns where staged WebAquarium assets would live and the staged ocean sheet folder, if any.
export async function loadOceanLace() {
  const aquariumAssets = new URL(import.meta.env.BASE_URL + 'webaquarium/', location.href);
  const sheetsUrl = new URL('library/ocean/textures/', aquariumAssets).href;
  const sheetBase = await detectAssets(sheetsUrl + 'foam_lace.png', sheetsUrl);
  const foamUrl = sheetBase ? sheetBase + 'foam_lace.png' : import.meta.env.BASE_URL + 'webaquarium-water/foam_lace.png';
  const laceTexture = await detectAssets(foamUrl, foamUrl)
    ? await new TextureLoader().loadAsync(foamUrl).catch(error => { console.warn('Foam lace texture failed to load; the ocean uses its generated one.', error); }) : undefined;
  return {aquariumAssets, sheetBase, laceTexture};
}
