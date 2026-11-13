import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {bakeSkyMap, terrainGroundColor, BIOME_TEXTURE_DEFAULTS, CLIPMAP_DEFAULTS, cloneBiome, createSandLook, createSkyVisibility, createTerrainAppearance, createTerrainField, createTerrainClipmap, createTerrainWorld, createTerrainMaterial, DEFAULT_TERRAIN_BIOME, reliefShape, RELIEF_MAX_SHAPES, RELIEF_SHAPES, SNOW_DEFAULTS, TERRAIN_BIOMES, TERRAIN_LAYERS, TERRAIN_PALETTE_ROLES, TERRAIN_PAINT_FIELDS, validateBiome, WORLD_DEFAULTS, WORLD_FIELDS, WORLD_MAP_AUTO, WORLD_MAX_BIOMES, WORLD_PALETTE_MAX} from '../../src/terrain/index.js';
import {DEFAULT_TERRAIN_TEXTURES, TERRAIN_TEXTURE_SETS} from '../../src/terrain/textures.js';
import {seededRandom} from '../../src/core/index.js';
import {createDataTexture} from '../../src/core/data-texture.js';
import {createBasicStage} from '../../src/stage/index.js';
import {createSurfaceWeather, createTrackMask} from '../../src/surface/index.js';
import {createTerrainImpacts} from './impacts.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchPanel} from '../panel.js';
import {hasTerrainTextureSet, loadTerrainTextures} from './textures.js';
import {appearanceControls, sandLookControls, textureSetControls} from './controls.js';
import '../bench.css';

// Terrain rings around the focus (createTerrainClipmap) and the wireframe colour of each ring, inner to outer.
// A lighter terrain for a weak GPU: ?cells=128&levels=6 in the address overrides the defaults. ?normalDetail=4 bakes
// the lighting of the far relief finer still (1 turns the baking off).
const query = new URLSearchParams(location.search);
const CLIP = {...CLIPMAP_DEFAULTS, ...Object.fromEntries(['cells', 'levels', 'normalDetail'].filter(key => query.has(key)).map(key => [key, Number(query.get(key))]))};
const LOD_COLORS = [0xffffff, 0x83e4bc, 0xffce78, 0xa7b2ff, 0xff9d9d, 0x9de0ff, 0xd5a7ff, 0xc8ff9d, 0xffd79d, 0x9dffd0];
const VIEW = {
  fov: 48, near: .5, far: 6000, position: [110, 105, 145], target: [0, 8, 0],
  speed: 16, low: 7, lookAhead: 20,
};
// Trees and rocks are placed per square tile, in the tiles within `reach` tiles of the focus, at most `tilesPerFrame`
// new tiles a frame.
const DRESSING = {
  tileSize: 32, reach: 5, tilesPerFrame: 2,
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
// Stand-in water surface of the tool: a flat tinted sheet at the water level, as wide as the terrain.
const WATER = {color: 0x2f5d62, opacity: .8, roughness: .12, shoreWidth: .8};
// The play area: a square of deformable ground (a terrain field, 25 cm cells) laid in place of the rings where the
// test balls roll, so they leave ruts and marks. It sits on a `snap` m grid so its edge follows the cells of every
// ring; the rings leave it a square `margin` m smaller and it is drawn just in front of them. A ball is launched
// `ahead` m in front of the focus; one started within `edge` m of the border moves the area there (its marks are lost).
// Ground bounce: the ambient light from below follows the colour of the ground around the focus, read at
// `points` x `points` places over a square of `span` m, at each refresh of the status text.
const BOUNCE = {span: 80, points: 5};
const PLAY = {size: 64, cells: 256, snap: 16, margin: 1, skyTexel: 2, trackResolution: 512, trackContrast: .12, edge: 12, ahead: 6,
  ball: {radius: 1.5, minRadius: .4, maxRadius: 4, baseRadius: .72, speed: 7, color: 0x8d8478, roughness: .8}, fallBelow: 12,
  offset: -1};
// Rings moved per frame: one keeps the cost of a frame even; the others catch up on the next frames.
const RINGS_PER_FRAME = 1;
const VIEWS = ['Textures', 'Layer colours', 'Biome colours', 'LOD wireframe'];
// Tuned for a landscape rather than a close-up: softer junctions than the library default, and rock drawn large
// (one repeat every 12 m or so with the default tiling) so a cliff reads as one rock face and not as a pattern.
const TOOL_APPEARANCE = {edgeSharpness: .25, rockScale: .18};
// Hand-placed biome map: regions per side, and one debug colour per world biome (also the 'Biome colours' view).
const MAP = {columns: 8, rows: 8, autoAlpha: .35, focusColor: '#ffffff', focusRadius: 4, font: '11px sans-serif', ink: '#10201f'};
const BIOME_SWATCHES = [0x7fbf6a, 0xd9b36c, 0x8fa7d9, 0xc98383, 0x6fc7c1, 0xb48fd1, 0xe0d36a, 0x8c9a6b,
  0xd99a5b, 0x5f8fbf, 0xbf6f9f, 0x9fbf5f, 0x7f7fbf, 0xbfa07f, 0x5fbf8f, 0xbf5f5f];
const biomeColors = BIOME_SWATCHES.map((color, index) => ['biome' + index, new THREE.Color(color)]);
export async function mountValley() {
  const settings = {seed: SEED, dressingSeed: DRESSING.seed, density: .62, view: VIEWS[0], flyover: false,
    ...WORLD_DEFAULTS, handPlaced: false, water: true, ballRadius: PLAY.ball.radius, snow: false, wetness: 0, bounce: 1};
  // The world's biomes: copies of catalogue biomes, so the catalogue stays as shipped. `biome` is the one being edited.
  const worldBiomes = [cloneBiome(DEFAULT_TERRAIN_BIOME)];
  let biome = worldBiomes[0];
  const map = {columns: MAP.columns, rows: MAP.rows, cells: new Array(MAP.columns * MAP.rows).fill(WORLD_MAP_AUTO)};


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
  // Loads one slice per set of a world palette ({sets, roles}), keyed by its place in the palette.
  function loadPalette({sets, roles}) {
    missingSets = [...new Set(sets.filter(set => !hasTerrainTextureSet(set)))];
    const bundled = sets.map((set, slice) => hasTerrainTextureSet(set) ? set : BIOME_TEXTURE_DEFAULTS[roles[slice]]);
    return loadTerrainTextures(renderer, {layerDetail: true, sets: Object.fromEntries(bundled.map((set, slice) => ['slice' + slice, set])),
      roles: Object.fromEntries(roles.map((role, slice) => ['slice' + slice, role]))});
  }
  const disposeTextures = set => { for (const texture of Object.values(set ?? {})) texture?.dispose?.(); };   // the entries that are textures
  let textures, texturesKey = '';
  const appearance = createTerrainAppearance();
  appearance.shoreWidth.value = WATER.shoreWidth;
  const waterSheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({color: WATER.color, transparent: true, opacity: WATER.opacity, roughness: WATER.roughness, depthWrite: false}));
  waterSheet.renderOrder = 1;
  scene.add(waterSheet);
  for (const [key, value] of Object.entries(TOOL_APPEARANCE)) appearance[key].value = value;
  const sandLook = createSandLook();
  const overlays = LOD_COLORS.map(color => new THREE.MeshBasicMaterial({color, wireframe: true}));
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
  let world, clipmap, play;
  // Vertex colours are only worked out for the views that show them.
  const debugView = () => settings.view === VIEWS[1] || settings.view === VIEWS[2];
  // Time spent keeping the terrain around the focus, per frame, over the last status period.
  const timing = {total: 0, worst: 0, frames: 0, add(ms) { this.total += ms; this.worst = Math.max(this.worst, ms); this.frames++; },
    read() { const text = this.frames ? `${(this.total / this.frames).toFixed(1)} ms mean, ${this.worst.toFixed(1)} ms worst` : ''; this.total = this.worst = this.frames = 0; return text; }};
  const cutout = {value: new THREE.Vector4()};
  // Wetness and snow of the ground, shared by the rings and the play area.
  const weather = createSurfaceWeather();
  // Snow lies as a real layer on the play area, where the balls pack it down. The rings only show it, so they are
  // lifted by the mean depth of that layer and the two surfaces meet.
  function applySnow() {
    weather.set({wetness: settings.wetness, snow: settings.snow ? 1 : 0});
    if (clipmap) clipmap.group.position.y = settings.snow ? SNOW_DEFAULTS.driftDepth : 0;
    if (play && play.field.snowCover.value !== settings.snow) play.impacts.setSurface(settings.snow ? 'snow' : 'mud');
  }
  const ballMaterial = new THREE.MeshStandardMaterial({color: PLAY.ball.color, roughness: PLAY.ball.roughness});
  const focus = new THREE.Vector3();
  const layerTint = Object.fromEntries(layerColors), tintScratch = new THREE.Color();

  // Layer weights and ground slope at a point, as the terrain paints them.
  function sample(x, z) {
    const paintSample = world.sampleAt(x, z);
    const {layers, sand} = world.paintAt(paintSample);
    // Sand lies over the other layers.
    return {slope: paintSample.slope, height: paintSample.height, forest: layers[TERRAIN_LAYERS.indexOf('forest')] * (1 - sand), rock: layers[TERRAIN_LAYERS.indexOf('rock')] * (1 - sand)};
  }

  // Vertex colour of the debug views: the layers as painted, or the share of each biome.
  function tint(x, z, paint, color) {
    color.setRGB(0, 0, 0);
    if (settings.view === VIEWS[2]) {
      world.weightsAt(x, z).forEach((share, index) => { if (share > 0) color.add(tintScratch.copy(biomeColors[index][1]).multiplyScalar(share)); });
      return;
    }
    if (settings.view !== VIEWS[1]) return;
    TERRAIN_LAYERS.forEach((name, layer) => color.add(tintScratch.copy(layerTint[name]).multiplyScalar(paint.layers[layer] * (1 - paint.sand))));
    color.add(tintScratch.copy(layerTint.sand).multiplyScalar(paint.sand));
  }

  // Dressing tiles by "column,row": the instanced meshes of one tile, built as the focus comes within reach.
  const dressingTiles = new Map();
  function clearDressing() {
    for (const meshes of dressingTiles.values()) for (const mesh of meshes) { dressing.remove(mesh); mesh.dispose(); }
    dressingTiles.clear();
  }

  function dressTile(column, row) {
    const size = DRESSING.tileSize, placements = {tree: [], rock: []};
    const random = seededRandom(settings.dressingSeed ^ Math.imul(column, DRESSING.hashX) ^ Math.imul(row, DRESSING.hashZ));
    for (let i = 0; i < DRESSING.attemptsPerTile; i++) {
      const x = (column + random()) * size, z = (row + random()) * size;
      const chance = random(), species = random(), yaw = random() * Math.PI * 2;
      const scale = THREE.MathUtils.lerp(DRESSING.minScale, DRESSING.maxScale, random());
      if (chance >= settings.density || (world.routeX && Math.abs(x - world.routeX(z)) < DRESSING.routeClearance)) continue;
      const ground = sample(x, z);
      if (world.waterLevel !== null && ground.height < world.waterLevel) continue;
      const tree = species < ground.forest && ground.slope <= DRESSING.tree.maxSlope;
      if (tree || species > 1 - ground.rock * DRESSING.rock.rate) placements[tree ? 'tree' : 'rock'].push({x, y: ground.height, z, yaw, scale});
    }
    return Object.entries(placements).filter(([, points]) => points.length).map(([kind, points]) => {
      const mesh = new THREE.InstancedMesh(props[kind].geometry, props[kind].material, points.length);
      points.forEach(({x, y, z, yaw, scale}, index) => {
        instance.position.set(x, y, z);
        instance.rotation.y = yaw;
        instance.scale.setScalar(scale);
        instance.updateMatrix();
        mesh.setMatrixAt(index, instance.matrix);
      });
      mesh.frustumCulled = false;   // instances spread over the tile, away from the geometry's own bounds
      dressing.add(mesh);
      return mesh;
    });
  }

  // Keeps the tiles within reach of the focus dressed, nearest first, and drops the others.
  function updateDressing() {
    const size = DRESSING.tileSize, reach = DRESSING.reach;
    const centerColumn = Math.floor(focus.x / size), centerRow = Math.floor(focus.z / size);
    for (const [key, meshes] of dressingTiles) {
      const [column, row] = key.split(',').map(Number);
      if (Math.max(Math.abs(column - centerColumn), Math.abs(row - centerRow)) <= reach) continue;
      for (const mesh of meshes) { dressing.remove(mesh); mesh.dispose(); }
      dressingTiles.delete(key);
    }
    let built = 0;
    for (let ring = 0; ring <= reach && built < DRESSING.tilesPerFrame; ring++) {
      for (let row = centerRow - ring; row <= centerRow + ring && built < DRESSING.tilesPerFrame; row++) {
        for (let column = centerColumn - ring; column <= centerColumn + ring && built < DRESSING.tilesPerFrame; column++) {
          const key = column + ',' + row;
          if (Math.max(Math.abs(column - centerColumn), Math.abs(row - centerRow)) !== ring || dressingTiles.has(key)) continue;
          dressingTiles.set(key, dressTile(column, row));
          built++;
        }
      }
    }
  }

  function disposePlay() {
    if (!play) return;
    play.impacts.dispose();
    scene.remove(play.mesh);
    play.material.dispose(); play.field.dispose(); play.tracks.dispose(); play.sky.map.dispose();
    play = undefined;
    cutout.value.set(0, 0, 0, 0);
  }

  // Lays the play area around a point. Its ground is sampled and painted from the world, like the rings.
  function createPlay(x, z) {
    disposePlay();
    const {size, cells, snap, margin} = PLAY, n = cells + 1, step = size / cells;
    const origin = [Math.round((x - size / 2) / snap) * snap, Math.round((z - size / 2) / snap) * snap];
    let lowest = Infinity;
    const heights = Float32Array.from({length: n * n}, (_, index) => {
      // Asked with the cell of the innermost ring, so the play area carries the same fine relief as the ground around it.
      const height = world.heightAt(origin[0] + index % n * step, origin[1] + Math.floor(index / n) * step, step);
      lowest = Math.min(lowest, height);
      return height;
    });
    const field = createTerrainField({origin, size: [size, size], resolution: [n, n], heights, seed: settings.seed, rules: worldBiomes[0].paint,
      paintAt: sample => world.paintAt(world.sampleAt(sample.x, sample.z)), paletteSize: world.palette.size, snowTrackRims: true});
    const tracks = createTrackMask({origin, size: [size, size], resolution: PLAY.trackResolution, directional: true});
    // The play area's own sky map, measured like the rings' so the ambient light does not change at its edge.
    const skySide = size / PLAY.skyTexel + 1;
    const sky = {map: createDataTexture(bakeSkyMap(createSkyVisibility(world.heightAt), origin, size, skySide), skySide, skySide, {format: THREE.RedFormat, filter: 'linear'}), bounds: field.bounds};
    const material = createTerrainMaterial({polygonOffset: true, polygonOffsetFactor: PLAY.offset, polygonOffsetUnits: PLAY.offset}, {
      field, palette: {...world.palette, means: textures.means}, layerArray: textures.layerArray, layerDetailArray: textures.layerDetailArray,
      detailNormal: textures.detail, appearance, sandLook, weather, tracks, trackContrast: PLAY.trackContrast, sky});
    const mesh = new THREE.Mesh(field.geometry, material);
    mesh.receiveShadow = true;
    scene.add(mesh);
    cutout.value.set(origin[0] + margin, origin[1] + margin, size - 2 * margin, size - 2 * margin);
    const impacts = createTerrainImpacts({scene, field, tracks, material: ballMaterial, fallOutHeight: lowest - PLAY.fallBelow,
      surround: {heightAt: world.heightAt, lift: () => settings.snow ? SNOW_DEFAULTS.driftDepth : 0}});
    play = {field, tracks, material, mesh, impacts, origin, sky};
    applySnow();
  }

  // Rolls a ball from just ahead of the focus, away from the camera.
  function rollBall() {
    const heading = new THREE.Vector3().subVectors(focus, camera.position).setY(0);
    if (heading.lengthSq() === 0) heading.set(0, 0, 1);
    heading.normalize();
    const x = focus.x + heading.x * PLAY.ahead, z = focus.z + heading.z * PLAY.ahead;
    const inside = play && [x - play.origin[0], z - play.origin[1]].every(offset => offset > PLAY.edge && offset < PLAY.size - PLAY.edge);
    if (!inside) createPlay(x, z);
    play.impacts.launch('sphere', settings.snow ? 'snow' : 'mud', undefined, {position: [x, z], velocity: [heading.x * PLAY.ball.speed, heading.z * PLAY.ball.speed], scale: settings.ballRadius / PLAY.ball.baseRadius});
  }

  function disposeTerrain() {
    disposePlay();
    if (clipmap) { scene.remove(clipmap.group); clipmap.dispose(); }
    clipmap = undefined;
  }

  // Rebuilds the world and the terrain rings around the focus from the edited biomes. The textures are reloaded
  // when the world's palette of texture sets changed; a newer rebuild started meanwhile wins.
  let building = 0;
  async function regenerate() {
    const {seed, regionSize, blend, wander, waterLevel, water} = settings;
    const next = createTerrainWorld({seed, biomes: worldBiomes, map: settings.handPlaced ? map : undefined, regionSize, blend, wander, waterLevel, water});
    const build = ++building, key = next.palette.sets.join() + '|' + next.palette.roles.join();
    if (key !== texturesKey) {
      const loaded = await loadPalette(next.palette);
      if (build !== building) { disposeTextures(loaded); return; }
      disposeTerrain();
      disposeTextures(textures);
      textures = loaded; texturesKey = key;
    }
    world = next;
    disposeTerrain();
    clipmap = createTerrainClipmap({world, ...CLIP, tint: debugView() ? tint : undefined, createMaterial: field =>
      createTerrainMaterial({}, {field, palette: {...world.palette, means: textures.means}, layerArray: textures.layerArray, layerDetailArray: textures.layerDetailArray, detailNormal: textures.detail, appearance, sandLook, weather, cutout})});
    scene.add(clipmap.group);
    applySnow();
    clipmap.update(focus.x, focus.z);
    // The ground darkens where it meets the water; a dry world has no shore.
    waterSheet.visible = world.waterLevel !== null;
    waterSheet.scale.setScalar(clipmap.extent);
    appearance.shoreWetness.value = waterSheet.visible ? 1 : 0;
    if (waterSheet.visible) appearance.waterLevel.value = waterSheet.position.y = world.waterLevel;
    clearDressing();
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
    mapContext.strokeStyle = MAP.focusColor;
    mapContext.beginPath();
    mapContext.arc(toMap(focus.x, map.columns), toMap(focus.z, map.rows), MAP.focusRadius, 0, Math.PI * 2);
    mapContext.stroke();
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
  focus.copy(orbit.target);
  await regenerate();
  const gui = createBenchPanel('Terrain generation');
  const presets = Object.fromEntries(Object.values(TERRAIN_BIOMES).map(entry => [entry.label, entry.id]));
  const report = error => { $error.hidden = !error; $error.textContent = error?.message ?? ''; };
  // Rebuilds the terrain from the edited biome. A biome the validation refuses is reported and not built.
  const rebuild = () => regenerate().then(() => report(), report);
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
        rebuild();
      }}, 'remove').name('Remove edited biome');
    }
    for (const [key, {label, min, max, step}] of Object.entries(WORLD_FIELDS)) worldFolder.add(settings, key, min, max, step).name(label).onFinishChange(rebuild);
    worldFolder.add(settings, 'water').name('Water (lakes, rivers, sea)').onChange(rebuild);
    worldFolder.add(settings, 'handPlaced').name('Hand-placed map').onChange(rebuild);
  }
  mountWorld();
  function mountEditor() {
    clear(biomeFolder);
    biomeFolder.add({preset: ''}, 'preset', {'Load a preset…': '', ...presets}).name(biomeName(worldBiomes.indexOf(biome))).onChange(id => {
      if (!id) return;
      worldBiomes[worldBiomes.indexOf(biome)] = biome = cloneBiome(id);
      mountWorld(); mountEditor();
      rebuild();
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
    textureSetControls(biomeFolder, {sets: biome.textures, catalogue: TERRAIN_TEXTURE_SETS, onChange: regenerate});
  }
  mountEditor();
  const copy = value => () => {
    try { worldBiomes.forEach(validateBiome); report(); } catch (error) { report(error); return; }
    navigator.clipboard.writeText(JSON.stringify(value(), null, 2)).catch(report);
  };
  gui.add({copy: copy(() => biome)}, 'copy').name('Copy edited biome as JSON');
  gui.add({copy: copy(() => {
    const {seed, regionSize, blend, wander, waterLevel, water} = settings;
    return {seed, regionSize, blend, wander, waterLevel, water, biomes: worldBiomes, ...(settings.handPlaced && {map})};
  })}, 'copy').name('Copy world as JSON');
  const materialFolder = appearanceControls(gui, appearance, 'Material').close();
  materialFolder.add(appearance.harmony, 'value', 0, 1, .01).name('Colour harmony between layers');
  const tints = materialFolder.addFolder('Layer target colours').close();
  TERRAIN_PALETTE_ROLES.forEach((role, index) => {
    const edit = {color: '#' + appearance.roleTints.value[index].getHexString()};
    tints.addColor(edit, 'color').name(role).onChange(value => appearance.roleTints.value[index].set(value));
  });
  materialFolder.add(appearance.bakedNormals, 'value', 0, 1, .01).name('Baked far relief lighting');
  materialFolder.add(appearance.skyOcclusion, 'value', 0, 1, .01).name('Sky occlusion (ambient in valleys)');
  materialFolder.add(settings, 'bounce', 0, 1, .01).name('Ground bounce (ambient from below)').onChange(updateBounce);
  materialFolder.add(appearance.farTiling.value, 'z', .05, 1, .01).name('Far texture size (1 = off)');
  materialFolder.add(appearance.farTiling.value, 'x', 10, 400, 5).name('Far textures from · m');
  materialFolder.add(appearance.farTiling.value, 'y', 20, 800, 5).name('Far textures fully at · m');
  materialFolder.add(appearance.macroVariation, 'value', 0, 1, .01).name('Large-scale colour variation');
  materialFolder.add(appearance.climateTint, 'value', 0, 1, .01).name('Dry-to-lush grass tint');
  for (const [key, label] of [['dryTint', 'Dry grass tint'], ['lushTint', 'Lush grass tint']]) {
    // The tints multiply the texture colour and may exceed 1: shown and edited as a colour at half strength.
    const edit = {color: '#' + appearance[key].value.clone().multiplyScalar(.5).getHexString()};
    materialFolder.addColor(edit, 'color').name(label).onChange(value => appearance[key].value.set(value).multiplyScalar(2));
  }
  sandLookControls(materialFolder, sandLook);
  const groundFolder = gui.addFolder('Ground state');
  groundFolder.add(settings, 'wetness', 0, 1, .01).name('Ground wetness').onChange(applySnow);
  groundFolder.add(settings, 'snow').name('Snow cover (3D where the balls roll)').onChange(applySnow);
  const playFolder = gui.addFolder('Test balls');
  playFolder.add(settings, 'ballRadius', PLAY.ball.minRadius, PLAY.ball.maxRadius, .1).name('Ball radius · m');
  playFolder.add({roll: () => { try { rollBall(); report(); } catch (error) { report(error); } }}, 'roll').name('Roll a ball from the focus');
  playFolder.add({clear: () => play?.impacts.reset()}, 'clear').name('Clear balls, ruts and marks');
  const view = gui.addFolder('View');
  view.add(settings, 'density', ...CONTROLS.density).name('Dressing density').onFinishChange(clearDressing);
  view.add({reroll() { settings.dressingSeed = nextSeed(settings.dressingSeed); clearDressing(); }}, 'reroll').name('Reroll dressing');
  view.add(settings, 'view', VIEWS).name('Show').onChange(() => { if (debugView()) clipmap.reshade(tint); });
  view.add(settings, 'flyover').name('Flyover').onChange(enabled => {
    orbit.enabled = !enabled;
    if (enabled) flyZ = focus.z;
    else { orbit.target.copy(focus); orbit.update(); }
  });

  const status = document.getElementById('status');
  const unbind = bindResize(renderer, camera);
  let lastStatus = -Infinity;
  let flyZ = 0;
  // Flies low along +Z, following the valley when the world has one.
  function fly(dt) {
    flyZ += dt * VIEW.speed;
    const routeX = world.routeX ?? (() => focus.x);
    const x = routeX(flyZ), targetZ = flyZ + VIEW.lookAhead;
    // Clear the ground ahead as well as below, or a steep rise would swallow the camera.
    const ahead = world.heightAt(routeX(targetZ), targetZ);
    camera.position.set(x, Math.max(world.heightAt(x, flyZ), ahead) + VIEW.low, flyZ);
    camera.lookAt(routeX(targetZ), ahead + VIEW.low, targetZ);
  }
  // The ground colour around the focus, into the stage's ambient light from below.
  const bounceColor = new THREE.Color(), bounceSample = new THREE.Color();
  function updateBounce() {
    if (!(settings.bounce > 0)) { stage.setGround(null); return; }
    const {span, points} = BOUNCE, palette = {...world.palette, means: textures.means};
    bounceColor.setRGB(0, 0, 0);
    for (let j = 0; j < points; j++) for (let i = 0; i < points; i++) {
      const x = focus.x + (i / (points - 1) - .5) * span, z = focus.z + (j / (points - 1) - .5) * span;
      bounceColor.add(terrainGroundColor(bounceSample, world.paintAt(world.sampleAt(x, z)), palette, appearance, sandLook.color.value));
    }
    stage.setGround(bounceColor.multiplyScalar(1 / (points * points)), settings.bounce);
  }
  const meters = value => value >= 1 ? value + ' m' : value * 100 + ' cm';
  startFrameLoop(renderer, (dt, now) => {
    if (settings.flyover) fly(dt);
    else orbit.update();
    // Detail follows what is looked at: the orbit target, or the camera when flying.
    focus.copy(settings.flyover ? camera.position : orbit.target);
    const started = performance.now();
    clipmap.update(focus.x, focus.z, RINGS_PER_FRAME);
    updateDressing();
    timing.add(performance.now() - started);
    play?.impacts.update(dt);
    weather.update(dt, null);
    waterSheet.position.x = focus.x; waterSheet.position.z = focus.z;
    stage.update(camera);
    for (const {meshes, material, level} of clipmap.rings) {
      const shown = settings.view === VIEWS[0] ? material : settings.view === VIEWS[3] ? overlays[level] : biomeMaterial;
      if (meshes[0].material !== shown) for (const mesh of meshes) mesh.material = shown;
    }
    if (now - lastStatus >= STATUS_REFRESH_MS) {
      lastStatus = now;
      updateBounce();
      if (settings.handPlaced) drawMap();
      status.textContent = `${clipmap.levels} rings · cells ${meters(clipmap.cellSize)} to ${meters(clipmap.rings.at(-1).cell)} · ${clipmap.extent} m across`
        + (settings.view === VIEWS[1] ? '\nLayer colours · ' + LAYER_NAMES.join(', ') : '')
        + (worldBiomes.length > 1 ? '\nWorld · ' + worldBiomes.map((entry, index) => biomeName(index)).join(', ') : '')
        + `\nTexture sets in view · ${world.palette.sets.length} of ${WORLD_PALETTE_MAX}`
        + `\nTerrain upkeep per frame · ${timing.read()}`
        + (clipmap.bakePending ? `\nFar relief lighting · baking, ${clipmap.bakePending} points to go` : '')
        + (missingSets.length ? '\nTexture sets not bundled, default used · ' + missingSets.join(', ') + ' · run npm run textures:fetch' : '');
    }
    renderer.render(scene, camera);
  });
  window.terrainTool = {get world() { return world; }, get clipmap() { return clipmap; }, get play() { return play; }, focus, camera, orbit, scene, settings, appearance};
  onLeave(() => {
    renderer.setAnimationLoop(null);
    unbind();
    orbit.dispose();
    gui.destroy();
    mapEvents.abort();
    disposeTerrain();
    clearDressing();
    for (const {geometry, material} of Object.values(props)) { geometry.dispose(); material.dispose(); }
    for (const overlay of overlays) overlay.dispose();
    waterSheet.geometry.dispose(); waterSheet.material.dispose();
    ballMaterial.dispose();
    disposeTextures(textures);
    biomeMaterial.dispose();
    stage.dispose();
    renderer.dispose();
  });
}
