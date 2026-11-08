# three-kit

**Live bench:** https://abstractocclusion-gif.github.io/ThreeJSCustomLibraries/ — every module runs in the browser
(deep links: `…/bench/?tool=trees`). Deployed from `main` by `.github/workflows/pages.yml`.

Neutral Three.js modules extracted from Abstract Occlusion's projects. Plain ESM under `src/`, no build step; `bench/` holds one
authoring page per module (Vite), `presets/` the JSON they save, `assets/` only free assets. Anything licensed (Synty packs,
Enviro-derived sky textures, commercial FX sheets) is never in the repo: drop it in `private-assets/` and every module falls back
to a free default without it. The weather module ships its own generated textures in `assets/weather/` (Perlin-Worley cloud
volumes, cirrus, moon, stars, galaxy, weather map — `npm run assets:weather` regenerates them); pass
`...bundledWeatherAssets()` from `three-kit/weather/bundled-assets` to `createThreeWeather` to use them.

## Use in a project

```sh
npm i github:AbstractOcclusion-gif/ThreeJSCustomLibraries#v0.1.0   # pin a tag; `three` is a peer dependency
```
```js
import {createWeatherSystem} from '@abstractocclusion/three-kit/weather';
import {createThreeWeather} from '@abstractocclusion/three-kit/weather/three';
```
Local hacking against a game: `npm link` here, `npm link @abstractocclusion/three-kit` in the game.

## Modules

| Module | Entry | Bench | Status |
| --- | --- | --- | --- |
| core (lighting contract, hash, preset helpers) | `three-kit/core` | — | ✓ |
| weather & sky (sim + Three adapter + dev panel) | `three-kit/weather`, `/weather/three`, `/weather/dev-panel` | `bench/weather/` | ✓ |
| particles (puffs, chips, prefabs; water spray: sheets, sprites, droplets, depth binding, precipitation) | `three-kit/particles`, `/particles/water` | `bench/particles/` | ✓ |
| water (channel surface, waves, ripples, flow bake, channel; ocean surface) | `three-kit/water` | `bench/water/`, `bench/ocean/` | ✓ |
| vegetation (grass with per-instance tint, specimens, procedural meadow tree, generated free assets, Synty loader code) | `three-kit/vegetation` | `bench/vegetation/` | ✓ |
| leaved trees (instanced lobed crowns + leaf cards, JSON profiles) | `three-kit/trees` | `bench/trees/` | ✓ |
| boundaries (runs → hedges/fences/walls/electric lines, JSON layouts) | `three-kit/boundaries` | `bench/boundaries/` | ✓ |
| cable (articulated rope on cannon-es, tube view) | `three-kit/cable` | `bench/cable/` | ✓ |
| camera (director, rigs, bullet time, replay, collision, post, panel) | `three-kit/camera` | `bench/camera/` | ✓ |

### Lighting hook

Custom ShaderMaterials in the lib take `lighting: {glsl, uniforms}` (see `src/core/lighting.js`): the GLSL defines
`shade(albedo, n, sunVisibility, ao, wrap)` and `applyFog(color, viewDistance)`. The default is sun + hemisphere + linear fog;
`syncLighting(uniforms, {sun, hemi, fog})` drives it from ordinary Three lights, e.g. the ones the weather adapter animates.
Water materials take a `sky: {glsl, uniforms, defines}` hook the same way (`src/weather/three/sky-dome.js` is the default).

## Bench

```sh
npm i && npm run dev        # opens /bench/
npm test                    # node --test
```

### Particles and licensed sheets

`createPuffs(scene, {assets})` and `createWaterSpray({..., assets: {assetBaseUrl, sheets, dropletUrl}})` take optional asset
sources; without them puffs use the bundled SVG masks and the water sprites a generated soft disc. The pond/ocean emitters that
depend on WebAquarium's renderer internals (pond splash/bubbles/silt/motes, ocean motes/rain) are not in this lib.

### Water

`createChannelSurface({renderer, scene, camera, sky, ripples, obstacles, flow, foamTexture?})` and
`createOceanSurface({sky, geometry?, laceTexture?, settings})` draw the sky through the `sky` hook from `sky-binding.js`:
`skyFromWeather(view)` shares the weather adapter's dome, `proceduralSky()` is a static gradient with a sun you drive, and
`customSky({glsl, uniforms})` takes your own `sky(dir, sunMul)`. Foam and whitecap tiles are generated (`foam-texture.js`); pass
your own textures to override. `createRipples` / `createFlowBake` take `{origin, size, cell}` grids and `ripples.mask(isWet)`
takes a callback. The full WebAquarium pond/ocean workshops are not part of this lib.

### Vegetation

`createGrassField({scene, geometries, map, color, placements, tileSize, flatColorMix})` — placements may carry `tint: [r, g, b]`
(linear) which becomes `instanceColor`. `createSpecimens({scene, parts, atlas, atlasRects, placements, profiles})` instances one
batch per kind with sway / flutter / contact sweep. `createProceduralMeadowTree(reference, {width, depth, crownHeight,
asymmetry})` builds bark + leaf-card parts for it. `createFreeVegetation()` supplies a generated atlas, grass clump LODs and a
tree reference so nothing licensed is needed; `loadSyntyVegetation({baseUrl})` / `createSyntyVariantLoader({baseUrl})` load a
private prepared pack (SYNTY.md).

### Leaved trees

`new LeavedTrees({scene, profile, lighting, leafTexture?, leafRect?, cellSize, sampleGround, canopy?, nearHole?})` then
`place(items)` with `{x, z, h, r, yaw?, tint | tint8}`; one InstancedMesh per 80 m cell and silhouette variant. `profile` is
`'tree'`, `'bush'` or a JSON object (`presets/trees/*.json`, authored in the bench); `setProfile()` rebuilds in place. The
material owns its shader and takes the `lighting` hook; the canopy sun-visibility map and the near dither hole are opt-in
defines. Hedges are the bush profile placed along a run.

### Boundaries, cable, camera

`createBoundaries({scene, assets, lighting, sampleGround})` turns validated runs (`layout.js`) into scene objects: `hedge` is
leaved bushes by default (`LeavedTrees`, bush profile, `hedgeOptions`), `fence`/`wall` repeat a `{model, length}` module
(procedural fallbacks included), `electric` places utility poles and sagging conductors. `createCable({world, endpoints,
length, preset})` needs `cannon-es` (optional peer dependency; only this module imports it). The camera module is unchanged
from Glider: `createCameraDirector`, `createFollowRig`, `createOrbitRig`, `createReplay`, `createCameraCollision`,
`createCameraPost`, `createCameraPanel`.

## Not in this repo (on purpose)

Glider's `lib/structures` (cannon/Jolt destructibles — a physics package, not rendering), the full WebAquarium pond/ocean
workshops and their emitters, the Synty catalogue and every licensed texture. See `private-assets/README.md` and `SYNTY.md`.

## Tests

`npm test` runs every `tests/**/*.test.js` under node (no browser); the benches are checked in a headless browser when a
batch lands. Per module: `npm run test:<module>`.
