// What stands on the ground of the world demo: rocks (rocks module), grass (vegetation module) and trees (the
// vegetation bench's instanced EZ-Tree models), all placed from the world's own paint so they follow its biomes.
// Rocks and grass come and go around the focus; trees are laid once for the whole corridor and drawn by distance.
import * as THREE from 'three';
import {createRocks} from '../../src/rocks/index.js';
import {createFreeVegetation, createGrassField} from '../../src/vegetation/index.js';
import {TERRAIN_LAYERS} from '../../src/terrain/index.js';
import {hash2} from '../../src/core/hash.js';
import {loadTreeModels} from '../vegetation/conifers.js';
import {hasTerrainTextureSet, terrainTextureUrl} from '../terrain/textures.js';

const LAYER = Object.fromEntries(TERRAIN_LAYERS.map((name, index) => [name, index]));
const TURN = Math.PI * 2;
// Rocks, per square tile of `tile` m within `reach` tiles of the focus, at most `tilesPerFrame` new tiles a frame.
// scatter: stones per tile, from grassy to rocky ground. boulders: chance of one on a tile. cliffs: one every `every` m
// along each wall, `span` m long, standing `inset` of the way up the side.
const ROCKS = {
  tile: 32, reach: 4, tilesPerFrame: 1, seed: 631,
  scatter: [2, 9], scatterSize: .8, boulderChance: .22, boulderSize: .7,
  cliffs: {every: 46, span: 15, inset: .55, size: 1.5},
  profile: {valley: 'woodland', dry: 'desert', alpine: 'alpine', mountains: 'alpine'}, fallbackProfile: 'alpine',
  repeat: .35, color: 0x8a8782, roughness: .92,   // texture repeats per metre of rock; plain colour without textures
};
// Grass, in chunks of `chunk` m along the corridor and `half` m to each side of the route: the chunk under the focus
// and `keep` chunks each way. Candidates lie `spacing` m apart, `perFrame` of them weighed a frame.
const GRASS = {
  chunk: 48, half: 64, keep: 1, spacing: 1.15, perFrame: 450, seed: 947,
  from: .12, underTrees: .6, fill: 1.7,   // least cover that grows grass; share of the forest floor that counts; clumps per unit of cover
  waterMargin: .08, sink: .02, size: [.7, 1.6], tileSize: 8, flatColorMix: .75,
  green: '#50762e', dry: '#c2aa61',
};
// Trees: candidates `spacing` m apart within `band` m of the route, kept by the forest paint, `clearance` m off the
// route. Each biome has its density and its mix of species; a species has its range of heights (m).
const TREES = {
  spacing: 8.5, band: 150, clearance: 8, seed: 389, maxSlope: .75, waterMargin: .3, grassShare: .25,
  lod: 60, impostor: 130,
  heights: {'ez-oak': [9, 14], 'ez-birch': [8, 12], 'ez-spruce': [10, 17], 'ez-bush': [1.3, 2.6]},
  biomes: {
    valley: {density: 1, mix: {'ez-oak': .5, 'ez-birch': .3, 'ez-bush': .2}},
    dry: {density: .35, mix: {'ez-bush': .7, 'ez-oak': .3}},
    alpine: {density: .8, mix: {'ez-spruce': .7, 'ez-birch': .3}},
    mountains: {density: .6, mix: {'ez-spruce': 1}},
  },
};

// world: a corridor world. environment: the core environment (wind). report(error): where a failed load goes.
// trees: false leaves the tree models out (they are the long download of the page).
export function createWorldDressing({scene, world, renderer, environment, trees = true, report = console.error}) {
  const route = world.corridor;
  if (!route?.length) throw Error('World dressing needs a corridor world with a length');
  const biomeAt = z => world.biomes[route.sectionAt(THREE.MathUtils.clamp(z, 0, route.length - 1e-3)).biome];
  const paintAt = (x, z) => { const sample = world.sampleAt(x, z); return {sample, paint: world.paintAt(sample)}; };
  const settings = {rocks: true, grass: true, trees: true, treeLod: TREES.lod, treeImpostor: TREES.impostor};
  const stats = {rockTiles: 0, grassClumps: 0, trees: 0, treesLoading: 0};

  // ---- Rocks
  const rockGroup = new THREE.Group(), rockMaterials = new Map(), rockTextures = [];
  rockGroup.name = 'rocks';
  scene.add(rockGroup);
  // One material per rock texture set of the biomes; a set that is not bundled gives a plain rock colour.
  function rockMaterial(biome) {
    const set = biome.textures.rock;
    if (rockMaterials.has(set)) return rockMaterials.get(set);
    const material = new THREE.MeshStandardMaterial({color: ROCKS.color, roughness: ROCKS.roughness});
    if (hasTerrainTextureSet(set)) {
      const loader = new THREE.TextureLoader();
      for (const [slot, role] of [['map', 'color'], ['normalMap', 'normal']]) {
        const texture = loader.load(terrainTextureUrl(set, role));
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.setScalar(ROCKS.repeat);
        if (role === 'color') texture.colorSpace = THREE.SRGBColorSpace;
        material[slot] = texture;
        rockTextures.push(texture);
      }
      material.color.set(0xffffff);
    }
    rockMaterials.set(set, material);
    return material;
  }
  const rockTiles = new Map();
  function buildRockTile(column, row) {
    const {tile, scatter, cliffs} = ROCKS, x0 = column * tile, z0 = row * tile, cx = x0 + tile / 2, cz = z0 + tile / 2;
    const biome = biomeAt(cz), material = rockMaterial(biome), profile = ROCKS.profile[biome.id] ?? ROCKS.fallbackProfile;
    const seed = Math.floor(hash2(column, row, ROCKS.seed) * 1e6) + 1, parts = [];
    const add = (rocks, x, z, yaw = 0) => { rocks.group.position.set(x, 0, z); rocks.group.rotation.y = yaw; rockGroup.add(rocks.group); parts.push(rocks); };
    const {paint} = paintAt(cx, cz), rocky = Math.min(1, paint.layers[LAYER.rock] * 1.5);
    add(createRocks({mode: 'scatter', environment: profile, seed, material, span: tile, size: ROCKS.scatterSize,
      count: Math.round(THREE.MathUtils.lerp(scatter[0], scatter[1], rocky)), heightAt: (x, z) => world.heightAt(cx + x, cz + z)}), cx, cz);
    if (hash2(column, row, ROCKS.seed + 1) < ROCKS.boulderChance) {
      const x = x0 + hash2(column, row, ROCKS.seed + 2) * tile, z = z0 + hash2(column, row, ROCKS.seed + 3) * tile;
      add(createRocks({mode: 'boulder', environment: profile, seed: seed + 1, material, size: ROCKS.boulderSize, heightAt: () => world.heightAt(x, z)}), x, z);
    }
    // The cliffs whose foot falls in this tile, on either wall.
    const {width, shoulder} = route.settings, offset = width / 2 + shoulder * cliffs.inset;
    for (let k = Math.ceil(z0 / cliffs.every); k * cliffs.every < z0 + tile; k++) for (const side of [-1, 1]) {
      const z = k * cliffs.every, x = route.routeX(z) + side * offset;
      if (x < x0 || x >= x0 + tile || z < 0 || z > route.length) continue;
      // The long side of a cliff runs along its local X: turned to run along the route.
      const along = Math.atan2(route.routeX(z + 1) - route.routeX(z - 1), 2);
      add(createRocks({mode: 'cliff', environment: profile, seed: seed + 2 + k * 2 + (side > 0), material, span: cliffs.span, size: cliffs.size,
        heightAt: () => world.heightAt(x, z)}), x, z, along - Math.PI / 2);
    }
    return parts;
  }
  function updateRocks(focus) {
    const {tile, reach} = ROCKS, column0 = Math.floor(focus.x / tile), row0 = Math.floor(focus.z / tile);
    for (const [key, parts] of rockTiles) {
      const [column, row] = key.split(',').map(Number);
      if (Math.abs(column - column0) <= reach + 1 && Math.abs(row - row0) <= reach + 1) continue;
      for (const rocks of parts) rocks.dispose();
      rockTiles.delete(key);
    }
    let built = 0;
    // Nearest tiles first.
    for (let ring = 0; ring <= reach && built < ROCKS.tilesPerFrame; ring++) {
      for (let row = row0 - ring; row <= row0 + ring && built < ROCKS.tilesPerFrame; row++) for (let column = column0 - ring; column <= column0 + ring; column++) {
        if (Math.max(Math.abs(row - row0), Math.abs(column - column0)) !== ring) continue;
        const key = column + ',' + row;
        if (rockTiles.has(key)) continue;
        rockTiles.set(key, buildRockTile(column, row));
        if (++built >= ROCKS.tilesPerFrame) break;
      }
    }
    stats.rockTiles = rockTiles.size;
  }

  // ---- Grass
  const grassGroup = new THREE.Group(), meadow = createFreeVegetation({meadowBlades: true});
  grassGroup.name = 'grass';
  scene.add(grassGroup);
  const grassChunks = new Map(), green = new THREE.Color(GRASS.green), dry = new THREE.Color(GRASS.dry), tint = new THREE.Color();
  let grassJob = null;
  // Weighs the candidates of a chunk a few at a time, then lays its field.
  function* weighChunk(index) {
    const {chunk, half, spacing, from, size} = GRASS, placements = [], columns = Math.floor(2 * half / spacing), rows = Math.floor(chunk / spacing);
    let weighed = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
      const z = index * chunk + (j + hash2(i, j, GRASS.seed + index)) * spacing;
      const x = route.routeX(z) - half + (i + hash2(j, i, GRASS.seed + index + 1)) * spacing;
      const {sample, paint} = paintAt(x, z), cover = Math.min(1, (paint.layers[LAYER.grass] + GRASS.underTrees * paint.layers[LAYER.forest]) * (1 - paint.sand));
      const chance = hash2(i + 7, j + 3, GRASS.seed + index + 2);
      if (cover > from && chance < cover * GRASS.fill && sample.height > world.waterLevel + GRASS.waterMargin) {
        tint.lerpColors(dry, green, paint.moisture);
        placements.push({x, y: sample.height - GRASS.sink, z, yaw: chance * TURN * 7, scale: THREE.MathUtils.lerp(size[0], size[1], hash2(i, j, GRASS.seed + 5) * cover), tint: tint.toArray()});
      }
      if (++weighed % GRASS.perFrame === 0) yield;
    }
    const field = placements.length ? createGrassField({scene: grassGroup, geometries: meadow.grassGeometries, map: meadow.atlas, color: 0xffffff,
      placements, tileSize: GRASS.tileSize, flatColorMix: GRASS.flatColorMix}) : null;
    grassChunks.set(index, {field, clumps: placements.length});
  }
  function updateGrass(dt, camera, focus) {
    const here = Math.floor(focus.z / GRASS.chunk), last = Math.floor((route.length - 1) / GRASS.chunk);
    for (const [index, {field}] of grassChunks) {
      if (Math.abs(index - here) <= GRASS.keep + 1) continue;
      field?.dispose();
      grassChunks.delete(index);
    }
    if (!grassJob) {
      const wanted = [0, ...Array.from({length: GRASS.keep}, (_, step) => [step + 1, -step - 1]).flat()].map(step => here + step)
        .find(index => index >= 0 && index <= last && !grassChunks.has(index));
      if (wanted !== undefined) grassJob = weighChunk(wanted);
    }
    if (grassJob?.next().done) grassJob = null;
    stats.grassClumps = 0;
    for (const {field, clumps} of grassChunks.values()) { stats.grassClumps += clumps; field?.update(dt, {camera, environment}); }
  }

  // ---- Trees
  const treeGroup = new THREE.Group(), species = [];
  treeGroup.name = 'trees';
  scene.add(treeGroup);
  if (trees) {
    const {spacing, band, clearance} = TREES, items = Object.fromEntries(Object.keys(TREES.heights).map(name => [name, []]));
    for (let j = 0; j * spacing < route.length; j++) for (let i = 0; i * spacing < band * 2; i++) {
      const z = (j + hash2(i, j, TREES.seed)) * spacing, x = route.routeX(z) - band + (i + hash2(j, i, TREES.seed + 1)) * spacing;
      if (Math.abs(x - route.routeX(z)) < clearance) continue;
      const rule = TREES.biomes[biomeAt(z).id];
      if (!rule) continue;
      const {sample, paint} = paintAt(x, z);
      const cover = rule.density * (paint.layers[LAYER.forest] + TREES.grassShare * paint.layers[LAYER.grass]);
      if (hash2(i + 11, j + 5, TREES.seed + 2) >= cover || sample.slope > TREES.maxSlope || sample.height < world.waterLevel + TREES.waterMargin) continue;
      // The species: drawn by its share of the biome's mix.
      let draw = hash2(i + 3, j + 17, TREES.seed + 3), name;
      for (const [candidate, share] of Object.entries(rule.mix)) { name = candidate; if ((draw -= share) < 0) break; }
      const [low, high] = TREES.heights[name], list = items[name];
      list.push({x, y: sample.height, z, h: THREE.MathUtils.lerp(low, high, hash2(i, j, TREES.seed + 4)), variant: list.length});
    }
    for (const [profile, list] of Object.entries(items)) {
      if (!list.length) continue;
      stats.treesLoading++;
      loadTreeModels({scene: treeGroup, profile, items: list, environment, renderer, distanceTest: true, lights: scene}).then(plants => {
        if (disposed) { plants.dispose(); return; }
        // The modelled tiers cast shadows; the flat cards do not.
        plants.group.traverse(mesh => { if (mesh.isInstancedMesh && !mesh.material.isMeshBasicMaterial) mesh.castShadow = true; });
        species.push({plants, count: list.length});
        stats.trees += list.length;
      }).catch(error => report(new Error(`Could not load the ${profile} trees: ${error.message}`))).finally(() => { stats.treesLoading--; });
    }
  }

  let disposed = false;
  return {
    settings, stats,
    probed: [rockGroup, treeGroup],   // what the light probes are meant for: the things that stand on the ground
    update(dt, camera, focus) {
      rockGroup.visible = settings.rocks; grassGroup.visible = settings.grass; treeGroup.visible = settings.trees;
      if (settings.rocks) updateRocks(focus);
      if (settings.grass) updateGrass(dt, camera, focus);
      if (settings.trees) for (const {plants, count} of species) {
        plants.update(dt);
        plants.updateDistance(camera, settings.treeLod, count, Math.max(settings.treeLod, settings.treeImpostor));
      }
    },
    dispose() {
      disposed = true;
      for (const parts of rockTiles.values()) for (const rocks of parts) rocks.dispose();
      for (const material of rockMaterials.values()) material.dispose();
      for (const texture of rockTextures) texture.dispose();
      for (const {field} of grassChunks.values()) field?.dispose();
      meadow.atlas.dispose(); for (const geometry of meadow.grassGeometries) geometry.dispose();
      for (const {plants} of species) plants.dispose();
      scene.remove(rockGroup, grassGroup, treeGroup);
    },
  };
}
