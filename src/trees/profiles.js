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
export const PROFILES = Object.freeze({tree: TREE_PROFILE, bush: BUSH_PROFILE});

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
// Deep-merge a partial profile over a base (arrays replace). Unknown keys are kept so a bench can carry extras.
export function mergeProfile(base, partial = {}) {
  const out = {...base};
  for (const [k, v] of Object.entries(partial)) out[k] = isObject(v) && isObject(base[k]) ? mergeProfile(base[k], v) : structuredClone(v);
  return out;
}
export function resolveProfile(profile = 'tree') {
  if (typeof profile === 'string') { if (!PROFILES[profile]) throw Error(`Unknown tree profile '${profile}'`); return structuredClone(PROFILES[profile]); }
  return mergeProfile(PROFILES[profile.base ?? (profile.name === 'bush' ? 'bush' : 'tree')], profile);
}
