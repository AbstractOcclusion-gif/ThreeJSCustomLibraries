// Isolation: every library entry imports on its own, every module imports only core and its declared lower modules, and
// every module page imports only its own module, the stage, core and the modules it is built on by design.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = path.join(ROOT, 'src'), BENCH = path.join(ROOT, 'bench');
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;   // static, side-effect and dynamic imports, re-exports
const PEERS = /^(?:three(?:\/.*)?|cannon-es)$/;                           // the package's peer dependencies

// Declared lower-module imports, as paths under src/. File-precise where a module may use only one file of the other.
const LIBRARY_ALLOWED = {
  terrain: ['surface'],
  destruction: ['cable/cable.js', 'cable/three.js', 'particles/chips.js', 'particles/puffs.js'],
  boundaries: ['trees'],
  fire: ['particles/puffs.js'],                    // smoke and embers of the fire visual
  weather: ['particles/water/precipitation.js', 'particles/wind.js'],   // rain and snow; wind streaks and debris
  water: ['particles/water/spray-pump.js'],        // the boat spray pump
};
// Module pages (bench/<page>/): the modules each one shows. Every page may also use core, the stage and the UI tool the
// bench chrome (bench/ui-demo.js) mounts on every page. Built on by design: boundaries->trees, fire->particle flames,
// pond->waterfall spray, terrain->surface, vegetation->leaved trees.
const PAGES = {
  boundaries: ['boundaries', 'trees'], cable: ['cable'], camera: ['camera'], destruction: ['destruction'],
  fire: ['fire', 'particles'], flocking: ['flocking'], ocean: ['water'], particles: ['particles'],
  pond: ['water', 'particles'], terrain: ['terrain', 'surface'], ui: ['ui'], vegetation: ['vegetation', 'trees'],
  water: ['water'], weather: ['weather'],
};
const EVERY_PAGE = ['core', 'stage', 'ui'];
const MIXED_PAGES = ['demo-ocean', 'demo-all'];   // every module on one weather: no import rule

const posix = file => file.split(path.sep).join('/');
function jsFiles(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? jsFiles(full) : entry.name.endsWith('.js') ? [full] : [];
  });
}
function importsOf(file) {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(IMPORT)].map(match => match[1]);
}
// Relative import -> absolute path, checked to exist so a broken path fails here and not in a friend's project.
function resolveRelative(from, specifier) {
  const target = path.resolve(path.dirname(from), specifier);
  assert.ok(fs.existsSync(target), `${posix(path.relative(ROOT, from))} imports missing ${specifier}`);
  return target;
}
const moduleOf = file => posix(path.relative(SRC, file)).split('/')[0];

test('every library entry in package.json imports on its own, in a fresh Node process', () => {
  const {exports} = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const entries = Object.entries(exports).filter(([name, target]) => target.endsWith('.js') && !name.includes('*'));
  assert.ok(entries.length > 0);
  for (const [name, target] of entries) {
    const url = new URL(target, `file://${ROOT}`).href;
    try { execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], {stdio: 'pipe'}); }
    catch (error) { assert.fail(`${name} does not import alone: ${String(error.stderr).split('\n').find(line => /Error/.test(line))}`); }
  }
});

test('library modules import only themselves, core, their declared lower modules and the peer dependencies', () => {
  for (const file of jsFiles(SRC)) {
    const own = moduleOf(file), where = posix(path.relative(ROOT, file));
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) { assert.match(specifier, PEERS, `${where} imports package ${specifier}`); continue; }
      const target = resolveRelative(file, specifier), relative = posix(path.relative(SRC, target));
      assert.ok(!relative.startsWith('..'), `${where} imports ${specifier} from outside src/`);
      const other = moduleOf(target);
      if (other === own || other === 'core') continue;
      const allowed = (LIBRARY_ALLOWED[own] ?? []).some(entry => relative === entry || relative.startsWith(entry + '/'));
      assert.ok(allowed, `${where} imports ${relative}: ${own} -> ${other} is not a declared dependency`);
    }
  }
});

test('every page with its own script is a module page with an import rule, or a mixed demo', () => {
  const pages = fs.readdirSync(BENCH, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(BENCH, entry.name, 'main.js'))).map(entry => entry.name);
  for (const page of pages) assert.ok(page in PAGES || MIXED_PAGES.includes(page), `bench/${page}/ has no import rule`);
});

test('module pages import only their own modules, the ones they are built on, core, the stage and the UI tool', () => {
  for (const [page, modules] of Object.entries(PAGES)) {
    const allowed = new Set([...modules, ...EVERY_PAGE]);
    // Walk the page's bench files (its own folder, bench/kit, shared panels); stop at src/, which the test above covers.
    const seen = new Set(), queue = [path.join(BENCH, page, 'main.js')];
    if (page === 'destruction') queue.push(path.join(BENCH, page, 'parts.js'));
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolveRelative(file, specifier);
        if (!posix(path.relative(SRC, target)).startsWith('..')) {
          const module = moduleOf(target);
          assert.ok(allowed.has(module), `bench/${page}/ reaches src/${module} through ${posix(path.relative(ROOT, file))}`);
        } else if (target.endsWith('.js')) queue.push(target);
      }
    }
  }
});
