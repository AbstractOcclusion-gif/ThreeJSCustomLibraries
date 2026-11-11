export function fireControls(gui, {ignite, reset}) {
  gui.add({ignite}, 'ignite').name('Ignite first crate');
  gui.add({reset}, 'reset').name('Reset crates');
}

// Flame look shared by every fire visual on the page, and which parts of a fire are drawn.
export function fireLookControls(gui, {look, show}) {
  const folder = gui.addFolder('Fire look');
  folder.add(show, 'flames').name('Flames');
  folder.add(look, 'height', .3, 3, .05).name('Flame height ×');
  folder.add(look, 'density', .2, 3, .05).name('Flame density ×');
  folder.add(look, 'brightness', .2, 3, .05).name('Flame brightness ×');
  folder.add(look, 'turbulence', 0, 2.5, .05).name('Turbulence ×');
  folder.add(look, 'windLean', 0, 3, .05).name('Wind lean ×');
  return folder;
}
