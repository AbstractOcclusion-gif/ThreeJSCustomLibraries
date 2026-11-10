// UI selections for the existing worker drivers; no simulation ownership here.
// Individual-body Jolt remains in the frame labs: it fails the house idle/impact checks.
export const HOUSE_ALGORITHMS=['cannon','jolt','jolt-dynamic'];
export function housePhysicsOptions(house,params){
 const requested=params.get('backend'),algorithm=HOUSE_ALGORITHMS.includes(requested)?requested:'jolt';
 const collision=params.get('collisions');
 return {backend:algorithm==='jolt-dynamic'?'jolt':algorithm,frame:algorithm==='jolt-dynamic'?1:0,
  collisionLOD:['auto','detailed','intact'].includes(collision)?collision:house.masonry?'intact':'auto'};
}
