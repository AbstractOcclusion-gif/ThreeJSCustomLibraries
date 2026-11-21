// Frame-time meter. The page calls tick() once per frame with the interval since the last frame and the CPU time it
// spent (update + render submit). measure(count) rebuilds the pool at that count, waits until it is full, then samples.
export const FIXED_COUNTS = Object.freeze([500, 1000, 2000]);
export const TARGET_FRAME_MS = 1000 / 60;
// warmupMs: at least this long after a rebuild; fill: share of the count alive before sampling; timeoutMs: sample anyway
// after this; frames: frames sampled per count, or as many as fit in sampleMs (at least minFrames) on a slow GPU.
const SAMPLE = Object.freeze({warmupMs: 2500, fill: 0.95, timeoutMs: 8000, frames: 180, sampleMs: 4000, minFrames: 20});
// The 60 fps search: from `start`, multiply by `growth` until a count misses the target, then halve the gap `refine` times.
const SEARCH = Object.freeze({start: 500, growth: 2, refine: 4});
const P95 = 0.95;

const sorted = values => [...values].sort((a, b) => a - b);
const quantile = (values, q) => sorted(values)[Math.min(values.length - 1, Math.floor(q * values.length))];
const round = value => Math.round(value * 100) / 100;

export function createMeter({rebuild, active, onProgress = () => {}}) {
  let waiting = [];
  const nextFrame = () => new Promise(resolve => waiting.push(resolve));
  async function measure(count) {
    onProgress(`measuring ${count} puffs…`);
    await rebuild(count);
    const start = performance.now();
    for (;;) {
      await nextFrame();
      const waited = performance.now() - start;
      if (waited > SAMPLE.timeoutMs || (waited > SAMPLE.warmupMs && active() >= count * SAMPLE.fill)) break;
    }
    const frames = [],
      cpu = [],
      sampling = performance.now();
    const enough = () => frames.length >= SAMPLE.frames || (frames.length >= SAMPLE.minFrames && performance.now() - sampling > SAMPLE.sampleMs);
    while (!enough()) {
      const sample = await nextFrame();
      if (sample.frameMs === null) continue;
      frames.push(sample.frameMs);
      cpu.push(sample.cpuMs);
    }
    return {count, alive: active(), frameMs: round(quantile(frames, 0.5)), p95Ms: round(quantile(frames, P95)), cpuMs: round(quantile(cpu, 0.5)), frames: frames.length};
  }
  return {
    tick(sample) {
      const resolve = waiting;
      waiting = [];
      for (const done of resolve) done(sample);
    },
    measure,
    async fixed(limit) {
      const results = [];
      for (const count of FIXED_COUNTS.filter(count => count <= limit)) results.push(await measure(count));
      return results;
    },
    // Highest count whose median frame stays within 60 fps; capped: the pool limit was reached first;
    // none: not even the smallest count tried held 60 fps (the result is that count).
    async max60(limit) {
      let good = null,
        bad = null;
      for (let count = SEARCH.start; count <= limit; count *= SEARCH.growth) {
        const result = await measure(count);
        if (result.frameMs > TARGET_FRAME_MS) {
          bad = result;
          break;
        }
        good = result;
      }
      if (!bad && good?.count < limit) {
        const last = await measure(limit);
        if (last.frameMs > TARGET_FRAME_MS) bad = last;
        else good = last;
      }
      if (!bad) return {...good, capped: true, none: false};
      let low = good?.count ?? 0,
        high = bad.count;
      for (let i = 0; i < SEARCH.refine; i++) {
        const result = await measure(Math.round((low + high) / 2));
        if (result.frameMs > TARGET_FRAME_MS) {
          high = result.count;
          bad = result;
        }
        else {
          low = result.count;
          good = result;
        }
      }
      return good ? {...good, capped: false, none: false} : {...bad, capped: false, none: true};
    },
  };
}
