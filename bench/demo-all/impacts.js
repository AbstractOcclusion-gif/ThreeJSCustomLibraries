import {createChips} from '../../src/particles/index.js';
import {createTerrainImpacts as createTerrainContacts} from '../terrain/impacts.js';

export function createTerrainImpacts(options) {
 const chips = createChips(options.scene, {pool: 128, life: [2, 3.5], baseSize: [.15, .36]});
 return createTerrainContacts({...options, chips});
}
