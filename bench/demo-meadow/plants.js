import * as THREE from 'three';
import {seededRandom} from '../../src/core/hash.js';
import {createFreeVegetation, createGrassField, createProceduralMeadowBush, createSpecimens, GRASS_VIEW_DEFAULTS} from '../../src/vegetation/index.js';
import {loadTreeModels} from '../vegetation/conifers.js';
import {SITE, TREES, UNDERGROWTH} from './layout.js';
import {createGrassPlacements, nearGrassPatch} from './grass-patches.js';
import {createMeadowFoliageSnow} from './foliage-snow.js';

const GRASS = {
 clumps: 3800, radius: 36, color: ['#6b843c', '#b2a36d'],
 sweepRadius: .55, recovery: 1.85, tileSize: 5, lodDistance: 20, shadowDistance: 12, farDensity: .46,
};
const WOODS = {lodDistance: 18, impostorDistance: 37, bushRadius: .95, bushScale: [.34, .62]};

export function createMeadowPlants({renderer, scene, field, environment, report}) {
 const free = createFreeVegetation({meadowBlades: true});
 const settings = {...GRASS_VIEW_DEFAULTS, lodDistance: GRASS.lodDistance, shadowDistance: GRASS.shadowDistance,
  farDensity: GRASS.farDensity, recoverySeconds: GRASS.recovery, sweepRadius: GRASS.sweepRadius,
  clumps: GRASS.clumps, radius: GRASS.radius, size: 1, sizeVariation: 1, tintVariation: 1,
  color: GRASS.color[0], soilColor: GRASS.color[1]};
 const treeSettings = {lodDistance: WOODS.lodDistance, impostorDistance: WOODS.impostorDistance, impostors: true, shadows: true,
  'ez-birch': TREES['ez-birch'].length, 'ez-spruce': TREES['ez-spruce'].length, shrubs: UNDERGROWTH.length};
 const grassGroup = new THREE.Group();
 scene.add(grassGroup);
 const foliage = createMeadowFoliageSnow(field, environment);
 let grass, grassDirty = false;
 function rebuild() {
  grassDirty = true;
  if (field.snowCover.value || !settings.density) return;
  const placements = createGrassPlacements(field, settings);
  grass?.dispose();
  grass = createGrassField({scene: grassGroup, geometries: free.grassGeometries, map: free.atlas, color: 0xffffff,
   placements, tileSize: GRASS.tileSize});
  grassDirty = false;
 }
 rebuild();
 const random = seededRandom(SITE.seed);
 const bushes = UNDERGROWTH.map(([x, z]) => ({x, y: field.heightAt(x, z), z,
  yaw: random() * Math.PI * 2, scale: THREE.MathUtils.lerp(...WOODS.bushScale, random())}));
 const shrubGroup = new THREE.Group();
 scene.add(shrubGroup);
 const shrubs = createSpecimens({scene: shrubGroup, parts: {bush: createProceduralMeadowBush(free.reference)},
  atlas: free.atlas, atlasRects: free.atlasRects, placements: {bush: bushes}});
 foliage.attach(shrubGroup);
 shrubs.setCount(bushes.length);

 const woods = [];
 let disposed = false;
 function applyShadows(group) {
  group.traverse(mesh => {
   if (mesh.isInstancedMesh) mesh.castShadow = treeSettings.shadows && mesh.receiveShadow;
  });
 }
 for (const [profile, layout] of Object.entries(TREES)) {
  const items = layout.map(([x, z, h], variant) => ({x, y: field.heightAt(x, z), z, h, variant}));
  loadTreeModels({scene, profile, items, environment, renderer, distanceTest: true}).then(trees => {
   if (disposed) { trees.dispose(); return; }
   foliage.attach(trees.group);
   applyShadows(trees.group);
   woods.push({trees, profile});
  }).catch(error => { if (!disposed) report(error); });
 }
 const sweep = {x: 0, z: 0, radius: 0, speed: 0};
 let shrubCount = bushes.length, shadows = treeSettings.shadows;
 return {
  settings, treeSettings, foliageSettings: foliage.settings, rebuild,
  contact(point) {
   if (field.snowCover.value || !settings.density || !nearGrassPatch(point, settings.sweepRadius)) return;
   grass.addSweep({fromX: point.x, fromZ: point.z, toX: point.x, toZ: point.z, radius: settings.sweepRadius});
  },
  clear() { grass?.clear(); shrubs.clear(); },
  update(dt, camera, walker) {
   foliage.update(dt);
   const showGrass = !field.snowCover.value && settings.density > 0;
   if (grassGroup.visible && !showGrass) grass?.clear();
   grassGroup.visible = showGrass;
   if (showGrass) {
    if (grassDirty) rebuild();
    grass.update(dt, {...settings, camera, environment, transmission: settings.transmission * environment.daylight});
   }
   sweep.x = walker.position.x;
   sweep.z = walker.position.z;
   sweep.speed = walker.grounded ? walker.speed : 0;
   sweep.radius = sweep.speed > 0 ? WOODS.bushRadius : 0;
   if (shrubCount !== treeSettings.shrubs) {
    shrubCount = treeSettings.shrubs;
    shrubs.setCount(shrubCount);
   }
   if (shrubCount) shrubs.update(dt, {environment, sweep});
   const shadowsChanged = shadows !== treeSettings.shadows;
   if (shadowsChanged) { shadows = treeSettings.shadows; applyShadows(shrubGroup); }
   for (const {trees, profile} of woods) {
    if (shadowsChanged) applyShadows(trees.group);
    const count = treeSettings[profile];
    trees.group.visible = count > 0;
    if (!count) continue;
    const {lodDistance, impostors, impostorDistance} = treeSettings;
    trees.updateDistance(camera, lodDistance, count, impostors ? Math.max(lodDistance, impostorDistance) : Infinity);
    trees.update(dt);
   }
  },
  dispose() {
   disposed = true;
   foliage.dispose();
   for (const {trees} of woods) trees.dispose();
   grass?.dispose();
   grassGroup.removeFromParent();
   shrubs.dispose();
   shrubGroup.removeFromParent();
   for (const geometry of free.grassGeometries) geometry.dispose();
   free.dispose();
  },
 };
}
