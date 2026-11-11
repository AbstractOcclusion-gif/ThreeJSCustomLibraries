import {DataUtils, HalfFloatType, MathUtils} from 'three';
import {createDataTexture} from '../core/data-texture.js';
import {assertFrameTime} from '../core/validate.js';

const CHANNELS = 4;
const {smoothstep} = MathUtils;

// How runoff shows on the terrain. Shared uniforms: pass one look to every runoff that should match.
export function createRunoffLook() {
  return {
    sourceArea: {value: 3.5},     // m2 of ground a spot must drain before a stream shows
    fullArea: {value: 30},        // m2 drained where the rivulets have joined into one stream
    rutSourceArea: {value: .4},   // m2 needed inside a track: ruts collect water early
    speed: {value: 1},            // scale on the flow speed derived from the slope
    rippleSize: {value: .11},     // m, size of the ripples carried by the flow
    rippleStrength: {value: 1},   // scale on the ripple relief
  };
}

// Surface runoff for a terrain field: bakes the drainage routing into one texture read by the terrain material
// (createTerrainMaterial's runoffFlow option), which draws the film and carries its ripples downhill.
// Texture, one texel per height sample: rg = downhill direction x slope (rise / run) along world X and Z,
// b = drained area (m2), a = the part of that area held back by hollows until they overflow.
export function createTerrainRunoff({field, drainage, look = createRunoffLook()}) {
  const {width, height} = field.heightMap.image;
  const texels = new Uint16Array(width * height * CHANNELS);
  const texture = createDataTexture(texels, width, height, {type: HalfFloatType, filter: 'linear', upload: false});
  const coverage = {value: 0};

  // A stream is one sample wide in the bake. A 3 x 3 binomial blur rounds its grid steps and gives it a bank.
  function softened(values, x, z) {
    let sum = 0, weights = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const column = x + dx, row = z + dz;
        if (column < 0 || row < 0 || column >= width || row >= height) continue;
        const weight = (2 - Math.abs(dx)) * (2 - Math.abs(dz));
        sum += values[row * width + column] * weight;
        weights += weight;
      }
    }
    return sum / weights;
  }

  // Call after the drainage is rebuilt, whenever the ground or the snow on it changes shape.
  function rebuild() {
    const {area, held, grade} = drainage.bakeFlow();
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const index = z * width + x, texel = index * CHANNELS;
        texels[texel] = DataUtils.toHalfFloat(grade[index * 2]);
        texels[texel + 1] = DataUtils.toHalfFloat(grade[index * 2 + 1]);
        texels[texel + 2] = DataUtils.toHalfFloat(softened(area, x, z));
        texels[texel + 3] = DataUtils.toHalfFloat(softened(held, x, z));
      }
    }
    texture.needsUpdate = true;
  }

  rebuild();
  return {
    texture, look, coverage, rebuild,
    // amount (0..1) scales the runoff; wetness (0..1) is how soaked the ground is: streams swell as it soaks and
    // shrink as it dries. The flow itself is animated by the material's surface weather time.
    update(dt, {amount, wetness}) {
      assertFrameTime(dt, 'Terrain runoff');
      if (![amount, wetness].every(Number.isFinite)) throw Error('Terrain runoff needs a finite amount and wetness');
      coverage.value = amount * smoothstep(wetness, 0, 1);
    },
    dispose() { texture.dispose(); },
  };
}
