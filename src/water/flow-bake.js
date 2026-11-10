import {DataTexture, LinearFilter, MathUtils, RGBAFormat, Vector4} from 'three';

// Reduced browser adaptation of WebGPUWater's River Fluid pressure projection.
// Face fluxes enforce solid walls and leave the first and last cross sections open.
const clamp = MathUtils.clamp;
const VELOCITY_RANGE = 10;   // m/s either way: a texel's 0..1 maps to -10..10 around .5
const BYTE = 255;
// Shear foam behind rocks: (shear - from) x gain x influence; influence starts lead m upstream of a rock, squashed
// across x by xSquash, and reaches radius + reach m.
const SHEAR_FOAM = Object.freeze({from: .08, gain: 1.9});
const ROCK_INFLUENCE = Object.freeze({lead: .25, xSquash: .45, reach: 1.4});

// Steady flow field baked from a channel (sectionAt) and rock obstacles [x, z, radius, _]. origin = [left, bottom] (m),
// size = [width, height] cells, cell (m). rgb = velocity (0.5 centred, ±10 m/s), b = shear foam, a = wet.
export function createFlowBake({origin = [-34, -28.6], size: gridSize = [112, 88], cell = .65} = {}) {
 const [width, height] = gridSize, [left, bottom] = origin;
 const size = width * height;
 const pixels = new Uint8Array(size * 4);
 const texture = new DataTexture(pixels, width, height, RGBAFormat);
 texture.minFilter = texture.magFilter = LinearFilter;
 const bounds = new Vector4(left, bottom, width * cell, height * cell);
 let ready = false;
 const vx = new Float32Array(size), vz = new Float32Array(size);
 const wet = new Uint8Array(size);

 function bake(channel, rocks, iterations) {
  const u = new Float32Array((width + 1) * height);
  const v = new Float32Array(width * (height + 1));
  const divergence = new Float32Array(size);
  let p = new Float32Array(size), next = new Float32Array(size);
  const sections = Array.from({length: width}, (_, x) => channel.sectionAt(left + (x + .5) * cell));
  wet.fill(0);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
   const section = sections[x];
   const wx = left + (x + .5) * cell, wz = bottom + (z + .5) * cell;
   wet[z * width + x] = Number(Boolean(section && Math.abs(wz - section.centre) < section.width &&
    !rocks.some(rock => Math.hypot(wx - rock.x, wz - rock.y) < rock.z)));
  }
  const last = sections.findLastIndex(Boolean);
  const open = (x, z) => z >= 0 && z < height && x >= 0 && x <= last && wet[z * width + x];
  for (let z = 0; z < height; z++) for (let x = 0; x <= last; x++) {
   if (!open(x, z)) continue;
   const i = z * width + x, face = z * (width + 1) + x;
   const section = sections[x];
   const speed = section.speed / Math.hypot(1, section.slope);
   if (x === 0 || open(x - 1, z)) u[face] = speed;
   if (x === last) u[face + 1] = speed;
   if (open(x, z - 1)) v[i] = speed * section.slope;
  }
  let before = 0, after = 0;
  for (let z = 0; z < height; z++) for (let x = 0; x <= last; x++) {
   if (!open(x, z)) continue;
   const i = z * width + x, face = z * (width + 1) + x;
   divergence[i] = u[face + 1] - u[face] + v[i + width] - v[i];
   before += divergence[i] ** 2;
  }
  for (let iteration = 0; iteration < iterations; iteration++) {
   for (let z = 0; z < height; z++) for (let x = 0; x <= last; x++) {
    if (!open(x, z)) continue;
    const i = z * width + x;
    const l = open(x - 1, z), r = open(x + 1, z), d = open(x, z - 1), t = open(x, z + 1);
    const count = Number(l || x === 0) + Number(r || x === last) + Number(d) + Number(t);
    next[i] = count ? ((l ? p[i - 1] : 0) + (r ? p[i + 1] : 0) +
     (d ? p[i - width] : 0) + (t ? p[i + width] : 0) - divergence[i]) / count : 0;
   }
   [p, next] = [next, p];
  }
  vx.fill(0);
  vz.fill(0);
  for (let z = 0; z < height; z++) for (let x = 0; x <= last; x++) {
   if (!open(x, z)) continue;
   const i = z * width + x, face = z * (width + 1) + x;
   if (x === 0 || open(x - 1, z)) u[face] -= p[i] - (x ? p[i - 1] : 0);
   if (x === last) u[face + 1] += p[i];
   if (open(x, z - 1)) v[i] -= p[i] - p[i - width];
  }
  for (let z = 0; z < height; z++) for (let x = 0; x <= last; x++) {
   if (!open(x, z)) continue;
   const i = z * width + x, face = z * (width + 1) + x;
   vx[i] = .5 * (u[face] + u[face + 1]);
   vz[i] = .5 * (v[i] + v[i + width]);
   after += (u[face + 1] - u[face] + v[i + width] - v[i]) ** 2;
  }
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
   const i = z * width + x, j = i * 4;
   const wx = left + (x + .5) * cell, wz = bottom + (z + .5) * cell;
   const influence = rocks.reduce((max, rock) => {
    if (!rock.z || wx < rock.x - ROCK_INFLUENCE.lead) return max;
    return Math.max(max, 1 - Math.hypot((wx - rock.x) * ROCK_INFLUENCE.xSquash, wz - rock.y) / (rock.z + ROCK_INFLUENCE.reach));
   }, 0);
   const shear = Math.abs((open(x, z + 1) ? vx[i + width] : vx[i]) -
    (open(x, z - 1) ? vx[i - width] : vx[i])) / (2 * cell);
   pixels[j] = Math.round(clamp(.5 + vx[i] / VELOCITY_RANGE, 0, 1) * BYTE);
   pixels[j + 1] = Math.round(clamp(.5 + vz[i] / VELOCITY_RANGE, 0, 1) * BYTE);
   pixels[j + 2] = wet[i] ? Math.round(clamp((shear - SHEAR_FOAM.from) * influence * SHEAR_FOAM.gain, 0, 1) * BYTE) : 0;
   pixels[j + 3] = wet[i] * BYTE;
  }
  ready = true;
  texture.needsUpdate = true;
  return {before, after};
 }

 function sample(x, z, out) {
  const col = Math.floor((x - left) / cell), row = Math.floor((z - bottom) / cell);
  const i = row * width + col;
  if (col < 0 || col >= width || row < 0 || row >= height || !wet[i]) return false;
  out.set(vx[i], vz[i]);
  return true;
 }

 return {texture, bounds, bake, sample, get ready() { return ready; },
  invalidate() { ready = false; }, dispose() { texture.dispose(); }};
}
