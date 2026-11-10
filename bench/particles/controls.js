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

export function particleControls(gui, {state, fx, depth, spray}) {
  const f1 = gui.addFolder('Puffs & prefabs'); for (const k of ['impactDust', 'campfire', 'smokePlume', 'stopEmitters', 'mortar', 'sparks']) f1.add(fx, k);
  const f2 = gui.addFolder('Chips & fragments'); f2.addColor(state, 'chipColor'); f2.add(state, 'chipCount', 1, 120, 1); f2.add(state, 'shock', 4, 60, 1); f2.add(fx, 'chips'); f2.add(fx, 'fragments');
  sprayControls(gui, {spray, depth, state, fx});
  gui.add(fx, 'clear');
}
