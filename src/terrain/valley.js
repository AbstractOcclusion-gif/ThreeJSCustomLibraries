import {fbm, valueNoise} from '../core/value-noise.js';

export const VALLEY_DEFAULTS = Object.freeze({seed: 17, relief: 26, valleyWidth: 35, woodland: .52});
const SHAPE = Object.freeze({
  bend: 21, bendScale: 105, shoulderWidth: 72, broadScale: 84, detailScale: 24,
  floorRelief: 2.4, saddleWidth: 31, saddleDepth: .65,
  rockFrom: .42, rockFull: .86, uplandFrom: .56, uplandFull: .94,
  woodlandScale: 55, woodlandBlend: .26,
});
const NOISE = Object.freeze({bend: 11, relief: 31, detail: 47, woodland: 73, regions: 97});
const smooth = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export const TERRAIN_LANDFORMS = Object.freeze(['Plains', 'Hills', 'Valley', 'Island', 'Cliffs', 'Mountains', 'Desert', 'Ice', 'Regions']);
const LANDSCAPE = Object.freeze({
  plainsRelief: .12, hillsRelief: .48, cliffRelief: 1.4, cliffStart: -.09, cliffEnd: .39,
  mountainRelief: 2.4, mountainFloor: .15, regionScale: 170, regionStart: -.32, regionEnd: .32,
  desertHeight: .18, iceHeight: .64,
  islandInner: 46, islandOuter: 112, islandShoreHeight: .38,
});

export function createProceduralTerrain({landform = 'Valley', ...options} = {}) {
  if (!TERRAIN_LANDFORMS.includes(landform)) throw new RangeError('Invalid terrain landform');
  return createLandscape(options, landform);
}

export function createValley(options = {}) {
  return createLandscape(options, 'Valley');
}

function createLandscape(options, landform) {
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
  const regions = valueNoise(seed + NOISE.regions);
  const regionMix = (x, z) => smooth(LANDSCAPE.regionStart, LANDSCAPE.regionEnd, regions(x / LANDSCAPE.regionScale, z / LANDSCAPE.regionScale));
  const routeX = z => landform === 'Valley' ? SHAPE.bend * bend(0, z / SHAPE.bendScale) : 0;

  function heightAt(x, z) {
    const broadHeight = fbm(broad, x / SHAPE.broadScale, z / SHAPE.broadScale);
    const texture = fbm(detail, x / SHAPE.detailScale, z / SHAPE.detailScale);
    const detailHeight = texture * SHAPE.floorRelief;
    const plains = broadHeight * relief * LANDSCAPE.plainsRelief + detailHeight;
    const mountains = (LANDSCAPE.mountainFloor + Math.abs(broadHeight)) * relief * LANDSCAPE.mountainRelief + detailHeight;
    switch (landform) {
      case 'Desert':
      case 'Plains': return plains;
      case 'Ice':
      case 'Mountains': return mountains;
      case 'Regions': return plains + (mountains - plains) * regionMix(x, z);
      case 'Hills': return broadHeight * relief * LANDSCAPE.hillsRelief + detailHeight;
      case 'Cliffs': return relief * LANDSCAPE.cliffRelief * smooth(
        LANDSCAPE.cliffStart, LANDSCAPE.cliffEnd, broadHeight) + detailHeight;
      case 'Island': {
        const land = 1 - smooth(LANDSCAPE.islandInner, LANDSCAPE.islandOuter, Math.hypot(x, z));
        return relief * (land * (1 + broadHeight) - LANDSCAPE.islandShoreHeight) + land * detailHeight;
      }
    }
    const cross = x - routeX(z);
    const shoulder = smooth(valleyWidth / 2, valleyWidth / 2 + SHAPE.shoulderWidth, Math.abs(cross));
    const saddle = cross > 0 ? 1 - SHAPE.saddleDepth * (1 - smooth(0, SHAPE.saddleWidth, Math.abs(z))) : 1;
    const ridge = .85 + broadHeight;
    return shoulder * saddle * relief * ridge + texture * (SHAPE.floorRelief + shoulder * relief * .18);
  }

  function biomeAt(x, z, height, slope) {
    const rock = Math.max(smooth(SHAPE.rockFrom, SHAPE.rockFull, slope),
      smooth(SHAPE.uplandFrom, SHAPE.uplandFull, height / relief));
    const moisture = climate(x / SHAPE.woodlandScale, z / SHAPE.woodlandScale) * .5 + .5;
    const threshold = 1 - woodland;
    const forest = (1 - rock) * smooth(threshold - SHAPE.woodlandBlend, threshold + SHAPE.woodlandBlend, moisture) * woodland;
    if (landform === 'Desert' || landform === 'Ice') {
      return {grassland: 0, woodland: 0, upland: rock, desert: landform === 'Desert' ? 1 - rock : 0, ice: landform === 'Ice' ? 1 - rock : 0};
    }
    if (landform !== 'Regions') return {grassland: 1 - rock - forest, woodland: forest, upland: rock};
    const mountain = regionMix(x, z);
    const desert = (1 - mountain) * (1 - smooth(LANDSCAPE.desertHeight, LANDSCAPE.iceHeight, moisture));
    const ice = mountain * smooth(LANDSCAPE.desertHeight, LANDSCAPE.iceHeight, height / relief);
    const temperate = 1 - desert - ice;
    return {grassland: temperate * (1 - rock - forest), woodland: temperate * forest, upland: temperate * rock, desert, ice};
  }

  return {heightAt, routeX, biomeAt};
}

/** Return a tile-aligned square sampling window centered near a world position. */
export function terrainWindowOrigin({x, z}, {tileSize, tileCount, strideTiles = 1}) {
  if (!(Number.isFinite(tileSize) && tileSize > 0)
      || !Number.isSafeInteger(tileCount) || tileCount < 1
      || !Number.isSafeInteger(strideTiles) || strideTiles < 1 || strideTiles > tileCount) {
    throw new RangeError('Invalid terrain window settings');
  }
  const stride = tileSize * strideTiles;
  const half = tileSize * tileCount / 2;
  const snap = coordinate => Math.round(coordinate / stride) * stride - half;
  return [snap(x), snap(z)];
}
