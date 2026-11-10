import './ui-theme.css';

const key = 'three-kit.bench-skin.v1';
const normalize = name => name === 'slate' ? 'slate' : 'field';

export function readBenchSkin() {
  try { return normalize(localStorage.getItem(key)); } catch { return 'field'; }
}

function applyBenchSkin(name) {
  document.documentElement.dataset.uiTheme = normalize(name);
}

export function setBenchSkin(name) {
  applyBenchSkin(name);
  try { localStorage.setItem(key, normalize(name)); } catch {}
}

applyBenchSkin(readBenchSkin());
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) applyBenchSkin(readBenchSkin());
});
