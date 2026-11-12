import {presetsFolder} from '../kit/controls.js';
import {POND_REFLECTION_DEFAULTS, CHANNEL_RENDER_DEFAULTS} from '../../src/water/surface.js';

// The channel surface's own render defaults for the optics settings both render modes use (one source: surface.js).
export function inlandOpticsDefaults() {
  const {f0, fresnelPower, sunGlint, causticDepth, causticFocus, causticFalloff, causticNormalScale, shaftLength, godColor, godFalloff, godSteps} = CHANNEL_RENDER_DEFAULTS;
  return {f0, fresnelPower, sunGlint, causticDepth, causticFocus, causticFalloff, causticNormalScale, shaftLength, godColor, godFalloff, godSteps};
}

export function waterFreezeControls(folder, freeze) {
  const {settings} = freeze;
  folder.add(settings, 'phase', ['Weather', 'Liquid', 'Frozen']).name('Pond phase');
  folder.add(settings, 'freezeSeconds', 1, 30, .5).name('Freeze time · s');
  folder.add(settings, 'thawSeconds', 1, 30, .5).name('Thaw time · s');
  const progress = {get ice() { return Math.round(freeze.progress * 100); }};
  folder.add(progress, 'ice', 0, 100).name('Freeze progress · %').disable().listen();
}

export function createBenchPondSettings() {
  return {
    ...inlandOpticsDefaults(),
    // WebAquarium's Fishing pond waves and absorption, scaled to the bench basin.
    windWaves: {waveLengthMeters: .4875, waveHeightMeters: .001625, animationSpeed: .2,
      directionSpread: 1, grouping: .36, crestSharpness: .21, waveCount: 16, windFromDegrees: 0},
    foam: .65, rippleStrength: 1, microRipples: 0, refraction: .8, reflection: 1,
    speed: 1, foamFeather: .7, bankFoam: 1,
    clarity: 1.86, pondColor: '#377e68', haze: .125, depthDark: .6, sunGlint: 1,
    planarReflection: {...POND_REFLECTION_DEFAULTS},
    caustics: 1.7, causticFalloff: .1, causticNormalScale: 3,
    godRays: .35, godHalf: true,
    shadowStrength: .7, shaftSoftness: 4, shadowEvery: 2,
  };
}

export function pondWindControls(folder, windWaves) {
  folder.add(windWaves, 'waveHeightMeters', 0, .04, .0001).name('Height · m');
  folder.add(windWaves, 'waveLengthMeters', .2, 2.5, .01).name('Wavelength · m');
  folder.add(windWaves, 'animationSpeed', 0, 2, .01).name('Speed');
  folder.add(windWaves, 'directionSpread', 1, 6, .05).name('Directional spread');
  folder.add(windWaves, 'grouping', 0, 1, .01);
  folder.add(windWaves, 'crestSharpness', 0, 1, .01);
  folder.add(windWaves, 'waveCount', 1, 16, 1);
  folder.close();
}

export function waterMaterialControls(folder, settings) {
  const surface = folder.addFolder('Surface detail');
  surface.add(settings, 'speed', 0, 2, .01).name('Flow speed');
  surface.add(settings, 'foam', 0, 1, .01).name('Foam');
  surface.add(settings, 'foamFeather', 0, 1, .01).name('Foam feather');
  surface.add(settings, 'bankFoam', 0, 1, .01).name('Bank foam');
  surface.add(settings, 'rippleStrength', 0, 3, .05).name('Ripple visibility');
  surface.add(settings, 'microRipples', 0, .2, .005).name('Micro ripples');
  const optics = folder.addFolder('Optics');
  optics.add(settings, 'refraction', 0, 2, .05).name('Refraction');
  optics.add(settings, 'reflection', 0, 2, .05).name('Reflections');
  optics.add(settings, 'clarity', .2, 3, .05).name('Depth clarity');
  if ('tint' in settings) optics.addColor(settings, 'tint').name('Depth tint');
  if ('pondColor' in settings) optics.addColor(settings, 'pondColor').name('Water color');
  if ('haze' in settings) optics.add(settings, 'haze', 0, 2, .01).name('Haze');
  if ('depthDark' in settings) optics.add(settings, 'depthDark', 0, 3, .05).name('Depth darkening');
  if ('f0' in settings) optics.add(settings, 'f0', 0, .3, .005).name('Fresnel base');
  if ('fresnelPower' in settings) optics.add(settings, 'fresnelPower', 1, 10, .1).name('Fresnel power');
  if ('sunGlint' in settings) optics.add(settings, 'sunGlint', 0, 2, .05).name('Sun glint');
  if (settings.planarReflection) {
    const planar = optics.addFolder('Planar reflection');
    const reflection = settings.planarReflection;
    planar.add(reflection, 'on').name('Enabled');
    planar.add(reflection, 'mix', 0, 1, .05);
    planar.add(reflection, 'distort', 0, .5, .01);
    planar.add(reflection, 'floor', 0, .6, .01).name('Reflectance floor');
    planar.add(reflection, 'resolution', [256, 512, 1024]);
    planar.add(reflection, 'hz', 5, 60, 1).name('Refresh rate · Hz');
    planar.close();
  }
  const light = folder.addFolder('Underwater light');
  light.add(settings, 'godRays', 0, 2, .05).name('God rays');
  light.add(settings, 'caustics', 0, 2, .05).name('Bed caustics');
  if ('causticDepth' in settings) light.add(settings, 'causticDepth', .25, 6, .05).name('Projection depth · m');
  if ('causticFocus' in settings) light.add(settings, 'causticFocus', 0, 1, .01).name('Caustic focus · m');
  if ('causticNormalScale' in settings) light.add(settings, 'causticNormalScale', 0, 4, .05).name('Caustic normal scale');
  if ('causticFalloff' in settings) light.add(settings, 'causticFalloff', 0, 2, .05).name('Caustic depth falloff');
  if ('shaftLength' in settings) light.add(settings, 'shaftLength', .25, 12, .05).name('Shaft reach · m');
  if ('godColor' in settings) light.addColor(settings, 'godColor').name('Shaft color');
  if ('godFalloff' in settings) light.add(settings, 'godFalloff', 0, 3, .05).name('Shaft falloff');
  if ('godSteps' in settings) light.add(settings, 'godSteps', 4, 40, 1).name('Shaft samples');
  if ('godHalf' in settings) light.add(settings, 'godHalf').name('Half-resolution shafts');
  if ('shadowStrength' in settings) light.add(settings, 'shadowStrength', 0, 1, .05).name('Underwater shadows');
  if ('shaftSoftness' in settings) light.add(settings, 'shaftSoftness', 0, 12, .5).name('Shaft shadow softness');
  if ('shadowEvery' in settings) light.add(settings, 'shadowEvery', 1, 8, 1).name('Shadow update interval');
}

// Ice look (createIceLook), shared by the water surface and any ice mesh.
export function iceLookControls(folder, look) {
  folder.add(look.frost, 'value', 0, 1, .01).name('Frost (0 clear · 1 white)');
  folder.add(look.cracks, 'value', 0, 2, .05).name('Cracks');
  folder.add(look.bubbles, 'value', 0, 2, .05).name('Bubbles');
  folder.add(look.sparkle, 'value', 0, 3, .05).name('Frost sparkle');
}

export function inlandWaterControls(folder, {settings, freeze, iceLook, toggleUnderwater, positionDiveCamera}) {
  waterMaterialControls(folder, settings);
  if (settings.windWaves) pondWindControls(folder.addFolder('Wind ripples'), settings.windWaves);
  if (freeze) {
    const freezing = folder.addFolder('Freeze and thaw');
    waterFreezeControls(freezing, freeze);
    if (iceLook) iceLookControls(freezing, iceLook);
  }
  const view = folder.addFolder('View');
  const diveControl = view.add({toggleUnderwater}, 'toggleUnderwater').name('Underwater view');
  let diveHeight;
  if ('diveHeight' in settings) {
    diveHeight = view.add(settings, 'diveHeight', -2.4, .25, .01).name('Eye above water · m').disable();
    if (positionDiveCamera) diveHeight.onChange(positionDiveCamera);
  }
  return {diveControl, diveHeight};
}


export function channelControls(gui, {settings: P, rebuild, setInteraction, clearRocks, toggleUnderwater, bake, bundled}) {
  const fc = gui.addFolder('Channel'); fc.add(P.channel, 'preset', ['stream', 'river']).onChange(rebuild); fc.add(P.channel, 'width', .6, 1.6, .05).onChange(rebuild); fc.add(P.channel, 'drop', 0, 6, .1).name('drop · m').onChange(rebuild); fc.add(P.channel, 'depth', .4, 2, .05).onChange(rebuild);
  inlandWaterControls(gui.addFolder('Water'), {settings: P.water, toggleUnderwater});
  const fv = gui.addFolder('Wind waves'); fv.add(P.waves, 'height', 0, .16, .005); fv.add(P.waves, 'wavelength', .35, 4, .05); fv.add(P.waves, 'direction', -180, 180, 5).name('direction vs wind °'); fv.add(P.waves, 'spread', 0, 90, 5); fv.add(P.waves, 'speed', 0, 2, .05); fv.close();
  const fi = gui.addFolder('Interact'); fi.add(P.interact, 'mode', ['orbit', 'ripple', 'rock']).onChange(setInteraction); fi.add(P.interact, 'rippleStrength', 0, 2, .05); fi.add(P.interact, 'markers').name('flow markers');
  fi.add({clearRocks: clearRocks}, 'clearRocks').name('clear rocks');
  const fb = gui.addFolder('Flow bake'); fb.add(P.bake, 'iterations', 10, 400, 10); fb.add({bake}, 'bake').name('bake flow field');
  presetsFolder(gui, {bundled, name: 'channel-water',
    getState: () => ({schema: 'three-kit.channel-water', version: 1, channel: {...P.channel}, water: {...P.water}, waves: {...P.waves}}),
    apply: p => { Object.assign(P.channel, p.channel); Object.assign(P.water, p.water); Object.assign(P.waves, p.waves); rebuild(); gui.controllersRecursive().forEach(c => c.updateDisplay()); }});
}
