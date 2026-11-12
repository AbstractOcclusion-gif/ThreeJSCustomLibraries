const LICENSE = 'CC0-1.0';
const COLOR_AND_HEIGHT = ['color', 'height'];
const PBR_MAPS = [...COLOR_AND_HEIGHT, 'normal', 'roughness'];
const MAP_COLOR_SPACES = Object.freeze({color: 'srgb', height: 'linear', normal: 'linear', roughness: 'linear'});

function textureSet(id, label, roles = PBR_MAPS) {
  const maps = Object.fromEntries(roles.map(role => [role, Object.freeze({
    path: `${id}/${role}.jpg`,
    colorSpace: MAP_COLOR_SPACES[role],
    ...(role === 'normal' && {convention: 'OpenGL'}),
  })]));
  return Object.freeze({
    id, label, license: LICENSE, source: `https://polyhaven.com/a/${id}`,
    maps: Object.freeze(maps),
  });
}

export const TERRAIN_TEXTURE_SETS = Object.freeze(Object.fromEntries([
  textureSet('sparse_grass', 'Sparse Grass'),
  textureSet('rock_wall_02', 'Rock Wall 02'),
  textureSet('snow_02', 'Snow 02'),
  textureSet('brown_mud', 'Brown Mud', COLOR_AND_HEIGHT),
  textureSet('mud_forest', 'Mud Forest'),
].map(set => [set.id, set])));

export const DEFAULT_TERRAIN_TEXTURES = Object.freeze({
  grass: 'sparse_grass',
  rock: 'rock_wall_02',
  snow: 'snow_02',
  mud: 'brown_mud',
  forest: 'mud_forest',
});

export function getTerrainTextureMap(setId, role) {
  const set = Object.hasOwn(TERRAIN_TEXTURE_SETS, setId) && TERRAIN_TEXTURE_SETS[setId];
  if (!set || !Object.hasOwn(set.maps, role)) {
    throw new RangeError(`Unknown terrain texture map: ${setId}/${role}`);
  }
  return set.maps[role];
}
