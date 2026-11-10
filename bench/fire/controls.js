export function fireControls(gui, {ignite, reset}) {
  gui.add({ignite}, 'ignite').name('Ignite first crate');
  gui.add({reset}, 'reset').name('Reset crates');
}
