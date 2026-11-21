import {MathUtils, Plane, Vector3} from 'three';
import {createTerrainClipmap} from '../../src/terrain/index.js';
import {RINGS_PER_FRAME} from '../kit/world-settings.js';

const RINGS = {cells: 64, levels: 4, snapCells: 2, normalDetail: 1, skySamples: 0};
const GEOMETRY_ONLY = {layers: [0, 0, 0, 0], sand: 0};

export function createMeadowTerrainView({renderer, scene, field, surface, createMaterial}) {
 const {x, y: z, z: spanX, w: spanZ} = field.bounds;
 const {data, width, height} = field.heightMap.image;
 const cell = spanX / (width - 1);
 const planes = [new Plane(new Vector3(1, 0, 0), -x), new Plane(new Vector3(-1, 0, 0), x + spanX),
  new Plane(new Vector3(0, 0, 1), -z), new Plane(new Vector3(0, 0, -1), z + spanZ)];
 let clipmap, snapshot, version, lastX, lastZ;

 function heightAt(worldX, worldZ) {
  // Ring samples align with the field grid. Clipping planes keep the rings inside the meadow.
  const column = MathUtils.clamp(Math.round((worldX - x) / cell), 0, width - 1);
  const row = MathUtils.clamp(Math.round((worldZ - z) / cell), 0, height - 1);
  return data[row * width + column];
 }
 function refreshHeights() {
  let left = width, top = height, right = -1, bottom = -1;
  for (let i = 0; i < data.length; i++) {
   if (snapshot[i] === data[i]) continue;
   snapshot[i] = data[i];
   const column = i % width, row = Math.floor(i / width);
   left = Math.min(left, column); right = Math.max(right, column);
   top = Math.min(top, row); bottom = Math.max(bottom, row);
  }
  if (right >= 0) clipmap.invalidate({minX: x + left * cell, minZ: z + top * cell,
   maxX: x + right * cell, maxZ: z + bottom * cell});
 }

 return {
  update(focus, useRings) {
   surface.visible = !useRings;
   if (clipmap) clipmap.group.visible = useRings;
   if (!useRings) return;
   if (!clipmap) {
    renderer.localClippingEnabled = true;
    clipmap = createTerrainClipmap({...RINGS, cellSize: cell, world: {heightAt, paintAt: () => GEOMETRY_ONLY},
     // All levels read the real field's snow, track and surface maps. Only ring geometry and its morph vary.
     createMaterial: ring => createMaterial({...field, morph: ring.morph}, {clippingPlanes: planes})});
    scene.add(clipmap.group);
    snapshot = data.slice();
    version = field.heightMap.version;
   }
   const jumped = Math.hypot(focus.x - lastX, focus.z - lastZ) > RINGS.cells * cell / 2;
   clipmap.update(focus.x, focus.z, jumped ? RINGS.levels : RINGS_PER_FRAME);
   lastX = focus.x;
   lastZ = focus.z;
   if (version !== field.heightMap.version) {
    refreshHeights();
    version = field.heightMap.version;
   }
  },
  dispose() { clipmap?.group.removeFromParent(); clipmap?.dispose(); },
 };
}
