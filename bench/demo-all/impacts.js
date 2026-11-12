import {createChips} from '../../src/particles/index.js';
import {createTerrainImpacts as createTerrainContacts} from '../terrain/impacts.js';

// Here the track mask mostly flattens grass, and grass bends under the whole width of a body, not only in its rut:
// the boulder is .72 m in radius and the block about .9 m long.
const GRASS_TRACK_RADIUS = Object.freeze({sphere: .7, box: .8});

export function createTerrainImpacts(options) {
 const chips = createChips(options.scene, {pool: 128, life: [2, 3.5], baseSize: [.15, .36]});
 return createTerrainContacts({trackRadius: GRASS_TRACK_RADIUS, ...options, chips});
}
