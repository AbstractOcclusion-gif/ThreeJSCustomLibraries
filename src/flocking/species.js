import {IMPORTED_FISH} from './imported-catalogue.js';

// Species profiles and mixed-shoal affinities from WebAquarium fish/state.js and fish/species.js.
const SPECIES = [
  { key: 'roach', girth: 0.2, name: 'Roach', size: 1.0,  speed: 1.0,  school: 1.0, depth: -0.45, depthK: 0.25, rough: 0.5, metal: 0.15, wave: [0.055, 0.004, 4.5, 1.0] },
  { key: 'rudd', girth: 0.2,  name: 'Rudd',  size: 1.0,  speed: 1.05, school: 1.0, depth: -0.22, depthK: 0.45, rough: 0.5, metal: 0.15, wave: [0.055, 0.004, 4.5, 1.0] },   // surface feeder
  { key: 'perch', girth: 0.22, name: 'Perch', size: 1.15, speed: 0.9,  school: 0.6, depth: -0.62, depthK: 0.35, rough: 0.6, metal: 0.05, wave: [0.05, 0.004, 4.2, 1.2] },   // loose groups, lower, near cover
  // bottom dweller: slow, loose groups, roots in the sand (silt puffs + dents), too big for the arch
  { key: 'carp', girth: 0.26,  name: 'Carp',  size: 1.7,  speed: 0.75, school: 0.4, depth: -0.78, depthK: 0.6,  rough: 0.55, metal: 0.1, wave: [0.05, 0.004, 4.0, 1.0], bottom: true, noArch: true },
  // lone ambush predator: hovers almost still, strikes at prey in front of it; the others keep their distance
  { key: 'pike', girth: 0.14,  name: 'Pike',  size: 2.2,  speed: 0.8,  school: 0.0, depth: -0.45, depthK: 0.3,  rough: 0.5, metal: 0.1, wave: [0.07, 0.003, 5.0, 0.7], pred: true, noArch: true, noJump: true, noFood: true } ];
SPECIES.push(...IMPORTED_FISH.map(sp => ({ ...sp, wave: sp.wave.slice() })));
const SP_DEF = { level: 0, cover: 0, hop: 0, inertia: 0, graze: 0, turnSlow: 0.3, react: 0.08, dens: 3, fwd: 1.5, commit: 0.4, pause: 0.5, space: 1.2, schoolSpace: 0.8, separation: 1, turn: 1, wander: 1, jump: 1, curl: 0.12, pivot: 1.2 };
// per-species overrides of SP_DEF (level / cover / hop / inertia / graze = species traits, toggle: species traits)
const SP_OVR = {
  roach: { react: 0.05, dens: 3, aff_rudd: 0.7, aff_perch: 0.3 },
  rudd:  { react: 0.06, dens: 3, aff_roach: 0.7, aff_perch: 0.2, level: 1 },
  perch: { react: 0.1, dens: 2, aff_roach: 0.4, aff_rudd: 0.3, cover: 1, hop: 1 },
  carp:  { schoolSpace: 1.0, turn: 0.8, commit: 0.6, pause: 0.7, react: 0.18, dens: 1, turnSlow: 0.1, inertia: 1, graze: 1 },   // carp: inertial, keeps its speed through wide turns
  pike:  { fwd: 2.2, space: 1.4, wander: 0.3, jump: 0, turn: 0.9, curl: 0.08, pivot: 0.9 } };   // pike: stiffer body
export const FISH_SPECIES = Object.freeze(Object.fromEntries(SPECIES.map(sp => [sp.key, Object.freeze({
 ...SP_DEF, ...sp, ['aff_' + sp.key]: sp.pred ? 0 : 1, ...SP_OVR[sp.key],
})])));
