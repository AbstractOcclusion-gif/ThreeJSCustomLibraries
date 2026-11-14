import {bakeSkyMap, createSkyVisibility} from '../../src/terrain/index.js';

export function samplePlayArea(ground, {origin, size, cells, reliefCellSize, skySide}, cachePaint = true) {
  const n = cells + 1, step = size / cells;
  const heights = new Float32Array(n * n);
  const paint = cachePaint ? new Array(heights.length) : null;
  let lowest = Infinity;
  for (let row = 0; row < n; row++) for (let column = 0; column < n; column++) {
    const index = row * n + column, x = origin[0] + column * step, z = origin[1] + row * step;
    const height = heights[index] = ground.heightAt(x, z, reliefCellSize);
    lowest = Math.min(lowest, height);
    if (paint) {
      const sample = ground.paintAt(ground.sampleAt(x, z));
      paint[index] = {...sample, palette: sample.palette.slice()};
    }
  }
  const skyData = bakeSkyMap(createSkyVisibility(ground.heightAt), origin, size, skySide);
  return {heights, paint, lowest, skyData};
}
