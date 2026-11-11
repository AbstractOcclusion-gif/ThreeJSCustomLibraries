import {BufferAttribute, MathUtils, PlaneGeometry, Vector4} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {seededRandom} from '../../src/core/index.js';
import {createChannel, createChannelSurface, createFlowBake, createRipples, proceduralSky} from '../../src/water/index.js';

const STREAM = {
  drop: 2.6,
  bankBlendEnd: 2.1, // half widths from the centre
  // x, z, half width, bed depth, flow speed
  sections: [
    [-32, -10, 1.6, .36, 1.7],
    [-22, -8, 1.5, .34, 1.9],
    [-12, -3, 2, .5, 1.35],
    [-3, 1, 1.7, .43, 1.6],
    [7, -2, 1.9, .5, 1.25],
    [17, -1, 2.3, .55, .9],
    [32, 6, 2.5, .6, .75],
  ],
};
const STREAM_STONES = [
  {x: -7, across: .25, radius: .65},
  {x: 2, across: -.25, radius: .7},
];
const CHANNEL_OBSTACLE_SLOTS = 4;
const POOLS = [
  {x: 5, z: 6, radiusX: 2.8, radiusZ: 1.9, depth: .26},
  {x: 10, z: 3, radiusX: 1.9, radiusZ: 1.35, depth: .18},
  {x: -4, z: 9, radiusX: 2.4, radiusZ: 1.65, depth: .21},
];
const POOL = {bowlEdge: .88, bankBlendStart: 1.1, apron: 1.45, spill: .83, stillFlowCoordinate: 2, fillRefreshSeconds: .12};
const FLOW = {cell: .4, iterations: 64};
const RAIN = {seed: 42, dropsPerSecond: 64, impactRadius: .52, strength: .16, jitter: .7};
const WATER = {captureScale: .5, foamFeather: .66, refraction: .88, clarity: 1, reflection: 1.15, microRipples: .008};
const WATERLINE_EPSILON = .002; // matches the water material's bed clip
const {lerp, smoothstep, clamp} = MathUtils;

export function createTerrainDrainage(baseHeight) {
  const channel = createChannel({drop: STREAM.drop, sections: STREAM.sections});
  channel.bed.dispose(); // The terrain field provides the bed mesh.
  const pools = POOLS.map(pool => ({...pool, floor: baseHeight(pool.x, pool.z) - pool.depth}));

  function heightAt(x, z) {
    const terrain = baseHeight(x, z);
    const section = channel.sectionAt(x);
    const across = section ? Math.abs(z - section.centre) / section.width : Infinity;
    let height = terrain;
    if (across < STREAM.bankBlendEnd) {
      const bankBlend = smoothstep(across, 1, STREAM.bankBlendEnd);
      height = lerp(channel.bedHeightAt(x, z), terrain, bankBlend);
    }
    for (const pool of pools) {
      const distance = Math.hypot((x - pool.x) / pool.radiusX, (z - pool.z) / pool.radiusZ);
      if (distance >= POOL.apron) continue;
      const bowl = pool.floor + pool.depth * smoothstep(distance, 0, POOL.bowlEdge);
      height = lerp(bowl, height, smoothstep(distance, POOL.bankBlendStart, POOL.apron));
    }
    return height;
  }
  const stones = STREAM_STONES.map(({x, across, radius}) => {
    const section = channel.sectionAt(x);
    return {x, z: section.centre + across * section.width, radius, slope: section.slope};
  });
  return {channel, pools, stones, heightAt};
}

export function createTerrainWater({renderer, scene, camera, stage, field, drainage, span, sampleSpacing, rainAmount}) {
  const {channel, pools, stones} = drainage;
  const origin = [field.bounds.x, field.bounds.y];
  const cells = Math.ceil(span / FLOW.cell);
  const grid = {origin, size: [cells, cells], cell: FLOW.cell};
  const ripples = createRipples(grid);
  const flow = createFlowBake(grid);
  const sky = proceduralSky();
  // Keep the existing four-slot channel shader interface. These coordinates
  // place boulders in the stream so the baked velocity curls around them.
  const obstacles = Array.from({length: CHANNEL_OBSTACLE_SLOTS}, (_, index) => {
    const stone = stones[index];
    return stone ? new Vector4(stone.x, stone.z, stone.radius, stone.slope) : new Vector4();
  });
  flow.bake(channel, obstacles, FLOW.iterations);

  const patches = pools.map(pool => {
    const width = pool.radiusX * 2, depth = pool.radiusZ * 2;
    const patch = new PlaneGeometry(width, depth, Math.ceil(width / sampleSpacing), Math.ceil(depth / sampleSpacing));
    patch.rotateX(-Math.PI / 2).translate(pool.x, pool.floor, pool.z);
    patch.deleteAttribute('uv');
    const flowData = new Float32Array(patch.getAttribute('position').count * 3);
    for (let index = 1; index < flowData.length; index += 3) flowData[index] = POOL.stillFlowCoordinate;
    patch.setAttribute('flow', new BufferAttribute(flowData, 3));
    return patch;
  });
  channel.surface.deleteAttribute('color');
  const parts = [channel.surface, ...patches];
  const counts = parts.map(part => part.getAttribute('position').count);
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  const positions = geometry.getAttribute('position');
  const bed = new BufferAttribute(new Float32Array(positions.count), 1);
  geometry.setAttribute('bedHeight', bed);
  const water = createChannelSurface({
    renderer, scene, camera, sky, ripples, flow, obstacles, captureScale: WATER.captureScale,
    clipToBed: true, stillBasins: true, rainAmount,
  });
  water.surface.geometry.dispose();
  water.surface.geometry = geometry;
  const settings = {speed: 1, foam: .55, puddles: .45};
  const random = seededRandom(RAIN.seed);
  const wetCells = [];
  const poolLevels = pools.map(pool => pool.floor);
  let time = 0, flowTime = 0, dropBudget = 0, fillClock = POOL.fillRefreshSeconds, previousFill = -1, bedDirty = true;

  function syncBed() {
    for (let index = 0; index < positions.count; index++) {
      const x = clamp(positions.getX(index), field.bounds.x, field.bounds.x + field.bounds.z);
      const z = clamp(positions.getZ(index), field.bounds.y, field.bounds.y + field.bounds.w);
      bed.setX(index, field.heightAt(x, z));
    }
    bed.needsUpdate = true;
  }

  function syncPoolLevels(fill) {
    let offset = counts[0];
    pools.forEach((pool, index) => {
      const level = fill > 0
        ? pool.floor + pool.depth * POOL.spill * fill
        : field.geometry.boundingBox.min.y;
      poolLevels[index] = level;
      const end = offset + counts[index + 1];
      for (; offset < end; offset++) positions.setY(offset, level);
    });
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  function syncRippleMask() {
    wetCells.length = 0;
    ripples.mask((x, z) => {
      const bedHeight = field.heightAt(x, z);
      if (bedHeight === undefined) return false;
      const section = channel.sectionAt(x);
      const streamWet = section && Math.abs(z - section.centre) <= section.width
        && section.height - bedHeight > WATERLINE_EPSILON
        && !obstacles.some(rock => Math.hypot(x - rock.x, z - rock.y) < rock.z);
      const poolWet = pools.some((pool, index) =>
        Math.abs(x - pool.x) < pool.radiusX && Math.abs(z - pool.z) < pool.radiusZ
        && poolLevels[index] - bedHeight > WATERLINE_EPSILON);
      if (streamWet || poolWet) wetCells.push([x, z]);
      return Boolean(streamWet || poolWet);
    });
  }

  return {
    settings,
    obstacles,
    invalidateBed() { bedDirty = true; },
    render(dt, rainWetness) {
      time += dt;
      flowTime += dt * settings.speed;
      fillClock += dt;
      const fill = clamp(settings.puddles + rainWetness, 0, 1);
      const updateFill = fill !== previousFill && fillClock >= POOL.fillRefreshSeconds;
      if (bedDirty) syncBed();
      if (updateFill) {
        syncPoolLevels(fill);
        previousFill = fill;
        fillClock = 0;
      }
      if (bedDirty || updateFill) syncRippleMask();
      bedDirty = false;

      dropBudget += dt * rainAmount.value * RAIN.dropsPerSecond;
      for (; dropBudget >= 1; dropBudget--) {
        if (!wetCells.length) continue;
        const [x, z] = wetCells[Math.floor(random() * wetCells.length)];
        const jitter = FLOW.cell * RAIN.jitter;
        ripples.splash(x + (random() - .5) * jitter, z + (random() - .5) * jitter, RAIN.strength, RAIN.impactRadius);
      }
      ripples.update(dt);
      sky.setEnvironment(stage.environment);
      water.render(flowTime, {...WATER, waveTime: time, speed: settings.speed, foam: settings.foam});
    },
    dispose() {
      water.dispose();
      flow.dispose();
      ripples.dispose();
    },
  };
}
