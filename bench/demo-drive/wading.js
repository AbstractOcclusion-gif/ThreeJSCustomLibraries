// What water does in the drive demo. The rules: the drag on the car, its engine drowning, the walker slowing down.
// The contacts: ripples and splashes where wheels and feet meet the surface. No rendering here; the page passes the
// ripple field and a splash function in.
export const WADING = Object.freeze({
 draft: 1.2,                // m of water over the wheel bottoms at which the car takes the full drag
 drag: 2600,                // N per (m/s)^2 at full draft: full throttle then holds about 2 m/s
 flood: [1, 1.5],           // m over the wheel bottoms where the engine starts to drown, and where it has died
 walkerSlow: [.2, 1.1, .6], // m of water at the feet where wading starts and where it is slowest; share of speed lost there
 surfaceReach: 1.6,         // m: deeper than this, a wheel or a foot no longer disturbs the surface
 interval: .12,             // s between ripples from one wheel or foot
 minSpeed: .3,              // m/s below which standing in water makes no ripples
 rippleSpeed: 8,            // m/s at which ripples are full strength
 minRipple: .15,            // weakest ripple a moving wheel or foot makes
 entrySpeed: 2,             // m/s: entering the water faster than this throws a splash
 splashSpeed: 12,           // m/s at which a splash is full strength
 minSplash: .2,             // weakest splash thrown
 splashRadius: [.25, .9],   // m, from a foot to a car wheel
 spraySpeed: 4,             // m/s above which a wheel keeps throwing spray
 sprayInterval: .25,        // s between those
 sprayShare: .6,            // their strength next to an entry splash
});
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smoothstep = (value, from, to) => { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };

// submersion: m of water over the car's wheel bottoms. drag: N per (m/s)^2, to push against the velocity. throttle:
// share of the driver's throttle the engine still answers.
export function carInWater(submersion) {
 const share = clamp(submersion / WADING.draft, 0, 1);
 return {drag: WADING.drag * share * share, throttle: 1 - smoothstep(submersion, ...WADING.flood)};
}
// Share of the walker's speed left with `depth` m of water at the feet.
export function walkerInWater(depth) {
 const [from, to, lost] = WADING.walkerSlow;
 return 1 - lost * smoothstep(depth, from, to);
}

// ripples: the water module's ripple field. splash(x, z, strength, radius): throws a splash at the surface.
export function createWaterContacts({ripples, splash}) {
 const waders = new Map();
 return {
  // Call every frame for each wheel or foot. depth: m of water over its lowest point (0 or less = dry). speed: m/s.
  // size: 0 (a foot) .. 1 (a car wheel).
  touch(dt, key, {x, z, depth, speed, size = 0}) {
   let wader = waders.get(key);
   if (!wader) waders.set(key, wader = {wet: false, wait: 0, spray: 0});
   if (!(depth > 0) || depth > WADING.surfaceReach) { wader.wet = false; return; }
   const radius = WADING.splashRadius[0] + (WADING.splashRadius[1] - WADING.splashRadius[0]) * size;
   const force = clamp(speed / WADING.splashSpeed, WADING.minSplash, 1);
   if (!wader.wet) {
    wader.wet = true;
    wader.wait = 0;
    if (speed > WADING.entrySpeed) splash(x, z, force, radius);
   }
   wader.wait -= dt;
   wader.spray -= dt;
   if (speed < WADING.minSpeed) return;
   if (wader.wait <= 0) {
    wader.wait = WADING.interval;
    ripples.splash(x, z, clamp(speed / WADING.rippleSpeed, WADING.minRipple, 1));
   }
   if (size > 0 && speed > WADING.spraySpeed && wader.spray <= 0) {
    wader.spray = WADING.sprayInterval;
    splash(x, z, force * WADING.sprayShare, radius);
   }
  },
  reset() { waders.clear(); },
 };
}
