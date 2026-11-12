// The bench only. The library itself is plain ESM under src/ and needs no build.
import {defineConfig} from 'vite';
import {readdirSync, existsSync, cpSync} from 'node:fs';
import {resolve} from 'node:path';

const benchPages = Object.fromEntries(
  readdirSync('bench', {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(`bench/${d.name}/index.html`))
    .map(d => [d.name, resolve(`bench/${d.name}/index.html`)]),
);
export default defineConfig(({command}) => ({
  root: '.',
  base: process.env.BASE_PATH ?? '/',   // GitHub Pages serves a project site under /<repo>/
  publicDir: command === 'serve' ? 'private-assets' : false,  // local overrides only, never copied into a production build
  plugins: [{
    name: 'structure-catalogue',
    apply: 'build',
    writeBundle({dir}) {
      cpSync(resolve('assets/structures'), resolve(dir, 'assets/structures'), {recursive: true});
    },
  }],
  optimizeDeps: {exclude: ['jolt-physics']},
  worker: {format: 'es'},
  build: {target: 'esnext', outDir: 'dist', rollupOptions: {input: {
    root: resolve('index.html'), bench: resolve('bench/index.html'), ...benchPages,
    structureCatalogue: resolve('bench/destruction/parts.html'),
    terrainValley: resolve('bench/terrain/valley.html'),
  }}},
  server: {open: '/bench/'},
}));
