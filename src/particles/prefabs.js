import {AdditiveBlending, Vector3} from 'three';
import {createPuffs} from './puffs.js';

const sheets = {
  flame: {url: new URL('../../assets/particles/flame-mask.svg', import.meta.url).href},
  plume: {url: new URL('../../assets/particles/smoke-mask.svg', import.meta.url).href},
};
const random = (min, max) => min + Math.random() * (max - min);

export async function createParticlePrefab(scene, type, {position, size = 1, ...options} = {}) {
  if (!['fire', 'smoke', 'dust'].includes(type)) throw new RangeError('Unknown particle prefab');
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('Prefab size must be positive');
  const puffs = await createPuffs(scene, {...options, sheets: {...sheets, ...options.sheets}});
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
    emit('plume', smaller ? 0.17 : 0.38, smaller ? 0.9 : 0.32,
      random(0.48, 0.82), random(0.65, 1.05), random(2.8, 4.2),
      smaller ? 0x72777d : burst % 2 ? 0xa8adb5 : 0x68717b,
      {gravity: -0.12 * size, grow: 2.2, opacity: smaller ? 0.27 : 0.51, fadeIn: 0.18});
  }

  function impactDust() {
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI * 2 / 10 + random(-0.24, 0.24);
      const speed = random(0.85, 2.25) * size;
      spawn.copy(origin);
      spawn.y += random(0.12, 0.21) * size;
      puffs.emit('plume', spawn, [Math.cos(angle) * speed, random(0.14, 0.32) * size, Math.sin(angle) * speed],
        random(0.25, 0.5) * size, random(0.55, 0.95), i % 2 ? 0xb49b7b : 0x8f7862, 0,
        {gravity: 0, grow: 1.7, opacity: 0.49, fadeIn: 0.05, aspect: 2, rotation: random(-0.2, 0.2)});
    }
    for (let i = 0; i < 4; i++) {
      emit('plume', 0.24, 0.28, random(0.28, 0.52), random(0.35, 0.56),
        random(1.1, 1.8), 0xc5ac8e, {gravity: 0, grow: 1.9, opacity: 0.36, fadeIn: 0.16});
    }
  }

  return {
    position: origin,
    get active() { return puffs.active; },
    start() {
      if (type === 'dust') impactDust();
      else { running = true; countdown = 0; }
    },
    stop() { running = false; },
    clear() { puffs.clear(); },
    dispose() { running = false; puffs.clear(); puffs.dispose(); },
    tick(dt) {
      if (!Number.isFinite(dt) || dt < 0) return;
      puffs.tick(dt);
      if (!running) return;
      countdown -= dt;
      if (countdown > 0) return;
      const interval = fire ? 0.036 : 0.105;
      countdown = Math.max(0, countdown + interval);
      burst++;
      if (!fire) {
        puff(false);
        return;
      }
      emit('flame', 0.25, 0.28, random(1.0, 1.65), random(0.7, 1.15),
        random(0.45, 0.72), burst % 3 ? 0xff7b22 : 0xffc950,
        {gravity: -0.35 * size, grow: -0.55, opacity: 0.72, fadeIn: 0.08,
          aspect: 0.75, rotation: random(-0.35, 0.35), blending: AdditiveBlending});
      if (burst % 4 === 0) {
        emit('dust-soft', 0.26, 0.48, random(1.6, 2.5), 0.12, random(0.55, 0.95),
          0xffb240, {gravity: -0.15 * size, grow: -0.5, blending: AdditiveBlending});
      }
      if (burst % 6 === 0) puff(true);
    },
  };
}
