# Shared-physics trial · 22 November 2026

## Approved harmony and authoring UI

### Smaller early skirt, staged fades and longer-lived ground dust

Shared skirt defaults are now .2 / .6 head radii at its upper/lower tiers,
.65 / 1.25 head radii below the head centre, with puff size .7x. Its emission
starts at reference second 1.5, independent of bulk rise. The existing formation
pass opens it by second 8; its own .8-second birth fade and incandescence replace
the head-detail/centre-heat reveal gates. This makes the skirt present during
early formation rather than waiting for the head to rise and cool.

Shared visibility uses one reference-clock sequence: column holds to second 60,
fades over 60–100, then skirt fades over 100–140. The existing cloud visibility
preset remains last; custom cloud times are bounded to preserve this ordering.
Skirt/head parcel identity now owns those fades, while gas and ground projection
use the head's lower envelope for fade ownership. Ground dust independently holds
until second 60 and settles/fades over 60–120, instead of 24–55. Ground feeding
still shuts down on its original schedule; no extra smoke or buoyant force is
injected to keep the ground sprites alive.

Head shape support mixes .35 of the existing spherical parcel circulation into
shared head advection, easing in over reference seconds 12–24. Gas transport,
heat, bulk ascent and ignition motion are unchanged. This is explicit authored
shape support, adjustable down to 0 for pure gas tracers. At High, rise .9 and
drag 1.85, local head-parcel height/width measured .63 without support and .80
with it at reference seconds 36/60. These bounds do not establish a spherical
per-pixel silhouette. Browser checks at 20 kt, High and x10 showed the early
cap/skirt/column/ground composition and the surviving cloud after skirt/column
disappeared. Complete matched-age x1/x10 and orbit approval remain playtests.

There are now 74 authoring controls, including early reveal, head shape support,
skirt puff size and the **Column → skirt → cloud** staging/ground timing folder.
Legacy mode retains its old fade ownership and ground-settling schedule.

### Conical skirt profile

Shared mode now uses its existing four emission bursts as tiers of a truncated
cone, following the user's drawn reference: narrow at the cloud join, broader
at the lower rim. Upper/lower ring radii default to .25 / .75 of head radius;
their vertical drops are .65 / 1.45 head radii below the head centre. This reduces
the lower ring target from the former .92 head radii. Puffy boundaries remain
soft: no solid cone, new shader or shared-particle change is introduced.

`skirtConeTarget` supplies the same profile to emission and subsequent guidance.
Each tier retains its layer identity as the cloud rises and expands. Fragment
sampling now selects the outer tiers, rather than the old .88 radius threshold.
Head/gas dynamics, puff sizes, phase, lighting and ground effects are unchanged
by this shape adjustment. Legacy mode retains its original collar layout.

Four controls under **Skirt emission** adjust cone upper/lower radius and drop;
there are now 65 authoring controls. Local pre-cone source, including the previous
lag/roll adjustments, is preserved at
`baselines/demo-blast/2026-11-22-before-conical-skirt/` (39 SHA-256 verified files).
Twelve focused checks pass, including ordered cone tiers, the reduced lower-rim
target, late gas/puff frequency agreement, reset and fragment sampling. The
rendered smoke silhouette still needs a playtest at the normal demo URL.

### Downward head roll

The scene's head roll gain is now +1.6 instead of -1.6, matching the skirt's
positive inverse-lookup convention. The angular speed magnitude, integrated
phase, late slowdown and gas motion are unchanged. A late-phase regression check
uses the installed material's phase/gain and the flow's axis at eight azimuths
to verify downward visible displacement of outer-flank density features. This
checks the direction convention, not a rendered late-cloud playtest.

### Reduced skirt lag

Shared-mode **Skirt rise following ×** now defaults to 1 instead of the former
hard-coded .65. It changes only the final multiplier of existing capped vertical
collar guidance. The lower target, radial guidance, emission layout, gas/head
advection and all materials/rolling are unchanged. Legacy motion still uses .65;
set the new control to .65 in Shared mode to compare the pushed `7eb4915` timing.
This makes 61 cloud authoring controls.

A High-fluid source simulation at reference second 16 measured head-to-skirt
centre separation 32.73 -> 27.32 at rise .65, and 66.03 -> 48.35 at rise 1.3.
The head heights/radii were identical across each pair. By reference second 24,
the distances were 43.55 -> 36.67 and 40.36 -> 35.27 respectively. These are local
parcel measurements, not rendered connector lengths. High buoyancy can still
show a substantial gap; screenshot matching and visual approval remain a playtest.

The approved shared-flow head, restored skirt and 1.5x billows are now the default
on the normal demo/catalogue entry. `?motion=accepted` retains legacy motion.
The existing Fireball panel remains; **Cloud authoring · restarts blast** adds
65 controls for billow envelopes, shared size, skirt shape/emission/following, puff blending and
growth, roll easing/gains, counts, ground dust/ring, feeding/settling, late ascent
and atmospheric visibility. Finish an edit to restart consistently. The reset
button restores the approved cloud defaults, including paired ranges. Quality
continues owning solver resolution, sample counts and allocation budgets.

Ignition now uses the same normal density displacement as mature smoke, without
the ignition-only outward lobes or multi-axis noise wobble. The existing integrated
downward scroll/roll phase remains; ignition expansion, heating, lighting and
fire fade times are preserved. This removes an authored density distortion, not
physical buoyant advection or the column's separate feeding transport.

User-approved pre-UI source is preserved locally at
`baselines/demo-blast/2026-11-22-approved-harmony-before-ui/` (36 verified files).
Local baseline archives, personal images and performance traces are not production
assets. The catalogue already contains the Desert Blast scene link; root redirects
to that catalogue, and Vite discovers the demo's index.html for production builds.

Exact pre-trial state: `baselines/demo-blast/2026-11-22-before-shared-physics-trial/`
(35 files, copied and SHA-256 verified before edits). The original last-safe
checkpoint remains untouched. This trial changes only demo code and tests.

The Fireball panel's **Cloud motion (restarts blast)** compares **Accepted motion**
(`?motion=accepted`) with **Shared solver · trial** (`?motion=shared`, now default).
Switching restarts the blast and resets the selected camera view.
Yield changes retain the selected motion mode in the URL.

### Larger billows and restored collar

The exact 36-file state before this revision is saved and SHA-256 verified at
`baselines/demo-blast/2026-11-22-before-shared-collar-billows/`. It preserves the
initial harmonized pure-advection trial for comparison or rollback.

Shared mode now keeps the head on the gas grid's .8-rate velocity and reuses the
existing accepted skirt radius/altitude guidance. Pure advection carried skirt
parcels into the body and lost the collar. This is explicitly a hybrid: the head
shares gas physics, while the skirt keeps an authored shape constraint. No new
collar trajectory, attachment formula, downward-roll sign or shader was added.
The established collar's limited following at high rise remains a limitation.

Head and skirt puff widths are 1.5x in Shared mode. The existing mean-width link
also makes gas detail coarser by the same factor, including late expansion
compensation. Ground sizes, counts, birth positions, growth timing, materials,
lighting, fire timing, roll direction and gas physics stay unchanged. Larger
detail also applies during ignition; fire-noise feature sizes are consequently
coarser, although its heat/colour/fade schedule is unchanged. Accepted mode keeps
the original widths and motion. Both modes can be selected without reloading.

Sixteen focused tests pass: head gas-velocity inheritance, original skirt guidance,
outer collar placement for both yields/rise settings, common gas/puff frequency
after expansion, 1.5x head envelopes, unchanged ground sizes, mode recovery,
handoff and reset. This revision has not been visually playtested. Reload the
normal demo with `quality=high&yield=20&motion=shared`, play, then compare rise
.65 / 1.3 and Playback x1 / x10. Expect larger billows and a distinct lower
collar without bringing back the head's old independent circulation.

## Initial coherence study and trial evidence

The following records the initial pure-advection trial, before the collar revision
above. Its code and line references are preserved in the 36-file checkpoint.

The pre-edit 35-file source/test manifest matched exactly. Current shared particle
files were inspected as working-tree dependencies; their existing user changes
were not replaced. This study followed the CPU `plume-flow.js` path.
`plume-fluid.js` exports a different GPU implementation but is not imported by
this demo; its entry was inspected to establish that distinction, not audited as
an active solver. Region dominance below is a source-based interpretation of
overlapping transparent layers, not a renderer-isolation measurement.

| Region | Rendering / movement / clock ownership |
| --- | --- |
| Crown and outer cap | Gas raymarch plus 124 High head parcels. Accepted parcels use analytic spherical circulation around the measured head; Shared uses gas velocity. Local puff rotation is separate from both. |
| Middle / lower head | Dense axisymmetric gas is expected to dominate much of the interior. Solver smoke/heat advect at .8 reference seconds per reference second; animated 3D noise displaces/modulates that field. Head parcels overlap it. |
| Skirt / collar | Four bursts of eight High volumetric sprites. Accepted uses radius/altitude guidance with capped vertical following times .65; Shared uses gas velocity. Authored birth placement, growth and local roll remain. |
| Column | Primarily gas, with a separate source-height transport lookup until reference second 24. Texture selection, density selection and opacity selection do not all use the same head boundary. |
| Ground | Gas near the ground plus independently expanding/settling dust. It intentionally stays ground-owned, rather than following the head. |
| Late cloud | `createLateCloud` supplies common bulk height, expansion and wind to gas and parcels; the local fluid and procedural clocks keep evolving. It is not another per-region parcel solver. |

Reference time is world time / sqrt(length). Playback multiplies host simulation
dt once; weather and camera follow wall time. The main loop bounds updates to
1/60 world seconds before late mode and 1/30 afterward; cloud updates further
bound fluid/puff work to .04 reference seconds. Solver fixed steps are .025,
advanced at .8. The outer frame loop clamps wall dt to .05, so slow rendering can
make actual playback slower than its label. Playback does not multiply shader
phase a second time. See `main.js:209` and `main.js:271`,
`cloud.js:338`, `plume-flow.js:167`, `bench/kit/page-lifecycle.js:1`.

| Evidence / source | Mismatch and consequence | Status |
| --- | --- | --- |
| `plume-flow.js:101`, `plume-flow.js:219` | Rise enters gas buoyancy quadratically. .65 to 1.3 means 4x that force term, not 2x every visible motion. Accepted head circulation and skirt guidance do not share that force. | Confirmed ownership mismatch; Shared bypasses the two overrides. |
| `plume-flow.js:211`, `plume-motion.js:18` | Accepted skirt altitude is a fraction of total head height, not a fixed collar drop relative to radius. Its target-relative vertical speed is capped and reduced to .65. A rapidly rising head can leave it behind. | Confirmed mechanism; accepted appearance intentionally retained. |
| `fireball.js:127`, `fireball.js:160`, `cloud.js:109` | Detail selects the head by its lower radius; density boost/fade and parcel late fade still use altitude fractions. Lower-head samples can receive column treatment. | Confirmed classification disagreement; not changed in this advection trial. |
| `fireball.js:144`, `fireball.js:155`, `puff-blend.js:94` | Gas head and base noise scroll in opposite vertical directions. Puff roll gains are head -1.6 and skirt +1.2. Translation, puff rotation, circulation and ascent are different mechanisms. | Confirmed difference; direction readability needs controlled visual judgement. No sign flip made. |
| `fireball.js:139`, `fireball.js:326`, `cloud.js:388`, `puff-blend.js:83` | Nominal world frequency is aligned, including late puff growth compensation. Gas uses warped noise and a grid envelope; puffs use independent seeded sphere envelopes with four chord samples and a second octave. | Equal frequency does not imply equal visible lobes. Count, overlap, opacity, shading and envelope clipping remain different. |
| `fireball.js:150`, `fireball.js:168`, `puff-blend.js:57` | Gas visible density includes displacement and billow modulation, but gas shadow probes read the unmodulated field. Puff shadows share rotation/scale but approximate density using only coarse noise and omit detail/upper feathering. | Coordinates are partly compatible; density/shadow integrands are not identical. Not changed. |
| `plume-flow.js:85`, `plume-flow.js:227`, `src/particles/puffs.js:187` | Gas drag is weak exponential velocity damping; head friction also divides authored circulation; viscosity diffuses only the gas. Puff launch drag and wind add independent movement in Accepted mode. | Shared tracers now inherit the common gas velocity, without extra launch or wind drift. Procedural texture rates still do not read these sliders. |
| `late-cloud.js:36`, `late-cloud.js:56`, `cloud.js:348` | Handoff inherits filtered head-rise speed, eases forces over six reference seconds and caps positive acceleration. Initial mapping is identity. The first host update already advances the bulk model; subsequent radius growth follows entrainment/diffusion rather than the preceding measured radius derivative. | Old preset velocity jump is absent. C1/C2 continuity of position/expansion at the live crossing has not been established; acceleration and expansion need measurement. |
| `cloud.js:357`, `cloud.js:369`, `plume-motion.js:3` | Fluid redistribution and local parcel movement continue after feed shutdown. Late re-anchoring removes local head climb from bulk transport. Roll eases to a nonzero .24 rate, not a complete stop. | Existing lifecycle test proves nonzero evolution, not enough perceptual evolution. Bulk rise can remain obvious while internal movement becomes weak. |
| `quality.js:1` | Quality changes solver cell size, projection iterations, parcel count and ray budget, not just pixel resolution. | Artistic/numerical tier differences are expected; cross-quality physical parity is not established. |

### Comparison coverage

High-quality UI was inspected at the normal demo entry point. These are sampled
views, not synchronized captures or measured playback equivalence. The automated
shared-mode integration cases use Low fluid resolution for inexpensive lifecycle
coverage; they do not prove High GPU appearance.

| Yield / buoyancy | Playback x1 coverage | Playback x10 coverage | Shared integration |
| --- | --- | --- | --- |
| 1 kt / .65 | No complete mature comparison | Shared late cloud sampled: separate collar greatly reduced | Handoff/reset passed |
| 1 kt / 1.3 | Switched into x1 after accelerated evolution; no matched-age sequence | Shared post-handoff cloud sampled: merged body, weak distinct skirt | Handoff/reset passed |
| 20 kt / .65 | Accepted ignition sampled; no complete matched-age sequence | Accepted cap/skirt split sampled; Shared late body sampled with reduced collar | Handoff/reset passed |
| 20 kt / 1.3 | Accepted late cap/skirt sampled; Shared post-handoff screenshot saved | Accepted layers and Shared merged body sampled | Handoff/reset passed |

The saved Shared screenshot is under the checkpoint's `observations/` directory.
It shows 20 kt, rise 1.3, x1 after accelerated evolution, around three world
minutes. This cannot demonstrate local rolling direction or handoff acceleration.
No pixel-isolation pass, orbit sweep, video motion measurement, full eight-case
matched-age visual matrix or complete test-suite run is claimed.

### Ranked follow-through

1. **Delivered physics experiment:** compare Accepted with Shared, leaving Accepted
   as default. The distinct skirt weakens with pure gas advection in inspected
   Shared views. Keep this explicit tradeoff instead of hiding it with opacity,
   lighting or envelope patches. Use the existing selector and original sliders.
2. **Safest next implementation:** retain a bounded skirt shape constraint in a
   shared moving fluid frame, with constraints distinguished from advection.
   Resolve the desired silhouette first; do not restore the rejected downward-roll
   signs, toroidal warp or radius/height attachment experiments wholesale.
3. **Confirmed mapping mismatch:** unify head/column classification for density,
   fade and noise against the actual head envelope, checking the junction before
   changing any frequencies. This intentionally remains outside the current trial.
4. **Confirmed light-transport approximation:** share the same density lookup
   between visible and shadow samples, subject to the existing sample budget.
   Matching nominal frequency alone is already covered and should not be repeated.
5. **Continuity/perception measurements:** capture height/radius and their
   derivatives around actual handoff at both rises, then assess local evolution
   separately from camera following and bulk ascent. Couple procedural roll to
   solved circulation only after that distinction is visually established.

Intentional differences preserved: independent ground dust, parcel variation,
fire/cooling presentation, local puff rotation, reduced optical-depth dilution,
weather wall clock and late atmosphere/visibility presets. None is evidence of a
stopped fluid solver by itself.

# Fiery-phase study · 22 November 2026

Exact pre-study source is saved in `baselines/demo-blast/2026-11-22-pre-fiery-study.zip` (471 hash-verified files, including skirt roll 1.2). The earlier coherent archive remains untouched. Assets and unsaved browser overrides are excluded.

This study changes only fire-look.js, fireball.js, cloud.js and puff-blend.js plus this note. Render-only heat extends the luminous body, with stronger retention at the lower head/mantle and rim. Gas and puff fade share the heat function; all extra heat and illumination end at reference second 22 (about 41 s at 1 kt / 74 s at 20 kt). Solved heat, buoyancy, density and mature rolling remain unchanged. Early gas distortion increases modestly and returns to the previous mapping by reference second 12. This is an authored incandescence treatment, not additional physical combustion.

To revert this study exactly, copy these four JS files and README.md from the pre-study source/bench/demo-blast directory; no new runtime files were added.

# Blast demo

## Source checkpoint · 22 November 2026

The accepted coherent version before the following skirt adjustment is saved in
`baselines/demo-blast/2026-11-22-coherent.zip` at the project root, with its source
tree, dependency lock/configuration, 11:02 reference screenshot and SHA-256
manifest. All 471 included source files were verified against the archive.
Existing assets/node_modules and unsaved browser slider overrides are not copied.
The sibling checkpoint directory contains the readable manifest and source.

After the checkpoint, skirt-puff roll gain increased from 1 to 1.2. Its current
direction, downward visual drift, geometry, material treatment and late slowdown
are unchanged; the head remains at -1.6 and ground puffs at 1.

## Accepted visual baseline · 21 November 2026

User accepted the effect before the following fine adjustments. Reference:
`C:/Users/bebx/Pictures/Screenshots/Capture d'écran 2026-11-21 174415.png`.
Screenshot shows High, 1 kt, Overview, Playback ×1: broad smooth cloud ball,
defined lower skirt, thin straight column and dense ground dust. Preserve the
opening white-yellow flash, slowed ground ring, continuing fluid evolution and
settling cap. Screenshot does not establish the simulation age or measured FPS.

Current fine adjustments: a small centreline bend below 55% of head height,
shared by gas and particle sampling, without changing cross-section width;
lower-skirt upward following reduced to 65% so it trails under the cap. Ball
appearance is unchanged pending a separate visual decision. Its dense gas and
overlapping head parcels can conceal billow contrast compared with the skirt;
the gas head also uses a coarser noise scale than the lower region.

## Running the demo

Latest ground restoration: residual clouds again use original 18–26-unit inner
and 38–46-unit outer envelopes, growing by 1.2 / 1.6. The ring keeps its own small
birth puffs, builds opacity and thickness to reference second 8, holds its visible
horizontal footprint/size from second 12, then settles over the existing 24–55
interval. Ground-detail frequency and stronger optical depth remain configured.

Lighting coherence: gas and volumetric puffs use the same ambient/direct-light,
shadow attenuation and scattering response. Scattering covers head, skirt,
column and ground volumes instead of stopping partway through the skirt. Default
self-shadow is .55 and scattering .35; their separate density integrations remain
approximations, not a coupled multiple-scattering solver. Ground projection is
unchanged. Column noise scale .45 gives coarser billows, with additional procedural
lighting definition; no particle/sample budget or ball/skirt geometry was added.

Residual ground-cloud detail frequency is 1.25, between its original coarse
look and the recent 1.6 setting. The outer apron/ring remains at 1.6; ground
optical depth, envelope volume and settling remain unchanged.

Skirt density-noise drift now shares the head's downward visual direction while
its actual parcels continue rising. Skirt roll rate, placement, scale, feathering
and ground-puff drift are unchanged.

Ground fullness follow-up: residual ground envelopes are 35% wider with .8 growth,
and apron growth is restored to 4.5. Ground-only optical depth is 1.6× and internal
noise frequency is 1.6×, keeping finer detail inside the fuller envelope. Particle
counts, spread velocities, 26-unit height cap and settling/fade remain unchanged;
head/skirt materials retain their previous optical depth and noise frequency.

Billow scale alignment: column noise now uses the head's .7 scale and 1× octave,
enlarging its detail about 1.5× from .8/1.3 without widening the column. Residual
ground puffs reuse head/skirt width variation and .55 growth (roughly 18–26
reference-unit mature width); apron puffs mature at 18–27 rather than 22–33.
Positions, outward spread, counts and settling remain unchanged. The remaining
join gets a 12% midpoint-only noise-contrast lift, with endpoints and displacement
amplitude unchanged. Ball/skirt tiling and light scattering are preserved.

Join contrast follow-up: the head/base noise crossfade compensates for variance
lost when averaging independent moving fields. Only overlap values are normalized
and bounded to their original ranges; crown/skirt endpoints, coordinates, particle
settings, core density and motion are unchanged. This targets the smooth belt at
the join, with no new texture samples. Its visual strength still needs a playtest.

Centre detail follow-up: noise and lighting region selection follows the head's
lower radius instead of fixed fractions of altitude. This keeps the established
coarse crown pattern across the lower-middle ball as it rises/widens; density,
fade masks, core opacity and motion retain their existing definitions. The upper
world-facing overlap of skirt puffs now receives the same scattering phase as
the head, while their lower half retains its previous lighting and all skirt
texture coordinates stay unchanged. Orbit/late-time colour matching still needs
visual verification; these changes do not claim per-pixel volume/puff sorting.

Camera-dependent join follow-up: skirt-top feathering now weights each 3D puff
density sample by world-up before texture rolling, replacing the screen-UV alpha
mask. The physical lower half and all positions/scales are unchanged. **Weather
air pass** compares the existing weather composite with a direct HDR scene render
without altering weather settings. Both paths have a depth-enabled output target.
Weather fog otherwise reads opaque background depth beneath transparent clouds;
compare terrain/sky backgrounds during ignition before changing the air pipeline.

Early join follow-up: the early head noise coordinate offset now uses only its
time envelope; height remains a blend of sampled values/displacement amplitude,
not of coordinate offsets. This removes the remaining ignition-only compression.
Puff scattering uses a world eye-to-puff ray updated before drawing, rather than
the camera forward axis. Turning in place no longer changes its phase spuriously;
orbiting still changes the physically relevant angle. Gas scattering is unchanged.
Visual verification across camera elevation/azimuth and ignition remains required.

Join texture mapping: head/base frequency and opposite drift are now sampled
independently and the resulting noise values blended over the existing height
zone. Coordinates themselves are no longer blended, avoiding the stretched
horizontal band. The transition zone needs extra noise reads; orbit and FPS
still need a playtest, since object-sorted puffs retain their known limitations.

**Skirt chunks** toggles the bounded debris experiment: four `createChips`
authored fragments, emitted from current outer-skirt puff lower edges before
reference second 28. Configured effective gravity .16 represents near-balanced
updraft, with a small initial downward speed and an 18-reference-second lifetime.
This is a net-acceleration VFX approximation, not coupled aerodynamic forces.
Existing smoke prefabs follow public one-slot BatchedMesh matrices and share one
64-puff pool. Chip geometry/material and smoke assets use existing tool recipes;
no physics bodies or shared-tool changes were added. Reset clears all fragments
and smoke, and disposal releases the owned geometry/material and pools.

Crater formation uses 28 shallow, concentric `field.crater` stages over reference
seconds .12–1.52, synchronizing height samples and reshaping the collider once
per affected host update. Their depth increments sum to the configured depth
(the terrain's existing depth limit still applies). Radius reaches the current
3× width progressively. Only the last stage emits the existing capped crater
debris burst; the explosion's ground puffs still supply the early dirt blast.
Reset clears both the field deformation and formation progress. The final bowl
is formed by overlapping excavations rather than replaying/resetting full stamps.

Head gas/puff density noise drifts visually downward in the rising cloud frame.
Puff positions, ascent and physics are unchanged; skirt/ground drift retains its
previous direction. This supplies apparent drag without making puffs fall.

Crater radius is now 54 × cube-root(yield) metres (3× the previous width), with
the same 4.6 × cube-root(yield) depth. The terrain stamp, collider reshape and
existing ejecta placement reuse this configuration; debris budgets are unchanged.

**Ball core density** (1–4, default 2.5) boosts smoke optical depth inside the
head, strongest within .12 head radii and absent by .8 radii, using a broad
quintic falloff with zero slope/curvature at its ends. The upper
head mask excludes the column. It multiplies the existing noisy density rather
than adding an opaque shape or changing the alpha falloff at the outer edge.
Gas self-shadow and ground projection share it; scattering, puff detail, motion
and fade timing remain unchanged. Set 1 to restore the prior core density.

Opacity adjustment: gas **Density** defaults to 3.8 within the existing .5–4
control range. Head/skirt puff optical depth is doubled inside their existing
volume chord integration, retaining the same soft edge and fade masks. Ground
puff opacity/settling and scattering phase are unchanged. No opaque alpha clamp,
geometry change or additional shader sample is introduced.

Early head turbulence: existing gas density displacement rises from 8 to 20
reference units in the head, with a multi-axis animated noise offset. It eases
back to the established look over reference seconds 3–12. Column/skirt settings,
ignition growth and the late cloud remain unchanged. This is visual density
distortion, not an additional fluid solve, and uses the existing texture samples.
The shared density lookup also adds broad outward lobes up to .45 of head
radius, restricted to the early upper head. They vanish over reference seconds
3–12 and are read by gas shading, self-shadow lookups and ground projection.
This breaks spherical growth without permanently changing the solved field.
Cloud light transport approximates absorption, emission, attenuated sunlight
and fireball illumination. **Fireball → Ball light scatter** (0–1, default .65)
adds a capped Henyey–Greenstein forward phase (g=.45) to sun lighting in the gas
head and head puffs. Zero restores prior lighting. Density, alpha, shape, motion
and ground shadows are unchanged. This is a single-scattering approximation,
not a multiple-scattering solve. Orbit toward the sun to inspect the difference.

7–12 second ball jitter adjustment: shell boundaries now use puff opacity as
weight, so almost transparent head parcels do not reposition gas like opaque
ones. All gas shells share a ray sampling lattice; shell intersections split
only a sample's integration length, never its lookup position. This prevents
partition movement from resampling the gas texture. Intersecting sprites still
use object-distance transparency ordering, not per-pixel sorting.

Shadow comparison: **Fireball → Cloud self shadow** (0–1, default 1) controls
three sunward density samples in the gas and three local density samples inside
each puff. Ambient fill remains. These add shader texture reads; FPS and visual
quality need a playtest. This does not cast the explosion onto terrain/buildings
or compute shadows between separate puffs. The existing mesh shadow caster skips
sprites; the gas render planes are view-dependent and cannot serve as casters.

Ground projection is now separate: **Ground cloud shadow** (0–1, default .7).
`ground-shadow.js` marches the live gas field toward the sun into a 128² texture
(256² on High), using 24 density samples. Terrain receives its transmittance
through the existing `addLightSlot` directional-light interface; ambient remains.
`volume-field.js` is the shared coordinate/density lookup for both gas and shadow,
including ignition, wind, late expansion and column/cloud fade. Ground height is
approximated by the blast plane; separate puffs and buildings do not cast through
this projection. The shadow can move off the finite terrain as the cloud rises.
Ball-puff spin is reversed again at the user's request, retaining the 1.6× gain;
skirt spin and the motion envelope remain unchanged.

Visual balance adjustment after the 17:55 screenshots: gas head noise uses
70% of the skirt-derived frequency and drops the 2.3× fine-detail multiplier,
producing broader billows rather than grain. Column noise retains its earlier
frequency. Mild head noise lighting contrast remains;
head parcel opacity is .72 instead of .85 to reduce overlap washing out detail.
Head puff birth scale is 1.25 of base width: 17.5 reference units, about 81% of
the unchanged 21.7-unit mature width. Ignition expansion remains unchanged.
The skirt redistribution was reverted; its four groups retain radius shares
.8–.92. Gas uses the same weighted cloud
palette as the parcels, replacing its separate pale head tint.
`puff-blend.js` feathers only the upper half of skirt puffs (up to 70% less
opacity at their top), preserving their lower edge, positions and dimensions.
Head and skirt puff rolling now follows the existing outward-over / rim-down
circulation, replacing the reversal trial. Roll speed starts at 2.5×, eases with
a 12-reference-second decay, and approaches .12× late in life. The integrated
phase never reverses as it slows. Head circulation and gas/puff noise drift share
that envelope; ground puff rolling and the fluid solver clock are unchanged.
Skirt lighting contrast is preserved. Gas-head noise lighting spans .55–1.35
instead of .8–1.12, increasing ball contrast through the existing head mask. Column
noise scale .8 and detail multiplier 1.3 replace 1 and 2.3, yielding roughly 2.2×
broader density detail without changing the column width or sample budget.
No sample or particle budget was added. Ground dust descends, flattens and fades
over the same reference seconds 24–55 as column shutdown; horizontal spread is
retained. This is a visual settling treatment, not terrain deposition physics.

Open `/bench/demo-blast/?quality=balanced&yield=1` or `&yield=20`.
The Quality selector retains the low / balanced / high budgets in `quality.js`.
Yield restarts the scene. Playback changes elapsed simulation time; 1 is normal.
Overview frames each yield; **Fixed observer · 1 km** uses the same metre-scale
viewpoint for comparing their apparent sizes. Houses remain 6–10 metres wide.

## Scale and model

`blast-scale.js` anchors the initial bubble's 13 reference-unit radius to the
contact surface-burst breakaway estimate in Glasstone & Dolan, 1977, §2.127.2:
145 W^0.4 feet. This gives breakaway radii of approximately 44 / 146 metres;
the book's rough maximum luminous-radius estimate is twice that (88 / 293 m).
These are reference dimensions, not measured boundaries of this noisy rendering.
Source: https://www.atomicarchive.com/resources/documents/effects/glasstone-dolan/chapter2.html

Space is multiplied by L and plume time by sqrt(L), preserving the authored
buoyant acceleration under similarity. The existing axisymmetric incompressible
solver still owns heat, fuel and smoke transport and its pressure projection.
The fine grid establishes the first 36 reference seconds, including the skirt.
`late-cloud.js` then carries the evolving local shape using a scalar entraining thermal:
volume grows with upward travel; entrained mass and quadratic drag brake the rise;
stable stratification removes buoyancy and permits a small, damped overshoot.
Horizontal wind comes from the shared environment in m/s, coupled at 15% for this visual preset. Lateral diffusion
continues after vertical stabilization. Gas density falls with the cloud's linear expansion (`DILUTION` in `late-cloud.js`), holding its optical depth;
heat decays separately so the cloud cannot keep burning throughout its lifetime.
Visible condensate uses a simple saturation/lifting-level approximation, with
45% starting relative humidity, dry/moist lapse rates and 12 micron droplets.
It supplies cloud-water extinction in addition to the conserved aerosol density.
This is not a coupled moisture/latent-heat microphysics solver. Saturation uses
Bolton (1980), equation 10: https://archive.eol.ucar.edu/projects/ceop/dm/documents/refdata_report/eqns.html

The approximate cloud-top targets are 3 km (1 kt) and 7 km (20 kt), reached on a
several-minute timescale. These are representative mid-latitude envelopes, not
digitized test data. Neutral stratification is calibrated to those targets rather
than inferred from a weather sounding. Retained heat and entrainment are model
parameters. Reference discussion: Glasstone & Dolan §§2.13–2.17 and Fig. 9.96.
The 30 / 60 minute visibility presets fade during the final 10 / 20 minutes;
they are explicit weather/art choices, not physical lifetimes fixed by yield.

The cap and attached skirt share an isotropic local expansion and translation.
Only the stem stretches to keep its ground connection. The fluid solver and
particle motion and rolling continue in that frame at normal reference speed.
Only parcel age is held after handoff: bulk opacity owns their eventual fade,
so billows do not expire while the cloud is still visible. The fluid clock and
particle positions are never held at handoff. Ground feed tapers over reference
seconds 10–24. The column fades over 24–55 independently of the cap's lifetime.
The local head is re-anchored to the bulk ascent each update, preventing a second
climb from the evolving grid. At 90% of the reference cloud top and vertical
speed below 1 m/s, the bulk centre settles at a fixed altitude; local fluid,
particle motion, lateral diffusion and fading continue.
The finite local grid still limits resolved detail; bulk ascent remains a reduced model.
This is a reduced VFX model, not a validated nuclear-effects or fallout simulation.
The initial radiative expansion and compressible shock are not resolved by the
plume grid. A separate energy-similarity propagation cue transitions smoothly to
sound speed and synchronizes screen distortion and scripted building swaps.
Ground dust lags and decelerates independently. Crater dimensions and building
failure/impulses remain visual approximations; Jolt simulates the debris motion.

## Transparency and startup

`main.js` sorts every transparent object by distance from the eye instead of
view depth, so turning the camera in place cannot reorder anything. `fireball.js`
splits the gas integration into eight shells of eye distance sharing one material
and the 24 / 40 / 64 total ray samples, divided by shell thickness. Shell edges
sit between equal groups of the cloud's visible puffs (even spacing when there are
too few), so the gas is cut finely where the puffs are. A puff still changes side
of one shell at a time, and intersecting puffs are not ordered per pixel.
Where the gas burns (`BURNING` in `fire-look.js`) the cloud's puffs fade out and
the gas volume draws alone, so no sprite changes side of the flame. Flame is as
opaque as smoke; **Density** scales the gas extinction. **Inner light** is the
ball's own light on the surrounding smoke and puffs, decaying with the burn; the
scene point light rides in the ball.
Bright flame/flash billboards have been removed: hot emission and smoke absorption
are integrated together in the gas slabs. The host exposure flash, point light,
and bloom remain. This prevents an additive flash layer shining through smoke.
The opening flash now uses a white-yellow scene-light pulse, peaking at 66×
light intensity and 8× post exposure with extra bloom. It returns smoothly to
the user's lighting and post settings within 1.5 seconds of playback.

Startup uses Jolt's documented `jolt-physics/wasm` entry and separate `.wasm` URL,
with initialization overlapped with weather and particle setup. Terrain retains
257² samples for both yields, so spatial extent does not increase the grid budget.

## Playtest

Ignition expands gas and detail parcels together from 4% to the established start
shape over 1.4 reference seconds. The fluid clock runs at .8 reference speed.
The upper parcel layer then blends in over
reference seconds 3–12 while the gas continuously retains smoke underneath its
cooling emission. Gas density defaults to 2.8. Head billows and column detail use
the skirt's 14-unit reference (head variation ±18%, skirt rim growth .55).
These visual controls are in `fire-look.js`; the user's distance-shell sorting
is preserved.
The seeded column radial variance is 64 (previously 255), halving its width.
Ground perimeter puffs start at 4–6 units, with at least 36 around the ring at
every quality. Eased growth fills gaps early; drag .18 limits the initial push
to roughly 10–13 reference units/second. The short dust front uses 30% of the
authored cue speed with drag .4; shock and building timing are unchanged.
the upper collar also starts small and is advected outward with rolling enabled.
Balanced uses 32 gas samples, .75 pixel ratio, 65% puff count and 28 pressure passes;
sun shafts are disabled there. High retains its existing rendering budget.

Head friction damps motion locally in the grid. Tagged head parcels follow a
spherical centre-up / top-outward / outer-down circulation while the bulk thermal
supplies overall ascent. The smooth
skirt mantle retains its separate guidance. Growth uses an exponential ease-out
(strength 4.5); head-radius measurements catch up over 4.5 reference seconds.

Play either yield, orbit around the cloud, zoom through it, and switch Views.
Check for whole-cloud popping as the puffs cross the volume's sort depth.
Check the fixed observer view between yields, then Reset and Play again.
Use Playback × (up to 60) to reach the skirt, column taper and final fade sooner.
Frame rising cloud follows the late ascent and backs out to retain the full
column; manual orbit/zoom disables it. Camera range supports the kilometre-scale
cloud. Watch the reported cloud top at 5 / 10 / 15 minutes, then the final fade
at 30 / 60 minutes. Reset must return to the early plume without stale transforms.

Skirt follow-up: existing volumetric skirt puffs now carry grain-modulated incandescence with the same early heat lifetime and stronger outer-rim weighting. Their opacity remains present during emission, preventing the gas-only heat treatment from hiding the emitting skirt. Emission is exactly zero after reference second 22.

## Delayed stem / lighting coherence study

Checkpoint: baselines/demo-blast/2026-11-22-fiery-accepted.zip (471 hash-verified source files). Earlier coherent and pre-fiery checkpoints remain untouched.

Presentation-only column reveal grows upward over reference seconds 1.5–10; a soft cap/stem gap closes over 8–12. The shared field lookup applies this to both gas and ground shadow. Head detail respects the same cap boundary; skirt parcels render initially near the feeding tip, then spread back into their original locations by second 12. Restored before every simulation step; no solver, emission count, mature geometry, rolling, or terrain changes. This depicts feeding flow rather than adding coupled mass transfer.

Gas now receives the same environment light tint as lit puffs. Shared scattering blends facet-dependent direct lighting toward the common gas base, keeping scattered light from amplifying skirt/head facet differences. Corrected late sorting to retain puff optical-depth boost instead of dropping it at handoff. Gas-wide vs local-puff shadow depth remains approximate.

Changed runtime files: fire-look.js, volume-field.js, cloud.js, light-scatter.js, fireball.js. Restore these from the fiery-accepted checkpoint to revert this study.

Late-distance root cause: SpriteMaterial receives scene FogExp2, custom gas shader previously did not. Gas now applies the same scene fog colour/density per ray sample at actual world distance, rather than fogging its near-camera proxy quad. This keeps atmosphere treatment consistent without changing density/geometry or shared weather code.

## Column upflow follow-up

During reference seconds 1.5–24, the lower gas samples now translate upward with the forming stem, and both column noise octaves use that same source-height lookup. Translation keeps the lower-stem billow scale instead of stretching/compressing tiling. Transported smoke is capped by the original radial density envelope to keep a broad head sample from widening the column. All new lookup offsets are exactly zero at second 24; cap samples above the join remain unchanged throughout. Solver, skirt paths, scattering, mature geometry and particle budgets are unchanged.

Incremental rollback: baselines/demo-blast/2026-11-22-before-column-upflow contains the previous fire-look.js, volume-field.js, fireball.js and README.md with SHA-256 manifest. Restore those four files to bench/demo-blast and remove tests/demo-blast/column-formation.test.js to undo only this follow-up. Full baselines remain untouched.

## Animation clock audit

The host scales wall dt by Playback × once, then converts cloud dt to reference seconds using sqrt(length). Gas solver advances at its established .8 rate; head tracking, parcel advection, forming-column lookup, ground settlement and shader motion use reference time. Bulk rise converts back to world seconds. Chunk trajectories use world dt with velocities L/T and gravity L/T²; their emission spacing/lifetime uses reference scaling. Camera following and weather evolve on wall time intentionally.

Fixed a mismatch: puff roll used each parcel age and restarted the ignition speed for late-born skirts. Demo hook now receives explosion age and birth age; phase is global integrated phase minus birth phase. Angular rates therefore share the global envelope without jumping at birth. Authored gains remain head -1.6, skirt 1.2; skirt vertical following remains .65. These are intentional relative motions, not equal velocities.

Reference milestones (1 kt / 20 kt world seconds): connection 22.13 / 40.28; upflow lookup returns to mature mapping 44.25 / 80.56; bulk handoff 66.38 / 120.84; ground settling ends 101.41 / 184.62. A 24-reference-second solver check at 60 vs 30 updates/sec differed by .024 reference metres in tracked height and .003 in radius, with fluid clocks within one .025 solver step. This checks integration consistency, not visual parity at every playback speed.

Rollback of this follow-up also restores cloud.js, puff-blend.js and tests/demo-blast/puff-blend.test.js from the incremental checkpoint; manifest records destination paths. Remove the added column-formation.test.js.

## Feeding turn and bulk-rise handoff

Incremental checkpoint: baselines/demo-blast/2026-11-22-before-feed-handoff (9 hash-verified files with original destination paths). Earlier full baselines remain untouched.

Column source-height travel is 1.5× stronger during formation. The column noise lookup also transports detail outward near the cap base with a localized decreasing radial inverse scale. Density retains its authored radial envelope; the cap/body lookup remains on its original path. Added offsets are zero at reference second 24, preserving the mature mapping. This is visual transport rather than a new coupled mass-transfer solve.

Found the speed discontinuity at the Buoyant cloud rising label: createLateCloud initialized velocity to 8 sqrt(L) instead of the measured local ascent. The host now passes flow.riseSpeed in reference metres/second, converted by L/T, and bulk forces ease in over six reference seconds. Target cloud altitude, density, visibility presets and late mapping remain unchanged. Shape and expansion may follow a slightly different early handoff trajectory because the preset velocity jump has been removed.

No added late circulation force: solver traces continued after feed shutdown, and regression checks verify normalized gas redistribution (not merely uniform fading), parcel displacement and shader phase advance after column opacity reaches zero. This distinguishes a slowing local plume / independent bulk ascent from an actual stopped clock. Perceptual motion still needs playtesting.

Runtime changes: fire-look.js, fireball.js, plume-flow.js, cloud.js, late-cloud.js. Tests updated: late-cloud.test.js and cloud-lifecycle.test.js. Documentation updated here. Restore the listed paths from the incremental checkpoint to revert this iteration.

Rollback requested: removed the latest 1.5× column transport and radial outward-turn lookup. fire-look.js and fireball.js exactly match the before-feed-handoff checkpoint again. Previous accepted column treatment/junction is restored; measured rise-speed inheritance and smooth bulk-force handoff remain in plume-flow.js, cloud.js and late-cloud.js.

## Motion / tiling coherence pass

Rollback checkpoint: baselines/demo-blast/2026-11-22-before-motion-coherence (original paths and SHA-256 manifest, including updated test sources). Full accepted baselines remain untouched.

Billow frequency: cloud host measures the mean local head-puff diameter and supplies one common reference-space detail width. Gas displacement and surface detail now both use the same frequency; column matches it too. Head and skirt puff noise scales compensate for their envelope sizes, and for extra late puff-envelope growth. Gas no longer changes texture frequency independently with measured head radius. This changes texture treatment, not authored envelope positions/counts. Puff face grain now rotates with the volumetric density instead of sliding on a separate unrotated surface.

Late ascent keeps inherited initial speed and force takeover, with positive acceleration eased toward max(inherited speed, 2 L/T). Deceleration remains unrestricted, neutral height and visibility unchanged; ascent takes longer. This is authored VFX pacing, not a new physical calibration. Residual roll multiplier is .24 rather than .12, retaining gradual easing and shared birth-relative clock. Late host updates now use bounded 1/30 world-second substeps at accelerated playback, avoiding one large late re-anchoring update per frame. No removed radial column feeding experiment was restored.

Validation: handoff continuity and capped subsequent ascent checked for both yields; late cloud lifecycle proves gas redistribution, parcel movement and advancing shader phase. The same integration test compares gas/head/skirt world noise frequencies after expansion; it does not claim identical noise shapes or per-pixel transparency ordering. GPU appearance and ×10 motion require visual playtest.

## Skirt visible billows / upper overlap

Checkpoint: baselines/demo-blast/2026-11-22-before-skirt-visible-billows (3 hash-verified files; manifest maps saved files to original paths). Earlier baseline archives are untouched. Only puff-blend.js runtime changed.

Skirt shading now blends whole-sphere face lighting toward the same billow-grain definition curve as the gas cap, inside the existing soft perimeter. It reuses the shared world-frequency grain; no new noise samples or puff budgets. This targets the perceived size of shaded lobes without resizing the authored envelopes. The world-up upper feather is modulated by existing coarse noise so irregular fingers survive into the overlap rather than a uniformly smooth band. Lower-half density and all sprite positions/scales/growth/roll are unchanged; upper-overlap optical density changes locally. No column or rise edits.

Puff-hook and late lifecycle checks pass, including shared gas/head/skirt world-frequency after expansion. Perceived lobe-size matching and the junction still require visual judgement. Restore the three manifest paths to undo this iteration.

## Downward roll, smaller skirt interiors, high-rise attachment

Checkpoints: baselines/demo-blast/2026-11-22-before-downward-roll and 2026-11-22-before-high-rise-attachment. Earlier full accepted baselines remain untouched.

Head puff lookup gain is now +1.6 (same downward visible convention as skirt +1.2); the previous negative sign made the visible texture roll upward around the outer flank. Shared roll rate is the sum of two decaying exponentials (12 and 120 reference seconds), so gas scroll, puff rolling and head parcel circulation share a finite settling phase instead of a permanent nonzero floor. Skirt interior density is split into two seed-oriented rolling lobes, gated out at the original outer shell. This targets the large visible puff bodies; envelope sizes and positions are not resized. The experimental toroidal gas-noise warp was removed before high-rise verification.

High-buoyancy separation: legacy skirt altitude was head.height × skirtHeightShare and vertical following was globally capped then friction-damped. It could fall far below a narrow rapidly rising cap. New skirtHeight preserves the old layout while head.height <= 2.5 × radius; above that it limits the collar drop relative to radius. Emission and guidance use the same target. Guidance inherits the derivative of that moving target (head rise, radius change and radial motion) and damps only relative settling. Head parcel translation uses exact displacement of the already-filtered head rather than another delayed velocity filter. This aligns rising frames; the axisymmetric gas and detail guidance remain a reduced VFX composition, not one fully coupled 3D fluid.

Runtime changes in these two steps: puff-blend.js, plume-motion.js, plume-flow.js, cloud.js. Fireball.js exactly restored to the before-downward-roll version. Tests: settling phase, downward material sign, normal/high-rise collar attachment and derivative inheritance, late lifecycle. Added tests/demo-blast/skirt-attachment.test.js. No rise-force control changes or reintroduction of the rejected column flare.

Normal-buoyancy reveal follow-up: skirt heatFade now stays at 1 because the skirt renders its own incandescence and already has an authored .8-reference-second fade-in. It no longer waits for the head-only 3–12-second detail/cooling reveal. Density, emission threshold, birth/mature sizes and trajectories are unchanged by this follow-up. Added an early-formation visibility assertion to the lifecycle test. Checkpoint: baselines/demo-blast/2026-11-22-before-skirt-reveal; manifest records rollback paths.

Skirt reveal measurement (High, standard .65 rise): solver first reaches the emission threshold at 5.8 reference seconds (~19.5 world seconds at 20 kt). Visibility can lag emission because newborn parcels were only .32 × nominal width at .22 × head radius, inside opaque hot gas. Skirt birth scale is now .75, initial radius .65 × head radius, with the same mature width/target radius/count. Guidance uses each burst’s authored radiusShare for both emission height and moving target, avoiding an unintended upward pull into the cap while spreading from a smaller birth radius. This changes early presentation; the current live view still has strong fire/bloom obscuring parts of the lower cap, so the exact perceived reveal time is not established. Checkpoint before this birth change: baselines/demo-blast/2026-11-22-before-skirt-birth.

Top/centre motion diagnosis: visible top is dominated by tagged head parcels with analytic circulation + local texture rotation; the centre is primarily advected axisymmetric gas. Buoyant rise enters the solver force quadratically; authored head circulation/roll and skirt radial-follow coefficient do not scale with it. Shared translation and common detail frequency do not make these one physical flow. Gas head/base lookups also scroll in opposite vertical directions, with height-based classification able to put lower cloud regions on the column path. These remaining ownership/timing differences are diagnosed, not eliminated by material matching. No further physics rewrite was made during this diagnosis.
