import {createUITool} from '../src/ui/index.js';
import '../src/ui/theme.css';

const demo = location.pathname.split('/').filter(part => part && part !== 'index.html').at(-1);
const settings = document.querySelector('aside:not([hidden]):not([role=alert])');
const toggle = document.createElement('button');
toggle.className = 'ui-launcher';
toggle.type = 'button';
toggle.textContent = 'UI Tool';
(settings ?? document.body).prepend(toggle);
const tool = createUITool({
  host: document.body, toggle, demo, initialOpen: demo === 'ui',
  onOpenDemo(target, pin) {
    const bench = new URL('../', location.href);
    bench.search = new URLSearchParams({tool: target, ui: '1', pin});
    window.top.location.assign(bench);
  },
});
window.addEventListener('bench-open-ui', tool.focusSearch);
