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

Register a standard or physical material with `view.addCloudShadowReceiver(material)` to shade it with the weather sun's cloud transmittance. The returned function detaches the material, and disposing the weather view detaches all receivers. Set `appearance.cloudShadowStrength` from `0` to `1` to blend the effect.

## Modules

| Module | Entry | Bench | Status |
| --- | --- | --- | --- |
| core (lighting contract, hash, preset helpers) | `three-kit/core` | — | ✓ |
| weather & sky (sim + Three adapter + dev panel) | `three-kit/weather`, `/weather/three`, `/weather/dev-panel` | `bench/weather/` | ✓ |
| particles (puffs, chips, prefabs; water spray: sheets, sprites, droplets, depth binding, precipitation) | `three-kit/particles`, `/particles/water` | `bench/particles/` | ✓ |
| fire (ignition, heat spread, fuel) | `three-kit/fire` | `bench/fire/` | ✓ |
| water (channel and pond surfaces, waves, ripples, flow bake; ocean surface) | `three-kit/water` | `bench/water/`, `bench/pond/`, `bench/ocean/` | ✓ |
| weathered surfaces (wetness, runoff streaks, snow, puddles, tracks, albedo anti-tiling) | `three-kit/surface` | `bench/weather/`, `bench/water/` | ✓ |
| vegetation (grass with per-instance tint, specimens, procedural meadow tree, generated free assets, Synty loader code) | `three-kit/vegetation` | `bench/vegetation/` | ✓ |
| leaved trees (instanced lobed crowns + leaf cards, JSON profiles) | `three-kit/trees` | `bench/trees/` | ✓ |
| boundaries (runs → hedges/fences/walls/electric lines, JSON layouts) | `three-kit/boundaries` | `bench/boundaries/` | ✓ |
| cable (articulated rope on cannon-es, tube view) | `three-kit/cable` | `bench/cable/` | ✓ |
| destruction (rigid structures, impact fracture, overload detachment) | `three-kit/destruction`, `/destruction/three` | `bench/destruction/` | ✓ |
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

`createParticlePrefab` bundles original 4×4 flame, smoke, and dust flipbooks. The sprite shader blends adjacent
frames over each particle's lifetime and maps the flame sheet's red channel to a heat color ramp.
Smoke and water mist use animated 3D noise for billowing density and softer silhouettes.
Custom puff sheets can opt into lifetime playback with `{url, cols, rows, animate: true}`. Frames run left to right,
top to bottom, and use RGBA with coverage in alpha. Sheets without `animate` still select a fixed frame by index.

### Water

`createChannelSurface({renderer, scene, camera, sky, ripples, obstacles, flow, foamTexture?})` and
`createOceanSurface({sky, geometry?, laceTexture?, settings})` draw the sky through the `sky` hook from `sky-binding.js`:
`skyFromWeather(view)` shares the weather adapter's dome, `proceduralSky()` is a static gradient with a sun you drive, and
`customSky({glsl, uniforms})` takes your own `sky(dir, sunMul)`. Foam and whitecap tiles are generated (`foam-texture.js`); pass
your own textures to override. `createRipples` / `createFlowBake` take `{origin, size, cell}` grids and `ripples.mask(isWet)`
takes a callback. The full WebAquarium pond/ocean workshops are not part of this lib.

The pond bench adapts Glider 2's procedural waterfall sample to the current channel surface, ripple grid,
generated foam and depth-aware spray. Set waterfall flow to zero to inspect a still pond.

### Fire

`createFireSystem({spreadRadius, cooling})` runs independently of Three.js. Register an object with
`system.add({position, ignitionHeat, burnSeconds, heatOutput})`. Position is a live object with `x`, `y` and `z`
coordinates. Call `object.ignite()` to start a fire and `system.tick(dt)` with elapsed seconds to advance it.
Read `object.phase` (`unlit`, `burning`, or `burned`) and the normalized `heat` and `fuel` values to drive visuals.
Burned objects stay burned until `system.reset()`. The bench uses the shared fire and smoke particle sheets.

### Destruction

The rigid destruction runtime and Pratt pony truss sample come from Glider 2's Structures lab.
`createStructureSystem({world, definition, canDamage})` adds members to a caller-owned Cannon world. Step the world,
call `system.update(dt)`, then update the optional `createThreeStructureView({system, scene})`. The system reports
`member:fractured` and `member:detached` events. The bridge bench uses a generated sphere as its physical projectile
and builds all its meshes from primitives. This port covers rigid members and excludes the authored masonry and Jolt labs.

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

## Credits

Code by Abstract Occlusion (Bert), MIT. Techniques adapted, as reimplementations, from: Evan Wallace's WebGL Water (MIT) and
the Abstract Occlusion WebGpuWater / WebAquarium projects for the water surfaces, ripples and spray; the Nubis / Horizon Zero
Dawn cloud papers and the general "Enviro-style" layered sky for the volumetric clouds; JONSWAP spectra for the wind-wave
bank. Dependencies: [three.js](https://threejs.org) (MIT), [lil-gui](https://lil-gui.georgealways.com) (MIT, bench only),
[cannon-es](https://pmndrs.github.io/cannon-es/) (MIT, cable module only). All textures in `assets/` are generated by
scripts in this repo or hand-drawn; no third-party art is included.
