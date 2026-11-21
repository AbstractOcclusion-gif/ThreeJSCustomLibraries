import {MathUtils} from 'three';
import {FOOTSTEP_DEFAULTS, TERRAIN_LAYERS} from '../../src/terrain/index.js';
import {groundHeight} from './layout.js';

const SOLE = {heel: .045, toe: .065, width: .045, deformationRadius: .125, snowRadius: FOOTSTEP_DEFAULTS.heelRadius, rimShare: .18};
const SOFT = {sand: .035, mud: .12, snow: .06};
const WINTER_DEPTH = 1.65; // scale on the terrain tool's 3D drift depth
const SNOW_PATH = {driftDepth: .43, packedShare: .15, radius: .24, spacing: .16,
  cross: .07, load: 1, airClearance: .14, rimShare: .36, rimMaxRise: .09};
const DEEP_SNOW = {depth: .35, bankOffset: .48};
const PRESS = {interval: 1 / 30, pathSeconds: .24, footSeconds: .13};
const SOFT_LAYER = {mud: TERRAIN_LAYERS.indexOf('mud'), snow: TERRAIN_LAYERS.indexOf('snow')};
const FADE = {seconds: 5, refresh: .2};

export function createFootprints({field, snowSurface, tracks, onSample, onSnowLaid}) {
 const settings = {life: 21, opacity: .9, impression: 1, snow: false, snowDepth: WINTER_DEPTH};
 field.setSnowDepthScale(settings.snowDepth, baseSample);
 snowSurface.setDepth(settings.snowDepth);
 const {driftDepth, packedShare, rimShare, rimMaxRise} = SNOW_PATH;
 field.configureSnow({driftDepth, packedShare, rimShare, rimMaxRise});
 let prints = [], pressing = [], elapsed = 0, pressTime = 0;
 let lastPath = null;
 function baseSample(column, row, height) {
  snowSurface.copyBaseSample(column, row, height);
  onSample(column, row, height);
 }
 function deformGround({x, z, depth}, amount) {
  field.deform(x, z, SOLE.deformationRadius, depth * amount, baseSample, {rimShare: SOLE.rimShare});
 }
 function addPrint(print) {
  print.amount = 0;
  print.snowAmount = 0;
  prints.push(print);
  pressing.push(print);
 }
 const faded = print => settings.life === 0 ? 1 :
  MathUtils.smoothstep(settings.life - print.age, 0, Math.min(settings.life, FADE.seconds));
 function applySnow() {
  for (const print of prints) {
   const load = print.snowLoad * print.amount * faded(print);
   if (load === print.snowAmount) continue;
   print.snowAmount = load;
   for (const stamp of print.stamps) snowSurface.invalidate(stamp);
  }
  snowSurface.replay(prints, onSample);
 }
 function clearSnow() {
  snowSurface.clear(onSample);
  for (const print of prints) print.snowAmount = 0;
 }
 function reapply() {
  if (field.snowCover.value) {
   onSnowLaid();
   applySnow();
  } else for (const print of prints) deformGround(print, print.amount);
 }
 function relay() {
  clearSnow();
  field.resetDeformation(baseSample);
  reapply();
 }
 function ink(print) {
  if (!print.path) tracks.stamp(print.heel, print.toe, SOLE.width, print.amount * faded(print) * settings.opacity);
 }
 function refreshInk() {
  tracks.clear();
  for (const print of prints) ink(print);
 }
 function setSnow(enabled) {
  settings.snow = enabled;
  if (field.snowCover.value === enabled) return;
  lastPath = null;
  prints = prints.filter(print => !print.path);
  pressing = pressing.filter(print => !print.path);
  clearSnow();
  if (!enabled) field.setSnowCover(false, baseSample);
  field.resetDeformation(baseSample);
  if (enabled) field.setSnowCover(true, baseSample);
  reapply();
 }
 return {
  settings,
  relaySnow: relay,
  setSnow,
  setSnowDepth(scale) {
   settings.snowDepth = scale;
   const changed = field.setSnowDepthScale(scale, baseSample);
   snowSurface.setDepth(scale);
   if (!settings.snow) setSnow(true);
   else if (changed) relay();
  },
  deepSnowAt({position: {x, z}, heading}) {
   if (!field.snowCover.value) return false;
   // The channel stays shallow after compaction. Read the banks to identify a deep drift.
   const dx = DEEP_SNOW.bankOffset * Math.cos(heading), dz = DEEP_SNOW.bankOffset * Math.sin(heading);
   return field.heightAt(x - dx, z + dz) - groundHeight(x - dx, z + dz) >= DEEP_SNOW.depth ||
    field.heightAt(x + dx, z - dz) - groundHeight(x + dx, z - dz) >= DEEP_SNOW.depth;
  },
  packPath({position, heading, grounded, velocity}, walking) {
   if (!field.snowCover.value || !walking) return;
   const {x, z} = position;
   const surface = field.heightAt(x, z);
   if (!Number.isFinite(surface) || (!grounded && (position.y - surface > SNOW_PATH.airClearance || velocity.y > 0))) return;
   const travel = lastPath ? Math.hypot(x - lastPath.x, z - lastPath.z) : Infinity;
   if (travel < SNOW_PATH.spacing) return;
   lastPath = {x, z};
   const dx = SNOW_PATH.cross * Math.cos(heading), dz = SNOW_PATH.cross * Math.sin(heading);
   const stamps = [snowSurface.stamp(x - dx, z + dz, SNOW_PATH.radius), snowSurface.stamp(x + dx, z - dz, SNOW_PATH.radius)];
   addPrint({age: 0, snowLoad: SNOW_PATH.load, path: true, stamps});
  },
  mark(point, heading) {
   const {x, z} = point, dx = Math.sin(heading), dz = Math.cos(heading);
   const depth = settings.impression * Math.max(
    SOFT.sand * field.sandWeightAt(x, z),
    SOFT.mud * field.layerWeightAt(x, z, SOFT_LAYER.mud),
    SOFT.snow * field.layerWeightAt(x, z, SOFT_LAYER.snow));
   const snowLoad = Math.min(1, FOOTSTEP_DEFAULTS.load * settings.impression);
   const print = {x, z, age: 0, depth, snowLoad, stamps: [snowSurface.stamp(x, z, SOLE.snowRadius)],
    heel: {x: x - dx * SOLE.heel, z: z - dz * SOLE.heel},
    toe: {x: x + dx * SOLE.toe, z: z + dz * SOLE.toe}};
   addPrint(print);
  },
  refreshInk,
  update(dt) {
   for (const print of prints) print.age += dt;
   const snow = field.snowCover.value;
   pressTime += dt;
   if (pressTime >= PRESS.interval) {
    pressTime %= PRESS.interval;
    pressing = pressing.filter(print => {
     const amount = MathUtils.smoothstep(print.age, 0, print.path ? PRESS.pathSeconds : PRESS.footSeconds);
     if (!snow) deformGround(print, amount - print.amount);
     print.amount = amount;
     ink(print);
     return amount < 1;
    });
    if (snow) applySnow();
   }
   elapsed += dt;
   if (settings.life > 0 && elapsed >= FADE.refresh && prints.some(print => faded(print) < 1)) {
    elapsed %= FADE.refresh;
    const expired = prints.some(print => print.age >= settings.life);
    if (expired) {
     if (snow) applySnow();
     prints = prints.filter(print => print.age < settings.life);
     pressing = pressing.filter(print => print.age < settings.life);
    }
    if (!snow && expired) relay();
    refreshInk();
   }
   field.flushDeformation();
   return snowSurface.flush();
  },
  clear() {
   prints = [];
   pressing = [];
   lastPath = null;
   tracks.clear();
   if (field.snowCover.value) snowSurface.clear(onSample);
   else field.resetDeformation(baseSample);
  },
 };
}
