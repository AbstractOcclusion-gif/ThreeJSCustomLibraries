// WebGPU puffs: the same API, hooks and defaults as ../puffs.js (createPuffs), simulated in a compute shader and drawn as
// instanced sprites, one draw per sheet and blend mode in use instead of one draw per puff.
// Extra option: `renderer`, a WebGPURenderer (its WebGL 2 fallback runs the same compute). Differences from the WebGL
// entry: `isRelevant` is checked at emit only (a GPU step cannot call back into JS); blending is normal or additive;
// puffs inside one draw are not depth-sorted against each other.
import * as T from 'three/webgpu';
import {instancedArray} from 'three/tsl';
import {SHEETS, DEFAULTS, PRESETS, BUILTIN_SHEETS, emitSettings, planBurst, assertSheetGrid} from '../puff-config.js';
import {createSlots, writePuff, uploadSlots, killAll, PUFF_ROWS} from './slots.js';
import {createPuffStep, createPuffMaterial, createLightUniform} from './puff-nodes.js';

// One draw call covers the whole pool, so the GPU entry allows far larger pools than the WebGL sprites (LIMITS.pool).
export const MAX_POOL = 262144;
const WHITE = new T.Color(1, 1, 1);
const blendKey = (sheetId, additive) => sheetId * 2 + (additive ? 1 : 0);

async function loadSheets(sheets, assets, loadTexture) {
  const loaded = new Map(),
    owned = [];
  const results = await Promise.allSettled(
    Object.entries(sheets).map(async ([name, {url, file, cols = 1, rows = 1, animate = false, heat = false, billow = false}]) => {
      assertSheetGrid(name, cols, rows);
      const map = await loadTexture(url ?? assets + file);
      map.colorSpace = T.SRGBColorSpace;
      owned.push(map);
      const animated = animate && cols * rows > 1;
      if (animated) {
        // Base-level filtering so atlas neighbours cannot bleed through the mip chain (as puffs.js).
        map.generateMipmaps = false;
        map.minFilter = T.LinearFilter;
        map.needsUpdate = true;
      }
      const {width = 1, height = 1} = map.image ?? {};
      loaded.set(name, {map, cols, rows, animated, heat: animated && heat, billow: animated && billow, width, height});
    }),
  );
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    for (const texture of owned) texture.dispose();
    throw failure.reason;
  }
  // Ids in declaration order, so a sheet keeps its id whatever loaded first.
  let id = 0;
  for (const name of Object.keys(sheets)) loaded.get(name).id = id++;
  return {loaded, owned};
}

export async function createPuffs(scene, options = {}) {
  const {pool, windResponse, assets, renderer, loadTexture = url => new T.TextureLoader().loadAsync(url)} = {...DEFAULTS, ...options};
  if (!renderer?.isWebGPURenderer) throw Error('WebGPU puffs need a WebGPURenderer (options.renderer)');
  if (!Number.isFinite(windResponse) || windResponse < 0) throw Error('Puff windResponse must be non-negative');
  if (!Number.isInteger(pool) || pool < 1 || pool > MAX_POOL) throw Error(`Puff pool must be 1..${MAX_POOL}`);
  if (!renderer.hasInitialized()) await renderer.init(); // init() throws once done; a pending init is shared
  const {loaded: sheets, owned} = await loadSheets({...(assets === undefined ? BUILTIN_SHEETS : SHEETS), ...options.sheets}, assets, loadTexture);

  const nodes = Object.fromEntries(PUFF_ROWS.map(name => [name, instancedArray(pool, 'vec4')]));
  const arrays = Object.fromEntries(PUFF_ROWS.map(name => [name, nodes[name].value.array]));
  const attributes = PUFF_ROWS.map(name => nodes[name].value);
  const slots = createSlots(pool),
    step = createPuffStep(nodes, pool),
    light = createLightUniform();
  const draws = new Map(),
    pending = [],
    color = new T.Color();
  // A draw per sheet and blend mode, made on first use.
  function drawFor(sheet, additive) {
    const key = blendKey(sheet.id, additive);
    if (!draws.has(key)) {
      const sprite = new T.Sprite(createPuffMaterial(nodes, sheet, additive, light));
      sprite.count = pool;
      sprite.frustumCulled = false;
      scene.add(sprite);
      draws.set(key, sprite);
    }
    return draws.get(key);
  }

  // Optional core/environment.js contract, held by reference: wind drifts the puffs, light tints the lit ones. null = neither.
  let disposed = false,
    environment = options.environment ?? null;
  // Same signature and options as puffs.js emit(). opts.blending: NormalBlending or AdditiveBlending.
  function emit(name, position, velocity, size, life, hex, index = 0, opts = {}) {
    const sheet = sheets.get(name);
    if (disposed || !sheet || (options.isRelevant && !options.isRelevant(position))) return false;
    const slot = slots.claim(life);
    if (slot < 0) return false;
    const settings = emitSettings(name, opts),
      additive = (opts.blending ?? T.NormalBlending) === T.AdditiveBlending;
    drawFor(sheet, additive);
    writePuff(arrays, slot, {
      ...settings,
      position,
      velocity,
      life,
      size,
      rotation: opts.rotation ?? Math.random() * Math.PI * 2,
      color: color.setHex(hex),
      lit: opts.lit ?? !(sheet.heat || additive),
      sheet: sheet.id,
      frame: sheet.animated ? 0 : index % (sheet.cols * sheet.rows),
      additive,
    });
    pending.push(slot);
    return true;
  }
  function burst(position, size, hex, preset) {
    planBurst(size, preset, (mask, velocity, puffSize, life, frame, opts) => emit(mask, position, velocity, puffSize, life, hex, frame, opts));
  }
  const api = {
    emit,
    setEnvironment(next) {
      environment = next ?? null;
    },
    mortar(position, size, {landing = false} = {}) {
      burst(position, size, PRESETS.mortar.color, landing ? PRESETS.mortarLanding : PRESETS.mortar);
    },
    dust(position, size, hex = PRESETS.dust.color) {
      burst(position, size, hex, PRESETS.dust);
    },
    smoke(position, size, hex = PRESETS.smoke.color) {
      burst(position, size, hex, PRESETS.smoke);
    },
    update(dt) {
      if (disposed) return;
      uploadSlots(attributes, pending);
      pending.length = 0;
      step.dt.value = dt;
      step.drift.value = environment ? windResponse : 0;
      if (environment) step.wind.value.set(environment.wind.x, environment.wind.z);
      light.value.copy(environment ? environment.light : WHITE);
      renderer.compute(step.node);
      slots.advance(dt);
    },
    get active() {
      return slots.active;
    },
    // Draw calls in use (one per sheet and blend mode emitted so far).
    get draws() {
      return draws.size;
    },
    clear() {
      slots.clear();
      killAll(arrays);
      pending.length = 0;
      for (const attribute of attributes) {
        attribute.clearUpdateRanges();
        attribute.needsUpdate = true;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sprite of draws.values()) {
        scene.remove(sprite);
        sprite.material.dispose();
      }
      step.node.dispose();
      for (const texture of owned) texture.dispose();
    },
  };
  api.tick = api.update; // the WebGL entry's former name
  return api;
}
