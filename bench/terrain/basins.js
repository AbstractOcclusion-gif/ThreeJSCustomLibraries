import {MathUtils} from 'three';

const POOLS = [
  {x: 5, z: 6, radiusX: 2.8, radiusZ: 1.9, depth: .26},
  {x: 10, z: 3, radiusX: 1.9, radiusZ: 1.35, depth: .18},
  {x: -4, z: 9, radiusX: 2.4, radiusZ: 1.65, depth: .21},
];
const POOL = {bowlEdge: .88, bankBlendStart: 1.1, apron: 1.45, spill: .83};
const {lerp, smoothstep} = MathUtils;

export function createTerrainBasins(baseHeight) {
  const pools = POOLS.map(pool => ({
    ...pool,
    floor: baseHeight(pool.x, pool.z) - pool.depth,
    capacity: pool.depth * POOL.spill,
  }));

  function heightAt(x, z) {
    let height = baseHeight(x, z);
    for (const pool of pools) {
      const distance = Math.hypot((x - pool.x) / pool.radiusX, (z - pool.z) / pool.radiusZ);
      if (distance >= POOL.apron) continue;
      const bowl = pool.floor + pool.depth * smoothstep(distance, 0, POOL.bowlEdge);
      height = lerp(bowl, height, smoothstep(distance, POOL.bankBlendStart, POOL.apron));
    }
    return height;
  }
  return {pools, heightAt};
}
