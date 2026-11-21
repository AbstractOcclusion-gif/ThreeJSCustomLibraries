import {Color, MathUtils} from 'three';
import {seededRandom} from '../../src/core/hash.js';
import {valueNoise} from '../../src/core/value-noise.js';
import {TERRAIN_LAYERS} from '../../src/terrain/index.js';
import {GRASS_PATCHES, SITE} from './layout.js';

const GRASS_LAYER = TERRAIN_LAYERS.indexOf('grass'), SNOW_LAYER = TERRAIN_LAYERS.indexOf('snow');
const PATCH = {attemptsPerClump: 12, edgeFrom: .68, edgeNoise: .16, noiseScale: .75, margin: .65, size: [.75, 1.65]};
const meadowNoise = valueNoise(SITE.seed);

export function createGrassPlacements(field, settings) {
 const random = seededRandom(SITE.seed), placements = [];
 const green = new Color(settings.color), straw = new Color(settings.soilColor), tint = new Color();
 const half = SITE.span / 2 - PATCH.margin;
 for (let attempt = 0; placements.length < settings.clumps && attempt < settings.clumps * PATCH.attemptsPerClump; attempt++) {
  const [cx, cz, rx, rz] = GRASS_PATCHES[attempt % GRASS_PATCHES.length];
  const angle = random() * Math.PI * 2, radius = Math.sqrt(random());
  const x = cx + rx * radius * Math.cos(angle), z = cz + rz * radius * Math.sin(angle);
  if (Math.max(Math.abs(x), Math.abs(z)) > half || Math.hypot(x, z) > settings.radius) continue;
  const y = field.heightAt(x, z);
  if (!(y > SITE.pond.level)) continue;
  const edge = radius + PATCH.edgeNoise * meadowNoise(x * PATCH.noiseScale, z * PATCH.noiseScale);
  const patch = 1 - MathUtils.smoothstep(edge, PATCH.edgeFrom, 1);
  const grass = field.layerWeightAt(x, z, GRASS_LAYER);
  const cover = patch * grass * (1 - field.sandWeightAt(x, z)) * (1 - field.layerWeightAt(x, z, SNOW_LAYER));
  if (random() > cover) continue;
  const variant = random();
  const scale = settings.size * MathUtils.lerp(1, MathUtils.lerp(...PATCH.size, variant), settings.sizeVariation);
  placements.push({x, y, z, scale, yaw: random() * Math.PI * 2, tint: tint.copy(green).lerp(straw, variant * settings.tintVariation).toArray()});
 }
 return placements;
}

export function nearGrassPatch({x, z}, reach) {
 return GRASS_PATCHES.some(([cx, cz, rx, rz]) => Math.hypot((x - cx) / (rx + reach), (z - cz) / (rz + reach)) <= 1);
}
