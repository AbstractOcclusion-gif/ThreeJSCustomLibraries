// CPU side of the WebGPU puff pool. The GPU owns the motion; the CPU only needs to know which slots are free, so it keeps
// each slot's death time on its own clock (a puff's life is fixed at emit) and never reads the GPU back.
// Slot choice matches the WebGL puffs: the first free slot, or no puff when the pool is full.

// Per-puff record, four floats per row, one storage buffer per row (the compute kernel owns MOTION and VELOCITY after
// the emit upload; the others are written once at emit and only read).
//   motion   x, y, z, age          velocity  vx, vy, vz, life (<= 0: dead)
//   shape    size, grow, gravity, peak opacity
//   look     aspect, fadeIn, wind share, rotation
//   tint     r, g, b, lit (1 follows environment.light)
//   draw     sheet id, frame index, additive (1/0), unused
export const PUFF_ROWS = Object.freeze(['motion', 'velocity', 'shape', 'look', 'tint', 'draw']);
export const ROW_SIZE = 4;
export const DEAD = 0;

// Binary min-heap of slot indices ordered by `key(slot)`.
function slotHeap(key) {
  const items = [];
  const swap = (i, j) => ([items[i], items[j]] = [items[j], items[i]]);
  return {
    get size() {
      return items.length;
    },
    peek: () => items[0],
    push(slot) {
      items.push(slot);
      for (let i = items.length - 1; i > 0; ) {
        const parent = (i - 1) >> 1;
        if (key(items[parent]) <= key(items[i])) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop() {
      const top = items[0],
        last = items.pop();
      if (items.length) {
        items[0] = last;
        for (let i = 0; ; ) {
          const left = 2 * i + 1,
            right = left + 1;
          let least = i;
          if (left < items.length && key(items[left]) < key(items[least])) least = left;
          if (right < items.length && key(items[right]) < key(items[least])) least = right;
          if (least === i) break;
          swap(i, least);
          i = least;
        }
      }
      return top;
    },
    clear() {
      items.length = 0;
    },
  };
}

export function createSlots(capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) throw Error('Puff slots need a positive integer capacity');
  const deathAt = new Float64Array(capacity).fill(-Infinity);
  // free: lowest index first (the WebGL "first free" choice); living: soonest death first. O(log n) per puff.
  const free = slotHeap(slot => slot),
    living = slotHeap(slot => deathAt[slot]);
  let clock = 0;
  const reset = () => {
    deathAt.fill(-Infinity);
    living.clear();
    free.clear();
    for (let slot = 0; slot < capacity; slot++) free.push(slot);
  };
  reset();
  return {
    capacity,
    get clock() {
      return clock;
    },
    // A free slot for a puff living `life` seconds, or -1 when every slot is alive.
    claim(life) {
      if (!free.size) return -1;
      const slot = free.pop();
      deathAt[slot] = clock + life;
      living.push(slot);
      return slot;
    },
    // After the GPU step of dt seconds: a puff dies once its age reaches its life, as in the WebGL update.
    advance(dt) {
      clock += dt;
      while (living.size && deathAt[living.peek()] <= clock) free.push(living.pop());
    },
    alive(i) {
      return deathAt[i] > clock;
    },
    get active() {
      return capacity - free.size;
    },
    clear: reset,
  };
}

// Writes one puff into the row arrays (Float32Array per row, ROW_SIZE floats per slot). Values as emit() resolved them.
export function writePuff(rows, i, {position, velocity, life, size, grow, gravity, peak, aspect, fadeIn, wind, rotation, color, lit, sheet, frame, additive}) {
  const o = i * ROW_SIZE;
  rows.motion.set([position.x, position.y, position.z, 0], o);
  rows.velocity.set([velocity[0], velocity[1], velocity[2], life], o);
  rows.shape.set([size, grow, gravity, peak], o);
  rows.look.set([aspect, fadeIn, wind, rotation], o);
  rows.tint.set([color.r, color.g, color.b, lit ? 1 : 0], o);
  rows.draw.set([sheet, frame, additive ? 1 : 0, 0], o);
}

// Upload only the slots written since the last frame: one update range per run of consecutive slots, on every row
// attribute. A single span would also re-upload the stale CPU copy of the puffs between them, which the GPU is moving.
// Returns the runs as [first, last] pairs.
export function uploadSlots(attributes, slots) {
  if (!slots.length) return [];
  const sorted = [...new Set(slots)].sort((a, b) => a - b),
    runs = [];
  let first = sorted[0],
    last = first;
  for (const slot of sorted.slice(1)) {
    if (slot === last + 1) {
      last = slot;
      continue;
    }
    runs.push([first, last]);
    first = last = slot;
  }
  runs.push([first, last]);
  for (const attribute of attributes) {
    for (const [lo, hi] of runs) attribute.addUpdateRange(lo * ROW_SIZE, (hi - lo + 1) * ROW_SIZE);
    attribute.needsUpdate = true;
  }
  return runs;
}

// Marks every slot dead in the row arrays (clear()).
export function killAll(rows) {
  for (let o = ROW_SIZE - 1; o < rows.velocity.length; o += ROW_SIZE) rows.velocity[o] = DEAD;
}
