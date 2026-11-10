import {DEFAULT_KINDS} from '../../src/boundaries/index.js';

export function boundariesControls(gui, {settings: S, actions, hedge: H, refresh}) {
  gui.add(S, 'kind', DEFAULT_KINDS);
  const fr = gui.addFolder('Run'); for (const k of ['finish', 'backPoint', 'undo', 'removeLast', 'sample', 'clearAll']) fr.add(actions, k);
  const fh = gui.addFolder('Hedge'); fh.add(H, 'heightM', .4, 4, .05).onFinishChange(() => refresh()); fh.add(H, 'widthM', .4, 3, .05).onFinishChange(() => refresh()); fh.add(H, 'spacingM', .4, 3, .05).onFinishChange(() => refresh()); fh.addColor(H, 'color').onFinishChange(() => refresh()); fh.add(H, 'tintJitter', 0, .5, .01).onFinishChange(() => refresh());
  const fl = gui.addFolder('Layout file'); fl.add(actions, 'export').name('export JSON'); fl.add(actions, 'import').name('import JSON…');
}
