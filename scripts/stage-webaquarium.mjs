import {cp, mkdir, readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const runtimeOnly = args.includes('--runtime-only');
const source = resolve(args.find(arg => arg !== '--runtime-only') ?? process.env.WEBAQUARIUM_ROOT ?? join(root, '../WebAquarium'));
const destination = join(root, 'private-assets/webaquarium');
const entries = await readdir(source, {withFileTypes: true});
const pages = entries.filter(entry => entry.isFile() && entry.name.endsWith('.html'));
const trees = ['src', 'fishing', 'game', 'hands', 'styles', 'ui'];
if (runtimeOnly) await stat(join(destination, 'library'));
else trees.push('library');
await Promise.all(['aquarium.html', 'fishing.html'].map(name => readFile(join(source, name))));
await mkdir(destination, {recursive: true});
await Promise.all(trees.map(name => cp(join(source, name), join(destination, name), {
 recursive: true, preserveTimestamps: true,
 async filter(from, to) {
  // Refresh code from the source every time, including files patched below.
  // Assets being served can be open in the dev server; skip unchanged files.
  if (name !== 'library') return true;
  const a = await stat(from);
  if (!a.isFile()) return true;
  const b = await stat(to).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return !b || a.size !== b.size || a.mtimeMs > b.mtimeMs + 1;
 },
})));
await Promise.all([...pages.map(page => page.name), 'hands/fishing.html'].map(async name => {
 const html = await readFile(join(source, name), 'utf8');
 const prefix = dirname(name) === '.' ? './' : '../';
 // The import map keys and targets must resolve to the same staged module URL.
 const scoped = html.replace(/(<script type="importmap">)([\s\S]*?)(<\/script>)/g,
  (_, open, map, close) => open + map.replaceAll('"/src/', '"' + prefix + 'src/') + close);
 await writeFile(join(destination, name), scoped);
}));
// Extend the original press/drag handler in the staged copy. Its input owners
// (tools, glass and Fishing's cast) still have priority; only a water press holds.
const inputPath = join(destination, 'src/input/input.js');
let input = await readFile(inputPath, 'utf8');
function patchInput(before, after) {
 if (!input.includes(before)) throw new Error('WebAquarium water input changed; check the hold integration in src/input/input.js.');
 input = input.replace(before, after);
}
patchInput('let dragging = false;', `let dragging = false, holdTimer;
function cancelWaterHold() { clearTimeout(holdTimer); }
function armWaterHold() {
  cancelWaterHold();
  holdTimer = setTimeout(function pulse() {
    if (!dragging || INPUT.suspended || SIMC.paused || document.hidden) return;
    drop(dragLast.x, dragLast.y, P.dropRadius, P.dropStrength * .35);
    holdTimer = setTimeout(pulse, 250);
  }, 250);
}`);
patchInput('dragging = true; dragLast.set(h.x, h.z);', 'dragging = true; dragLast.set(h.x, h.z); armWaterHold();');
patchInput('if (!dragging) return; const h = pick(e); if (!h) return;', 'if (!dragging) return; const h = pick(e); if (!h) { cancelWaterHold(); return; }');
patchInput('dragLast.set(h.x, h.z); });', 'dragLast.set(h.x, h.z); armWaterHold(); });');
patchInput('grab = null; dragging = false; LURE.held', 'grab = null; dragging = false; cancelWaterHold(); LURE.held');
await writeFile(inputPath, input);
const pondPath = join(destination, 'fishing/pond.js');
const pond = await readFile(pondPath, 'utf8');
const panelPosition = "top: '12px', right: 'auto', zIndex: 50 });";
if (!pond.includes(panelPosition)) throw new Error('WebAquarium Fishing dev panel placement changed; check the bench integration.');
await writeFile(pondPath, pond.replace(panelPosition,
 "top: 'calc(var(--pond-bar-bottom, 70px) + 8px)', right: 'auto', zIndex: 50, maxHeight: 'calc(100vh - var(--pond-bar-bottom, 70px) - 16px)' });\n  panel.close();"));
console.log('Staged Aquarium and Fishing in private-assets/webaquarium.');
