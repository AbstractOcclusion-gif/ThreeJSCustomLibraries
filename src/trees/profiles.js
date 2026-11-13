// Leaved-tree profiles: every number the geometry builder uses, as plain JSON the bench authors and saves.
// Template units: crown radius 1 in X/Z, total height 1 in Y (ground at 0). Instances scale by (r, h, r).
export const TREE_PROFILE = Object.freeze({
  name: 'tree',
  variants: 4,                                   // distinct silhouettes; an instance picks one by position hash
  trunk: {enabled: true, sides: 6, radiusBottom: .1, radiusTop: .055, belowGround: .03, topIntoCrown: .4, color: '#4b3b2c'},
  crown: {depth: .55, bottomFlatten: .6, mainRadius: 1, mainSquash: .85, fixedSquash: null, mainCentreY: null},
  lobes: {count: [2, 4], radius: [.5, .7], offset: [.45, .7], drop: [.1, .35], spread: 1, dropScale: 1, baseY: null, dropShare: 1,
    noiseAmplitude: .14, noiseFrequency: 2.6, tintJitter: .08},
  core: {detail: 1, radiusShare: .78, shade: .55},
  cards: {perUnitArea: 14, size: [.42, .62], tilt: .55, sink: .08, scale: 1, subcells: 2, yCompensation: .34, tintJitter: .12},
  shade: {bottom: .72, top: 1.12},
});
export const BUSH_PROFILE = Object.freeze({
  ...TREE_PROFILE, name: 'bush',
  trunk: {...TREE_PROFILE.trunk, enabled: false},
  crown: {...TREE_PROFILE.crown, depth: .92, fixedSquash: .8, mainCentreY: .55},
  lobes: {...TREE_PROFILE.lobes, count: [3, 5], spread: 1.15, dropScale: 1.4, baseY: .45, dropShare: .3},
  cards: {...TREE_PROFILE.cards, scale: .6},
});
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
// Deep-merge a partial profile over a base (arrays replace). Unknown keys are kept so a bench can carry extras.
export function mergeProfile(base, partial = {}) {
  const out = {...base};
  for (const [k, v] of Object.entries(partial)) out[k] = isObject(v) && isObject(base[k]) ? mergeProfile(base[k], v) : structuredClone(v);
  return out;
}
export const SPECIES = Object.freeze({
  oak: mergeProfile(TREE_PROFILE, {
    name: 'oak', trunk: {radiusBottom: .15, radiusTop: .065, topIntoCrown: .65},
    crown: {depth: .56, mainRadius: .65, mainSquash: .92},
    lobes: {count: [5, 7], radius: [.34, .53], offset: [.48, .92], drop: [-.24, .36]},
    core: {radiusShare: .54}, cards: {size: [.21, .36], perUnitArea: 54, subcells: 1},
    branches: {origin: [.32, .62], radius: .081, tipRadius: .018, bend: .1},
  }),
  birch: mergeProfile(TREE_PROFILE, {
    name: 'birch', trunk: {radiusBottom: .075, radiusTop: .019, color: '#d6c9b3', topIntoCrown: .91},
    crown: {depth: .68, mainRadius: .43, mainSquash: .8, mainCentreY: .72},
    lobes: {count: [8, 11], radius: [.19, .35], offset: [.31, .82], drop: [-.46, .42], baseY: .62},
    core: {radiusShare: .35}, cards: {size: [.16, .29], perUnitArea: 72, yCompensation: .73, subcells: 1},
    branches: {origin: [.23, .61], radius: .045, tipRadius: .008, bend: .21},
  }),
  hawthorn: mergeProfile(BUSH_PROFILE, {
    name: 'hawthorn', crown: {mainRadius: .49, mainCentreY: .67, fixedSquash: .59},
    lobes: {count: [7, 9], radius: [.26, .45], offset: [.42, .86], drop: [-.24, .33], baseY: .52},
    core: {radiusShare: .52}, cards: {size: [.3, .48], perUnitArea: 106, subcells: 1},
    branches: {count: 3, origin: [0, .08], radius: .041, tipRadius: .01, bend: .04},
  }),
  pine: mergeProfile(TREE_PROFILE, {
    name: 'pine', trunk: {radiusBottom: .105, radiusTop: .03, topIntoCrown: .91, color: '#a26e45'},
    crown: {depth: .42, mainRadius: .53, mainCentreY: .86, fixedSquash: .31},
    lobes: {count: [6, 8], radius: [.24, .43], offset: [.39, .81], drop: [-.26, .65], baseY: .79},
    core: {radiusShare: .44}, cards: {needle: true, size: [.26, .43], perUnitArea: 112, subcells: 1},
    branches: {origin: [.53, .67], radius: .025, tipRadius: .005, bend: .025},
  }),
  spruce: mergeProfile(TREE_PROFILE, {
    name: 'spruce', trunk: {radiusBottom: .086, radiusTop: .009, topIntoCrown: 1, color: '#74563e'},
    crown: {depth: .86, mainRadius: .13, mainCentreY: .95, fixedSquash: .49},
    lobes: {count: [0, 0], tiers: [
      {height: .23, reach: .67, radius: .4, branches: 6},
      {height: .38, reach: .54, radius: .36, branches: 6},
      {height: .53, reach: .42, radius: .29, branches: 5},
      {height: .68, reach: .29, radius: .23, branches: 5},
      {height: .81, reach: .16, radius: .18, branches: 4},
    ]},
    core: {radiusShare: .67}, cards: {needle: true, size: [.21, .34], perUnitArea: 76, subcells: 1},
    branches: {origin: [.22, .91], radius: .024, tipRadius: .004, bend: .018},
  }),
});
export const PROFILES = Object.freeze({tree: TREE_PROFILE, bush: BUSH_PROFILE, ...SPECIES});

export function resolveProfile(profile = 'tree') {
  if (typeof profile === 'string') { if (!PROFILES[profile]) throw Error(`Unknown tree profile '${profile}'`); return structuredClone(PROFILES[profile]); }
  return mergeProfile(PROFILES[profile.base ?? (profile.name === 'bush' ? 'bush' : 'tree')], profile);
}
