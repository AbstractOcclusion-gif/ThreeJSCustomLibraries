// The panel folders the demos built on the terrain world share (World, Drive): light, cost, the ground's weather and
// the dressing. One copy, so the two pages offer the same controls. Each returns its folder, for a page to add its own.

// settings: {volumetric}. sunShadows, volumetric, probes: the lighting tool's. appearance: the terrain's.
export function worldLightControls(gui, {settings, sunShadows, volumetric, probes, appearance}) {
  const folder = gui.addFolder('Light');
  folder.add(sunShadows.settings, 'strength', 0, 1, .01).name('Sun shadows');
  folder.add(sunShadows.settings, 'distance', 40, 600, 5).name('Sun shadows reach · m');
  folder.add(sunShadows.settings, 'softness', 0, 4, .1).name('Shadow soft edge');
  folder.add(settings, 'volumetric').name('Volumetric light');
  folder.add(volumetric.settings, 'density', 0, .02, .0005).name('Air density · 1/m');
  folder.add(probes.strength, 'value', 0, 1, .01).name('Light probes on rocks and trees');
  folder.add(appearance.skyOcclusion, 'value', 0, 1, .01).name('Sky occlusion on the ground');
  return folder;
}

// Every costly part can be switched off here, to find what a machine spends its frame on.
// settings: {pixelRatio, sunShadows, cloudShadows, volumetric}. cost: the kit's WORLD_COST.
export function worldCostControls(gui, {settings, cost, renderer, sunShadows, weather, volumetric, appearance}) {
  const folder = gui.addFolder('Performance');
  folder.add(settings, 'pixelRatio', cost.pixelRatios).name('Render pixel ratio').onChange(value => renderer.setPixelRatio(value));
  folder.add(settings, 'sunShadows').name('Sun shadows').onChange(on => sunShadows.set('strength', on ? 1 : 0));
  folder.add(settings, 'cloudShadows').name('Cloud shadows').onChange(on => weather.view.configure({appearance: {cloudShadowStrength: on ? 1 : 0}}));
  folder.add(settings, 'volumetric').name('Volumetric light');
  folder.add(volumetric.settings, 'steps', 4, 48, 1).name('Volumetric steps');
  folder.add(appearance.layerDetail, 'value', 0, 1, .01).name('Terrain close-up detail');
  folder.add({sky: cost.skyCapture}, 'sky', [.35, 1.25, 8]).name('Sky refresh · s').onChange(value => weather.view.configure({sky: {captureInterval: value}}));
  return folder;
}

// The ground follows the weather (rain wets it, snow covers it, both fade); or set by hand.
// settings: {followWeather, wetness, snow}.
export function worldGroundControls(gui, settings) {
  const folder = gui.addFolder('Ground');
  folder.add(settings, 'followWeather').name('Follows the weather');
  folder.add(settings, 'wetness', 0, 1, .01).name('Wetness (by hand)').listen();
  folder.add(settings, 'snow', 0, 1, .01).name('Snow cover (by hand)').listen();
  return folder;
}

// dressing: the World demo's dressing (its settings).
export function worldDressingControls(gui, dressing) {
  const folder = gui.addFolder('Rocks, grass, trees');
  folder.add(dressing.settings, 'rocks').name('Rocks and cliffs');
  folder.add(dressing.settings, 'grass').name('Grass');
  folder.add(dressing.settings, 'trees').name('Trees');
  folder.add(dressing.settings, 'treeLod', 20, 200, 1).name('Trees: far model from · m');
  folder.add(dressing.settings, 'treeImpostor', 40, 400, 1).name('Trees: flat cards from · m');
  return folder;
}
