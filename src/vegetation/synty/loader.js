// Loader code for a private Synty-derived vegetation drop-in. The lib ships NO Synty data; a project (or the bench) serves
// the prepared files from a base URL (see SYNTY.md for the layout) and passes it here.
//   <baseUrl>/grass.json            grass clump LODs: [{position, uv, bend}]
//   <baseUrl>/specimens.json        {kind: [{material, foliage?, position, uv}]}
//   <baseUrl>/specimen-atlas.json   [[u, v, w, h] × 5]: grass, bushTrunk, birchTrunk, leaf, branch
//   <baseUrl>/specimen-atlas.png
//   <baseUrl>/expansion/manifest.json  {rectangles: {material: rect}, variants: {id: {parts: [{material, foliage, offset, vertices}], ...}}}
//   <baseUrl>/expansion/atlas.png, <baseUrl>/expansion/<id>.bin  (float32 x,y,z,u,v per vertex)
import * as THREE from 'three';

const join = (base, path) => new URL(path, base.endsWith('/') ? base : base + '/').href;
const getJson = async (url, fetcher, signal) => { const r = await fetcher(url, {signal}); if (!r.ok) throw Error(`${url}: ${r.status}`); return r.json(); };

export async function loadSyntyVegetation({baseUrl, loader = new THREE.TextureLoader(), fetch: fetcher = globalThis.fetch} = {}) {
  if (!baseUrl) throw Error('loadSyntyVegetation needs baseUrl');
  const [grassLods, parts, atlasLayout, atlas] = await Promise.all([
    getJson(join(baseUrl, 'grass.json'), fetcher), getJson(join(baseUrl, 'specimens.json'), fetcher),
    getJson(join(baseUrl, 'specimen-atlas.json'), fetcher), loader.loadAsync(join(baseUrl, 'specimen-atlas.png')),
  ]);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  const [grassRect, ...specimenRects] = atlasLayout;
  const [u, v, width, height] = grassRect;
  const grassGeometries = grassLods.map(({position, uv, bend}) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv.map((value, index) => index % 2 === 0 ? u + width * value : v + height * value), 2));
    geometry.setAttribute('bendWeight', new THREE.Float32BufferAttribute(bend, 1));
    geometry.computeVertexNormals();
    return geometry;
  });
  const atlasRects = Object.fromEntries(['bushTrunk', 'birchTrunk', 'leaf', 'branch'].map((name, index) => [name, specimenRects[index]]));
  return {atlas, grassGeometries, parts, atlasRects, atlasLayout, dispose() { for (const g of grassGeometries) g.dispose(); atlas.dispose(); }};
}

export function createSyntyVariantLoader({baseUrl, loader = new THREE.TextureLoader(), fetch: fetcher = globalThis.fetch} = {}) {
  if (!baseUrl) throw Error('createSyntyVariantLoader needs baseUrl');
  let atlasPromise, manifestPromise, disposed = false;
  const manifest = () => manifestPromise ??= getJson(join(baseUrl, 'expansion/manifest.json'), fetcher).catch(e => { manifestPromise = undefined; throw e; });
  return {
    variants: () => manifest().then(m => m.variants),
    async load(id, signal) {
      const {variants, rectangles} = await manifest();
      const entry = variants[id];
      if (disposed || !entry) throw Error('Unknown or unavailable vegetation variant');
      atlasPromise ??= loader.loadAsync(join(baseUrl, 'expansion/atlas.png')).then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; if (disposed) texture.dispose(); return texture;
      }).catch(error => { atlasPromise = undefined; throw error; });
      const [atlas, bytes] = await Promise.all([atlasPromise, fetcher(join(baseUrl, `expansion/${id}.bin`), {signal}).then(r => { if (!r.ok) throw Error(`Mesh download failed (${r.status})`); return r.arrayBuffer(); })]);
      signal?.throwIfAborted();
      if (disposed) throw Error('Vegetation loader disposed');
      const data = new Float32Array(bytes);
      const parts = entry.parts.map(({material, foliage, offset, vertices}) => {
        const position = new Float32Array(vertices * 3), uv = new Float32Array(vertices * 2);
        for (let i = 0; i < vertices; i++) { const p = offset + i * 5; position.set(data.subarray(p, p + 3), i * 3); uv.set(data.subarray(p + 3, p + 5), i * 2); }
        return {material, foliage, position, uv};
      });
      return {...entry, atlas, atlasRects: rectangles, parts};
    },
    dispose() { disposed = true; atlasPromise?.then(texture => texture.dispose(), () => {}); },
  };
}
