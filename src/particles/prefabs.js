import {AdditiveBlending, Vector3} from 'three';
import {createPuffs} from './puffs.js';

const sheets = {
  flame: {url: new URL('../../assets/particles/flame-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true, heat: true},
  plume: {url: new URL('../../assets/particles/smoke-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true, billow: true},
  impact: {url: new URL('../../assets/particles/dust-flipbook.png', import.meta.url).href, cols: 4, rows: 4, animate: true},
};
const FLAME_WIND = 0.4;   // flames and embers lean with the wind; they are not carried like smoke
const random = (min, max) => min + Math.random() * (max - min);

export async function createParticlePrefab(scene, type, {position, size = 1, ...options} = {}) {
  if (!['fire', 'smoke', 'dust'].includes(type)) throw new RangeError('Unknown particle prefab');
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('Prefab size must be positive');
  const dustMask = options.sheets?.plume && !options.sheets?.impact ? 'plume' : 'impact';
  const prefabSheets = type === 'fire' ? {flame: sheets.flame, plume: sheets.plume}
    : type === 'smoke' ? {plume: sheets.plume} : {[dustMask]: sheets[dustMask]};
  const puffs = await createPuffs(scene, {...options, sheets: {...prefabSheets, ...options.sheets}});
  const origin = new Vector3();
  if (position) origin.copy(position);
  const spawn = new Vector3();
  let running = type !== 'dust';
  let countdown = 0;
  let burst = 0;
  const fire = type === 'fire';

  function emit(mask, spread, height, speed, scale, life, color, style) {
    spawn.copy(origin);
    spawn.x += random(-spread, spread) * size;
    spawn.y += height * size;
    spawn.z += random(-spread, spread) * size;
    puffs.emit(mask, spawn, [random(-spread, spread) * size, speed * size, 0],
      scale * size, life, color, 0, style);
  }

  function puff(smaller) {
    emit('plume', smaller ? 0.12 : 0.23, smaller ? 0.89 : 0.32,
      random(0.38, 0.66), random(0.72, 1.1), random(2.8, 4.2),
      smaller ? 0x80756a : burst % 2 ? 0xbfb9b1 : 0x918c85,
      {gravity: -0.1 * size, grow: 2.1, opacity: smaller ? 0.27 : 0.41, fadeIn: 0.45});
  }

  function impactDust() {
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI * 2 / 10 + random(-0.24, 0.24);
      const speed = random(0.85, 2.25) * size;
      spawn.copy(origin);
      spawn.y += random(0.12, 0.21) * size;
      puffs.emit(dustMask, spawn, [Math.cos(angle) * speed, random(0.14, 0.32) * size, Math.sin(angle) * speed],
        random(0.25, 0.5) * size, random(0.55, 0.95), i % 2 ? 0xb49b7b : 0x8f7862, 0,
        {gravity: 0, grow: 1.7, opacity: 0.49, fadeIn: 0.05, aspect: 2, rotation: random(-0.2, 0.2)});
    }
    for (let i = 0; i < 4; i++) {
      emit(dustMask, 0.24, 0.28, random(0.28, 0.52), random(0.35, 0.56),
        random(1.1, 1.8), 0xc5ac8e, {gravity: 0, grow: 1.9, opacity: 0.36, fadeIn: 0.16});
    }
  }

  const api = {
    position: origin,
    setEnvironment(environment) { puffs.setEnvironment(environment); },
    get active() { return puffs.active; },
    start() {
      if (type === 'dust') impactDust();
      else { running = true; countdown = 0; }
    },
    stop() { running = false; },
    clear() { puffs.clear(); },
    dispose() { running = false; puffs.clear(); puffs.dispose(); },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) return;
      puffs.update(dt);
      if (!running) return;
      countdown -= dt;
      if (countdown > 0) return;
      countdown = Math.max(0, countdown + (fire ? 0.105 : 0.15));
      burst++;
      if (!fire) {
        puff(false);
        return;
      }
      emit('flame', 0.11, 0.31, random(0.75, 1.3), random(0.82, 1.18),
        random(0.31, 0.47), 0xff9939,
        {gravity: -0.3 * size, grow: -0.4, opacity: 0.96, fadeIn: 0.045,
          aspect: 0.63, rotation: random(-0.16, 0.16), wind: FLAME_WIND});
      if (burst % 2 === 0) {
        emit('dust-soft', 0.23, 0.53, random(1.9, 2.7), random(0.045, 0.075), random(0.45, 0.85),
          0xffb240, {gravity: 0.55 * size, grow: -0.5, opacity: 0.8, blending: AdditiveBlending, wind: FLAME_WIND});
      }
      if (burst % 3 === 0) puff(true);
    },
  };
  api.tick = api.update;   // former name, kept for existing callers
  return api;
}
