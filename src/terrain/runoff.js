import {MathUtils, Vector4} from 'three';
import {createFixedStep} from '../core/fixed-step.js';
import {seededRandom} from '../core/hash.js';
import {createTrackMask} from '../core/track-mask.js';

const FLOW = {
  // Square metres of contributing ground needed for a visible stream.
  sourceArea: 3.5,
  fullWidthArea: 38,
  radius: [.13, .38],
  speedPerGrade: 3.2,
  speed: [.12, 2.1], // metres per second
  startsPerSecond: 145,
  maxHighlights: 320,
  lifespan: [1.6, 3.4],
  fadeIn: .2,
  fadeOut: .45,
  endFade: .2,
  submergedDepth: .012,
};
const RUT = {trackCoverage: .2, sourceArea: 0, fullWidthArea: 5, radius: [.11, .23], highlightShare: .45};
const HIGHLIGHT = {headRadius: .12, tailRadius: .085, tailSeconds: .22, tailStrength: .48};
const {clamp, lerp, smoothstep} = MathUtils;

export function createTerrainRunoff({field, drainage, tracks, resolution = 512, seed = 1}) {
  const {x, y: z, z: width, w: depth} = field.bounds;
  const {data: heights, width: columns, height: rows} = field.heightMap.image;
  const stepX = width / (columns - 1), stepZ = depth / (rows - 1);
  const maskOptions = {origin: [x, z], size: [width, depth], resolution};
  const channels = createTrackMask(maskOptions);
  const highlights = createTrackMask(maskOptions);
  const coverage = {value: 0};
  const random = seededRandom(seed);
  const clock = createFixedStep();
  const sample = new Vector4();
  const beads = [];
  const links = new Map();
  let starts = [], rutStarts = [], spawnCredit = 0, painted = false;

  function pointAt(index) {
    return {x: x + index % columns * stepX, z: z + Math.floor(index / columns) * stepZ};
  }

  function rebuild() {
    const {receiver, area} = drainage.bakeFlow();
    channels.clear();
    highlights.clear();
    painted = false;
    links.clear();
    rutStarts = [];
    for (let index = 0; index < receiver.length; index++) {
      const next = receiver[index];
      if (next < 0) continue;
      const from = pointAt(index), to = pointAt(next);
      // Tracks lower the visibility threshold only. The receiver is still
      // selected from the deformed terrain, including its raised snow rims.
      const inRut = tracks && tracks.sample(from.x, from.z) >= RUT.trackCoverage
        && tracks.sample(to.x, to.z) >= RUT.trackCoverage;
      const profile = inRut ? RUT : FLOW;
      if (area[index] < profile.sourceArea) continue;
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      const grade = (heights[index] - heights[next]) / length;
      const speed = clamp(grade * FLOW.speedPerGrade, ...FLOW.speed);
      const radius = lerp(...profile.radius, smoothstep(area[index], profile.sourceArea, profile.fullWidthArea));
      channels.stamp(from, to, radius);
      const link = {index, from, to, next, length, speed};
      links.set(index, link);
      if (inRut) rutStarts.push(link);
    }
    starts = [...links.values()];
    for (const bead of beads) {
      if (!bead.link) continue;
      const updated = links.get(bead.link.index);
      if (updated?.next === bead.link.next) {
        bead.link = updated;
      } else {
        bead.link = null;
        bead.life = Math.min(bead.life, bead.age + FLOW.endFade);
      }
    }
  }

  function isSubmerged(point, fill) {
    if (fill <= 0 || !drainage.sample(point.x, point.z, sample) || sample.w <= sample.z) return false;
    return lerp(sample.z, sample.w, fill) - field.heightAt(point.x, point.z) > FLOW.submergedDepth;
  }

  function spawn(fill) {
    const candidates = rutStarts.length && random() < RUT.highlightShare ? rutStarts : starts;
    const link = candidates[Math.floor(random() * candidates.length)];
    if (!link) return;
    const fraction = random();
    const head = {x: lerp(link.from.x, link.to.x, fraction), z: lerp(link.from.z, link.to.z, fraction)};
    if (isSubmerged(head, fill)) return;
    beads.push({
      link, head, tail: {...head}, distance: fraction * link.length,
      age: 0, life: lerp(...FLOW.lifespan, random()),
    });
  }

  function advance(bead, dt, fill) {
    bead.age += dt;
    if (bead.age >= bead.life) return false;
    if (!bead.link) return true;

    const {head, tail} = bead;
    const catchup = 1 - Math.exp(-dt / HIGHLIGHT.tailSeconds);
    tail.x = lerp(tail.x, head.x, catchup);
    tail.z = lerp(tail.z, head.z, catchup);

    let time = dt;
    while (bead.link && time > 0) {
      const {length, speed, from, to, next} = bead.link;
      const remaining = length - bead.distance;
      const traveled = Math.min(remaining, time * speed);
      bead.distance += traveled;
      time -= traveled / speed;
      const fraction = bead.distance / length;
      head.x = lerp(from.x, to.x, fraction);
      head.z = lerp(from.z, to.z, fraction);
      if (traveled < remaining) break;
      bead.link = links.get(next);
      bead.distance = 0;
    }
    if (!bead.link || isSubmerged(head, fill)) {
      bead.link = null;
      bead.life = Math.min(bead.life, bead.age + FLOW.endFade);
    }
    return true;
  }

  rebuild();
  return {
    texture: highlights.texture,
    film: channels.texture,
    coverage,
    rebuild,
    update(dt, {supply, amount, puddleFill, wetness = supply}) {
      coverage.value = amount * smoothstep(wetness, 0, 1);
      let advanced = false;
      clock.advance(dt, step => {
        advanced = true;
        let count = 0;
        for (const bead of beads) {
          if (advance(bead, step, puddleFill)) beads[count++] = bead;
        }
        beads.length = count;
        spawnCredit += step * supply * amount * FLOW.startsPerSecond;
        while (spawnCredit >= 1) {
          spawnCredit--;
          if (beads.length < FLOW.maxHighlights) spawn(puddleFill);
        }
      });
      if (!advanced) return;
      if (painted) highlights.clear();
      painted = beads.length > 0 && amount > 0;
      if (!painted) return;
      for (const bead of beads) {
        const fade = smoothstep(bead.age, 0, FLOW.fadeIn) * smoothstep(bead.life - bead.age, 0, FLOW.fadeOut);
        const strength = fade * amount;
        highlights.stamp(bead.tail, bead.head, HIGHLIGHT.tailRadius, strength * HIGHLIGHT.tailStrength);
        highlights.stamp(bead.head, bead.head, HIGHLIGHT.headRadius, strength);
      }
    },
    dispose() {
      channels.dispose();
      highlights.dispose();
    },
  };
}
