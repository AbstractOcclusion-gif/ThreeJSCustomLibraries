// The bench only. The library itself is plain ESM under src/ and needs no build.
import {defineConfig} from 'vite';
import {readdirSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';

const benchPages = Object.fromEntries(
  readdirSync('bench', {withFileTypes: true}).filter(d => d.isDirectory() && existsSync(`bench/${d.name}/index.html`))
    .map(d => [d.name, resolve(`bench/${d.name}/index.html`)]),
);
export default defineConfig({
  root: '.',
  base: process.env.BASE_PATH ?? '/',   // GitHub Pages serves a project site under /<repo>/
  publicDir: 'private-assets',  // served at /, gitignored: drop Synty / Enviro / licensed textures here
  build: {target: 'esnext', outDir: 'dist', rollupOptions: {input: {root: resolve('index.html'), bench: resolve('bench/index.html'), ...benchPages}}},
  server: {open: '/bench/'},
});
