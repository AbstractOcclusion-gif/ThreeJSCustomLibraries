import * as THREE from 'three';
import {createSchoolStage} from './school.js';
import {createFishMesh} from './fish-mesh.js';
import {FISH_SPECIES} from './species.js';

export {FISH_SPECIES};
// Bundled species (assets/fish/README.md). Override with `modelsUrl` or a parsed `models` object.
export const BUNDLED_FISH_MODELS_URL = new URL('../../assets/fish/webaquarium-species.json', import.meta.url).href;
const LVREF = [1, 1.5, 1.5, .8, .6, 1], SKIN = .08;
const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
function noise(seed, time) {
 const i = Math.floor(time), u = time - i, w = u * u * u * (u * (u * 6 - 15) + 10);
 const gradient = k => { const v = Math.sin(k * 127.1 + seed * 311.7) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };
 return .5 + gradient(i) * u * (1 - w) + gradient(i + 1) * (u - 1) * w;
}

export async function createFishFlock({
 modelsUrl = BUNDLED_FISH_MODELS_URL, models: givenModels = null,
 bounds, counts = {roach: 10, rudd: 6, perch: 4}, size = .7, random = Math.random,
 surfaceHeight = () => bounds.max.y, floorHeight = () => bounds.min.y, signal,
} = {}) {
 if (!bounds?.isBox3 || bounds.isEmpty() || !(size > 0)) throw new TypeError('Flock needs swim bounds and a positive size');
 const species = Object.entries(counts).filter(([, count]) => count > 0);
 for (const [key, count] of species) {
  if (!Object.hasOwn(FISH_SPECIES, key) || !Number.isInteger(count) || count > 300) throw new RangeError(`Invalid flock count for ${key}`);
 }
 let models = givenModels;
 if (!models) {
  const response = await fetch(modelsUrl, {signal});
  if (!response.ok) throw new Error(`Could not load fish models (${response.status})`);
  models = await response.json();
 }
 const clock = {value: 0};
 const loaded = await Promise.allSettled(species.map(([key, count]) => createFishMesh(models[key], FISH_SPECIES[key], count, clock)));
 const failure = loaded.find(result => result.status === 'rejected');
 if (failure || signal?.aborted) {
  for (const result of loaded) if (result.status === 'fulfilled') result.value.dispose();
  if (failure) throw failure.reason;
  signal.throwIfAborted();
 }
 const draw = loaded.map(result => result.value);
 const group = new THREE.Group();
 for (const entry of draw) group.add(entry.mesh);
 const profiles = species.map(([key]) => ({...FISH_SPECIES[key]}));
 const fish = [];
 for (let sp = 0; sp < species.length; sp++) {
  for (let slot = 0; slot < species[sp][1]; slot++) {
   const p = new THREE.Vector3(
    THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, .2 + random() * .6),
    THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, .2 + random() * .6),
    THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, .2 + random() * .6),
   );
   const dir = new THREE.Vector3(Math.cos(slot * 2.39996), 0, Math.sin(slot * 2.39996));
   const spd = .22 * profiles[sp].speed;
   fish.push({p, dir, v: dir.clone().multiplyScalar(spd), sp, slot, spd, size: .85 + random() * .3,
    phase: random() * Math.PI * 2, seed: random() * 1000, amp: .6, bend: 0, dodge: 0, hand: random() > .5 ? 1 : -1});
  }
 }
 const P = {arbitrate: true, smartSteer: true, schoolDesync: true, orientSpace: true,
  speciesTraits: true, fishSchool: 1, fishSeparation: 1};
 const FT = Object.fromEntries(['al', 'co', 'se', 'd', 'al2'].map(key => [key, new THREE.Vector3()]));
 FT.lv = LVREF.map(() => new THREE.Vector3());
 const ARB = {on: false}, NEAR = [], PRED = [], grid = new Map(), freeBuckets = [];
 const lvl = (index, acceleration) => ARB.on ? FT.lv[index] : acceleration;
 const maxSize = Math.max(1, ...profiles.map(sp => sp.size)) * 1.15;
 const maxSpace = Math.max(1, ...profiles.map(sp => sp.space));
 const baseLength = .25 * size, R = Math.max(.5, baseLength * 2.5 * 1.15, baseLength * maxSize * maxSpace), cell = R * .5;
 const fishLength = f => baseLength * profiles[f.sp].size * f.size;
 profiles.forEach((sp, index) => {
  const half = baseLength * (sp.size * 1.15 + maxSize) * .5;
  const space = Math.max(sp.schoolSpace, ...profiles.map(other => (sp.space + other.space) * .5));
  const reach = Math.max(R, half * space * (1 + (sp.fwd - 1) * 1.25) + .001);
  sp._ring = Math.ceil((reach + SKIN) / cell);
  sp._reach2 = reach ** 2;
  sp._list2 = (reach + SKIN) ** 2;
  sp._aff = profiles.map((other, j) => j === index ? sp['aff_' + sp.key] : other.pred ? 0 : sp['aff_' + other.key] || 0);
 });
 function gatherNear(x, z, ring) {
  NEAR.length = 0;
  const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
  for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) {
   const bucket = grid.get(`${ix + a}/${iz + b}`);
   if (bucket) for (const index of bucket) NEAR.push(index);
  }
  return NEAR.length;
 }
 const school = createSchoolStage({P, fish, SPECIES: profiles, fishLength, FT, ARB, NEAR, PRED, gatherNear, lvl, nk: () => 1, random});
 const acceleration = new THREE.Vector3(), desired = new THREE.Vector3(), wander = new THREE.Vector3();
 const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), turn = new THREE.Quaternion(), bank = new THREE.Quaternion();
 const scale = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, 1);
 let frame = 0;
 function pose(f) {
  const entry = draw[f.sp];
  matrix.lookAt(f.dir, ZERO, UP);
  rotation.setFromRotationMatrix(matrix).multiply(bank.setFromAxisAngle(forward, f.bend * .3));
  matrix.compose(f.p, rotation, scale.setScalar(size * f.size * profiles[f.sp].size));
  entry.mesh.setMatrixAt(f.slot, matrix);
  entry.swim.setXYZW(f.slot, f.phase, f.amp, f.bend, clamp(1 - f.spd / (.22 * profiles[f.sp].speed * .6), 0, 1));
 }
 function update(delta) {
  const dt = clamp(delta, 0, .05);
  clock.value += dt;
  if (!dt) return;
  frame++;
  // Reuse arrays while keeping only currently occupied cells in the grid.
  for (const bucket of grid.values()) {
   bucket.length = 0;
   freeBuckets.push(bucket);
  }
  grid.clear();
  PRED.length = 0;
  fish.forEach((f, i) => {
   const key = `${Math.floor(f.p.x / cell)}/${Math.floor(f.p.z / cell)}`;
   let bucket = grid.get(key);
   if (!bucket) grid.set(key, bucket = freeBuckets.pop() ?? []);
   bucket.push(i);
   if (profiles[f.sp].pred) PRED.push(i);
  });
  fish.forEach((f, i) => {
   const sp = profiles[f.sp], L = fishLength(f), cruise = .22 * sp.speed;
   const top = Math.min(bounds.max.y, surfaceHeight(f.p.x, f.p.z) - .1);
   const bottom = Math.min(top, Math.max(bounds.min.y, floorHeight(f.p.x, f.p.z) + .1));
   acceleration.set(0, 0, 0);
   school({f, i, sp, L, cruise, acc: acceleration, dt, relist: frame === 1, R, sw: 1}, frame);
   const yaw = Math.atan2(f.dir.x, f.dir.z) + (noise(f.seed, clock.value * .4) * 2 - 1) * .785;
   const pitch = (noise(f.seed + 1000, clock.value * .2) * 2 - 1) * .236;
   wander.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
   lvl(5, acceleration).addScaledVector(wander, .8 * cruise * sp.wander);
   lvl(4, acceleration).y += (THREE.MathUtils.lerp(top, bottom, -sp.depth) - f.p.y) * sp.depthK * 2;
   const boundary = lvl(0, acceleration), margin = Math.max(.12, L * 2);
   boundary.x += 3 * (Math.max(0, bounds.min.x + margin - f.p.x) - Math.max(0, f.p.x - bounds.max.x + margin)) / margin;
   boundary.z += 3 * (Math.max(0, bounds.min.z + margin - f.p.z) - Math.max(0, f.p.z - bounds.max.z + margin)) / margin;
   boundary.y += 3 * (Math.max(0, bottom + .12 - f.p.y) - Math.max(0, f.p.y - top + .1));
   let budget = 1;
   FT.lv.forEach((force, index) => {
    acceleration.addScaledVector(force, budget);
    budget = Math.max(.1, budget * (1 - .75 * Math.min(1, force.length() / LVREF[index])));
   });
   desired.copy(f.v).addScaledVector(acceleration, .5).normalize();
   if (desired.lengthSq() < 1e-8) desired.copy(f.dir);
   const angle = f.dir.angleTo(desired), turnRate = (f.dodge > 0 ? 4.5 : 2.4) * sp.turn;
   const yawTo = Math.atan2(f.dir.z * desired.x - f.dir.x * desired.z, f.dir.x * desired.x + f.dir.z * desired.z);
   const step = Math.min(turnRate * dt, angle * damp(7, dt));
   if (angle > 1e-5) f.dir.applyQuaternion(turn.identity().slerp(rotation.setFromUnitVectors(f.dir, desired), step / angle)).normalize();
   f.dodge = Math.max(0, f.dodge - dt);
   const want = cruise * (f.dodge > 0 ? 1.4 : 1) * (1 - .7 * THREE.MathUtils.smoothstep(angle, 1.4, 2.6));
   f.spd += (want - f.spd) * damp(3, dt);
   f.v.copy(f.dir).multiplyScalar(f.spd);
   f.p.addScaledVector(f.v, dt);
   f.p.x = clamp(f.p.x, bounds.min.x, bounds.max.x);
   f.p.z = clamp(f.p.z, bounds.min.z, bounds.max.z);
   f.p.y = clamp(f.p.y, bottom, top);
   const rel = f.spd / cruise;
   f.phase += dt * (4 + Math.min(rel, 2.5) * 3.2);
   f.amp += (clamp(.3 + rel * .3, .15, 1.2) - f.amp) * damp(4, dt);
   f.bend += (clamp(yawTo / (turnRate * .5), -1, 1) - f.bend) * damp(6, dt);
   pose(f);
  });
  for (const entry of draw) { entry.mesh.instanceMatrix.needsUpdate = true; entry.swim.needsUpdate = true; }
 }
 for (const f of fish) pose(f);
 return {group, fish, update, dispose() { group.removeFromParent(); for (const entry of draw) entry.dispose(); }};
}
