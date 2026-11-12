import {CABLE_PRESETS} from '../../src/cable/index.js';
import {SETUPS} from './setups.js';

const LIMITS = {
  span: [2, 14, .5], slack: [1.01, 1.3, .01], segments: [4, 24, 1],
  breakStrength: [100, 1e6, 100], pull: [0, 1, .01],
};

export function cableControls(gui, {settings, reset, cut, release, act}) {
  const rebuild = gui.add(settings, 'setup', Object.keys(SETUPS));
  const span = gui.add(settings, 'span', ...LIMITS.span).onFinishChange(reset);
  const slack = gui.add(settings, 'slack', ...LIMITS.slack).name('length / span').onFinishChange(reset);
  gui.add(settings, 'preset', Object.keys(CABLE_PRESETS)).onChange(reset);
  gui.add(settings, 'segments', ...LIMITS.segments).onFinishChange(reset);
  gui.add(settings, 'breakStrength', ...LIMITS.breakStrength).onFinishChange(reset);
  const pull = gui.add(settings, 'pull', ...LIMITS.pull).listen();
  const action = gui.add({act}, 'act');
  gui.add({cut}, 'cut').name('Cut first rope at centre');
  gui.add({release}, 'release').name('Release first rope attachment');
  gui.add({reset}, 'reset').name('Reset setup');

  function sync() {
    const setup = SETUPS[settings.setup];
    span.show(settings.setup === 'Fixed span');
    slack.show(setup.ropes(settings).some(rope => rope.slack === undefined));
    pull.show(Boolean(setup.drive));
    action.show(Boolean(setup.action));
    if (setup.drive) pull.name(setup.drive.label);
    if (setup.action) action.name(setup.action.label);
  }

  rebuild.onChange(() => { reset(); sync(); });
  sync();
}
