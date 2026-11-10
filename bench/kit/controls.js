// Bench-only panels shared by the demos: presets, the basic stage, and the optional environment sliders.
import {downloadJson, readJsonFile} from '../../src/core/presets.js';

// Presets folder: bundled JSON (import.meta.glob result), save file, load file. getState() -> plain object, apply(obj).
export function presetsFolder(gui, {bundled, name, getState, apply}) {
  const f = gui.addFolder('Presets');
  const names = Object.keys(bundled).map(p => p.split('/').pop().replace('.json', ''));
  const s = {bundled: names[0] ?? '', save: () => downloadJson(`${name}-preset.json`, getState()), load: () => input.click()};
  if (names.length) f.add(s, 'bundled', names).onChange(async v => { const path = Object.keys(bundled).find(p => p.endsWith(`/${v}.json`)); apply((await bundled[path]()).default); });
  f.add(s, 'save').name('save preset (download)'); f.add(s, 'load').name('load preset file…');
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true; document.body.append(input);
  input.onchange = async () => { try { if (input.files[0]) apply(await readJsonFile(input.files[0])); } catch (e) { console.error(e); } finally { input.value = ''; } };
  return f;
}

// Controls for a basic stage (src/stage): the standalone environment every module demo can react to.
export function stageControls(gui, stage, {wind = true, onChange = () => {}} = {}) {
  const folder = gui.addFolder('Stage · sun, light, wind');
  const state = {elevation: 50, azimuth: 35, light: 1, windSpeed: 0, windHeading: 0, gust: 0};
  const apply = () => { stage.setSun(state.elevation, state.azimuth).setLight(state.light).setWind(state.windSpeed, state.windHeading, state.gust); onChange(state); };
  folder.add(state, 'elevation', 2, 88, 1).name('sun elevation · °').onChange(apply);
  folder.add(state, 'azimuth', 0, 360, 5).name('sun azimuth · °').onChange(apply);
  folder.add(state, 'light', 0, 1, .01).name('light (1 = noon)').onChange(apply);
  if (wind) {
    folder.add(state, 'windSpeed', 0, 20, .5).name('wind · m/s').onChange(apply);
    folder.add(state, 'windHeading', 0, 360, 5).name('wind heading · °').onChange(apply);
    folder.add(state, 'gust', 0, 1, .01).name('gust').onChange(apply);
  }
  return {folder, state, apply};
}

// Optional environment (core/environment.js): off = the modules run standalone, exactly as before.
// state: {environment, windSpeed, windHeading, gust?, light?} - the gust and light sliders appear only when the state has them.
export function environmentControls(gui, {state, apply}) {
  const folder = gui.addFolder('Environment (optional)');
  folder.add(state, 'environment').name('react to environment').onChange(apply);
  folder.add(state, 'windSpeed', 0, 20, .5).name('wind · m/s').onChange(apply);
  folder.add(state, 'windHeading', 0, 360, 5).name('wind heading · °').onChange(apply);
  if ('gust' in state) folder.add(state, 'gust', 0, 1, .01).name('gust').onChange(apply);
  if ('light' in state) folder.add(state, 'light', 0, 1, .01).name('scene light (1 = noon)').onChange(apply);
  return folder;
}
