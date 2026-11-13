import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {cloneBiome, createTerrainAppearance, createTerrainWorld, createTerrainField, createTerrainMaterial, DEFAULT_TERRAIN_BIOME, reliefShape, RELIEF_MAX_SHAPES, RELIEF_SHAPES, TERRAIN_BIOMES, TERRAIN_LAYERS, TERRAIN_PAINT_FIELDS, terrainWindowOrigin, validateBiome, WORLD_DEFAULTS, WORLD_FIELDS, WORLD_MAP_AUTO, WORLD_MAX_BIOMES} from '../../src/terrain/index.js';
import {DEFAULT_TERRAIN_TEXTURES, TERRAIN_TEXTURE_SETS} from '../../src/terrain/textures.js';
import {seededRandom} from '../../src/core/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchPanel} from '../panel.js';
import {hasTerrainTextureSet, loadTerrainTextures} from './textures.js';
import {textureSetControls} from './controls.js';
import {createValleyTiles} from './valley-tiles.js';
import '../bench.css';

const GRID = {
  tileCount: 8, strideTiles: 2, tileSize: 32, cells: [32, 16, 8], distances: [65, 125], hysteresis: 8,
  lodColors: [0x83e4bc, 0xffce78, 0xa7b2ff],
};
const VIEW = {
  fov: 48, near: .5, far: 800, position: [110, 105, 145], target: [0, 8, 0],
  speed: 16, low: 7, rise: 94, lookAhead: 20, edgeBuffer: 26,
};
const DRESSING = {
  seed: 238, attemptsPerTile: 34, hashX: 73856093, hashZ: 19349663, routeClearance: 9, minScale: .65, maxScale: 1.65,
  tree: {color: 0x355a37, radius: 1.2, height: 5.2, sides: 6, maxSlope: .63},
  rock: {color: 0x81837d, radius: 1.1, depthScale: .7, rate: .65},
};
const SEED = 17;
// Debug colours of the 'Layer colours' view, per terrain layer and for sand.
const LAYER_COLORS = {grass: 0xb3c870, rock: 0x9d8ba0, snow: 0xe6eef2, mud: 0x6b5138, forest: 0x3b8153, sand: 0xd6c096};
const LAYER_NAMES = Object.keys(LAYER_COLORS);
const layerColors = LAYER_NAMES.map(name => [name, new THREE.Color(LAYER_COLORS[name])]);
const CONTROLS = {density: [0, 1, .01]};
const VIEWS = ['Textures', 'Layer colours', 'Biome colours'];
// Hand-placed biome map: regions per side, and one debug colour per world biome (also the 'Biome colours' view).
const MAP = {columns: 8, rows: 8, autoAlpha: .35, windowColor: '#ffffff', font: '11px sans-serif', ink: '#10201f'};
const BIOME_SWATCHES = [0x7fbf6a, 0xd9b36c, 0x8fa7d9, 0xc98383, 0x6fc7c1, 0xb48fd1, 0xe0d36a, 0x8c9a6b,
  0xd99a5b, 0x5f8fbf, 0xbf6f9f, 0x9fbf5f, 0x7f7fbf, 0xbfa07f, 0x5fbf8f, 0xbf5f5f];
const biomeColors = BIOME_SWATCHES.map((color, index) => ['biome' + index, new THREE.Color(color)]);
const span = GRID.tileSize * GRID.tileCount, half = span / 2;
const cells = GRID.tileCount * GRID.cells[0], resolution = cells + 1, spacing = span / cells;
export async function mountValley() {
  const settings = {seed: SEED, infinite: false, dressingSeed: DRESSING.seed, density: .62, lod: true, wireframe: false, view: VIEWS[0], flyover: false,
    ...WORLD_DEFAULTS, handPlaced: false};
  // The world's biomes: copies of catalogue biomes, so the catalogue stays as shipped. `biome` is the one being edited.
  const worldBiomes = [cloneBiome(DEFAULT_TERRAIN_BIOME)];
  let biome = worldBiomes[0];
  const map = {columns: MAP.columns, rows: MAP.rows, cells: new Array(MAP.columns * MAP.rows).fill(WORLD_MAP_AUTO)};
  // The world shares one texture palette: the texture sets of its first biome.
  const palette = () => worldBiomes[0].textures;

  const renderer = benchRenderer();
  const scene = new THREE.Scene();
  const stage = createBasicStage({scene, ground: false});
  const camera = new THREE.PerspectiveCamera(VIEW.fov, innerWidth / innerHeight, VIEW.near, VIEW.far);
  camera.position.set(...VIEW.position);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(...VIEW.target);
  orbit.enableDamping = true;
  orbit.update();
  // A catalogue set whose files are not bundled falls back to the layer's default set and is named in the status.
  let missingSets = [];
  function bundledSets(sets) {
    missingSets = [...new Set(Object.values(sets).filter(set => !hasTerrainTextureSet(set)))];
    return Object.fromEntries(Object.entries(sets).map(([layer, set]) => [layer, hasTerrainTextureSet(set) ? set : DEFAULT_TERRAIN_TEXTURES[layer]]));
  }
  const loadTextures = sets => loadTerrainTextures(renderer, {layerDetail: true, sets: bundledSets(sets)});
  const disposeTextures = set => { for (const texture of Object.values(set)) texture?.dispose?.(); };
  let textures = await loadTextures(palette());
  const appearance = createTerrainAppearance();
  appearance.shoreWetness.value = 0;
  const biomeMaterial = new THREE.MeshLambertMaterial({vertexColors: true});
  const treeGeometry = new THREE.ConeGeometry(DRESSING.tree.radius, DRESSING.tree.height, DRESSING.tree.sides);
  treeGeometry.translate(0, DRESSING.tree.height / 2, 0);
  const rockGeometry = new THREE.IcosahedronGeometry(DRESSING.rock.radius);
  rockGeometry.scale(1, DRESSING.rock.depthScale, 1);
  const props = {
    tree: {geometry: treeGeometry, material: new THREE.MeshStandardMaterial({color: DRESSING.tree.color})},
    rock: {geometry: rockGeometry, material: new THREE.MeshStandardMaterial({color: DRESSING.rock.color})},
  };
  const instance = new THREE.Object3D();
  const dressing = new THREE.Group();
  scene.add(dressing);
  let world, field, material, tiles, flyDistance = 0;
  let origin = [-half, -half];

  function sample(x, z) {
    const dx = (world.heightAt(x + spacing, z) - world.heightAt(x - spacing, z)) / (2 * spacing);
    const dz = (world.heightAt(x, z + spacing) - world.heightAt(x, z - spacing)) / (2 * spacing);
    // Sand lies over the other layers.
    const sand = field.sandWeightAt(x, z);
    const weights = {sand};
    TERRAIN_LAYERS.forEach((name, layer) => { weights[name] = field.layerWeightAt(x, z, layer) * (1 - sand); });
    world.weightsAt(x, z).forEach((share, index) => { weights['biome' + index] = share; });
    return {dx, dz, weights};
  }

  function clearDressing() {
    for (const mesh of [...dressing.children]) {
      dressing.remove(mesh);
      mesh.dispose();
    }
  }

  function placeDressing() {
    clearDressing();
    const placements = {tree: [], rock: []};
    for (const {mesh} of tiles.tiles) {
      const {x: centerX, z: centerZ} = mesh.position;
      const tileX = Math.floor(centerX / GRID.tileSize);
      const tileZ = Math.floor(centerZ / GRID.tileSize);
      const random = seededRandom(settings.dressingSeed ^ Math.imul(tileX, DRESSING.hashX) ^ Math.imul(tileZ, DRESSING.hashZ));
      for (let i = 0; i < DRESSING.attemptsPerTile; i++) {
        const x = centerX + (random() - .5) * GRID.tileSize;
        const z = centerZ + (random() - .5) * GRID.tileSize;
        const chance = random(), species = random(), yaw = random() * Math.PI * 2;
        const scale = THREE.MathUtils.lerp(DRESSING.minScale, DRESSING.maxScale, random());
        if (chance >= settings.density || (world.routeX && Math.abs(x - world.routeX(z)) < DRESSING.routeClearance)) continue;
        const {dx, dz, weights} = sample(x, z);
        const tree = species < weights.forest && Math.hypot(dx, dz) <= DRESSING.tree.maxSlope;
        if (tree || species > 1 - weights.rock * DRESSING.rock.rate) {
          placements[tree ? 'tree' : 'rock'].push({x, z, yaw, scale});
        }
      }
    }
    for (const [kind, points] of Object.entries(placements)) {
      if (!points.length) continue;
      const {geometry, material} = props[kind];
      const mesh = new THREE.InstancedMesh(geometry, material, points.length);
      points.forEach(({x, z, yaw, scale}, index) => {
        instance.position.set(x, field.heightAt(x, z), z);
        instance.rotation.y = yaw;
        instance.scale.setScalar(scale);
        instance.updateMatrix();
        mesh.setMatrixAt(index, instance.matrix);
      });
      dressing.add(mesh);
    }
  }

  function disposeTerrain() {
    tiles?.dispose();
    material?.dispose();
    field?.dispose();
  }

  function createMaterial() {
    return createTerrainMaterial({}, {field, layerArray: textures.layerArray, layerDetailArray: textures.layerDetailArray, detailNormal: textures.detail, appearance});
  }

  function windowOrigin(position) {
    return settings.infinite ? terrainWindowOrigin(position, GRID) : [-half, -half];
  }

  function regenerate() {
    const {seed, regionSize, blend, wander} = settings;
    world = createTerrainWorld({seed, biomes: worldBiomes, map: settings.handPlaced ? map : undefined, regionSize, blend, wander});
    buildWindow(windowOrigin(camera.position));
  }

  function buildWindow(nextOrigin) {
    disposeTerrain();
    origin = nextOrigin;
    const heights = Float32Array.from({length: resolution ** 2}, (_, index) =>
      world.heightAt(origin[0] + index % resolution * spacing, origin[1] + Math.floor(index / resolution) * spacing));
    field = createTerrainField({origin, size: [span, span], resolution: [resolution, resolution],
      heights, seed: settings.seed, rules: worldBiomes[0].paint, paintAt: worldBiomes.length > 1 ? world.paintAt : undefined});
    material = createMaterial();
    tiles = createValleyTiles({field, scene, material, sample, config: GRID, biomeColors: settings.view === VIEWS[2] ? biomeColors.slice(0, worldBiomes.length) : layerColors, origin});
    placeDressing();
    drawMap();
  }

  const $error = document.getElementById('error');
  const $map = document.getElementById('biome-map'), $mapHelp = document.getElementById('biome-map-help');
  const mapContext = $map.getContext('2d');
  const css = color => '#' + color.toString(16).padStart(6, '0');
  // The map shows each region's biome number: painted ones solid, seed-drawn ones faint, and the terrain window.
  function drawMap() {
    $mapHelp.hidden = !settings.handPlaced;
    $map.style.display = settings.handPlaced ? 'block' : 'none';
    if (!settings.handPlaced) return;
    const cell = $map.width / map.columns;
    mapContext.clearRect(0, 0, $map.width, $map.height);
    mapContext.font = MAP.font; mapContext.textAlign = 'center'; mapContext.textBaseline = 'middle';
    for (let row = 0; row < map.rows; row++) for (let column = 0; column < map.columns; column++) {
      const painted = map.cells[row * map.columns + column];
      const index = world.regionBiome(column - Math.floor(map.columns / 2), row - Math.floor(map.rows / 2));
      mapContext.globalAlpha = painted === WORLD_MAP_AUTO ? MAP.autoAlpha : 1;
      mapContext.fillStyle = css(BIOME_SWATCHES[index]);
      mapContext.fillRect(column * cell + 1, row * cell + 1, cell - 2, cell - 2);
      mapContext.fillStyle = MAP.ink;
      mapContext.fillText(index + 1, (column + .5) * cell, (row + .5) * cell);
    }
    mapContext.globalAlpha = 1;
    const toMap = (coordinate, count) => (coordinate / settings.regionSize + Math.floor(count / 2)) * cell;
    mapContext.strokeStyle = MAP.windowColor;
    mapContext.strokeRect(toMap(origin[0], map.columns), toMap(origin[1], map.rows), span / settings.regionSize * cell, span / settings.regionSize * cell);
  }
  function paintMap(event) {
    const bounds = $map.getBoundingClientRect();
    const column = Math.floor((event.clientX - bounds.left) / bounds.width * map.columns);
    const row = Math.floor((event.clientY - bounds.top) / bounds.height * map.rows);
    if (column < 0 || row < 0 || column >= map.columns || row >= map.rows) return;
    const value = event.shiftKey ? WORLD_MAP_AUTO : worldBiomes.indexOf(biome);
    if (map.cells[row * map.columns + column] === value) return;
    map.cells[row * map.columns + column] = value;
    rebuild();
  }
  const mapEvents = new AbortController();
  $map.addEventListener('pointerdown', paintMap, {signal: mapEvents.signal});
  $map.addEventListener('pointermove', event => { if (event.buttons & 1) paintMap(event); }, {signal: mapEvents.signal});
  regenerate();
  const gui = createBenchPanel('Terrain generation');
  const presets = Object.fromEntries(Object.values(TERRAIN_BIOMES).map(entry => [entry.label, entry.id]));
  const report = error => { $error.hidden = !error; $error.textContent = error?.message ?? ''; };
  // Rebuilds the terrain from the edited biome. A biome the validation refuses is reported and not built.
  function rebuild() {
    try { regenerate(); report(); } catch (error) { report(error); }
  }
  async function applyTextures(sets) {
    const next = await loadTextures(sets);
    material.setLayerTextures({layerArray: next.layerArray, layerDetailArray: next.layerDetailArray, detailNormal: next.detail});
    disposeTextures(textures);
    textures = next;
  }
  const refreshTextures = () => applyTextures(palette()).then(rebuild, report);
  gui.add(settings, 'seed').listen().onFinishChange(value => {
    settings.seed = Number.isSafeInteger(Math.trunc(value)) ? Math.trunc(value) : SEED;
    rebuild();
  });
  const nextSeed = seed => (seed + 1) >>> 0;
  gui.add({reroll() { settings.seed = nextSeed(settings.seed); rebuild(); }}, 'reroll').name('Reroll terrain');

  // The biome editor: relief recipe, paint rules and texture sets of the biome in hand. Rebuilt when the biome or the
  // list of relief shapes changes.
  const worldFolder = gui.addFolder('World');
  const biomeFolder = gui.addFolder('Biome');
  const clear = folder => { for (const child of [...folder.children]) child.destroy(); };
  const biomeName = index => `${index + 1} · ${worldBiomes[index].label}`;
  // The world's list of biomes and how they are laid out. Rebuilt when the list changes.
  function mountWorld() {
    clear(worldFolder);
    const editing = worldBiomes.indexOf(biome);
    const choice = {edit: editing, add: ''};
    worldFolder.add(choice, 'edit', Object.fromEntries(worldBiomes.map((entry, index) => [biomeName(index), index]))).name('Edit biome').onChange(index => {
      biome = worldBiomes[index];
      mountEditor();
    });
    if (worldBiomes.length < WORLD_MAX_BIOMES) {
      worldFolder.add(choice, 'add', {'Add a biome…': '', ...presets}).name('Add').onChange(id => {
        if (!id) return;
        worldBiomes.push(biome = cloneBiome(id));
        mountWorld(); mountEditor(); rebuild();
      });
    }
    if (worldBiomes.length > 1) {
      worldFolder.add({remove() {
        const removed = worldBiomes.indexOf(biome);
        worldBiomes.splice(removed, 1);
        // Regions painted with the removed biome go back to the seed; later biomes move down one place.
        map.cells = map.cells.map(cell => cell === removed ? WORLD_MAP_AUTO : cell > removed ? cell - 1 : cell);
        biome = worldBiomes[Math.min(removed, worldBiomes.length - 1)];
        mountWorld(); mountEditor();
        if (removed === 0) refreshTextures(); else rebuild();
      }}, 'remove').name('Remove edited biome');
    }
    for (const [key, {label, min, max, step}] of Object.entries(WORLD_FIELDS)) worldFolder.add(settings, key, min, max, step).name(label).onFinishChange(rebuild);
    worldFolder.add(settings, 'handPlaced').name('Hand-placed map').onChange(rebuild);
  }
  mountWorld();
  function mountEditor() {
    clear(biomeFolder);
    const first = biome === worldBiomes[0];
    biomeFolder.add({preset: ''}, 'preset', {'Load a preset…': '', ...presets}).name(biomeName(worldBiomes.indexOf(biome))).onChange(id => {
      if (!id) return;
      worldBiomes[worldBiomes.indexOf(biome)] = biome = cloneBiome(id);
      mountWorld(); mountEditor();
      if (first) refreshTextures(); else rebuild();
    });
    const reliefFolder = biomeFolder.addFolder('Relief (applied top to bottom)');
    biome.relief.forEach((entry, index) => {
      const spec = RELIEF_SHAPES[entry.shape];
      const folder = reliefFolder.addFolder(`${index + 1} · ${spec.label}`);
      if (index > 0) folder.close();
      for (const [key, {label, min, max, step}] of Object.entries(spec.fields)) folder.add(entry, key, min, max, step).name(label).onFinishChange(rebuild);
      const reorder = edit => () => { edit(); mountEditor(); rebuild(); };
      if (index > 0) folder.add({up: reorder(() => biome.relief.splice(index - 1, 2, entry, biome.relief[index - 1]))}, 'up').name('Move up');
      if (biome.relief.length > 1) folder.add({remove: reorder(() => biome.relief.splice(index, 1))}, 'remove').name('Remove shape');
    });
    if (biome.relief.length < RELIEF_MAX_SHAPES) {
      const shapes = Object.fromEntries(Object.entries(RELIEF_SHAPES).map(([name, spec]) => [spec.label, name]));
      const add = {shape: ''};
      reliefFolder.add(add, 'shape', {'Add a shape…': '', ...shapes}).name('Add').onChange(name => {
        if (!name) return;
        biome.relief.push(reliefShape(name));
        mountEditor(); rebuild();
      });
    }
    const paintFolder = biomeFolder.addFolder('Paint rules').close();
    for (const [key, {label, min, max, step}] of Object.entries(TERRAIN_PAINT_FIELDS)) paintFolder.add(biome.paint, key, min, max, step).name(label).onFinishChange(rebuild);
    // Only the first biome's sets are shown: the world shares them.
    if (first) textureSetControls(biomeFolder, {sets: biome.textures, catalogue: TERRAIN_TEXTURE_SETS, onChange: applyTextures});
  }
  mountEditor();
  const copy = value => () => {
    try { worldBiomes.forEach(validateBiome); report(); } catch (error) { report(error); return; }
    navigator.clipboard.writeText(JSON.stringify(value(), null, 2)).catch(report);
  };
  gui.add({copy: copy(() => biome)}, 'copy').name('Copy edited biome as JSON');
  gui.add({copy: copy(() => {
    const {seed, regionSize, blend, wander} = settings;
    return {seed, regionSize, blend, wander, biomes: worldBiomes, ...(settings.handPlaced && {map})};
  })}, 'copy').name('Copy world as JSON');
  const view = gui.addFolder('View and streaming');
  view.add(settings, 'infinite').name('Infinite streaming').onChange(rebuild);
  view.add(settings, 'density', ...CONTROLS.density).name('Dressing density').onFinishChange(placeDressing);
  view.add({reroll() { settings.dressingSeed = nextSeed(settings.dressingSeed); placeDressing(); }}, 'reroll').name('Reroll dressing');
  view.add(settings, 'view', VIEWS).name('Show').onChange(() => buildWindow(origin));
  view.add(settings, 'lod').name('Dynamic LOD');
  view.add(settings, 'wireframe').name('LOD wireframe');
  view.add(settings, 'flyover').name('Flyover').onChange(enabled => {
    orbit.enabled = !enabled;
    if (enabled) flyDistance = 0;
    else orbit.update();
  });

  const status = document.getElementById('status');
  const unbind = bindResize(renderer, camera);
  let lastStatus = -Infinity;
  const routeLength = span - 2 * VIEW.edgeBuffer;
  function fly(dt) {
    flyDistance += dt * VIEW.speed;
    if (!settings.infinite) flyDistance %= 2 * routeLength;
    const forward = settings.infinite || flyDistance < routeLength;
    const z = -routeLength / 2 + (forward ? flyDistance : 2 * routeLength - flyDistance);
    const routeX = world.routeX ?? (() => 0);
    const x = routeX(z);
    const altitude = VIEW.low + (settings.infinite ? 0 : VIEW.rise * Math.sin(Math.PI * flyDistance / (2 * routeLength)) ** 2);
    const targetZ = z + (forward ? VIEW.lookAhead : -VIEW.lookAhead);
    camera.position.set(x, world.heightAt(x, z) + altitude, z);
    camera.lookAt(routeX(targetZ), world.heightAt(routeX(targetZ), targetZ) + VIEW.low, targetZ);
  }
  startFrameLoop(renderer, (dt, now) => {
    if (settings.flyover) fly(dt);
    else orbit.update();
    const nextOrigin = windowOrigin(camera.position);
    if (nextOrigin.some((coordinate, axis) => coordinate !== origin[axis])) buildWindow(nextOrigin);
    stage.update(camera);
    const counts = tiles.update(camera, {...settings, surfaceMaterial: settings.view === VIEWS[0] ? material : biomeMaterial});
    if (now - lastStatus >= STATUS_REFRESH_MS) {
      lastStatus = now;
      status.textContent = 'Tiles · ' + counts.map((count, level) => 'LOD ' + level + ': ' + count).join(' · ')
        + (settings.view === VIEWS[1] ? '\nLayer colours · ' + LAYER_NAMES.join(', ') : '')
        + (worldBiomes.length > 1 ? '\nWorld · ' + worldBiomes.map((entry, index) => biomeName(index)).join(', ') + '\nTextures · shared, from biome 1' : '')
        + (missingSets.length ? '\nTexture sets not bundled, default used · ' + missingSets.join(', ') + ' · run npm run textures:fetch' : '');
    }
    renderer.render(scene, camera);
  });
  onLeave(() => {
    renderer.setAnimationLoop(null);
    unbind();
    orbit.dispose();
    gui.destroy();
    mapEvents.abort();
    disposeTerrain();
    clearDressing();
    for (const {geometry, material} of Object.values(props)) { geometry.dispose(); material.dispose(); }
    disposeTextures(textures);
    biomeMaterial.dispose();
    stage.dispose();
    renderer.dispose();
  });
}
