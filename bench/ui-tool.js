import {readBenchSkin, setBenchSkin} from './ui-theme.js';

const storageKey = 'three-kit.bench-ui.v1';
const fields = 'input:not([type=hidden]), select, textarea, button';

function readWorkspace() {
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
    if (control.closest('header, nav, [aria-hidden=true], .lil-gui .title')) continue;
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
  target.scrollIntoView({block: 'nearest'});
  target.focus({preventScroll: true});
  if (!target.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    target.animate([{outline: '2px solid var(--bench-accent, #ffda8a)'}, {outline: '2px solid transparent'}], 1600);
  }
}

export function createUITool({panel, toggle, onOpenDemo}) {
  const state = readWorkspace();
  const search = panel.querySelector('input[type=search]');
  const skin = panel.querySelector('select');
  skin.value = readBenchSkin();
  skin.addEventListener('change', () => setBenchSkin(skin.value));
  const results = panel.querySelector('ul');
  const status = panel.querySelector('[role=status]');
  let activeDemo = null, activeFrame = null, pendingPin = null;
  let observer, frameKeys;

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
    let entries = [];
    try {
      if (activeFrame?.contentDocument) entries = controlList(activeFrame.contentDocument);
    } catch {}
    const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = entries.filter(entry => terms.every(term => entry.path.toLowerCase().includes(term)));
    results.replaceChildren();
    for (const pin of state.pins) {
      if (terms.length && !terms.every(term => pin.path.toLowerCase().includes(term))) continue;
      const li = document.createElement('li');
      li.append(button(`${pin.demo} · ${pin.path}`, () => {
        if (pin.demo === activeDemo) {
          const entry = entries.find(item => item.key === pin.key);
          if (entry) showControl(entry.control);
          else status.textContent = 'This control is unavailable in the current scene state.';
        } else {
          pendingPin = pin;
          onOpenDemo(pin.demo);
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
      if (!state.pins.some(pin => pin.demo === activeDemo && pin.key === entry.key)) {
        li.append(button('Pin', () => {
          state.pins.push({demo: activeDemo, key: entry.key, path: entry.path});
          persist();
          render();
        }));
      }
      results.append(li);
    }
    status.textContent = !activeDemo ? 'Choose a demo to find its controls.' :
      !entries.length ? 'Waiting for demo controls…' :
      `${matches.length} matching controls${matches.length > 80 ? ' · narrow your search to see more' : ''}`;
    if (pendingPin?.demo === activeDemo) {
      const entry = entries.find(item => item.key === pendingPin.key);
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
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  search.addEventListener('input', render);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      setOpen(false);
      toggle.focus();
    } else if (event.key === 'Enter' && event.target === search) {
      results.querySelector('li > button')?.click();
    }
  });
  function focusSearch(event) {
    if (event.key !== '/' || event.ctrlKey || event.altKey || event.metaKey ||
        event.target.closest?.('input, select, textarea, [contenteditable=true]')) return;
    event.preventDefault();
    setOpen(true);
    search.focus();
  }
  document.addEventListener('keydown', focusSearch);
  setOpen(new URLSearchParams(location.search).get('ui') === '1' || state.open);

  return {
    get lastDemo() { return state.demo; },
    setDemo(demo, frame) {
      observer?.disconnect();
      frameKeys?.abort();
      activeDemo = state.demo = demo;
      activeFrame = frame;
      persist();
      frame?.addEventListener('load', () => {
        if (activeFrame !== frame) return;
        observer?.disconnect();
        frameKeys?.abort();
        const doc = frame.contentDocument;
        const body = doc?.body;
        if (body) {
          frameKeys = new AbortController();
          doc.addEventListener('keydown', focusSearch, {signal: frameKeys.signal});
          observer = new MutationObserver(records => {
            if (records.some(record => [...record.addedNodes, ...record.removedNodes]
              .some(node => node.nodeType === 1 && (node.matches(fields) || node.querySelector(fields))))) render();
          });
          observer.observe(body, {childList: true, subtree: true});
        }
        render();
      });
      render();
    },
  };
}
