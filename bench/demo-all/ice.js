import * as THREE from 'three';
import {Body, Box, ContactMaterial, Material, Vec3} from 'cannon-es';
import {hasIceSupport} from '../../src/water/freeze.js';
import {createIceSlab, ICE_THICKNESS, ICE_TOP} from './ice-slab.js';
import {createIceFracture, iceFractureDistance} from './ice-fracture.js';
import {createDataTexture} from '../../src/core/data-texture.js';

const SLIDE_FRICTION = .00015;

export function createTerrainIce(field, freezeMap, scene) {
 const columns = Math.ceil(field.bounds.z / .5), rows = Math.ceil(field.bounds.w / .5);
 const width = field.bounds.z / columns, depth = field.bounds.w / rows;
 const damage = new Uint8Array(columns * rows);
 const support = new Uint8Array(damage.length);
 const pixelsPerCell = 4, mapColumns = columns * pixelsPerCell, mapRows = rows * pixelsPerCell;
 const mapWidth = width / pixelsPerCell, mapDepth = depth / pixelsPerCell;
 const mask = new Uint8Array(mapColumns * mapRows);
 const texture = createDataTexture(mask, mapColumns, mapRows, {format: THREE.RedFormat});
 const active = {value: false};
 const solidSurface = {value: false}, holes = [], slab = createIceSlab(scene, freezeMap);
 const bodies = new Map(), material = new Material({friction: SLIDE_FRICTION, restitution: 0});
 let lastProgress, lastLevel, lastBedVersion, dirty = true;

 function clear() {
  if (!active.value) return;
  damage.fill(0);
  mask.fill(0);
  holes.length = 0;
  active.value = false;
  texture.needsUpdate = true;
  dirty = true;
 }

 return {
  texture, bounds: field.bounds, active, solidSurface, material: slab.material,
  owns(body) { return body.material === material; },
  addContactMaterial(world, blockMaterial) {
   world.addContactMaterial(new ContactMaterial(material, blockMaterial, {friction: SLIDE_FRICTION, restitution: 0}));
  },
  clear,
  crack(x, z, radius) {
   const fracture = createIceFracture(x, z, radius), cutCells = [];
   const extent = radius * 1.08;
   const leftCell = Math.max(0, Math.floor((x - extent - field.bounds.x) / width));
   const rightCell = Math.min(columns - 1, Math.floor((x + extent - field.bounds.x) / width));
   const frontCell = Math.max(0, Math.floor((z - extent - field.bounds.y) / depth));
   const backCell = Math.min(rows - 1, Math.floor((z + extent - field.bounds.y) / depth));
   let changed = false;
   for (let row = frontCell; row <= backCell; row++) for (let column = leftCell; column <= rightCell; column++) {
    const index = row * columns + column;
    if (damage[index]) continue;
    const cellX = field.bounds.x + (column + .5) * width;
    const cellZ = field.bounds.y + (row + .5) * depth;
    if (iceFractureDistance(fracture, cellX, cellZ) > 0) continue;
    cutCells.push(index);
    if (support[index]) changed = true;
   }
   if (changed) {
    for (const index of cutCells) damage[index] = 255;
    holes.push(fracture);
    const left = Math.max(0, Math.floor((x - extent - field.bounds.x) / mapWidth));
    const right = Math.min(mapColumns - 1, Math.floor((x + extent - field.bounds.x) / mapWidth));
    const front = Math.max(0, Math.floor((z - extent - field.bounds.y) / mapDepth));
    const back = Math.min(mapRows - 1, Math.floor((z + extent - field.bounds.y) / mapDepth));
    for (let row = front; row <= back; row++) for (let column = left; column <= right; column++) {
     const px = field.bounds.x + (column + .5) * mapWidth;
     const pz = field.bounds.y + (row + .5) * mapDepth;
     if (iceFractureDistance(fracture, px, pz) <= 0) mask[row * mapColumns + column] = 255;
    }
    active.value = true; texture.needsUpdate = true; dirty = true;
   }
   return changed;
  },
  sync(world, progress, level) {
   if (progress === 0) clear();
   if (!dirty && progress === lastProgress && level === lastLevel && field.heightMap.version === lastBedVersion) return false;
   dirty = false;
   const solid = progress >= 1;
   const moved = lastLevel !== undefined && (level !== lastLevel || solid !== solidSurface.value) && bodies.size > 0;
   solidSurface.value = solid;
   const iceTop = level + (solid ? ICE_TOP : 0);
   lastProgress = progress;
   lastLevel = level;
   lastBedVersion = field.heightMap.version;
   const rectangles = [], open = new Map();
   for (let row = 0; row < rows; row++) {
    const z = field.bounds.y + (row + .5) * depth;
    let start = -1;
    for (let column = 0; column <= columns; column++) {
     let solid = false;
     if (column < columns) {
      const index = row * columns + column;
      const x = field.bounds.x + (column + .5) * width;
      solid = progress > 0 && !damage[index] && hasIceSupport(progress, level - field.heightAt(x, z), x, z, freezeMap);
      support[index] = Number(solid);
     }
     if (solid) { if (start < 0) start = column; continue; }
     if (start < 0) continue;
     const key = `${start}/${column}`;
     const previous = open.get(key);
     if (previous?.endRow === row) previous.endRow++;
     else {
      const rectangle = {start, end: column, row, endRow: row + 1};
      rectangles.push(rectangle);
      open.set(key, rectangle);
     }
     start = -1;
    }
   }
   const wanted = new Set();
   for (const {start, end, row, endRow} of rectangles) {
    const key = `${start}/${end}/${row}/${endRow}`;
    wanted.add(key);
    if (bodies.has(key)) {
     const body = bodies.get(key);
     if (moved) { body.position.y = iceTop - ICE_THICKNESS / 2; body.aabbNeedsUpdate = true; }
     continue;
    }
    const x = field.bounds.x + (start + end) * width / 2;
    const z = field.bounds.y + (row + endRow) * depth / 2;
    const shape = new Box(new Vec3((end - start) * width / 2, ICE_THICKNESS / 2, (endRow - row) * depth / 2));
    const body = new Body({mass: 0, shape, material, position: new Vec3(x, iceTop - ICE_THICKNESS / 2, z)});
    world.addBody(body);
    bodies.set(key, body);
   }
   let removed = moved;
   for (const [key, body] of bodies) if (!wanted.has(key)) {
    world.removeBody(body);
    bodies.delete(key);
    removed = true;
   }
   if (solid) {
    const bounds = rectangles.length ? {
     left: field.bounds.x + (Math.min(...rectangles.map(r => r.start)) - 1) * width,
     right: field.bounds.x + (Math.max(...rectangles.map(r => r.end)) + 1) * width,
     front: field.bounds.y + (Math.min(...rectangles.map(r => r.row)) - 1) * depth,
     back: field.bounds.y + (Math.max(...rectangles.map(r => r.endRow)) + 1) * depth,
    } : null;
    slab.rebuild(field, level, holes, bounds);
   } else slab.mesh.visible = false;
   return removed;
  },
  dispose() { slab.dispose(); texture.dispose(); },
 };
}
