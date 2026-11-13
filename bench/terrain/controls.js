import {OCEAN_COAST_WET_DEFAULTS, SNOW_FIELDS, TERRAIN_LAYERS, TERRAIN_PAINT_DEFAULTS, TERRAIN_PAINT_FIELDS} from '../../src/terrain/index.js';

export function terrainControls(gui, {rules, appearance, onLayersChanged}) {
  const automatic = gui.addFolder('Automatic layers');
  const primary = [
    ['rockSlope', 'Rock slope', .2, 2, .05],
    ['snowLine', 'Snow line · m', -2, 22, .5],
    ['mudBelow', 'Mud below · m', -3, 6, .1],
    ['forestCover', 'Forest floor coverage', 0, 1, .01],
    ['sandBelow', 'Sand below · m', -7, 22, .1],
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
  appearanceControls(gui, appearance);
}

// Texture and material look shared by every terrain material (createTerrainAppearance).
export function appearanceControls(gui, appearance, title = 'Triplanar textures') {
  const textures = gui.addFolder(title);
  for (const [key, label, min, max, step] of [
    ['rockScale', 'Rock tiling', .05, 1.2, .01],
    ['tiling', 'Tiling', .1, 2, .05],
    ['sharpness', 'Blend sharpness', 1, 8, .25],
    ['antiTiling', 'Break up repetition', 0, 1, .05],
    ['detailStrength', 'Detail normal strength', 0, 2, .05],
    ['heightBlend', 'Texture height blend', 0, 1, .05],
    ['edgeSharpness', 'Junction sharpness', 0, 1, .01],
    ['edgeBreakup', 'Junction break-up', 0, 1, .01],
    ['layerDetail', 'Per-layer normal and roughness', 0, 1, .01],
  ]) {
    textures.add(appearance[key], 'value', min, max, step).name(label);
  }
  return textures;
}

// Snow layer settings (field.snowSettings). The track settings act on the next track; the others re-lay the snow.
const SNOW_TRACK_KEYS = ['packedShare', 'rimShare', 'rimMaxRise'];
export function snowBodyControls(gui, {field, onRelay}) {
  const folder = gui.addFolder('Snow body (re-lays snow)');
  const values = {...field.snowSettings};
  for (const [key, spec] of Object.entries(SNOW_FIELDS)) {
    if (SNOW_TRACK_KEYS.includes(key)) continue;
    folder.add(values, key, spec.min, spec.max, spec.step).name(spec.label).onFinishChange(() => {
      try {
        field.configureSnow({[key]: values[key]});
        onRelay();
      } catch (error) {
        console.warn(error.message);
        Object.assign(values, field.snowSettings);
        folder.controllers.forEach(controller => controller.updateDisplay());
      }
    });
  }
  return folder;
}

// How deep contacts sink into snow. A load is the share of the packable depth pressed out: 1 packs the snow fully,
// down to the 'packed snow left' share of the fresh depth.
export function snowTrackControls(gui, {field, paint, footstep, contact}) {
  const folder = gui.addFolder('Snow tracks');
  folder.add(paint, 'radius', .2, 2, .05).name('Painted track radius · m');
  folder.add(paint, 'load', 0, 1, .01).name('Painted track sink');
  folder.add(footstep, 'load', 0, 1, .01).name('Footstep sink');
  folder.add(footstep, 'spacing', .3, 1.2, .01).name('Footstep stride · m');
  folder.add(contact, 'load', 0, 1, .01).name('Rolling ball sink');
  folder.add(contact, 'impactLoad', 0, 1, .01).name('Ball impact sink');
  const settings = {...field.snowSettings};
  for (const key of SNOW_TRACK_KEYS) {
    const spec = SNOW_FIELDS[key];
    folder.add(settings, key, spec.min, spec.max, spec.step).name(spec.label).onChange(value => field.configureSnow({[key]: value}));
  }
  return folder;
}

// One dropdown per layer over the texture catalogue. onChange(sets) loads and applies them; a set that fails to load
// is reported in the folder title and the dropdown returns to the set in use.
export function textureSetControls(gui, {sets, catalogue, onChange}) {
  const title = 'Texture sets';
  const folder = gui.addFolder(title).close();
  const labels = Object.fromEntries(Object.values(catalogue).map(set => [set.label, set.id]));
  const applied = {...sets};
  let busy = false;
  for (const layer of Object.keys(sets)) {
    const controller = folder.add(sets, layer, labels).name(layer).onChange(async () => {
      if (busy) return;
      busy = true;
      folder.title(`${title} · loading…`);
      try {
        await onChange({...sets});
        Object.assign(applied, sets);
        folder.title(title);
      } catch (error) {
        Object.assign(sets, applied);
        folder.title(`${title} · ${error.message}`);
      } finally {
        busy = false;
        folder.controllersRecursive().forEach(item => item.updateDisplay());
      }
    });
    controller.domElement.title = 'Texture set of the ' + layer + ' layer';
  }
  return folder;
}

// Marks a rolling or landing body leaves in bare mud and sand (CONTACT_SURFACES.mud and .sand).
export function groundTrackControls(gui, {mud, sand}) {
  const folder = gui.addFolder('Mud and sand tracks').close();
  for (const [name, contact] of [['Mud', mud], ['Sand', sand]]) {
    folder.add(contact, 'print', 0, .3, .005).name(`${name} rolling rut depth · m`);
    folder.add(contact, 'impact', 0, .6, .01).name(`${name} impact depth · m`);
    folder.add(contact, 'rimShare', 0, 1, .01).name(`${name} pushed to track rims`);
  }
  return folder;
}

// Snow shading (createSnowLook). Colours are edited as hex strings and written to the shared uniforms.
export function snowLookControls(gui, look) {
  const folder = gui.addFolder('Snow look');
  const colors = {tint: '#' + look.tint.value.getHexString(), shadowTint: '#' + look.shadowTint.value.getHexString()};
  folder.addColor(colors, 'tint').name('Snow colour').onChange(value => look.tint.value.set(value));
  folder.addColor(colors, 'shadowTint').name('Shade tint').onChange(value => look.shadowTint.value.set(value));
  folder.add(look.scatter, 'value', 0, 1, .01).name('Light scatter');
  folder.add(look.sparkle, 'value', 0, 2, .01).name('Sparkle');
  folder.add(look.edgeBreakup, 'value', 0, 1, .01).name('Edge break-up');
  folder.add(look.trackRelief, 'value', 0, .2, .005).name('Track edge relief · m');
  return folder;
}

// Sand shading (createSandLook). The colour is edited as a hex string and written to the shared uniform.
export function sandLookControls(gui, look) {
  const folder = gui.addFolder('Sand look').close();
  const colors = {color: '#' + look.color.value.getHexString()};
  folder.addColor(colors, 'color').name('Sand colour').onChange(value => look.color.value.set(value));
  folder.add(look.variation, 'value', 0, 1, .01).name('Colour patches');
  folder.add(look.grain, 'value', 0, 1, .01).name('Grain');
  folder.add(look.rippleSize, 'value', .04, .6, .01).name('Ripple spacing · m');
  folder.add(look.rippleHeight, 'value', 0, 3, .01).name('Ripple height');
  folder.add(look.rippleHeading, 'value', 0, 360, 1).name('Wind heading · °');
  folder.add(look.sparkle, 'value', 0, 2, .01).name('Sparkle');
  folder.add(look.roughness, 'value', .5, 1, .01).name('Roughness');
  return folder;
}

// Runoff look (createRunoffLook): where streams start, how fast they run and the ripples they carry.
export function runoffControls(folder, look) {
  folder.add(look.sourceArea, 'value', .2, 30, .1).name('Stream starts at · m² drained');
  folder.add(look.fullArea, 'value', 2, 200, 1).name('Full stream at · m² drained');
  folder.add(look.rutSourceArea, 'value', 0, 10, .1).name('Stream in tracks from · m²');
  folder.add(look.speed, 'value', 0, 3, .05).name('Flow speed ×');
  folder.add(look.rippleSize, 'value', .03, .5, .005).name('Flow ripple size · m');
  folder.add(look.rippleStrength, 'value', 0, 3, .05).name('Flow ripple strength ×');
}

// Wet look shared by the terrain materials, how fast rain soaks and dries the ground, melt speed and puddle depth.
export function wetnessControls(gui, {look, rates, melt, puddle, onPuddleDepth}) {
  const folder = gui.addFolder('Wetness');
  folder.add(look.wetDarkening, 'value', 0, .8, .01).name('Wet darkening');
  folder.add(look.wetRoughness, 'value', .05, 1, .01).name('Wet roughness × (lower = glossier)');
  folder.add(look.puddleDarkening, 'value', 0, .8, .01).name('Puddle darkening');
  folder.add(look.rippleSize, 'value', .3, 3, .05).name('Rain ripple size ×');
  folder.add(look.rippleRate, 'value', .2, 3, .05).name('Rain ripple rate ×');
  folder.add(look.rippleStrength, 'value', 0, 3, .05).name('Rain ripple strength ×');
  folder.add(rates, 'wetting', .01, 1, .01).name('Soaking speed · /s');
  folder.add(rates, 'drying', 0, .5, .005).name('Drying speed · /s');
  folder.add(melt, 'metresPerSecond', .001, .1, .001).name('Melt speed · m/s');
  folder.add(puddle, 'maxDepth', .05, 1, .01).name('Puddle max depth · m').onFinishChange(onPuddleDepth);
  return folder;
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

