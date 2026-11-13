// Sky visibility over a relief: the share of the sky's light that reaches a level patch of ground, 1 in the open and
// less at the bottom of a valley or the foot of a cliff. It is the large-scale ambient occlusion of a ground: it dims
// the ambient light only, never the sun. Small-scale contact shadow is left to screen-space AO (camera post).
// Shared by the terrain (sky maps of its rings) and the light probes (lighting module).
// Measured by scanning the horizon: along `directions` headings, the steepest rise of the ground seen from the point,
// at distances that double from `firstStep` up to `reach`.
export const SKY_VISIBILITY_DEFAULTS = Object.freeze({
  directions: 8,   // headings scanned around the point
  firstStep: 3,    // m, the nearest ground looked at: finer shapes are left to the normals and to screen-space AO
  reach: 200,      // m, the farthest
});
export const SKY_VISIBILITY_LIMITS = Object.freeze({directions: [4, 32], firstStep: [.25, 64], reach: [1, 4000]});
const FAR_STEPS = 4;   // a coarse map (spacing over `reach`) still looks this many times its spacing away
const BYTE = 255;

// heightAt(x, z, cell): the relief, band-limited to `cell` metres when it can (createTerrainWorld's heightAt).
// Returns {settings, at(x, z, spacing = 0, lift = 0) -> 0..1, samples(spacing)}: `spacing` is the distance between the
// points asked for (a map's texel), so nothing finer than the map can hold is measured; `lift`: metres above the ground
// of the point looked from; samples: relief samples one point costs.
export function createSkyVisibility(heightAt, overrides = {}) {
  if (typeof heightAt !== 'function') throw new TypeError('Sky visibility needs a heightAt function');
  const settings = {...SKY_VISIBILITY_DEFAULTS, ...overrides};
  for (const [name, [min, max]] of Object.entries(SKY_VISIBILITY_LIMITS)) {
    if (!Number.isFinite(settings[name]) || settings[name] < min || settings[name] > max) throw new RangeError(`Invalid sky visibility ${name}`);
  }
  if (!Number.isInteger(settings.directions)) throw new RangeError('Invalid sky visibility directions');
  const {directions, firstStep, reach} = settings;
  const headings = Array.from({length: directions}, (_, index) => {
    const angle = index / directions * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const first = spacing => Math.max(firstStep, spacing);
  const last = spacing => Math.max(reach, first(spacing) * FAR_STEPS);
  return {
    settings,
    samples(spacing = 0) { return 1 + directions * (1 + Math.floor(Math.log2(last(spacing) / first(spacing)))); },
    at(x, z, spacing = 0, lift = 0) {
      const start = first(spacing), end = last(spacing), base = heightAt(x, z, start) + lift;
      let hidden = 0;
      for (const [dx, dz] of headings) {
        let rise = 0;   // tangent of the horizon's elevation along this heading
        for (let distance = start; distance <= end; distance *= 2) {
          rise = Math.max(rise, (heightAt(x + dx * distance, z + dz * distance, distance / 2) - base) / distance);
        }
        // A uniform sky over a horizon at elevation e lights level ground by 1 - sin(e)^2 of the open sky.
        hidden += rise * rise / (1 + rise * rise);
      }
      return 1 - hidden / directions;
    },
  };
}

// One row of a sky map: texels i0..i1 of row j of a square map of `side` texels, `spacing` m apart from `origin`.
export function bakeSkyRow(visibility, data, side, origin, spacing, j, i0 = 0, i1 = side - 1) {
  for (let i = i0; i <= i1; i++) data[j * side + i] = Math.round(visibility.at(origin[0] + i * spacing, origin[1] + j * spacing, spacing) * BYTE);
}

// A whole sky map (one byte per texel, row by row) over a square of ground, e.g. for a terrain field.
export function bakeSkyMap(visibility, origin, size, side) {
  if (!Number.isInteger(side) || side < 2 || !(size > 0)) throw new RangeError('A sky map needs a size and at least two texels per side');
  const data = new Uint8Array(side * side);
  for (let j = 0; j < side; j++) bakeSkyRow(visibility, data, side, origin, size / (side - 1), j);
  return data;
}
