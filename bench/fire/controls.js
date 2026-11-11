export function fireControls(gui, {ignite, reset}) {
  gui.add({ignite}, 'ignite').name('Ignite first crate');
  gui.add({reset}, 'reset').name('Reset crates');
}

// Flame look shared by every fire visual on the page, and which parts of a fire are drawn.
export function fireLookControls(gui, {look, show}) {
  const folder = gui.addFolder('Fire look');
  folder.add(show, 'flames').name('Flames');
  folder.add(show, 'fluid').name('Fluid flames (off = sheets)');
  folder.add(look, 'planes', 1, 3, 1).name('Flame planes (1 = faces camera)');
  folder.add(show, 'smoke').name('Smoke');
  folder.add(show, 'embers').name('Embers');
  folder.add(show, 'light').name('Fire light');
  folder.add(look, 'height', .3, 3, .05).name('Flame height ×');
  folder.add(look, 'density', .2, 3, .05).name('Flame density ×');
  folder.add(look, 'brightness', .2, 3, .05).name('Flame brightness ×');
  folder.add(look, 'turbulence', 0, 2.5, .05).name('Turbulence ×');
  folder.add(look, 'windLean', 0, 3, .05).name('Wind lean ×');
  folder.add(look, 'smoke', 0, 3, .05).name('Smoke amount ×');
  folder.add(look, 'embers', 0, 4, .05).name('Ember amount ×');
  folder.add(look, 'light', 0, 3, .05).name('Light strength ×');
  return folder;
}
