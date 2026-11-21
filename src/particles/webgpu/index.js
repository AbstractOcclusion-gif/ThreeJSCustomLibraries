// WebGPU entry of the particles module (an option; the WebGL entry ../index.js stays the default).
// Same API as the WebGL puffs and prefabs; pass `renderer` (a WebGPURenderer) in their options.
import {createParticlePrefab as createPrefab} from '../prefabs.js';
import {createPuffs} from './puffs.js';

export {createPuffs, MAX_POOL} from './puffs.js';
export const createParticlePrefab = (scene, type, options = {}) => createPrefab(scene, type, {...options, makePuffs: createPuffs});
