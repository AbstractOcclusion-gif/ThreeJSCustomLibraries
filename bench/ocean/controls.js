import * as THREE from 'three';
import {JERLOV_NAMES, OCEAN_PRESETS, OCEAN_DEFAULTS, OCEAN_REFLECTION_MODES, SEA_STATE_DEFAULTS} from '../../src/water/index.js';
import {presetsFolder} from '../kit/controls.js';

// Ocean surface panels: sea state, look, scene reflection, underwater optics and presets. Shared by the Ocean page and the
// ocean coast demo, which adds its boat, floating block, motes and coast around them.
// onHeading(degrees): the host turns its wind source (stage or weather) to the new heading.
export function oceanControls(gui, {ocean, camera, controls, rippleGesture, onHeading, bundled}) {
  const s = ocean.settings;
  const sea = gui.addFolder('Sea state');
  const spectrum = {...SEA_STATE_DEFAULTS};
  const applySpectrum = () => ocean.fft.setSeaState(spectrum);
  function applyLegacySea(values) {
    Object.assign(spectrum, SEA_STATE_DEFAULTS, {
      significantWaveHeight: values.chop * 1.875, swellHeight: values.swell,
      swellWavelength: values.swellLength, choppiness: values.choppiness,
    });
    applySpectrum();
  }
  const preset = {name: 'rolling'};
  sea.add(preset, 'name', Object.keys(OCEAN_PRESETS)).name('preset').onChange(v => {
    ocean.apply(OCEAN_PRESETS[v]); applyLegacySea(s); gui.controllersRecursive().forEach(c => c.updateDisplay());
  });
  sea.add(spectrum, 'significantWaveHeight', 0, 6, .05).name('Significant wave height · m').onChange(applySpectrum);
  sea.add(spectrum, 'peakWavelength', 5, 160, 1).name('Peak wavelength · m').onChange(applySpectrum);
  sea.add(spectrum, 'swellHeight', 0, 4, .05).name('Swell height · m').onChange(applySpectrum);
  sea.add(spectrum, 'swellWavelength', 20, 250, 1).name('Swell wavelength · m').onChange(applySpectrum);
  sea.add(spectrum, 'choppiness', 0, 2, .01).name('Crest shape').onChange(applySpectrum);
  sea.add(spectrum, 'aperiodic').name('Reduce tile repetition').onChange(applySpectrum);
  sea.add(s, 'whitecaps', 0, 1, .01).onChange(() => ocean.apply()); sea.add(s, 'waveSpeed', 0, 2, .01); sea.add(s, 'heading', 0, 360, 1).name('wind heading °').onChange(v => { onHeading(v); ocean.apply(); });
  const look = gui.addFolder('Look');
  look.addColor(s, 'waterTint').onChange(() => ocean.apply()); look.addColor(s, 'foamTint').onChange(() => ocean.apply());
  look.add(s, 'reflection', 0, 1.5, .01).onChange(() => ocean.apply()); look.add(s, 'fresnelPower', 1, 10, .1).onChange(() => ocean.apply());
  const reflections = look.addFolder('Scene reflection');
  reflections.add(s, 'reflectionSource', OCEAN_REFLECTION_MODES).name('Source').onChange(() => ocean.apply());
  reflections.add(s, 'reflectionMix', 0, 1, .05).name('Scene mix').onChange(() => ocean.apply());
  reflections.add(s, 'planarResolution', [128, 256, 512]).name('Planar resolution');
  reflections.add(s, 'planarHz', 5, 60, 1).name('Planar refresh · Hz');
  reflections.add(s, 'reflectionSteps', 4, 32, 1).name('Screen-space steps').onChange(() => ocean.apply());
  reflections.close();
  look.add(s, 'glint', 0, 3, .01).onChange(() => ocean.apply()); look.add(s, 'fineRipples', 0, 2, .01).onChange(() => ocean.apply());
  look.add(s, 'foamOpacity', 0, 1, .01).onChange(() => ocean.apply()); look.add(s, 'foamFeather', .02, 1, .01).onChange(() => ocean.apply()); look.add(s, 'foamScale', .25, 4, .01).onChange(() => ocean.apply());
  const view = {waterline: false, eyeHeight: 0, waterType: 'Open ocean II', godRays: 1};
  const orbitPosition = new THREE.Vector3();
  const optics = gui.addFolder('Underwater optics');
  optics.add(view, 'waterline').name('Waterline view').onChange(enabled => {
    rippleGesture.cancel();
    controls.enabled = !enabled;
    if (enabled) orbitPosition.copy(camera.position);
    else camera.position.copy(orbitPosition);
  });
  optics.add(view, 'eyeHeight', -3, 2, .01).name('Eye above mean sea · m');
  optics.add(view, 'waterType', JERLOV_NAMES).name('Water type');
  optics.add(s, 'refractionStrength', 0, 1, .01).name('Refraction').onChange(() => ocean.apply());
  optics.add(s, 'clarity', .2, 3, .05).name('Depth clarity').onChange(() => ocean.apply());
  optics.add(s, 'tirStrength', 0, 1, .01).name('Internal reflection').onChange(() => ocean.apply());
  optics.add(view, 'godRays', 0, 1, .05).name('Underwater sun shafts');
  look.add(s, 'crestGlow', 0, 6, .05).name('Crest glow').onChange(() => ocean.apply());
  presetsFolder(gui, {bundled, name: 'ocean',
    getState: () => ({schema: 'three-kit.ocean', version: 1, settings: {...s}, spectrum: {...spectrum}}),
    apply: p => {
      ocean.apply({...OCEAN_DEFAULTS, ...(p.settings ?? p)});
      if (p.spectrum) { Object.assign(spectrum, SEA_STATE_DEFAULTS, p.spectrum); applySpectrum(); }
      else applyLegacySea(s);
      gui.controllersRecursive().forEach(c => c.updateDisplay());
    }});
  return {settings: s, view, orbitPosition, sea, optics};
}
