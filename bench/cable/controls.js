import {CABLE_PRESETS} from '../../src/cable/index.js';

export function cableControls(gui, {settings: S, reset, cut, release}) {
  gui.add(S, 'preset', Object.keys(CABLE_PRESETS)).onChange(reset); gui.add(S, 'span', 2, 14, .5).onFinishChange(reset); gui.add(S, 'slack', 1.01, 1.3, .01).name('length / span').onFinishChange(reset);
  gui.add(S, 'segments', 4, 24, 1).onFinishChange(reset); gui.add(S, 'breakStrength', 100, 1e6, 100).onFinishChange(reset);
  gui.add({cut}, 'cut').name('cut at centre'); gui.add({release}, 'release').name('release left anchor'); gui.add({reset}, 'reset');
}
