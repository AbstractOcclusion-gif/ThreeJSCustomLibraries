export function grassControls(gui, {settings, rebuild}) {
  const fg = gui.addFolder('Grass');
  fg.add(settings, 'clumps', 500, 60000, 500).onFinishChange(rebuild); fg.add(settings, 'radius', 10, 60, 1).onFinishChange(rebuild);
  fg.add(settings, 'size', .35, 2.5, .05).name('Clump size').onFinishChange(rebuild);
  fg.add(settings, 'sizeVariation', 0, 1, .01).name('Size variation').onFinishChange(rebuild);
  fg.addColor(settings, 'color').name('Meadow color').onFinishChange(rebuild);
  fg.addColor(settings, 'soilColor').name('Dry grass color').onFinishChange(rebuild);
  fg.add(settings, 'tintVariation', 0, 1, .01).name('Color variation').onFinishChange(rebuild);
  fg.add(settings, 'density', 0, 1, .01); fg.add(settings, 'lodDistance', 5, 80, 1); fg.add(settings, 'farDensity', 0, 1, .01); fg.add(settings, 'shadowDistance', 0, 60, 1); fg.add(settings, 'transmission', 0, 2, .01).name('backlight');
}

export function plantControls(gui, {plants, interact, placeTrees, buildBushes, shapeTrees, rollBall, stress, slide}) {
  const fp = gui.addFolder('Plants');
  fp.add(plants, 'trees', 0, 60, 1).onFinishChange(placeTrees); fp.add(plants, 'bushes', 0, 120, 1).onFinishChange(buildBushes); fp.add(plants, 'gust', 0, 1, .01);
  fp.add(plants, 'treeWidth', .5, 1.8, .01).name('Crown width').onFinishChange(placeTrees);
  fp.add(plants, 'treeCrown', .4, 1.6, .01).name('Crown depth').onFinishChange(shapeTrees);
  fp.add(plants, 'asymmetry', 0, 1, .01).name('Lobe spread').onFinishChange(shapeTrees);
  const fi = gui.addFolder('Interact'); fi.add(interact, 'ballSpeed', 1, 15, .5); fi.add(interact, 'ballRadius', .4, 2.5, .1); fi.add({rollBall}, 'rollBall').name('roll the ball');
  fi.add(interact, 'recoverySeconds', .25, 8, .25).name('Grass recovery · s');
  fi.add({stress}, 'stress').name('Stress test · 8 balls');
  fi.add({slide}, 'slide').name('Slide a box');
}
