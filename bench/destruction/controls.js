export function destructionControls(gui, state) {
  gui.add(state, 'fire').name('Launch projectile');
  gui.add(state, 'speed', 18, 50, 1).name('Speed (m/s)');
  gui.add(state, 'slowMotion').name('Slow motion');
  gui.add(state, 'rebuild').name('Rebuild bridge');
  gui.add(state, 'shots').listen().disable();
  gui.add(state, 'impacts').name('Impact breaks').listen().disable();
  gui.add(state, 'detached').name('Overload breaks').listen().disable();
}
