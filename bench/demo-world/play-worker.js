import {createTerrainWorld} from '../../src/terrain/index.js';
import {samplePlayArea} from '../terrain/play-samples.js';
import {SURROUND} from '../terrain/impacts.js';

let world;
self.onmessage = ({data}) => {
  try {
    if (data.world) {
      world = createTerrainWorld(data.world);
      return;
    }
    const result = samplePlayArea(world, data.request);
    const {size, cell} = SURROUND, count = Math.round(size / cell) + 1;
    const [x, z] = data.request.center;
    const originX = Math.round((x - size / 2) / cell) * cell, originZ = Math.round((z - size / 2) / cell) * cell;
    const heights = Float64Array.from({length: count ** 2}, (_, i) =>
      world.heightAt(originX + (i % count) * cell, originZ + Math.floor(i / count) * cell));
    result.surroundSamples = {originX, originZ, data: heights};
    self.postMessage({id: data.id, result}, [result.heights.buffer, result.skyData.buffer, heights.buffer]);
  } catch (error) {
    self.postMessage({id: data.id, error: error.message});
  }
};
