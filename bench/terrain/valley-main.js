import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createTerrainAppearance, createTerrainField, createTerrainMaterial, createProceduralTerrain, TERRAIN_LANDFORMS, terrainWindowOrigin, VALLEY_DEFAULTS} from '../../src/terrain/index.js';
import {seededRandom} from '../../src/core/index.js';
import {createBasicStage} from '../../src/stage/index.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchPanel} from '../panel.js';
import {loadTerrainTextures} from './textures.js';
import {createValleyTiles} from './valley-tiles.js';
import {mountTexturePicker} from './valley-textures.js';
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
const PAINT = {rockSlope: .64, snowLine: 40, mudBelow: -.9};
const BIOMES = {
  Temperate: {terrain: VALLEY_DEFAULTS, colors: [0xb3c870, 0x3b8153, 0x9d8ba0], labels: 'Grassland, woodland, rocky upland'},
  Alpine: {terrain: {relief: 46, valleyWidth: 24, woodland: .22}, paint: {snowLine: 22}, colors: [0x99ae80, 0x335c52, 0xcadce5], labels: 'Alpine meadow, conifers, snowy upland'},
  Dry: {terrain: {relief: 32, valleyWidth: 48, woodland: .08}, paint: {rockSlope: .38, snowLine: 80}, colors: [0xcbbb79, 0x7c8b52, 0xac8272], labels: 'Dry grassland, sparse scrub, exposed rock'},
  Wetland: {terrain: {relief: 12, valleyWidth: 54, woodland: .65}, paint: {mudBelow: 1.4}, colors: [0xa9b775, 0x3a8066, 0x8a9281], labels: 'Wet meadow, wet woodland, rocky ground'},
};
const REGIONAL_LANDFORMS = ['Desert', 'Ice', 'Regions'];
const REGION_COLORS = {desert: 0xc8a66b, ice: 0xc9e0ee};
const BIOME_KEYS = ['grassland', 'woodland', 'upland'];
const CONTROLS = {relief: [8, 54, 1], valleyWidth: [18, 64, 1], woodland: [0, 1, .01], density: [0, 1, .01]};
const span = GRID.tileSize * GRID.tileCount, half = span / 2;
const cells = GRID.tileCount * GRID.cells[0], resolution = cells + 1, spacing = span / cells;
export async function mountValley() {
  const settings = {...VALLEY_DEFAULTS, biome: 'Temperate', landform: 'Valley', infinite: false, dressingSeed: DRESSING.seed, density: .62, lod: true, wireframe: false, biomes: false, flyover: false};

  const renderer = benchRenderer();
  const scene = new THREE.Scene();
  const stage = createBasicStage({scene, ground: false});
  const camera = new THREE.PerspectiveCamera(VIEW.fov, innerWidth / innerHeight, VIEW.near, VIEW.far);
  camera.position.set(...VIEW.position);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(...VIEW.target);
  orbit.enableDamping = true;
  orbit.update();
  let textures = await loadTerrainTextures(renderer);
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
  let valley, field, material, tiles, flyDistance = 0;
  let origin = [-half, -half];

  function sample(x, z) {
    const dx = (valley.heightAt(x + spacing, z) - valley.heightAt(x - spacing, z)) / (2 * spacing);
    const dz = (valley.heightAt(x, z + spacing) - valley.heightAt(x, z - spacing)) / (2 * spacing);
    const weights = valley.biomeAt(x, z, valley.heightAt(x, z), Math.hypot(dx, dz));
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
        if (chance >= settings.density || (settings.landform === 'Valley' && Math.abs(x - valley.routeX(z)) < DRESSING.routeClearance)) continue;
        const {dx, dz, weights} = sample(x, z);
        const tree = species < weights.woodland && Math.hypot(dx, dz) <= DRESSING.tree.maxSlope;
        if (tree || species > 1 - weights.upland * DRESSING.rock.rate) {
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
    valley = createProceduralTerrain(settings);
    buildWindow(windowOrigin(camera.position));
  }

  function buildWindow(nextOrigin) {
    disposeTerrain();
    origin = nextOrigin;
    const biome = BIOMES[settings.biome];
    const biomeColors = BIOME_KEYS.map((name, index) => [name, new THREE.Color(biome.colors[index])]);
    const regionalPaint = REGIONAL_LANDFORMS.includes(settings.landform);
    if (regionalPaint) {
      for (const [name, tint] of Object.entries(REGION_COLORS)) biomeColors.push([name, new THREE.Color(tint)]);
    }
    const heights = Float32Array.from({length: resolution ** 2}, (_, index) =>
      valley.heightAt(origin[0] + index % resolution * spacing, origin[1] + Math.floor(index / resolution) * spacing));
    const paintAt = regionalPaint ? ({x, z, height, slope}) => {
      const weights = valley.biomeAt(x, z, height, slope);
      const {grassland, woodland, upland, desert, ice} = weights;
      return {layers: [grassland + desert, upland, ice, 0, woodland], sand: desert};
    } : undefined;
    field = createTerrainField({origin, size: [span, span], resolution: [resolution, resolution],
      heights, seed: settings.seed, paintAt, rules: {...PAINT, ...biome.paint}});
    material = createMaterial();
    tiles = createValleyTiles({field, scene, material, sample, config: GRID, biomeColors, origin});
    placeDressing();
  }

  regenerate();
  const disposePicker = mountTexturePicker(renderer, next => {
    material.dispose();
    for (const texture of Object.values(textures)) texture?.dispose();
    textures = next;
    material = createMaterial();
    settings.biomes = false;
    settings.wireframe = false;
  });
  const gui = createBenchPanel('Terrain generation');
  gui.add(settings, 'landform', TERRAIN_LANDFORMS).name('Landform').onChange(regenerate);
  gui.add(settings, 'infinite').name('Infinite streaming').onChange(regenerate);
  gui.add(settings, 'biome', Object.keys(BIOMES)).name('Biome preset').onChange(name => {
    const {seed, ...terrain} = BIOMES[name].terrain;
    Object.assign(settings, terrain);
    regenerate();
  });
  gui.add(settings, 'seed').listen().onFinishChange(value => {
    settings.seed = Number.isSafeInteger(Math.trunc(value)) ? Math.trunc(value) : VALLEY_DEFAULTS.seed;
    regenerate();
  });
  const nextSeed = seed => (seed + 1) >>> 0;
  gui.add({reroll() { settings.seed = nextSeed(settings.seed); regenerate(); }}, 'reroll').name('Reroll terrain');
  for (const name of ['relief', 'valleyWidth', 'woodland']) gui.add(settings, name, ...CONTROLS[name]).listen().onFinishChange(regenerate);
  gui.add(settings, 'density', ...CONTROLS.density).name('Dressing density').onFinishChange(placeDressing);
  gui.add({reroll() { settings.dressingSeed = nextSeed(settings.dressingSeed); placeDressing(); }}, 'reroll').name('Reroll dressing');
  gui.add(settings, 'biomes').name('Biome colors').listen();
  gui.add(settings, 'lod').name('Dynamic LOD');
  gui.add(settings, 'wireframe').name('LOD wireframe').listen();
  gui.add(settings, 'flyover').name('Flyover').onChange(enabled => {
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
    const x = valley.routeX(z);
    const altitude = VIEW.low + (settings.infinite ? 0 : VIEW.rise * Math.sin(Math.PI * flyDistance / (2 * routeLength)) ** 2);
    const targetZ = z + (forward ? VIEW.lookAhead : -VIEW.lookAhead);
    camera.position.set(x, valley.heightAt(x, z) + altitude, z);
    camera.lookAt(valley.routeX(targetZ), valley.heightAt(valley.routeX(targetZ), targetZ) + VIEW.low, targetZ);
  }
  startFrameLoop(renderer, (dt, now) => {
    if (settings.flyover) fly(dt);
    else orbit.update();
    const nextOrigin = windowOrigin(camera.position);
    if (nextOrigin.some((coordinate, axis) => coordinate !== origin[axis])) buildWindow(nextOrigin);
    stage.update(camera);
    const counts = tiles.update(camera, {...settings, surfaceMaterial: settings.biomes ? biomeMaterial : material});
    if (now - lastStatus >= STATUS_REFRESH_MS) {
      lastStatus = now;
      status.textContent = 'Tiles · ' + counts.map((count, level) => 'LOD ' + level + ': ' + count).join(' · ')
        + (settings.biomes ? ' | ' + (settings.landform === 'Regions' ? 'Desert, grassland, woodland, rocky upland, ice' : BIOMES[settings.biome].labels) : '');
    }
    renderer.render(scene, camera);
  });
  onLeave(() => {
    renderer.setAnimationLoop(null);
    unbind();
    orbit.dispose();
    gui.destroy();
    disposePicker();
    disposeTerrain();
    clearDressing();
    for (const {geometry, material} of Object.values(props)) { geometry.dispose(); material.dispose(); }
    for (const texture of Object.values(textures)) texture?.dispose();
    biomeMaterial.dispose();
    stage.dispose();
    renderer.dispose();
  });
}
