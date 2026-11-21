import {WORLD_COST} from '../kit/world-settings.js';

export const QUALITY = {
 low: {scale: .75, shadow: 512, shadowInterval: 100, grassDensity: .48, grassShadows: false, caustics: false, heightFog: false,
  terrainRings: true, woodland: {lodDistance: 11, impostorDistance: 24, shadows: false},
  sky: {captureInterval: WORLD_COST.skyCapture, lightingInterval: WORLD_COST.skyLighting}},
 balanced: {scale: 1, shadow: 1024, shadowInterval: 0, grassDensity: 1, grassShadows: true, caustics: true, heightFog: true},
 high: {scale: 1.5, shadow: 2048, shadowInterval: 0, grassDensity: 1, grassShadows: true, caustics: true, heightFog: true},
};

export function createQualityDefaults({plants, pond, weather}) {
 const grass = plants.settings, water = pond.settings, trees = plants.treeSettings;
 const shadowDistance = grass.shadowDistance, caustics = water.caustics;
 const {lodDistance, impostorDistance, shadows} = trees;
 const woodland = {lodDistance, impostorDistance, shadows};
 const originalSky = weather.view.getConfig().sky;
 return (quality, previous) => {
  // The preset supplies starting values. Keep settings that have been tuned by hand.
  if (!previous || grass.density === previous.grassDensity) grass.density = quality.grassDensity;
  if (!previous || grass.shadowDistance === (previous.grassShadows ? shadowDistance : 0))
   grass.shadowDistance = quality.grassShadows ? shadowDistance : 0;
  if (!previous || water.caustics === (previous.caustics ? caustics : 0)) water.caustics = quality.caustics ? caustics : 0;
  for (const [key, fallback] of Object.entries(woodland)) {
   if (!previous || trees[key] === (previous.woodland?.[key] ?? fallback)) trees[key] = quality.woodland?.[key] ?? fallback;
  }
  const current = weather.view.getConfig(), sky = {}, appearance = {};
  for (const key of Object.keys(QUALITY.low.sky)) {
   const fallback = originalSky[key];
   if (!previous || current.sky[key] === (previous.sky?.[key] ?? fallback)) sky[key] = quality.sky?.[key] ?? fallback;
  }
  if (!previous || current.appearance.heightFog === previous.heightFog) appearance.heightFog = quality.heightFog;
  weather.view.configure({sky, appearance});
 };
}
