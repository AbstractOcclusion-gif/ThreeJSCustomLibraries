# three-kit

**Live bench:** https://abstractocclusion-gif.github.io/ThreeJSCustomLibraries/ — public module demos run in the browser
(deep links: `…/bench/?tool=vegetation`). Deployed from `main` by `.github/workflows/pages.yml`.

Choose **UI Tool** from the module list for an interactive sample. The same tool is available beside the settings in each bench demo, including on direct links. Search a demo's controls, reveal a setting in its original panel, or pin it for later. Use the demo's preset controls to save scene values.

Press **/** to open and focus the UI Tool, **Enter** to reveal the first match, or **Escape** to close it. Pins and the **Field** and **Slate** skins are remembered in the browser. The UI Tool is optional. Import `createUITool` from `@abstractocclusion/three-kit/ui` and mount it with a host element, a toggle button, and a stable demo ID. Load `@abstractocclusion/three-kit/ui/theme.css` for the included styles and override its CSS variables to customize the palette.

When adding a tweak, put its control in the module panel and pass scene settings or callbacks from the demo. This keeps the label, range, and behavior the same wherever the capability is used.

| Panel | Definition | Where it is used |
| --- | --- | --- |
| UI Tool | `src/ui/index.js` | UI Tool demo and the library's other bench demos |
| Stage | `bench/kit/controls.js` (`stageControls`) | Every module page on the basic stage: sun, light and wind |
| Weather | `src/weather/three/dev-panel.js` | Weather page; the two demos through `bench/kit/weather.js` |
| Terrain, shoreline, coast | `bench/terrain/controls.js` | Terrain page (layers, textures). The All tools demo adds shoreline and grass density by texture; the Ocean coast demo uses the coast controls. |
| Grass and plants | `bench/vegetation/controls.js` | Vegetation (grass, planting, contact). The All tools demo shares Grass. |
| Leaved Trees | `bench/trees/controls.js` | Vegetation trees and bushes, and Boundaries hedges |
| Inland water | `bench/water/controls.js` | Channel, Pond and the All tools demo. Wind, freeze, and dive-height controls follow the capabilities supplied by the scene. |
| Ocean | `bench/ocean/controls.js` | Ocean page and Ocean coast demo: sea state, look, reflections, underwater optics, presets |
| Boat, block, coast | `bench/demo-ocean/controls.js`, `bench/demo-ocean/trail-controls.js` | Ocean coast demo, around the shared ocean panels |
| Particles and spray | `bench/particles/controls.js` | Particles. Pond and the two demos share the spray controls. |
| Boundaries, Cable, Destruction, Fire | Each module's `bench/<module>/controls.js` | The respective pages |
| Camera | `src/camera/panel.js` (styles: `src/camera/panel.css`) | Camera |

Scene actions such as rolling a boulder, dropping an ice block, or starting the waterfall are supplied by the demo that owns them. Staged Aquarium and Fishing scenes use WebAquarium's own panels.

Neutral Three.js modules extracted from Abstract Occlusion's projects. Plain ESM under `src/`, no build step; `bench/` holds one
authoring page per module on the basic stage plus two mixed demos (`demo-ocean`, `demo-all`) where every module shares one
weather (Vite), `presets/` the JSON they save, `assets/` only free assets. Anything licensed (Synty packs,
Enviro-derived sky textures, commercial FX sheets) is never in the repo: drop it in `private-assets/` and every module falls back
to a free default without it. The weather module ships its own generated textures in `assets/weather/` (Perlin-Worley cloud
volumes, cirrus, moon, stars, galaxy, weather map — `npm run assets:weather` regenerates them); pass
`...bundledWeatherAssets()` from `three-kit/weather/bundled-assets` to `createThreeWeather` to use them.

## Use in a project

```sh
npm i github:AbstractOcclusion-gif/ThreeJSCustomLibraries#v0.2.0   # pin a tag; `three` is a peer dependency
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
| core (environment contract, lighting hook, sky, hash, value noise, fixed step, presets, validation) | `three-kit/core` | — | ✓ |
| stage (basic sky, sun, ambient, ground and environment for standalone use) | `three-kit/stage` | every module page | ✓ |
| weather & sky (sim + Three adapter + dev panel) | `three-kit/weather`, `/weather/three`, `/weather/dev-panel` | `bench/weather/` | ✓ |
| particles (puffs, chips, prefabs; water spray: sheets, sprites, droplets, depth binding, precipitation) | `three-kit/particles`, `/particles/water` | `bench/particles/` | ✓ |
| fire (ignition, heat spread, fuel) | `three-kit/fire` | `bench/fire/` | ✓ |
| water (channel and pond surfaces, waves, ripples, flow bake; ocean surface) | `three-kit/water` | `bench/water/`, `bench/pond/`, `bench/ocean/` | ✓ |
| flocking (instanced fish and schooling) | `three-kit/flocking` | `bench/flocking/` | ✓ |
| weathered surfaces (wetness, runoff streaks, snow, puddles, tracks, albedo anti-tiling) | `three-kit/surface` | `bench/terrain/` | ✓ |
| terrain (heightfield, automatic triplanar layers, prop contact blending, detail normals, shoreline wetness) | `three-kit/terrain` | `bench/terrain/` | ✓ |
| vegetation (grass with per-instance tint, specimens, procedural meadow tree, generated free assets, Synty loader code) | `three-kit/vegetation` | `bench/vegetation/` | ✓ |
| leaved trees (instanced lobed crowns + leaf cards, JSON profiles) | `three-kit/trees` | `bench/vegetation/` | ✓ |
| boundaries (runs → hedges/fences/walls/electric lines, JSON layouts) | `three-kit/boundaries` | `bench/boundaries/` | ✓ |
| cable (articulated rope on cannon-es, tube view) | `three-kit/cable` | `bench/cable/` | ✓ |
| destruction (rigid structures, impact fracture, overload detachment) | `three-kit/destruction`, `/destruction/three` | `bench/destruction/` | ✓ |
| camera (director, rigs, bullet time, replay, collision, post, panel) | `three-kit/camera` | `bench/camera/` | ✓ |

### Standalone: what each entry needs

Every entry imports on its own (`tests/isolation/` checks it). A module imports only `core` and the lower modules listed here;
everything in the last column is optional and has a calm, clear-noon default.

| Entry | Also imports | Peer dependencies | Optional inputs |
| --- | --- | --- | --- |
| `core`, `stage` | — | three | — |
| `weather` | — | none (pure simulation) | — |
| `weather/three` | `particles/water` precipitation (rain, snow) | three | `assetBaseUrl` or `...bundledWeatherAssets()` |
| `particles` | — | three | `environment` (option or `setEnvironment`), `assets` sheets |
| `particles/water` | — | three, passed in as `THREE` (motes and the spray pump import it) | `environment` (`spray.setEnvironment`, `precipitation.update`), `assets` |
| `fire` | — | none | `environment` (option or `setEnvironment`): wind pushes the spread |
| `water` | `particles/water` spray pump (the boat) | three | `sky` hook, `environment` (`ocean.setEnvironment`, `proceduralSky().setEnvironment`) |
| `flocking` | — | three | `modelsUrl` / `models`, `surfaceHeight` / `floorHeight` callbacks |
| `surface` | — | three | — |
| `terrain` | `surface` | three | `lighting` hook (coast), water `shoreBinding` |
| `vegetation` | — | three | `environment` in `grass.update` / `specimens.update` |
| `trees` | — | three | `lighting` hook, `environment` (`setEnvironment`) |
| `boundaries` | `trees` (hedges) | three | `lighting` hook, `environment` (`setEnvironment`), `assets` |
| `cable` | — | three, cannon-es | `environment` (`setEnvironment`) |
| `destruction`, `destruction/three` | cable physics and view for structural rigs; chips and puffs for views and debris | cannon-es; three for the view; optional caller-supplied Jolt | catalogue URL for authored assets |
| `camera` | — | three | load `three-kit/camera/panel.css` when you use `createCameraPanel` |
| `ui` | — | none | load `three-kit/ui/theme.css` |

`particles/water` takes `THREE` as an argument (rather than importing it) so its tests can inject a fake loader.
Per-frame methods are named `update(dt)`; `tick` remains as an alias where it existed. The camera director's `tick(dt)` is a
different thing: it returns the time scale.

### Basic stage

`createBasicStage({scene, sky = true, ground = true, shadows = false, ...STAGE_DEFAULTS})` from `three-kit/stage` gives a
module what it needs to be seen alone: a clear gradient sky, a sun, an ambient light, a flat ground, the default lighting hook
and an environment kept in step with them. It returns `{environment, lighting, sun, hemi, sky, skyUniforms, ground}` and
`setSun(elevationDegrees, azimuthDegrees)`, `setLight(level)` (1 = clear noon), `setWind(speed, headingDegrees, gust)`,
`update(camera)` once per frame, and `dispose()`. Pass `sky: false` or `ground: false` when the host has its own.

### Environment contract

`createEnvironment()` from `three-kit/core` is the one optional input the reactive modules share. It is plain data owned by
whoever drives the scene: the weather adapter fills `view.environment` each frame, the basic stage fills its own, or a project
fills one by hand. Modules read it and never write it.

| Field | Meaning |
| --- | --- |
| `wind.x`, `wind.z`, `wind.speed` | horizontal velocity the air moves toward, m/s, and its length (`setEnvironmentWind(env, speed, headingDegrees)`; 0° = +X, 90° = +Z) |
| `wind.gust` | 0..1 turbulence share; the weather adapter leaves it to the host |
| `sun.direction`, `sun.color` | unit vector toward the key light (the moon at night); colour × intensity, as a DirectionalLight |
| `ambient.sky`, `ambient.ground` | colour × intensity, as a HemisphereLight |
| `light` | relative scene light for unlit things such as sprites: white at clear noon |
| `daylight`, `rain`, `snow` | 0..1 |

### Fixed step

`createFixedStep({step = 1/120, maxSteps = 6})` from `three-kit/core` drives physics that must not see a variable frame time
(cable, destruction, buoyancy). `advance(dt, run)` calls `run(step)` once per whole step owed, keeps the remainder for the next
frame and returns the number of steps; a slow frame runs at most `maxSteps` and drops the rest. `reset()` clears the remainder.

### Lighting hook

Custom ShaderMaterials in the lib take `lighting: {glsl, uniforms}` (see `src/core/lighting.js`): the GLSL defines
`shade(albedo, n, sunVisibility, ao, wrap)` and `applyFog(color, viewDistance)`. The default is sun + hemisphere + linear fog;
`syncLighting(uniforms, {sun, hemi, fog})` drives it from ordinary Three lights, e.g. the ones the weather adapter animates.
Water materials take a `sky: {glsl, uniforms, defines}` hook the same way (`proceduralSky()` from `src/water/sky-binding.js` is the default).

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
Use `ocean.update(dt, windSpeed, camera.position, windHeading)` before drawing; with `ocean.setEnvironment(env)` the wind arguments may be left `undefined` and come from the environment. For scene optics, render
`ocean.captureScene(scene, camera)` and `ocean.captureWater(waterScene, camera)`, then pass both targets
to `composite.renderLayers`. Use `SurfaceProbes` to sample the same waves for the waterline or buoyancy.
Optional `wake: {}` enables the moving ripple window and hull footprints, and `caustics: {}` enables the
projected sunlight map. With `exclusion: true`, register a hull's lid and shell with `ocean.exclusion.add`.
`captureScene` takes `excludeHulls` to toggle the depth mask. `FoamTrail` renders a stern ribbon or paints foam into the
wake field after `ocean.update`. The Ocean coast demo (`bench/demo-ocean/`) exercises both with WebAquarium's original motorboat
when its assets are staged; the Ocean page (`bench/ocean/`) shows the surface alone on the basic stage.
`ocean.setShore(heightAt, bounds)` accepts a terrain height callback, while
`ocean.shoreBinding` lets a terrain material sample the wave and wet-sand inputs. Weather can run its
existing fog and sunlight pass over host-provided color, scene depth, and water distance textures.

The Pond bench uses the channel surface with Glider 2's waterfall sample and the Fishing pond's wind wave tuning.
Set waterfall flow to zero to inspect a still pond. Without weather, its air temperature slider drives the ice. Click for one ripple, hold to pulse, or drag to leave a trail.
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
The Flocking page (`bench/flocking/`) shows a school in a swim volume; the two demos put fish in water.

### Fire

`createFireSystem({spreadRadius, cooling})` runs independently of Three.js. Register an object with
`system.add({position, ignitionHeat, burnSeconds, heatOutput})`. Position is a live object with `x`, `y` and `z`
coordinates. Call `object.ignite()` to start a fire and `system.update(dt)` with elapsed seconds to advance it (`tick` is kept as an alias).
Read `object.phase` (`unlit`, `burning`, or `burned`) and the normalized `heat` and `fuel` values to drive visuals.
Burned objects stay burned until `system.reset()`. The bench uses the shared fire and smoke particle sheets.

### Destruction

The destruction module includes the rigid Pratt bridge, bendable assemblies, pre-fractured masonry and timber, and
structural cable rigs from Glider 2. For the rigid path, step your Cannon world, call `system.update(dt)`, then update
`createThreeStructureView({system, scene})`. The rigid system emits `member:fractured` and `member:detached` events.
`createAssemblySimulation(options)` owns its clock and world through `advance(seconds)`. It uses Cannon by default,
or accepts a driver created with `createJoltDriver(J)` or `createJoltClusterDriver(J)` and a caller-initialized Jolt module.

Serve the files in `assets/structures/` together and pass the manifest URL to `loadPartLibrary(url)` from
`destruction/three`. The catalogue includes 88 authored parts, their GLBs and fracture definitions, and the shared
atlases. The library owns loaded asset resources. Dispose views and debris bindings before the asset library.
Run `npm run build:catalogue` to validate exports and regenerate the manifest after authoring changes.

Open `/bench/destruction/parts.html?house=brick-cottage` for the catalogue, house, and staircase bench.
The cottage defaults to clustered Jolt. Append `&backend=cannon` for the Cannon reference. Click to fire a physical
impactor, toggle the facade, and use **Rebuild** to reset. The Blender extension lives in `tools/blender/`.

### Vegetation

`createGrassField({scene, geometries, map, color, placements, tileSize, flatColorMix})` — placements may carry `tint: [r, g, b]`
(linear) which becomes `instanceColor`. `createSpecimens({scene, parts, atlas, atlasRects, placements, profiles})` instances one
batch per kind with sway / flutter / contact sweep. `createProceduralMeadowTree(reference, {width, depth, crownHeight,
asymmetry})` and `createProceduralMeadowBush(reference)` build bark and leaf-card parts for it. The bush has several stems
rooted at ground level and works with the specimen `bush` motion profile. `createFreeVegetation()` supplies a generated atlas,
grass clump LODs and a shared plant reference; `loadSyntyVegetation({baseUrl})` / `createSyntyVariantLoader({baseUrl})` load a
private prepared pack (SYNTY.md).

### Leaved trees

`new LeavedTrees({scene, profile, lighting, leafTexture?, leafRect?, cellSize, sampleGround, canopy?, nearHole?})` then
`place(items)` with `{x, z, h, r, yaw?, tint | tint8}`; one InstancedMesh per 80 m cell and silhouette variant. `profile` is
`'tree'`, `'bush'` or a JSON object (see `presets/trees/*.json`); `setProfile()` rebuilds in place. The
material owns its shader and takes the `lighting` hook; the canopy sun-visibility map and the near dither hole are opt-in
defines. Hedges are the bush profile placed along a run.

### Boundaries, cable, camera

`createBoundaries({scene, assets, lighting, sampleGround})` turns validated runs (`layout.js`) into scene objects: `hedge` is
leaved bushes by default (`LeavedTrees`, bush profile, `hedgeOptions`), `fence`/`wall` repeat a `{model, length}` module
(procedural fallbacks included), `electric` places utility poles and sagging conductors. `createCable({world, endpoints,
length, preset})` needs `cannon-es`, the optional peer dependency also used by destruction. The camera module is unchanged
from Glider: `createCameraDirector`, `createFollowRig`, `createOrbitRig`, `createReplay`, `createCameraCollision`,
`createCameraPost`, `createCameraPanel`. The panel's styles are not imported by the module (it stays plain ESM): load
`three-kit/camera/panel.css` yourself, as with the UI tool's theme.

## Not in this repo (on purpose)

Glider's authored masonry and Jolt labs, the full WebAquarium pond/ocean workshops and their emitters,
the Synty catalogue and private texture packs. See `private-assets/README.md` and `SYNTY.md`.

## Tests

`npm test` runs Node's test discovery inside `tests/` (no browser). Selected modules also have `npm run test:<module>` scripts.
`tests/isolation/` checks that every package entry imports alone and that modules and module pages import only what the
rules above allow; a new bench page needs an entry there.

## Credits

Code by Abstract Occlusion (Bert), MIT. Techniques adapted, as reimplementations, from: Evan Wallace's WebGL Water (MIT) and
the Abstract Occlusion WebGpuWater / WebAquarium projects for the water surfaces, ripples and spray; the Nubis / Horizon Zero
Dawn cloud papers and the general "Enviro-style" layered sky for the volumetric clouds; JONSWAP spectra for the wind-wave
bank. Dependencies: [three.js](https://threejs.org) (MIT), [lil-gui](https://lil-gui.georgealways.com) (MIT, bench only),
[cannon-es](https://pmndrs.github.io/cannon-es/) (MIT, used by cable, destruction and some benches).
Bundled assets include generated textures, WebAquarium fish models and CC0 [terrain maps](assets/terrain/README.md).
