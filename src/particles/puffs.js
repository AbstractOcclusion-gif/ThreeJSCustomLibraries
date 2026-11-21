import * as T from 'three';
import {createPuffMaterial} from './puff-material.js';
import {createSwirlField} from './swirl.js';
import {
  SHEETS,
  DEFAULTS,
  WIND_RAMP,
  LIMITS,
  PRESETS,
  BUILTIN_SHEETS,
  emitSettings,
  planBurst,
  assertSheetGrid,
} from './puff-config.js';
// Billboard puffs (dust, soft dust, smoke): a fixed sprite pool with per-sprite gravity, growth and fade.
// Defaults, presets and sheets live in puff-config.js, shared with the WebGPU entry (webgpu/puffs.js).
export async function createPuffs(scene, options = {}) {
  const {
    pool,
    windResponse,
    assets,
    loadTexture = url => new T.TextureLoader().loadAsync(url),
  } = {...DEFAULTS, ...options};
  if (!Number.isFinite(windResponse) || windResponse < 0) throw Error('Puff windResponse must be non-negative');
  if (!Number.isInteger(pool) || pool < 1 || pool > LIMITS.pool) throw Error(`Puff pool must be 1..${LIMITS.pool}`);
  const sheets = {...(assets === undefined ? BUILTIN_SHEETS : SHEETS), ...options.sheets};
  const frames = Object.create(null),
    animated = Object.create(null),
    owned = [];
  const loaded = await Promise.allSettled(
    Object.entries(sheets).map(
      async ([name, {url, file, cols = 1, rows = 1, animate = false, heat = false, billow = false}]) => {
        assertSheetGrid(name, cols, rows);
        const sheet = await loadTexture(url ?? assets + file);
        sheet.colorSpace = T.SRGBColorSpace;
        owned.push(sheet);
        if (animate && cols * rows > 1) {
          // Use base-level filtering so atlas neighbors cannot bleed through the mip chain.
          sheet.generateMipmaps = false;
          sheet.minFilter = T.LinearFilter;
          sheet.needsUpdate = true;
          animated[name] = {cols, rows, heat, billow};
          frames[name] = [sheet];
          return;
        }
        frames[name] = Array.from({length: cols * rows}, (_, i) => {
          const t = sheet.clone();
          t.repeat.set(1 / cols, 1 / rows);
          t.offset.set((i % cols) / cols, (rows - 1 - Math.floor(i / cols)) / rows);
          t.needsUpdate = true;
          owned.push(t);
          return t;
        });
      },
    ),
  );
  const failure = loaded.find(result => result.status === 'rejected');
  if (failure) {
    for (const texture of owned) texture.dispose();
    throw failure.reason;
  }
  const puffs = [];
  const hasAnimation = Object.keys(animated).length > 0;
  for (let i = 0; i < pool; i++) {
    const look = createPuffMaterial(frames.dust[0], hasAnimation);
    const sprite = new T.Sprite(look.material);
    sprite.visible = false;
    scene.add(sprite);
    puffs.push({...look, sprite, active: false, age: 0, life: 1, v: new T.Vector3(), base: new T.Color()});
  }
  // Optional core/environment.js contract, held by reference: wind drifts the puffs, light tints the lit ones. null = neither.
  let disposed = false,
    environment = options.environment ?? null;
  // The swirling air (swirl.js) the puffs emitted with a `swirl` speed are carried by; options.swirl: its settings.
  const swirl = createSwirlField(options.swirl),
    flow = new T.Vector3();
  let clock = 0; // s the pool has run: the swirl's time
  // opts: gravity (m/s^2 down, negative rises), grow (scale gain over life), opacity (peak), wind (drift scale, default 1),
  // swirl (m/s the pool's swirling air carries it at, on top of its own velocity; default 0: none),
  // lit (follows environment.light; default: everything except glowing puffs - heat sheets and additive blending).
  function emit(name, position, velocity, size, life, color, index = 0, opts = {}) {
    if (disposed || !frames[name] || (options.isRelevant && !options.isRelevant(position))) return false;
    const p = puffs.find(p => !p.active);
    if (!p) return false;
    p.active = true;
    p.age = 0;
    p.life = life;
    p.size = size;
    const settings = emitSettings(name, opts);
    p.gravity = settings.gravity;
    p.grow = settings.grow;
    p.peak = settings.peak;
    p.v.set(velocity[0], velocity[1], velocity[2]);
    p.aspect = settings.aspect;
    p.fadeIn = settings.fadeIn;
    const animation = animated[name];
    p.tiles.set(animation?.cols ?? 1, animation?.rows ?? 1);
    p.frame.value = 0;
    p.heat.value = animation?.heat ? 1 : 0;
    p.billow.value = animation?.billow ? 1 : 0;
    p.sprite.position.copy(position);
    p.material.map = frames[name][index % frames[name].length];
    p.material.opacity = p.fadeIn > 0 ? 0 : p.peak;
    p.material.rotation = opts.rotation ?? Math.random() * Math.PI * 2;
    p.material.blending = opts.blending ?? T.NormalBlending;
    p.wind = settings.wind;
    p.swirl = opts.swirl ?? 0;
    p.lit = opts.lit ?? !(animation?.heat || p.material.blending === T.AdditiveBlending);
    p.base.setHex(color);
    p.material.color.copy(p.base);
    if (environment && p.lit) p.material.color.multiply(environment.light);
    p.sprite.scale.set(size * p.aspect, size, 1);
    p.sprite.visible = true;
    return true;
  }
  function burst(position, size, color, preset) {
    planBurst(size, preset, (mask, velocity, puffSize, life, frame, opts) =>
      emit(mask, position, velocity, puffSize, life, color, frame, opts),
    );
  }
  const api = {
    emit,
    setEnvironment(next) {
      environment = next ?? null;
    },
    // Mortar powder: a brief burst and a restrained, slower residual cloud; a landing is smaller and has fewer puffs.
    mortar(position, size, {landing = false} = {}) {
      burst(position, size, PRESETS.mortar.color, landing ? PRESETS.mortarLanding : PRESETS.mortar);
    },
    // Concrete-coloured dust ring at an impact point; size in metres.
    dust(position, size, color = PRESETS.dust.color) {
      burst(position, size, color, PRESETS.dust);
    },
    // Slow rising smoke/dust cloud for a crushed panel; size in metres.
    smoke(position, size, color = PRESETS.smoke.color) {
      burst(position, size, color, PRESETS.smoke);
    },
    // A local stir of the air: every living puff within `radius` (m) of `center` takes `velocity` (m/s, [x, y, z]) on
    // top of its own, in full at the centre and fading to nothing at the edge. A hand through smoke, a door's draught.
    disturb(center, radius, velocity) {
      if (disposed) return;
      if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Puff disturbance radius must be positive');
      for (const p of puffs) {
        if (!p.active) continue;
        const share = 1 - p.sprite.position.distanceTo(center) / radius;
        if (share <= 0) continue;
        p.v.x += velocity[0] * share;
        p.v.y += velocity[1] * share;
        p.v.z += velocity[2] * share;
      }
    },
    update(dt) {
      if (disposed) return;
      const drift = environment ? windResponse : 0;
      clock += dt;
      for (const p of puffs) {
        if (!p.active) continue;
        p.age += dt;
        const t = p.age / p.life;
        if (t >= 1 || (options.isRelevant && !options.isRelevant(p.sprite.position))) {
          p.active = false;
          p.sprite.visible = false;
          continue;
        }
        p.sprite.position.addScaledVector(p.v, dt);
        p.v.y -= dt * p.gravity;
        if (drift > 0) {
          const carried = drift * p.wind * Math.min(1, p.age / WIND_RAMP) * dt;
          p.sprite.position.x += environment.wind.x * carried;
          p.sprite.position.z += environment.wind.z * carried;
        }
        if (p.swirl > 0) {
          // Eased in over the swirl's ramp: a new puff still follows the thread it left in.
          const felt = Math.min(1, p.age / swirl.ramp);
          swirl.sample(flow, p.sprite.position.x, p.sprite.position.y, p.sprite.position.z, clock);
          p.sprite.position.addScaledVector(flow, p.swirl * felt * felt * dt);
        }
        if (environment && p.lit) p.material.color.copy(p.base).multiply(environment.light);
        const fadeIn = p.fadeIn > 0 ? Math.min(1, p.age / p.fadeIn) : 1;
        const scale = p.size * (1 + t * p.grow);
        p.frame.value = t * (p.tiles.x * p.tiles.y - 1);
        p.material.opacity = (1 - t) * p.peak * fadeIn;
        p.sprite.scale.set(scale * p.aspect, scale, 1);
      }
    },
    get active() {
      return puffs.reduce((n, p) => n + (p.active ? 1 : 0), 0);
    },
    clear() {
      for (const p of puffs) {
        p.active = false;
        p.sprite.visible = false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const p of puffs) {
        scene.remove(p.sprite);
        p.material.dispose();
      }
      for (const t of owned) t.dispose();
    },
  };
  api.tick = api.update; // former name, kept for existing callers
  return api;
}
