import {fbm, valueNoise} from '../core/value-noise.js';

export const VALLEY_DEFAULTS = Object.freeze({seed: 17, relief: 26, valleyWidth: 35, woodland: .52});
const SHAPE = Object.freeze({
  bend: 21, bendScale: 105, shoulderWidth: 72, broadScale: 84, detailScale: 24,
  floorRelief: 2.4, saddleWidth: 31, saddleDepth: .65,
  rockFrom: .42, rockFull: .86, uplandFrom: .56, uplandFull: .94,
  woodlandScale: 55, woodlandBlend: .26,
});
const NOISE = Object.freeze({bend: 11, relief: 31, detail: 47, woodland: 73});
const smooth = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export function createValley(options = {}) {
  const settings = {...VALLEY_DEFAULTS, ...options};
  const {seed, relief, valleyWidth, woodland} = settings;
  if (!Number.isSafeInteger(seed) || !Number.isFinite(relief) || relief <= 0
      || !Number.isFinite(valleyWidth) || valleyWidth <= 0 || !(woodland >= 0 && woodland <= 1)) {
    throw new RangeError('Invalid valley settings');
  }
  const bend = valueNoise(seed + NOISE.bend);
  const broad = valueNoise(seed + NOISE.relief);
  const detail = valueNoise(seed + NOISE.detail);
  const climate = valueNoise(seed + NOISE.woodland);
  const routeX = z => SHAPE.bend * bend(0, z / SHAPE.bendScale);

  function heightAt(x, z) {
    const cross = x - routeX(z);
    const shoulder = smooth(valleyWidth / 2, valleyWidth / 2 + SHAPE.shoulderWidth, Math.abs(cross));
    const saddle = cross > 0 ? 1 - SHAPE.saddleDepth * (1 - smooth(0, SHAPE.saddleWidth, Math.abs(z))) : 1;
    const ridge = .85 + fbm(broad, x / SHAPE.broadScale, z / SHAPE.broadScale);
    const texture = fbm(detail, x / SHAPE.detailScale, z / SHAPE.detailScale);
    return shoulder * saddle * relief * ridge + texture * (SHAPE.floorRelief + shoulder * relief * .18);
  }

  function biomeAt(x, z, height, slope) {
    const rock = Math.max(smooth(SHAPE.rockFrom, SHAPE.rockFull, slope),
      smooth(SHAPE.uplandFrom, SHAPE.uplandFull, height / relief));
    const moisture = climate(x / SHAPE.woodlandScale, z / SHAPE.woodlandScale) * .5 + .5;
    const threshold = 1 - woodland;
    const forest = (1 - rock) * smooth(threshold - SHAPE.woodlandBlend, threshold + SHAPE.woodlandBlend, moisture) * woodland;
    return {grassland: 1 - rock - forest, woodland: forest, upland: rock};
  }

  return {heightAt, routeX, biomeAt};
}
