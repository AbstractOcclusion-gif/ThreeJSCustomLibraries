import * as THREE from 'three';
import {createSchoolStage} from './school.js';
import {createFishMesh} from './fish-mesh.js';
import {FISH_SPECIES} from './species.js';

export {FISH_SPECIES};
// Bundled species (assets/fish/README.md). Override with `modelsUrl` or a parsed `models` object.
export const BUNDLED_FISH_MODELS_URL = new URL('../../assets/fish/webaquarium-species.json', import.meta.url).href;
// Behaviour constants ported from WebAquarium's fish brain. Speeds in m/s at species speed 1; rates in 1/s (exponential
// approach, see damp); angles in radians; distances in metres unless given in fish lengths.
const MAX_PER_SPECIES = 300;
const MAX_STEP = .05;                       // s: one update never advances more (a resumed tab does not teleport the school)
const CRUISE = .22;                         // m/s at species speed 1
const GOLDEN_ANGLE = 2.39996;               // rad: even start headings around the circle
const SPAWN = Object.freeze({inset: .2, size: [.85, .3], amp: .6});   // inset: share of the bounds kept clear; size: [min, range]
// Steering priority levels (0 boundary .. 5 wander): each level's reference force, and how much of the remaining budget
// a level at full force uses up; lower levels then get what is left, never under budgetFloor.
const FORCE_LEVELS = [1, 1.5, 1.5, .8, .6, 1];
const BUDGET = Object.freeze({use: .75, floor: .1});
const NEIGHBOURS = Object.freeze({
  skin: .08,           // m: extra listing radius so a neighbour list stays valid between rebuilds
  minRadius: .5,       // m
  lengths: 2.5,        // radius in base fish lengths
  sizeMargin: 1.15,    // largest species size and its 15 % size jitter
  cellShare: .5,       // grid cell = radius x this
  forwardGain: 1.25,   // how much a species' forward bias stretches its reach
  baseLength: .25,     // m: fish length at size 1 and species size 1
});
const WANDER = Object.freeze({yawRate: .4, yaw: .785, pitchRate: .2, pitch: .236, strength: .8, pitchSeed: 1000});
const DEPTH_GAIN = 2;
const BOUNDARY = Object.freeze({strength: 3, minMargin: .12, marginLengths: 2, floorClear: .12, surfaceClear: .1, waterClear: .1});
const STEER = Object.freeze({
  velocityMix: .5,                 // share of the summed acceleration added to the current velocity
  turnRate: 2.4, dodgeTurnRate: 4.5, settleRate: 7,
  dodgeSpeed: 1.4,                 // x cruise while dodging
  turnSlowdown: .7, slowFrom: 1.4, slowTo: 2.6,   // a sharp turn (rad) slows the fish by up to this share
  speedRate: 3,
});
const SWIM = Object.freeze({        // tail animation fed to the shader
  phaseBase: 4, phaseGain: 3.2, maxRelativeSpeed: 2.5,
  amp: [.3, .3], ampRange: [.15, 1.2], ampRate: 4,   // amp: [base, gain per relative speed]
  bendRate: 6, bendTurnShare: .5, bank: .3,
  idleShare: .6,                   // below this share of cruise the swim blends to idle
});
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
  if (!Object.hasOwn(FISH_SPECIES, key) || !Number.isInteger(count) || count > MAX_PER_SPECIES) throw new RangeError(`Invalid flock count for ${key}`);
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
    THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, SPAWN.inset + random() * (1 - 2 * SPAWN.inset)),
    THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, SPAWN.inset + random() * (1 - 2 * SPAWN.inset)),
    THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, SPAWN.inset + random() * (1 - 2 * SPAWN.inset)),
   );
   const dir = new THREE.Vector3(Math.cos(slot * GOLDEN_ANGLE), 0, Math.sin(slot * GOLDEN_ANGLE));
   const spd = CRUISE * profiles[sp].speed;
   fish.push({p, dir, v: dir.clone().multiplyScalar(spd), sp, slot, spd, size: SPAWN.size[0] + random() * SPAWN.size[1],
    phase: random() * Math.PI * 2, seed: random() * 1000, amp: SPAWN.amp, bend: 0, dodge: 0, hand: random() > .5 ? 1 : -1});
  }
 }
 const P = {arbitrate: true, smartSteer: true, schoolDesync: true, orientSpace: true,
  speciesTraits: true, fishSchool: 1, fishSeparation: 1};
 const FT = Object.fromEntries(['al', 'co', 'se', 'd', 'al2'].map(key => [key, new THREE.Vector3()]));
 FT.lv = FORCE_LEVELS.map(() => new THREE.Vector3());
 const ARB = {on: false}, NEAR = [], PRED = [], grid = new Map(), freeBuckets = [];
 const lvl = (index, acceleration) => ARB.on ? FT.lv[index] : acceleration;
 const N = NEIGHBOURS;
 const maxSize = Math.max(1, ...profiles.map(sp => sp.size)) * N.sizeMargin;
 const maxSpace = Math.max(1, ...profiles.map(sp => sp.space));
 const baseLength = N.baseLength * size, R = Math.max(N.minRadius, baseLength * N.lengths * N.sizeMargin, baseLength * maxSize * maxSpace), cell = R * N.cellShare;
 const fishLength = f => baseLength * profiles[f.sp].size * f.size;
 profiles.forEach((sp, index) => {
  const half = baseLength * (sp.size * N.sizeMargin + maxSize) * .5;
  const space = Math.max(sp.schoolSpace, ...profiles.map(other => (sp.space + other.space) * .5));
  const reach = Math.max(R, half * space * (1 + (sp.fwd - 1) * N.forwardGain) + .001);
  sp._ring = Math.ceil((reach + N.skin) / cell);
  sp._reach2 = reach ** 2;
  sp._list2 = (reach + N.skin) ** 2;
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
  rotation.setFromRotationMatrix(matrix).multiply(bank.setFromAxisAngle(forward, f.bend * SWIM.bank));
  matrix.compose(f.p, rotation, scale.setScalar(size * f.size * profiles[f.sp].size));
  entry.mesh.setMatrixAt(f.slot, matrix);
  entry.swim.setXYZW(f.slot, f.phase, f.amp, f.bend, clamp(1 - f.spd / (CRUISE * profiles[f.sp].speed * SWIM.idleShare), 0, 1));
 }
 function update(delta) {
  const dt = clamp(delta, 0, MAX_STEP);
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
   const sp = profiles[f.sp], L = fishLength(f), cruise = CRUISE * sp.speed;
   const top = Math.min(bounds.max.y, surfaceHeight(f.p.x, f.p.z) - BOUNDARY.waterClear);
   const bottom = Math.min(top, Math.max(bounds.min.y, floorHeight(f.p.x, f.p.z) + BOUNDARY.waterClear));
   acceleration.set(0, 0, 0);
   school({f, i, sp, L, cruise, acc: acceleration, dt, relist: frame === 1, R, sw: 1}, frame);
   const yaw = Math.atan2(f.dir.x, f.dir.z) + (noise(f.seed, clock.value * WANDER.yawRate) * 2 - 1) * WANDER.yaw;
   const pitch = (noise(f.seed + WANDER.pitchSeed, clock.value * WANDER.pitchRate) * 2 - 1) * WANDER.pitch;
   wander.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
   lvl(5, acceleration).addScaledVector(wander, WANDER.strength * cruise * sp.wander);
   lvl(4, acceleration).y += (THREE.MathUtils.lerp(top, bottom, -sp.depth) - f.p.y) * sp.depthK * DEPTH_GAIN;
   const B = BOUNDARY, boundary = lvl(0, acceleration), margin = Math.max(B.minMargin, L * B.marginLengths);
   boundary.x += B.strength * (Math.max(0, bounds.min.x + margin - f.p.x) - Math.max(0, f.p.x - bounds.max.x + margin)) / margin;
   boundary.z += B.strength * (Math.max(0, bounds.min.z + margin - f.p.z) - Math.max(0, f.p.z - bounds.max.z + margin)) / margin;
   boundary.y += B.strength * (Math.max(0, bottom + B.floorClear - f.p.y) - Math.max(0, f.p.y - top + B.surfaceClear));
   let budget = 1;
   FT.lv.forEach((force, index) => {
    acceleration.addScaledVector(force, budget);
    budget = Math.max(BUDGET.floor, budget * (1 - BUDGET.use * Math.min(1, force.length() / FORCE_LEVELS[index])));
   });
   desired.copy(f.v).addScaledVector(acceleration, STEER.velocityMix).normalize();
   if (desired.lengthSq() < 1e-8) desired.copy(f.dir);
   const angle = f.dir.angleTo(desired), turnRate = (f.dodge > 0 ? STEER.dodgeTurnRate : STEER.turnRate) * sp.turn;
   const yawTo = Math.atan2(f.dir.z * desired.x - f.dir.x * desired.z, f.dir.x * desired.x + f.dir.z * desired.z);
   const step = Math.min(turnRate * dt, angle * damp(STEER.settleRate, dt));
   if (angle > 1e-5) f.dir.applyQuaternion(turn.identity().slerp(rotation.setFromUnitVectors(f.dir, desired), step / angle)).normalize();
   f.dodge = Math.max(0, f.dodge - dt);
   const want = cruise * (f.dodge > 0 ? STEER.dodgeSpeed : 1) * (1 - STEER.turnSlowdown * THREE.MathUtils.smoothstep(angle, STEER.slowFrom, STEER.slowTo));
   f.spd += (want - f.spd) * damp(STEER.speedRate, dt);
   f.v.copy(f.dir).multiplyScalar(f.spd);
   f.p.addScaledVector(f.v, dt);
   f.p.x = clamp(f.p.x, bounds.min.x, bounds.max.x);
   f.p.z = clamp(f.p.z, bounds.min.z, bounds.max.z);
   f.p.y = clamp(f.p.y, bottom, top);
   const rel = f.spd / cruise;
   f.phase += dt * (SWIM.phaseBase + Math.min(rel, SWIM.maxRelativeSpeed) * SWIM.phaseGain);
   f.amp += (clamp(SWIM.amp[0] + rel * SWIM.amp[1], ...SWIM.ampRange) - f.amp) * damp(SWIM.ampRate, dt);
   f.bend += (clamp(yawTo / (turnRate * SWIM.bendTurnShare), -1, 1) - f.bend) * damp(SWIM.bendRate, dt);
   pose(f);
  });
  for (const entry of draw) { entry.mesh.instanceMatrix.needsUpdate = true; entry.swim.needsUpdate = true; }
 }
 for (const f of fish) pose(f);
 return {group, fish, update, dispose() { group.removeFromParent(); for (const entry of draw) entry.dispose(); }};
}
