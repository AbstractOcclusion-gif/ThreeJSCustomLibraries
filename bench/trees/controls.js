import {resolveProfile} from '../../src/trees/index.js';
import {presetsFolder} from '../shared.js';

// Ranges from the original Trees profile editor, shared by both canopy shapes and hedges.
const ranges = {
  variants: [1, 8, 1], sides: [3, 12, 1], radiusBottom: [.01, .3], radiusTop: [.005, .2],
  belowGround: [0, .1], topIntoCrown: [0, 1], depth: [.1, 1], bottomFlatten: [.1, 1],
  mainRadius: [.5, 1.5], mainSquash: [.3, 1.5], fixedSquash: [.3, 1.5], mainCentreY: [0, 1],
  count: [0, 8, 1], radius: [.1, 1], offset: [0, 1.2], drop: [0, .8], spread: [.5, 2],
  dropScale: [0, 2], baseY: [0, 1], dropShare: [0, 1], noiseAmplitude: [0, .4],
  noiseFrequency: [.5, 6], tintJitter: [0, .4], detail: [0, 2, 1], radiusShare: [.3, 1],
  shade: [.1, 1], perUnitArea: [1, 40], size: [.05, 1.2], tilt: [0, 1.5], sink: [0, .3],
  scale: [.2, 2], subcells: [1, 4, 1], yCompensation: [.1, 1], bottom: [.2, 1.5], top: [.5, 1.6],
};
const overrides = new Set(['fixedSquash', 'mainCentreY', 'baseY']);

function validateProfile(profile, defaults) {
  for (const [key, initial] of Object.entries(defaults)) {
    if (key === 'name') continue;
    const value = profile[key];
    if (initial && typeof initial === 'object' && !Array.isArray(initial)) {
      if (!value || typeof value !== 'object') throw Error('Invalid profile section: ' + key);
      validateProfile(value, initial);
    } else if (ranges[key]) {
      if (overrides.has(key) && value === null) continue;
      const [min, max, step] = ranges[key];
      const values = Array.isArray(initial) && Array.isArray(value) && value.length === initial.length ? value : [value];
      if (Array.isArray(initial) !== Array.isArray(value) ||
          (Array.isArray(initial) && value.length !== initial.length) ||
          values.some(number => !Number.isFinite(number) || number < min || number > max || (step === 1 && !Number.isInteger(number)))) {
        throw Error('Invalid profile value: ' + key);
      }
    } else if (typeof value !== typeof initial || (key === 'color' && !/^#[0-9a-f]{6}$/i.test(value))) {
      throw Error('Invalid profile value: ' + key);
    }
  }
}

export function treeProfileControls(gui, {title, trees, onChange = () => {}}) {
  const folder = gui.addFolder(title).close();
  const base = trees.profile.name === 'bush' ? 'bush' : 'tree';
  const defaults = resolveProfile(base);
  let profile, settings;
  function apply() {
    trees.setProfile(profile);
    onChange(trees.profile);
  }
  function bind(group, object, key) {
    const value = object[key];
    if (typeof value === 'boolean') {
      group.add(object, key).onFinishChange(apply);
      return;
    }
    if (typeof value === 'string' && value.startsWith('#')) {
      group.addColor(object, key).onFinishChange(apply);
      return;
    }
    if (!ranges[key]) return;
    const [min, max, step = .005] = ranges[key];
    if (overrides.has(key)) {
      const state = {override: value !== null, value: value ?? (min + max) / 2};
      group.add(state, 'override').name(key + ' override').onFinishChange(enabled => {
        object[key] = enabled ? state.value : null;
        slider.enable(enabled);
        apply();
      });
      const slider = group.add(state, 'value', min, max, step).name(key).enable(state.override)
        .onFinishChange(number => { object[key] = number; apply(); });
    } else if (Array.isArray(value)) {
      group.add(value, '0', min, max, step).name(key + ' min').onFinishChange(apply);
      group.add(value, '1', min, max, step).name(key + ' max').onFinishChange(apply);
    } else if (typeof value === 'number') {
      group.add(object, key, min, max, step).onFinishChange(apply);
    }
  }
  function sync() {
    profile = structuredClone(trees.profile);
    settings?.destroy();
    settings = folder.addFolder('Profile settings');
    for (const [section, values] of Object.entries(profile)) {
      if (section === 'name' || section === 'base') continue;
      if (values && typeof values === 'object' && !Array.isArray(values)) {
        const group = settings.addFolder(section).close();
        for (const key of Object.keys(values)) bind(group, values, key);
      } else bind(settings, profile, section);
    }
  }
  sync();
  const bundled = import.meta.glob('../../presets/trees/*.json');
  presetsFolder(folder, {
    bundled: Object.fromEntries(Object.entries(bundled).filter(([path]) => path.endsWith('/' + base + '.json'))),
    name: base,
    getState: () => ({schema: 'three-kit.tree-profile', version: 1, ...trees.profile}),
    apply: ({schema, version, ...values}) => {
      if (schema !== 'three-kit.tree-profile' || version !== 1) throw Error('Unsupported tree profile preset');
      const next = resolveProfile({...values, base});
      validateProfile(next, defaults);
      profile = next;
      apply();
      sync();
    },
  }).close();
  folder.add({reset() {
    profile = structuredClone(defaults);
    apply();
    sync();
  }}, 'reset').name('Reset profile');
  return {sync};
}
