import {IcosahedronGeometry, MathUtils, Vector3} from 'three';
import {createChips, createPuffs} from '../../src/particles/index.js';

const POWDER_SHEET = {url: new URL('../../assets/particles/dust-flipbook.png', import.meta.url).href,
 cols: 4, rows: 4, animate: true};
const POWDER = {pool: 24, count: 5, color: 0xf4f8ff, spread: .14, rise: [.48, .78],
 back: [.18, .38], size: [.14, .28], life: [.52, .68], gravity: 4.2, grow: .8,
 fadeIn: .045, opacity: .56, wind: .10};
const CHUNKS = {pool: 48, count: 4, color: 0xeff5ff, size: [.025, .055], life: [2.5, 4],
 gravity: 9.82, bounce: .08, shock: 2};
const CONTACT = {leastDepth: .025, fullDepth: .40, lift: .018};

export async function createMeadowSnowEffects({scene, field, environment}) {
 const puffs = await createPuffs(scene, {pool: POWDER.pool, environment, sheets: {powder: POWDER_SHEET}});
 const geometry = new IcosahedronGeometry(1, 0);
 const chunks = createChips(scene, {pool: CHUNKS.pool, geometry, gravity: CHUNKS.gravity,
  baseSize: CHUNKS.size, life: CHUNKS.life, bounce: CHUNKS.bounce});
 chunks.setGround((x, z) => field.heightAt(x, z));
 const at = new Vector3();
 const between = ([min, max]) => MathUtils.randFloat(min, max);

 return {
  plant(point, heading) {
   if (!field.snowCover.value) return;
   const surface = field.heightAt(point.x, point.z);
   const loose = surface - point.y;
   if (loose < CONTACT.leastDepth || !Number.isFinite(loose)) return;
   const force = MathUtils.smoothstep(loose, CONTACT.leastDepth, CONTACT.fullDepth);
   const sin = Math.sin(heading), cos = Math.cos(heading);
   at.set(point.x, surface + CONTACT.lift, point.z);
   for (let i = 0; i < POWDER.count; i++) {
    const back = between(POWDER.back), side = MathUtils.randFloatSpread(POWDER.spread);
    puffs.emit('powder', at, [side * cos - back * sin, between(POWDER.rise), -side * sin - back * cos],
     between(POWDER.size), between(POWDER.life), POWDER.color, 0, {gravity: POWDER.gravity,
      grow: POWDER.grow, fadeIn: POWDER.fadeIn, opacity: POWDER.opacity * force, wind: POWDER.wind});
   }
   chunks.emit(at, {color: CHUNKS.color, chips: Math.ceil(CHUNKS.count * force), size: force}, CHUNKS.shock);
  },
  update(dt) { puffs.update(dt); chunks.update(dt); },
  clear() { puffs.clear(); chunks.clear(); },
  dispose() { puffs.dispose(); chunks.dispose(); geometry.dispose(); },
 };
}
