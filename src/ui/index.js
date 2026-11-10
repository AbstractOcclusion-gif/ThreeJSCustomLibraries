import {bindUISkin, readBenchSkin, setBenchSkin} from './theme.js';
export {bindUISkin};

const storageKey = 'three-kit.bench-ui.v1';
const fields = 'input:not([type=hidden]), select, textarea, button';

export function readWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.pins)) return saved;
  } catch {}
  return {open: false, demo: null, pins: []};
}

function labelOf(control) {
  const doc = control.ownerDocument;
  const linked = control.getAttribute('aria-labelledby')?.split(/\s+/)
    .map(id => doc.getElementById(id)?.textContent).join(' ');
  const label = control.labels?.[0]?.cloneNode(true);
  label?.querySelectorAll('input, select, textarea, output, button').forEach(node => node.remove());
  return (control.getAttribute('aria-label') || linked || label?.textContent ||
    control.textContent || control.getAttribute('placeholder') || control.id).trim();
}

function controlList(doc) {
  const entries = [], duplicates = new Map(), rows = new Set();
  for (const control of doc.querySelectorAll(fields)) {
    if (control.closest('header, nav, .ui-tool, .ui-launcher, [aria-hidden=true], .lil-gui .title')) continue;
    const row = control.closest('.lil-gui .controller');
    if (row && rows.has(row)) continue;
    if (row) rows.add(row);
    const label = labelOf(control);
    if (!label) continue;
    const folders = [];
    for (let node = control.parentElement; node && node !== doc.body; node = node.parentElement) {
      const heading = node.matches('.lil-gui') ? node.querySelector(':scope > .title') :
        node.matches('details') ? node.querySelector(':scope > summary') : null;
      if (heading) folders.unshift(heading.textContent.trim());
    }
    const path = [...folders, label].join(' / ');
    const occurrence = (duplicates.get(path) ?? 0) + 1;
    duplicates.set(path, occurrence);
    entries.push({key: `${path}#${occurrence}`, path, label, control});
  }
  return entries;
}

function reveal(control) {
  for (let node = control.parentElement; node; node = node.parentElement) {
    if (node.matches('details')) node.open = true;
    if (node.matches('.lil-gui.closed')) node.querySelector(':scope > .title')?.click();
  }
  const target = control.hidden ? control.labels?.[0] : control;
  if (!target) return;
  const view = target.ownerDocument.defaultView;
  // lil-gui opens its folders on the next frame.
  view.requestAnimationFrame(() => {
    if (!target.isConnected) return;
    target.scrollIntoView({block: 'nearest'});
    target.focus({preventScroll: true});
    if (!view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      target.animate([{outline: '2px solid var(--bench-accent, #ffda8a)'}, {outline: '2px solid transparent'}], 1600);
    }
  });
}

export function isUISearchShortcut(event) {
  return event.key === '/' && !event.ctrlKey && !event.altKey && !event.metaKey &&
    !event.target.closest?.('input, select, textarea, [contenteditable=true]');
}

export function createUITool({host, toggle, demo, onOpenDemo, initialOpen = false}) {
  const listeners = new AbortController();
  const {signal} = listeners;
  bindUISkin(signal);
  const panel = document.createElement('section');
  panel.className = 'ui-tool';
  panel.id = 'ui-tool';
  panel.setAttribute('aria-labelledby', 'ui-tool-title');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="ui-tool-heading"><h2 id="ui-tool-title">UI Tool</h2><button type="button" aria-label="Close UI Tool">Close</button></div>
    <label class="ui-skin">Skin <select aria-label="UI skin"><option value="field">Field</option><option value="slate">Slate</option></select></label>
    <input type="search" aria-label="Find a demo control" placeholder="Find a demo control…">
    <p role="status"></p>
    <ul aria-label="Controls and pins"></ul>
  `;
  host.append(panel);
  toggle.setAttribute('aria-controls', panel.id);
  const state = readWorkspace();
  state.demo = demo;
  const search = panel.querySelector('input[type=search]');
  const skin = panel.querySelector('select');
  skin.value = readBenchSkin();
  skin.addEventListener('change', () => setBenchSkin(skin.value), {signal});
  const results = panel.querySelector('ul');
  const status = panel.querySelector('[role=status]');
  const query = new URLSearchParams(location.search);
  let pendingPin = query.get('pin');

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch {}
  }
  function button(label, action) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', action);
    return el;
  }
  function showControl(control) {
    setOpen(false);
    reveal(control);
  }
  function render() {
    if (panel.hidden) return;
    const entries = controlList(document);
    const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = entries.filter(entry => terms.every(term => entry.path.toLowerCase().includes(term)));
    results.replaceChildren();
    for (const pin of state.pins) {
      if (terms.length && !terms.every(term => pin.path.toLowerCase().includes(term))) continue;
      const li = document.createElement('li');
      li.append(button(`${pin.demo} · ${pin.path}`, () => {
        if (pin.demo === demo) {
          const entry = entries.find(item => item.key === pin.key);
          if (entry) showControl(entry.control);
          else status.textContent = 'This control is unavailable in the current scene state.';
        } else {
          if (onOpenDemo) onOpenDemo(pin.demo, pin.key);
          else status.textContent = 'Open the pinned demo to reveal this control.';
        }
      }), button('Unpin', () => {
        state.pins = state.pins.filter(item => item !== pin);
        persist();
        render();
      }));
      results.append(li);
    }
    for (const entry of matches.slice(0, 80)) {
      const li = document.createElement('li');
      li.append(button(entry.path, () => showControl(entry.control)));
      if (!state.pins.some(pin => pin.demo === demo && pin.key === entry.key)) {
        li.append(button('Pin', () => {
          state.pins.push({demo, key: entry.key, path: entry.path});
          persist();
          render();
        }));
      }
      results.append(li);
    }
    status.textContent = !entries.length ? 'Waiting for demo controls…' :
      `${matches.length} matching controls${matches.length > 80 ? ' · narrow your search to see more' : ''}`;
    if (pendingPin) {
      const entry = entries.find(item => item.key === pendingPin);
      if (entry) {
        pendingPin = null;
        showControl(entry.control);
      }
    }
  }
  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    state.open = open;
    persist();
    render();
  }
  function close() {
    setOpen(false);
    toggle.focus();
  }
  toggle.addEventListener('click', () => {
    setOpen(panel.hidden);
    if (!panel.hidden) search.focus();
  }, {signal});
  panel.querySelector('.ui-tool-heading button').addEventListener('click', close, {signal});
  search.addEventListener('input', render, {signal});
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      close();
    } else if (event.key === 'Enter' && event.target === search) {
      results.querySelector('li > button')?.click();
    }
  }, {signal});
  function focusSearch() {
    setOpen(true);
    search.focus();
  }
  document.addEventListener('keydown', event => {
    if (!isUISearchShortcut(event)) return;
    event.preventDefault();
    focusSearch();
  }, {signal});
  setOpen(query.get('ui') === '1' || state.open || initialOpen);
  const observer = new MutationObserver(records => {
    if (!panel.hidden && records.some(record => !panel.contains(record.target) &&
      [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 &&
        (node.matches(fields) || node.querySelector(fields))))) render();
  });
  observer.observe(document.body, {childList: true, subtree: true});
  return {focusSearch, dispose() {
    observer.disconnect();
    listeners.abort();
    panel.remove();
    toggle.removeAttribute('aria-controls');
    toggle.removeAttribute('aria-expanded');
  }};
}
