# three-kit

**Live bench:** https://abstractocclusion-gif.github.io/ThreeJSCustomLibraries/ — public module demos run in the browser
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
| flocking (instanced fish and schooling) | `three-kit/flocking` | `bench/pond/` | ✓ |
| weathered surfaces (wetness, runoff streaks, snow, puddles, tracks, albedo anti-tiling) | `three-kit/surface` | `bench/weather/`, `bench/water/` | ✓ |
| terrain (heightfield, automatic triplanar layers, prop contact blending, detail normals, shoreline wetness) | `three-kit/terrain` | `bench/terrain/` | ✓ |
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
sources; without them puffs use the bundled SVG masks and the water sprites a generated soft disc. The water particle entry
also exports suspended motes and precipitation. WebAquarium's full pond and ocean emitter systems stay in the original scenes.

`createParticlePrefab` bundles original 4×4 flame, smoke, and dust flipbooks. The sprite shader blends adjacent
frames over each particle's lifetime and maps the flame sheet's red channel to a heat color ramp.
Smoke and water mist use animated 3D noise for billowing density and softer silhouettes.
Custom puff sheets can opt into lifetime playback with `{url, cols, rows, animate: true}`. Frames run left to right,
top to bottom, and use RGBA with coverage in alpha. Sheets without `animate` still select a fixed frame by index.

### Water

`createChannelSurface({renderer, scene, camera, sky, ripples, obstacles, flow, foamTexture?})` and
`createOceanSurface({renderer?, sky, geometry?, laceTexture?, settings})` draw the sky through the `sky` hook from `sky-binding.js`:
`skyFromWeather(view)` shares the weather adapter's dome, `proceduralSky()` is a static gradient with a sun you drive, and
`customSky({glsl, uniforms})` takes your own `sky(dir, sunMul)`. Foam and whitecap tiles are generated (`foam-texture.js`); pass
your own textures to override. `createRipples` / `createFlowBake` take `{origin, size, cell}` grids and `ripples.mask(isWet)`
takes a callback.

For level water, set `settings.planarReflection = {...POND_REFLECTION_DEFAULTS}` on the channel surface to
capture mirrored scene geometry. `createWaterlineComposite(renderer, {caustics: surface.lighting})` can render a perspective view across the
waterline. Pass the water height at the eye's horizontal position and optional surface slopes to
`composite.render(scene, camera, {height, slopeX, slopeZ, waterType})`. The optical presets come from WebAquarium.

With a WebGL2 renderer, the ocean runs WebAquarium's FFT cascades and camera-following clipmap.
Use `ocean.update(dt, windSpeed, camera.position, windHeading)` before drawing. For scene optics, render
`ocean.captureScene(scene, camera)` and `ocean.captureWater(waterScene, camera)`, then pass both targets
to `composite.renderLayers`. Use `SurfaceProbes` to sample the same waves for the waterline or buoyancy.
Optional `wake: {}` enables the moving ripple window and hull footprints, and `caustics: {}` enables the
projected sunlight map. With `exclusion: true`, register a hull's lid and shell with `ocean.exclusion.add`.
`captureScene` takes `excludeHulls` to toggle the depth mask. `FoamTrail` renders a stern ribbon or paints foam into the
wake field after `ocean.update`. The Ocean bench exercises both with WebAquarium's original motorboat.
`ocean.setShore(heightAt, bounds)` accepts a terrain height callback, while
`ocean.shoreBinding` lets a terrain material sample the wave and wet-sand inputs. Weather can run its
existing fog and sunlight pass over host-provided color, scene depth, and water distance textures.

The Pond bench uses the channel surface with Glider 2's waterfall sample and the Fishing pond's wind wave tuning.
Set waterfall flow to zero to inspect a still pond. Click for one ripple, hold to pulse, or drag to leave a trail.
The `Water → Underwater light` folder controls caustics and shafts. With `bedCaustics: 'material'`, bind submerged
lit materials through `surface.lighting.bindBedMaterial(material)` to receive projected caustics. Pass a list of
`lightOccluders` to include mesh shadows in the shaft pass.

Run `npm run stage:webaquarium` to bring the sibling WebAquarium project into the local bench. Supply
`WEBAQUARIUM_ROOT` or pass its path after `--` if it is elsewhere. Aquarium and Fishing load the original browser
scenes with their renderer, game data, and dev panels. Use `npm run dev` to view the staged scenes locally.
The build omits the staged game and licensed assets.

### Flocking

`createFishFlock({bounds, counts, surfaceHeight?, floorHeight?})` from `three-kit/flocking` loads
WebAquarium's fish meshes, instanced swim animation, and schooling behavior. Add the returned
`group` to a scene and call `update(dt)`. Water and terrain heights are optional host callbacks.
In the Pond bench, enable **Show fish school** and use **Underwater view**.

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
length, preset})` needs `cannon-es`, the optional peer dependency also used by destruction. The camera module is unchanged
from Glider: `createCameraDirector`, `createFollowRig`, `createOrbitRig`, `createReplay`, `createCameraCollision`,
`createCameraPost`, `createCameraPanel`.

## Not in this repo (on purpose)

Glider's authored masonry and Jolt labs, the full WebAquarium pond/ocean workshops and their emitters,
the Synty catalogue and private texture packs. See `private-assets/README.md` and `SYNTY.md`.

## Tests

`npm test` runs Node's test discovery inside `tests/` (no browser). Selected modules also have `npm run test:<module>` scripts.

## Credits

Code by Abstract Occlusion (Bert), MIT. Techniques adapted, as reimplementations, from: Evan Wallace's WebGL Water (MIT) and
the Abstract Occlusion WebGpuWater / WebAquarium projects for the water surfaces, ripples and spray; the Nubis / Horizon Zero
Dawn cloud papers and the general "Enviro-style" layered sky for the volumetric clouds; JONSWAP spectra for the wind-wave
bank. Dependencies: [three.js](https://threejs.org) (MIT), [lil-gui](https://lil-gui.georgealways.com) (MIT, bench only),
[cannon-es](https://pmndrs.github.io/cannon-es/) (MIT, used by cable, destruction and some benches).
Bundled assets include generated textures, WebAquarium fish models and CC0 [terrain maps](assets/terrain/README.md).
