// Reference dimensions: Glasstone & Dolan (1977), section 2.127.2, contact
// surface breakaway radius ~145 W^.4 feet; rough maximum ~twice that.
// https://www.atomicarchive.com/resources/documents/effects/glasstone-dolan/chapter2.html
// The later cloud uses a reduced buoyant plume, not a fallout model.
export const BLAST_YIELDS = Object.freeze({1: '1 kt · surface', 20: '20 kt · surface'});
export const DEFAULT_YIELD = 1;
export const BLAST_CRATER = Object.freeze({radius:54,depth:4.6});
export function resolveBlastYield(name) {
  return Object.hasOwn(BLAST_YIELDS, name) ? Number(name) : DEFAULT_YIELD;
}
export function createBlastScale(yieldKt = DEFAULT_YIELD) {
  if (!Object.hasOwn(BLAST_YIELDS, yieldKt)) throw new RangeError('Choose 1 or 20 kt');
  const breakawayRadius = 145 * .3048 * yieldKt ** .4;
  // Solver seed radius=13. x'=L*x, t'=sqrt(L)*t preserves buoyant acceleration.
  const length = breakawayRadius / 13, seconds = Math.sqrt(length);
  const range = Math.cbrt(yieldKt);
  // Strong-shock energy similarity R~(E*t²/rho)^1/5, joined continuously
  // to an acoustic front. A propagation cue, with no damage pressure model.
  const sound = 343, density = 1.225;
  const coefficient = (2 * .5 * 4.184e12 * yieldKt / density) ** .2;
  const joinTime = (.4 * coefficient / sound) ** (1 / .6);
  const joinRadius = coefficient * joinTime ** .4;
  const radiusAt = time => time <= 0 ? 0 : time < joinTime
    ? coefficient * time ** .4 : joinRadius + sound * (time - joinTime);
  return Object.freeze({
    yieldKt, length, seconds, breakawayRadius, fireballRadius: breakawayRadius * 2,
    terrainSpan: 480 * length,
    // Approximate mid-latitude surface-burst envelopes (G&D §§2.15–2.17).
    // Visibility is an explicit weather/art preset; it is not fixed by yield.
    cloud: Object.freeze(yieldKt === 1
      ? {top:3000,fadeStart:1200,visibleSeconds:1800,columnFadeSeconds:90,relativeHumidity:.45}
      : {top:7000,fadeStart:2400,visibleSeconds:3600,columnFadeSeconds:180,relativeHumidity:.45}),
    crater: Object.freeze({radius: BLAST_CRATER.radius * range, depth: BLAST_CRATER.depth * range}),
    shock: Object.freeze({radiusAt}),
  });
}
