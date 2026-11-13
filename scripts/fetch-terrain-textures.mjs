// Downloads the maps of every catalogue set that is missing under assets/terrain/, from Poly Haven (CC0).
// Usage: npm run textures:fetch
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TERRAIN_TEXTURE_SETS} from '../src/terrain/textures.js';

const ASSETS = fileURLToPath(new URL('../assets/terrain/', import.meta.url));
const RESOLUTION = '1k';
// Catalogue role -> Poly Haven map name (https://api.polyhaven.com/files/<id>).
const SOURCE_MAPS = Object.freeze({color: 'Diffuse', height: 'Displacement', normal: 'nor_gl', roughness: 'Rough'});

async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${url} answered ${response.status}`);
  return response;
}

let fetched = 0;
for (const set of Object.values(TERRAIN_TEXTURE_SETS)) {
  const missing = Object.entries(set.maps).filter(([, map]) => !existsSync(ASSETS + map.path));
  if (!missing.length) continue;
  const files = await (await get(`https://api.polyhaven.com/files/${set.id}`)).json();
  for (const [role, map] of missing) {
    const url = files[SOURCE_MAPS[role]]?.[RESOLUTION]?.jpg?.url;
    if (!url) throw Error(`Poly Haven has no ${RESOLUTION} JPEG ${SOURCE_MAPS[role]} map for ${set.id}`);
    const target = ASSETS + map.path;
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, Buffer.from(await (await get(url)).arrayBuffer()));
    console.log('fetched', map.path);
    fetched++;
  }
}
console.log(fetched ? `${fetched} maps added under assets/terrain/` : 'Every catalogue map is already present');
