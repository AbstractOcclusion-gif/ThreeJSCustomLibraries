// The measured effect: the puffs' own smoke preset (puffs.smoke), fired at random points of a disc at the rate that keeps
// `count` puffs alive. Both renderer modes run exactly this, with the same pool and settings.
import {Vector3} from 'three';
import {PRESETS} from '../../src/particles/puff-config.js';
import {PREFAB_SHEETS} from '../../src/particles/prefabs.js';

// billow: the smoke preset drawn with the prefabs' smoke flipbook (crossfade + billow noise, the heavy shading);
// soft: the bundled soft mask (a still sheet, the light shading).
export const LOADS = Object.freeze({
  billow: {label: 'Billow flipbook', sheets: {smoke: PREFAB_SHEETS.plume}},
  soft: {label: 'Soft mask', sheets: {}},
});
// radius: m of the disc the bursts land in; size: burst size, m; overfill: emit this much faster than puffs die, so the
// pool stays full.
export const FIELD = Object.freeze({radius: 6, size: 1, overfill: 1.15});

const ring = PRESETS.smoke.ring;
const meanLife = Array.isArray(ring.life) ? (ring.life[0] + ring.life[1]) / 2 : ring.life;
const puffsPerSecond = count => (count / meanLife) * FIELD.overfill;

export function createPlumeLoad() {
  const at = new Vector3();
  let owed = 0;
  return {
    step(puffs, dt, count) {
      owed += (dt * puffsPerSecond(count)) / ring.count;
      for (; owed >= 1; owed--) {
        const angle = Math.random() * Math.PI * 2,
          reach = Math.sqrt(Math.random()) * FIELD.radius;
        puffs.smoke(at.set(Math.cos(angle) * reach, 0, Math.sin(angle) * reach), FIELD.size);
      }
    },
    reset() {
      owed = 0;
    },
  };
}
