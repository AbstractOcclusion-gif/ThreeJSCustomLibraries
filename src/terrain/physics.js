// The terrain's physics (three-kit/terrain/physics): Cannon colliders of a field and of the world's relief around it,
// and the contacts tool that marks the field where bodies press, roll and land (ruts, prints, impacts, its chips).
// Its own entry, so the terrain needs cannon-es only when this is used. A Jolt host mirrors these bodies through the
// destruction module's driver.
export {createTerrainCollider, createSurroundCollider} from './colliders.js';
export {createTerrainImpacts, CONTACT_SURFACES, TRACK_RADIUS, SURROUND} from './impacts.js';
