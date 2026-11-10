// Bench-only: the weather system + Three adapter set up the way the demos use it, and its dev panel mount.
import {createWeatherSystem, hourLabel} from '../../src/weather/index.js';
import {createThreeWeather} from '../../src/weather/three/index.js';
import {bundledWeatherAssets} from '../../src/weather/three/bundled-assets.js';
import {createWeatherDevPanel} from '../../src/weather/three/dev-panel.js';
import {detectAssets} from './assets.js';

export async function createBenchWeather({scene, renderer, camera, lightTarget, initial = 'cloudy 1', hour = 15, precipitation = {count: 360, radius: 32, height: 34, floorHeight: 0}}) {
  // Private Enviro-derived set when dropped in, otherwise the free bundled textures.
  const privateBase = await detectAssets(import.meta.env.BASE_URL + 'weather/cirrus.png', import.meta.env.BASE_URL + 'weather/');
  const assets = privateBase ? {assetBaseUrl: privateBase} : bundledWeatherAssets();
  const system = createWeatherSystem({weather: {initial, seed: 17}, day: {hour, moonLight: true}});
  const view = createThreeWeather({system, scene, renderer, camera, lightTarget, ...assets, sky: {quality: 'mobile'}, precipitation});
  const assetBaseUrl = privateBase ?? 'bundled';
  view.ready.catch(console.error);
  return {system, view, renderer, assetBaseUrl, hourLabel};
}

export function mountWeatherControls(weather, parent = document.querySelector('aside')) {
  const container = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Weather';
  container.append(summary);
  parent.append(container);
  const panel = createWeatherDevPanel({...weather, container});
  let last = -Infinity;
  container.addEventListener('toggle', () => { if (container.open) panel.refresh(); });
  return {sync() {
    if (!container.open) return;
    const now = performance.now();
    if (now - last < 200) return;
    last = now;
    panel.refresh();
  }, dispose() { panel.dispose(); container.remove(); }};
}
