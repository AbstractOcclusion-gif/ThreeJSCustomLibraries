# Private vegetation drop-in (Synty POLYGON Nature Biomes)

The library never contains Synty data. If you own the pack, prepare the files with your own tooling and serve them from a
folder of yours; the bench looks for them at `private-assets/synty/vegetation/` (gitignored, served at `/synty/vegetation/`).

```
synty/vegetation/
  grass.json             [{position: [...], uv: [...], bend: [...]}, ...]   grass clump LOD geometries (near, far)
  specimens.json         {bush: [{material, foliage?, position, uv}], birch: [...]}
  specimen-atlas.json    [[u, v, w, h] × 5]  rects for: grass, bushTrunk, birchTrunk, leaf, branch
  specimen-atlas.png
  expansion/manifest.json  {rectangles: {material: [u, v, w, h]}, variants: {id: {label, mode, height, parts: [{material, foliage, offset, vertices}]}}}
  expansion/atlas.png
  expansion/<id>.bin     Float32 x, y, z, u, v per vertex
```

```js
import {loadSyntyVegetation, createSyntyVariantLoader} from '@abstractocclusion/three-kit/vegetation';
const pack = await loadSyntyVegetation({baseUrl: '/synty/vegetation/'});
const variants = createSyntyVariantLoader({baseUrl: '/synty/vegetation/'});
```

Without the drop-in, `createFreeVegetation()` supplies a generated atlas, grass clumps and a procedural-tree reference.
