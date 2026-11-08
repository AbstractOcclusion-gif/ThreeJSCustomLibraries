import {createSoftDiscTexture} from './soft-disc.js';
// Flipbook sheets for the water sprites. The lib ships no sheet textures (the originals are licensed FX collections): a
// project supplies them with `assetBaseUrl` (files named as OCEAN_SHEET_FILES, served from that base) or an explicit
// `sheets: {name: {url, cols, rows, fps}}` map. 'soft disc' is a generated fallback that is always available.
export const OCEAN_SHEET_LAYOUTS = Object.freeze({
  'wake front (8x8)': {file: 'wake_front_sheet.webp', cols: 8, rows: 8, fps: 23},
  'wake back (8x8)': {file: 'wake_back_sheet.webp', cols: 8, rows: 8, fps: 24},
  'propeller wake (6x6)': {file: 'propeller_wake_sheet.webp', cols: 6, rows: 6, fps: 24},
  'bubbles (8x8)': {file: 'bubbles_sheet.webp', cols: 8, rows: 8, fps: 24},
  'splashes (8x8)': {file: 'splashes_sheet.webp', cols: 8, rows: 8, fps: 30},
  'circle swell (6x6)': {file: 'circle_swell_sheet.webp', cols: 6, rows: 6, fps: 24},
  'mist (8x8)': {file: 'mist_sheet.webp', cols: 8, rows: 8, fps: 24},
  'fountain jet (8x8)': {file: 'fountain_jet_sheet.webp', cols: 8, rows: 8, fps: 24},   // an upright blow / jet
});
export const OCEAN_SHEET_FILES = Object.freeze(Object.fromEntries(Object.entries(OCEAN_SHEET_LAYOUTS).map(([k, v]) => [k, v.file])));
export const SOFT_DISC = 'soft disc';

export function createOceanSheets({THREE, assetBaseUrl, sheets: custom = {}, loadTexture} = {}) {
  // One flipbook material recipe every sprite shares: frame crossfade, alpha or additive blend, "foam" colour (luminance = foam
  // mask, lit like whitecaps) or "photo" colour (the frame's own rgb, luminance = alpha).
  const fromBase = assetBaseUrl ? Object.fromEntries(Object.entries(OCEAN_SHEET_LAYOUTS).map(([name, {file, cols, rows, fps}]) =>
    [name, {src: new URL(file, assetBaseUrl).href, cols, rows, fps}])) : {};
  const SHEETS = Object.freeze({
    [SOFT_DISC]: {src: null, cols: 1, rows: 1, fps: 1},
    ...fromBase,
    ...Object.fromEntries(Object.entries(custom).map(([name, {url, src, cols = 1, rows = 1, fps = 24}]) => [name, {src: url ?? src, cols, rows, fps}])),
  });
  const NO_SHEET = 'none (ocean foam)';   // plain coverage: the surface shader's whitecap dissolve supplies the pattern
  const SHEET_NAMES = [NO_SHEET, ...Object.keys(SHEETS)];
  const BLEND_MODES = ['alpha', 'additive'], COLOR_MODES = ['foam', 'photo'];

  const cache = new Map();
  const load = loadTexture ?? (url => new THREE.TextureLoader().load(url));
  function loadSheet(name) {
    if (!cache.has(name)) { const t = SHEETS[name].src ? load(SHEETS[name].src) : createSoftDiscTexture(THREE); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; cache.set(name, t); }   // flipY off: v = 0 is the frame TOP
    return cache.get(name);
  }
  // Uniforms every flipbook material carries; `applySheet` points them at a sheet, `applyLook` sets blend + colour mode.
  const sheetUniforms = (skyUniforms, sunDir) => ({ tSheet: { value: null }, uUseSheet: { value: 0 }, uTiles: { value: new THREE.Vector2(8, 8) }, uColorMode: { value: 0 }, uMaskLow: { value: 0.1 }, uMaskHigh: { value: 0.7 },
    uOpacity: { value: 1 }, uSunCol: skyUniforms.uSunCol, uFxAmbient: skyUniforms.uFxAmbient, uLight: { value: sunDir } });
  function applySheet(material, name) { const sh = SHEETS[name], u = material.uniforms; u.uUseSheet.value = sh ? 1 : 0; if (!sh) return null; u.tSheet.value = loadSheet(name); u.uTiles.value.set(sh.cols, sh.rows); return sh; }
  function applyLook(material, { blend = 'alpha', color = 'foam', maskLow = 0.1, maskHigh = 0.7, opacity = 1 }) {
    const additive = blend === 'additive'; material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending; material.needsUpdate = true;
    const u = material.uniforms; u.uColorMode.value = color === 'photo' ? 1 : 0; u.uMaskLow.value = maskLow; u.uMaskHigh.value = maskHigh; u.uOpacity.value = opacity;
    if (u.uFxAdditive) u.uFxAdditive = { value: additive ? 1 : 0 };
  }
  // GLSL: sampleFlipbook(uv, frame) -> rgb + alpha already resolved per colour mode (premultiplied for additive by the alpha).
  const FLIPBOOK_GLSL = /* glsl */`uniform sampler2D tSheet; uniform vec2 uTiles; uniform float uUseSheet, uColorMode, uMaskLow, uMaskHigh, uOpacity; uniform vec3 uSunCol, uLight, uFxAmbient;
    vec2 frameUv(float f, vec2 uv){ float n = uTiles.x * uTiles.y; f = mod(f, n); float col = mod(f, uTiles.x), row = floor(f / uTiles.x); return (vec2(col, row) + clamp(uv, 0.002, 0.998)) / uTiles; }
    vec4 sampleFlipbook(vec2 uv, float frame){ float f0 = floor(frame), t = frame - f0;
      float wrappedP = clamp(normalize(uLight + 1e-5).y * 0.6 + 0.4, 0.0, 1.0); if (uUseSheet < 0.5) return vec4(uFxAmbient + uSunCol * wrappedP, uOpacity);
      vec3 c = mix(texture2D(tSheet, frameUv(f0, uv)).rgb, texture2D(tSheet, frameUv(f0 + 1.0, uv)).rgb, t);
      float lum = pow(dot(c, vec3(0.3, 0.55, 0.15)), 0.4545), mask = smoothstep(uMaskLow, uMaskHigh, lum);   // mask thresholds in gamma (as the sheet reads)
      float wrapped = clamp(normalize(uLight + 1e-5).y * 0.6 + 0.4, 0.0, 1.0); vec3 foam = uFxAmbient + uSunCol * wrapped;   // FoamLitColor
      vec3 rgb = uColorMode > 0.5 ? c * (uFxAmbient * 1.4285714 + 0.5 * uSunCol) : foam; return vec4(rgb, mask * uOpacity); }`;

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;

    for (const texture of cache.values()) texture.dispose();
    cache.clear();
  }

  return {SHEETS, NO_SHEET, SHEET_NAMES, BLEND_MODES, COLOR_MODES, loadSheet, sheetUniforms, applySheet, applyLook, FLIPBOOK_GLSL, dispose};
}
