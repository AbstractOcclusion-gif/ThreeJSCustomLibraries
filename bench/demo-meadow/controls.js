import {createBenchPanel} from '../panel.js';
import {sandLookControls, shorelineControls, snowBodyControls, snowLookControls} from '../terrain/controls.js';
import {grassControls} from '../vegetation/controls.js';
import {pondWindControls, waterMaterialControls} from '../water/controls.js';
import {TREES, UNDERGROWTH} from './layout.js';
import {SNOW_DEPTH_SCALE} from '../../src/terrain/index.js';

export function mountMeadowControls({container, ground, plants, pond, footprints, camera, setTreeCount, setSnow}) {
 const panel = createBenchPanel('Meadow tuning').close();
 container.append(panel.domElement);
 panel.domElement.classList.remove('autoPlace');
 const grass = panel.addFolder('Vegetation').close();
 grass.add(plants.foliageSettings, 'snow').name('Snow on foliage');
 grassControls(grass, plants);
 const interaction = grass.addFolder('Contact').close();
 interaction.add(plants.settings, 'recoverySeconds', .25, 8, .05).name('Grass recovery · s');
 interaction.add(plants.settings, 'sweepRadius', .15, 1.5, .05).name('Foot bend radius · m');
 const trees = grass.addFolder('EZ-Tree woodland').close(), treeSettings = plants.treeSettings;
 for (const [species, label] of [['ez-birch', 'Birch count'], ['ez-spruce', 'Spruce count']])
  trees.add(treeSettings, species, 0, TREES[species].length, 1).name(label).onChange(count => setTreeCount(species, count));
 trees.add(treeSettings, 'shrubs', 0, UNDERGROWTH.length, 1).name('Interactive shrub count');
 trees.add(treeSettings, 'lodDistance', 5, 100, 1).name('LOD2 switch · m');
 trees.add(treeSettings, 'impostors').name('Impostors');
 trees.add(treeSettings, 'shadows').name('Woodland shadows');
 trees.add(treeSettings, 'impostorDistance', 12, 180, 1).name('Impostor switch · m');

 const water = panel.addFolder('Pond').close();
 waterMaterialControls(water, pond.settings);
 pondWindControls(water.addFolder('Wind ripples'), pond.settings.windWaves);

 const soil = panel.addFolder('Ground and footprints').close();
 soil.add(footprints.settings, 'impression', 0, 2, .05).name('Impression depth ×');
 soil.add(footprints.settings, 'life', 0, 120, 1).name('Lifetime · s (0 keeps)').onChange(footprints.refreshInk);
 soil.add(footprints.settings, 'opacity', 0, 1, .01).name('Footprint contrast').onChange(footprints.refreshInk);
 soil.add(ground.surface.wetDarkening, 'value', 0, .8, .01).name('Wet darkening');
 soil.add(ground.surface.wetRoughness, 'value', .05, 1, .01).name('Wet roughness');
 soil.add(ground.rates, 'wetting', 0, 1, .01).name('Wetting rate');
 soil.add(ground.rates, 'drying', 0, .5, .005).name('Drying rate');
 soil.add(ground.rates, 'snowing', 0, 1, .01).name('Snow accumulation rate');
 sandLookControls(soil, ground.sand);
 shorelineControls(soil, ground.appearance);
 const snow = panel.addFolder('3D snow');
 snow.add(footprints.settings, 'snow').name('3D snow cover').listen().onChange(setSnow);
 snow.add(footprints.settings, 'snowDepth', SNOW_DEPTH_SCALE.min, SNOW_DEPTH_SCALE.max, .05)
  .name('Snow depth ×').onFinishChange(footprints.setSnowDepth);
 snowBodyControls(snow, {field: ground.field, onRelay: footprints.relaySnow}).close();
 snowLookControls(snow, ground.snow).close();
 panel.addFolder('Camera').close().add(camera, 'zoom', camera.minZoom, camera.maxZoom, .01).name('Zoom distance ×').listen();
 return panel;
}
