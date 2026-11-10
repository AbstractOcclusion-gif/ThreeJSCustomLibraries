import {OCEAN_COAST_WET_DEFAULTS, TERRAIN_LAYERS, TERRAIN_PAINT_DEFAULTS, TERRAIN_PAINT_FIELDS} from '../../src/terrain/index.js';

export function terrainControls(gui, {rules, appearance, onLayersChanged}) {
  const automatic = gui.addFolder('Automatic layers');
  const primary = [
    ['rockSlope', 'Rock slope', .2, 2, .05],
    ['snowLine', 'Snow line · m', -2, 22, .5],
    ['mudBelow', 'Mud below · m', -3, 6, .1],
    ['forestCover', 'Forest floor coverage', 0, 1, .01],
  ];
  for (const [key, label, min, max, step] of primary) {
    automatic.add(rules, key, min, max, step).name(label).onFinishChange(onLayersChanged);
  }
  const detail = automatic.addFolder('Layer detail').close();
  for (const [key, spec] of Object.entries(TERRAIN_PAINT_FIELDS)) {
    if (primary.some(([name]) => key === name)) continue;
    rules[key] ??= TERRAIN_PAINT_DEFAULTS[key];
    detail.add(rules, key, spec.min, spec.max, spec.step).name(spec.label).onFinishChange(onLayersChanged);
  }
  const textures = gui.addFolder('Triplanar textures');
  for (const [key, label, min, max, step] of [
    ['rockScale', 'Rock tiling', .15, 1.2, .01],
    ['tiling', 'Tiling', .1, 2, .05],
    ['sharpness', 'Blend sharpness', 1, 8, .25],
    ['antiTiling', 'Break up repetition', 0, 1, .05],
    ['detailStrength', 'Detail normal strength', 0, 2, .05],
    ['heightBlend', 'Texture height blend', 0, 1, .05],
  ]) {
    textures.add(appearance[key], 'value', min, max, step).name(label);
  }
}

export function shorelineControls(gui, appearance) {
  const folder = gui.addFolder('Shoreline');
  folder.add(appearance.shoreWidth, 'value', 0, 2, .05).name('Wet band · m');
  folder.add(appearance.shoreWetness, 'value', 0, 1, .05).name('Water wetness');
}

export function coastControls(gui, coast, caustics) {
  const folder = gui.addFolder('Coast');
  const wet = {...OCEAN_COAST_WET_DEFAULTS};
  const visibility = {on: coast.s.on};
  folder.add(visibility, 'on').name('Show island and seabed').onChange(on => coast.applySettings({on}));
  folder.add(wet, 'strength', 0, 1, .05).name('Wet sand').onChange(() => coast.applyWet(wet));
  folder.add(caustics.settings, 'strength', 0, 2, .05).name('Bed caustics');
  folder.close();
}

export function grassDensityControls(gui, {cover, defaults, stats, rebuild}) {
  const folder = gui.addFolder('Grass density by texture');
  for (const [layer, label] of [['grass', 'Meadow'], ['mud', 'Mud'], ['forest', 'Forest floor'], ['rock', 'Rock'], ['snow', 'Snow']]) {
    folder.add(cover, layer, 0, 100, 1).name(label + ' · %').onFinishChange(rebuild);
  }
  folder.add(cover, 'patchiness', 0, 1, .01).name('Patch contrast').onFinishChange(rebuild);
  folder.add(cover, 'patchSize', 2, 15, .5).name('Patch size · m').onFinishChange(rebuild);
  folder.add(stats, 'clumps').name('Placed clumps').disable().listen();
  folder.add({reset() {
    Object.assign(cover, defaults);
    rebuild();
    folder.controllers.forEach(controller => controller.updateDisplay());
  }}, 'reset').name('Reset grass settings');
}

// The baked layer map is byte-quantized. Normalize its interpolated weights
// so 100% coverage accepts all candidates when patch contrast is zero.
export function grassCoverageAt(field, x, z, cover, patch) {
  let density = 0, total = 0, strongest = -1, dominant;
  for (let index = 0; index < TERRAIN_LAYERS.length; index++) {
    const layer = TERRAIN_LAYERS[index], weight = field.layerWeightAt(x, z, index);
    density += weight * cover[layer];
    total += weight;
    if (weight > strongest) { strongest = weight; dominant = layer; }
  }
  if (!total || !cover[dominant]) return 0;
  return density / (100 * total) * (1 - cover.patchiness * patch);
}

