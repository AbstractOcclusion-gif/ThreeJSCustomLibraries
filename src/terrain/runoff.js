import {MathUtils, Vector4} from 'three';
import {createFixedStep} from '../core/fixed-step.js';
import {seededRandom} from '../core/hash.js';
import {createTrackMask} from '../core/track-mask.js';

const FLOW = {
  minimumGrade: .065,
  speedPerGrade: 3.2, // m/s per metre of drop per horizontal metre
  maxSpeed: 2.1,
  startsPerSecond: 160,
  maxHeads: 384,
  lifespan: [1.6, 3.4],
  fadeIn: .2,
  fadeOut: .45,
  stallFade: .2,
  submergedDepth: .012,
};
const FOOTPRINT = {headRadius: .17, tailRadius: .115, tailSeconds: .22, tailStrength: .48};
const {lerp, smoothstep} = MathUtils;

// Persistent surface beads. The terrain owns their height and supplies the
// grade; the track mask rasterizes their wet heads and trailing films.
export function createTerrainRunoff({field, drainage, resolution = 512, seed = 1}) {
  const {x, y: z, z: width, w: depth} = field.bounds;
  const mask = createTrackMask({origin: [x, z], size: [width, depth], resolution});
  const random = seededRandom(seed);
  const clock = createFixedStep();
  const sample = new Vector4();
  const beads = [];
  let spawnCredit = 0, painted = false;

  function isSubmerged(height, fill) {
    return sample.w > sample.z && lerp(sample.z, sample.w, fill) - height > FLOW.submergedDepth;
  }

  function spawn(fill) {
    const px = x + random() * width, pz = z + random() * depth;
    if (!drainage.sample(px, pz, sample) || Math.hypot(sample.x, sample.y) < FLOW.minimumGrade) return;
    if (isSubmerged(field.heightAt(px, pz), fill)) return;
    beads.push({
      head: {x: px, z: pz},
      tail: {x: px, z: pz},
      age: 0,
      life: lerp(...FLOW.lifespan, random()),
      stalled: false,
    });
  }

  function advance(bead, dt, fill) {
    bead.age += dt;
    if (bead.age >= bead.life) return false;
    if (bead.stalled) return true;
    const {head, tail} = bead;
    const height = field.heightAt(head.x, head.z);
    if (!drainage.sample(head.x, head.z, sample)) return false;
    const grade = Math.hypot(sample.x, sample.y);
    const displacement = dt * Math.min(FLOW.speedPerGrade, FLOW.maxSpeed / Math.max(grade, FLOW.minimumGrade));
    const nextX = head.x + sample.x * displacement;
    const nextZ = head.z + sample.y * displacement;
    const nextHeight = field.heightAt(nextX, nextZ);
    if (nextHeight === undefined) return false;
    if (grade < FLOW.minimumGrade || nextHeight >= height || isSubmerged(height, fill)) {
      bead.stalled = true;
      bead.life = Math.min(bead.life, bead.age + FLOW.stallFade);
      return true;
    }
    const catchup = 1 - Math.exp(-dt / FOOTPRINT.tailSeconds);
    tail.x = lerp(tail.x, head.x, catchup);
    tail.z = lerp(tail.z, head.z, catchup);
    head.x = nextX;
    head.z = nextZ;
    return true;
  }

  return {
    texture: mask.texture,
    update(dt, {rain, amount, puddleFill}) {
      let advanced = false;
      clock.advance(dt, step => {
        advanced = true;
        let count = 0;
        for (const bead of beads) {
          if (advance(bead, step, puddleFill)) beads[count++] = bead;
        }
        beads.length = count;
        spawnCredit += step * rain * amount * FLOW.startsPerSecond;
        while (spawnCredit >= 1) {
          spawnCredit--;
          if (beads.length < FLOW.maxHeads) spawn(puddleFill);
        }
      });
      if (!advanced) return;
      if (painted) mask.clear();
      painted = beads.length > 0 && amount > 0;
      if (!painted) return;
      for (const bead of beads) {
        const fade = smoothstep(bead.age, 0, FLOW.fadeIn) * smoothstep(bead.life - bead.age, 0, FLOW.fadeOut);
        const strength = fade * amount;
        mask.stamp(bead.tail, bead.head, FOOTPRINT.tailRadius, strength * FOOTPRINT.tailStrength);
        mask.stamp(bead.head, bead.head, FOOTPRINT.headRadius, strength);
      }
    },
    dispose: () => mask.dispose(),
  };
}
