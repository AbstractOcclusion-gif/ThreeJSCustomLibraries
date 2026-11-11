import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const [suite, ...options] = process.argv.slice(2);
const directory = fileURLToPath(new URL(suite === 'destruction' ? '../tests/destruction/' : '../tests/', import.meta.url));
const files = readdirSync(directory, {recursive: true, withFileTypes: true})
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
  .map(entry => resolve(entry.parentPath ?? entry.path, entry.name))
  .sort();

if (!files.length) throw new Error('No test files found in ' + directory);
const result = spawnSync(process.execPath, ['--test', ...options, ...files], {stdio: 'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
