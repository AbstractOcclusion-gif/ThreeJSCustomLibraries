// What the page spends on its light, as two tiers of the lighting and camera tools' own options: `high` is every tool
// at its defaults, `low` is for a phone. A touch screen gets `low`; `?quality=high` or `?quality=low` in the address
// chooses by hand.
import {WORLD_COST} from '../kit/world-settings.js';

export const QUALITY = Object.freeze({
 high: Object.freeze({
  pixelRatio: null,      // the bench renderer's own
  sunShadows: Object.freeze({}),   // createSunShadows options: its defaults
  lampShadows: true,     // the rig's lamps cast
  air: true,             // volumetric light
  post: true,            // the camera tool's bloom and grading ...
  ao: true,              // ... and its ambient occlusion
 }),
 low: Object.freeze({
  pixelRatio: WORLD_COST.pixelRatio,   // one canvas pixel per screen point
  // Two small cascades that end at the far side of the hall (m), instead of four large ones out to 150 m.
  sunShadows: Object.freeze({cascades: 2, resolution: 512, distance: 40}),
  lampShadows: false,    // the lamps still light the hall
  air: false,
  post: false,
  ao: false,
 }),
});

// The tier asked for in the address, else by the screen: {name, ...its settings}.
export function pickQuality() {
 const asked = new URLSearchParams(location.search).get('quality');
 if (asked !== null && !(asked in QUALITY)) throw Error('Unknown quality: ' + asked + ' (' + Object.keys(QUALITY).join(', ') + ')');
 const name = asked ?? (matchMedia('(pointer: coarse)').matches ? 'low' : 'high');
 return {name, ...QUALITY[name]};
}
