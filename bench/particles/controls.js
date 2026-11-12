import {environmentControls} from '../kit/controls.js';

// Impact splash (createImpactSplash): which parts are drawn and the scales of its look.
export function splashControls(gui, splash, actions = {}) {
  const folder = gui.addFolder('Splash');
  for (const [name, action] of Object.entries(actions)) folder.add({[name]: action}, name);
  folder.add(splash.show, 'droplets').name('Droplets');
  folder.add(splash.show, 'chunks').name('Water chunks');
  folder.add(splash.show, 'jets').name('Entry jets');
  folder.add(splash.show, 'crown').name('Crown');
  folder.add(splash.look, 'amount', .2, 3, .05).name('Amount ×');
  folder.add(splash.look, 'height', .3, 3, .05).name('Height ×');
  folder.add(splash.look, 'size', .3, 3, .05).name('Size ×');
  folder.add(splash.look, 'life', .3, 3, .05).name('Duration ×');
  folder.add(splash.look, 'brightness', .2, 2, .05).name('Brightness ×');
  return folder;
}

export function sprayControls(gui, {spray, depth, state, fx}) {
  const folder = gui.addFolder('Water spray');
  if (fx) {
    folder.add(fx, 'mist');
    folder.add(fx, 'splash');
    folder.add(state, 'sprayLoop').name('auto spray');
    folder.add(state, 'mistSize', .3, 3);
    folder.add(state, 'splashStrength', .1, 1);
  }
  folder.add(depth.uniforms.uFxSoftDistance, 'value', .01, 1, .01).name('Soft intersection · m');
  folder.add(spray, 'clear').name('Clear water spray');
  return folder;
}

export function particleControls(gui, {state, fx, depth, spray, applyEnvironment}) {
  const f1 = gui.addFolder('Puffs & prefabs'); for (const k of ['impactDust', 'campfire', 'smokePlume', 'stopEmitters', 'mortar', 'sparks']) f1.add(fx, k);
  const f2 = gui.addFolder('Chips & fragments'); f2.addColor(state, 'chipColor'); f2.add(state, 'chipCount', 1, 120, 1); f2.add(state, 'shock', 4, 60, 1); f2.add(fx, 'chips'); f2.add(fx, 'fragments');
  sprayControls(gui, {spray, depth, state, fx});
  if (applyEnvironment) environmentControls(gui, {state, apply: applyEnvironment});
  gui.add(fx, 'clear');
}
