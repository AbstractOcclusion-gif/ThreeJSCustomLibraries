import data from './material-profiles.json' with {type:'json'};

function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export const STRUCTURE_MATERIALS=freeze(data.materials);
export const STRUCTURE_ATLAS=freeze(data.atlas);
export function structureMaterial(id){const profile=STRUCTURE_MATERIALS[id];if(!profile)throw Error(`Unknown structure material ${id}`);return profile;}
