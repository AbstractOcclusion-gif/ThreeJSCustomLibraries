import {DEFAULT_TERRAIN_TEXTURES, TERRAIN_TEXTURE_SETS} from '../../src/terrain/textures.js';
import {loadTerrainTextures, terrainTextureUrl} from './textures.js';

export function mountTexturePicker(renderer, applyTextures) {
  const layer = document.getElementById('texture-layer');
  const set = document.getElementById('texture-set');
  const map = document.getElementById('texture-map');
  const preview = document.getElementById('texture-preview');
  const source = document.getElementById('texture-source');
  const apply = document.getElementById('texture-apply');
  const status = document.getElementById('texture-status');
  let sets = {...DEFAULT_TERRAIN_TEXTURES};
  let disposed = false;

  for (const name of Object.keys(sets)) layer.add(new Option(name, name));
  for (const entry of Object.values(TERRAIN_TEXTURE_SETS)) set.add(new Option(entry.label, entry.id));

  function showMap() {
    preview.src = terrainTextureUrl(set.value, map.value);
    preview.alt = TERRAIN_TEXTURE_SETS[set.value].label + ' ' + map.value + ' map';
  }

  function showSet() {
    const entry = TERRAIN_TEXTURE_SETS[set.value];
    map.replaceChildren(...Object.keys(entry.maps).map(role => new Option(role, role)));
    source.href = entry.source;
    showMap();
  }

  layer.onchange = () => { set.value = sets[layer.value]; showSet(); };
  set.onchange = showSet;
  map.onchange = showMap;
  layer.onchange();
  apply.onclick = async () => {
    const target = layer.value;
    const next = {...sets, [target]: set.value};
    apply.disabled = true;
    status.textContent = 'Loading textures…';
    try {
      const textures = await loadTerrainTextures(renderer, {sets: next});
      if (disposed) {
        for (const texture of Object.values(textures)) texture?.dispose();
        return;
      }
      applyTextures(textures);
      sets = next;
      status.textContent = TERRAIN_TEXTURE_SETS[next[target]].label + ' applied to ' + target;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      apply.disabled = false;
    }
  };
  return () => { disposed = true; };
}
