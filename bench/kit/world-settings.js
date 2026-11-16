// What the demos built on the terrain world share (World, Drive): one copy of how the ground is drawn, lit and
// weathered, so the two cannot drift apart. A page spreads these into its own settings and adds what is its own.

// The rings: half-metre cells in the nearest one, `cells` to a side.
export const WORLD_RINGS = Object.freeze({cells: 128, cellSize: .5});
export const RINGS_PER_FRAME = 1;   // rings refreshed a frame
// Relief samples the rings may spend per frame on their background bakes (far normals, sky map): a third of the
// library defaults, so a moving view does not pay for them every frame.
export const WORLD_BAKE = Object.freeze({normalSamples: 1600, skySamples: 1300});
// A corridor's cross-section and bends (m): wide, gentle sides and a floor a few metres above the water leave room for
// grass and woods on the way through. A page adds its length and its biome sections.
export const VALLEY_SHAPE = Object.freeze({width: 44, shoulder: 150, wall: 26, floor: 4, floorRelief: .4, bend: 34, bendScale: 170, endRamp: 90, sectionBlend: 90});
export const SHORE_WIDTH = .8;      // m of wet ground at the water's edge
// As the terrain tool: soft junctions and rock drawn large, for a landscape rather than a close-up.
export const WORLD_APPEARANCE = Object.freeze({edgeSharpness: .25, rockScale: .18, antiTiling: 0, layerDetail: 0});
export const PLAY_SNOW_FROM = .5;   // snow cover of the ground from which the play area lies under real snow
// The light, as the All tools demo: the kit's cascaded sun shadows, and thin air lit by the sun through them and
// through the weather's clouds. scanSeconds: how often new materials are looked for.
export const WORLD_LIGHT = Object.freeze({shadowDistance: 160, airDensity: .0012, sunInAir: 1.5, scanSeconds: 2});
// What a page costs: the sky is captured and its light refreshed at these intervals (s); one canvas pixel per screen
// pixel unless chosen otherwise (pixelRatios: the choices offered).
export const WORLD_COST = Object.freeze({skyCapture: 1.25, skyLighting: 8, pixelRatio: 1, pixelRatios: [.75, 1, 1.25, 1.5], fpsSmoothing: .1});
export const WORLD_WEATHER = Object.freeze({initial: 'cloudy 1', hour: 14, rain: {count: 360, radius: 32, height: 34, floorHeight: 0}});
