import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneBiome, createRelief, DEFAULT_TERRAIN_BIOME, reliefShape, RELIEF_MAX_SHAPES, RELIEF_SHAPES, TERRAIN_BIOMES, validateBiome, validateRelief} from '../../src/terrain/index.js';

const sampleRange = (relief, extent = 200, step = 8) => {
 let low = Infinity, high = -Infinity;
 for (let x = -extent; x <= extent; x += step) for (let z = -extent; z <= extent; z += step) {
  const height = relief.heightAt(x, z);
  assert.ok(Number.isFinite(height));
  low = Math.min(low, height); high = Math.max(high, height);
 }
 return [low, high];
};

test('every relief shape has complete defaults inside its ranges and a recipe is validated by name', () => {
 for (const [name, spec] of Object.entries(RELIEF_SHAPES)) {
  assert.deepEqual(Object.keys(spec.defaults), Object.keys(spec.fields), name);
  validateRelief([reliefShape(name)]);
 }
 assert.throws(() => reliefShape('volcano'), /Unknown relief shape/);
 assert.throws(() => validateRelief([]), RangeError);
 assert.throws(() => validateRelief(Array.from({length: RELIEF_MAX_SHAPES + 1}, () => reliefShape('base'))), RangeError);
 assert.throws(() => validateRelief([reliefShape('rolling', {scale: 0})]), /rolling setting at 1: scale/);
 assert.throws(() => validateRelief([{...reliefShape('base'), tilt: 1}]), /Unknown base setting: tilt/);
 assert.throws(() => createRelief(1.5, [reliefShape('base')]), /integer seed/);
 assert.throws(() => createRelief(1, [reliefShape('island', {inner: 100, outer: 50})]), /shore radius/);
});

test('relief is repeatable per seed and each shape does what its name says', () => {
 const recipe = [reliefShape('rolling', {amplitude: 20})];
 assert.equal(createRelief(4, recipe).heightAt(13.5, -7.25), createRelief(4, recipe).heightAt(13.5, -7.25));
 assert.notEqual(createRelief(4, recipe).heightAt(13.5, -7.25), createRelief(5, recipe).heightAt(13.5, -7.25));
 assert.equal(createRelief(1, [reliefShape('base', {height: 12})]).heightAt(3, 9), 12);
 const [ridgeLow] = sampleRange(createRelief(1, [reliefShape('ridged', {amplitude: 50, floor: .2})]));
 assert.ok(ridgeLow >= 10);
 // Eroded ground stays inside its height, and erosion smooths steep flanks more than gentle ground.
 const [erodedLow, erodedHigh] = sampleRange(createRelief(1, [reliefShape('eroded', {amplitude: 100})]), 1000, 20);
 assert.ok(erodedLow >= 0 && erodedHigh <= 100 && erodedHigh - erodedLow > 40);
 assert.notEqual(createRelief(1, [reliefShape('eroded', {erosion: 0})]).heightAt(40, 70), createRelief(1, [reliefShape('eroded', {erosion: 1})]).heightAt(40, 70));
 // Fine relief stays within its height, and a mesh keeps only the bumps its cells can show.
 const micro = createRelief(1, [reliefShape('micro', {amplitude: .2, size: 3})]);
 const [microLow, microHigh] = sampleRange(micro, 30, .5);
 assert.ok(microLow >= -.2 && microHigh <= .2 && microHigh - microLow > .1);
 assert.equal(micro.heightAt(3.3, 7.1, 16), 0);
 assert.equal(micro.heightAt(3.3, 7.1, .05), micro.heightAt(3.3, 7.1));
 let fineRange = 0, coarseRange = 0;
 for (let x = 0; x < 40; x += .37) { fineRange = Math.max(fineRange, Math.abs(micro.heightAt(x, 2, .25))); coarseRange = Math.max(coarseRange, Math.abs(micro.heightAt(x, 2, 1))); }
 assert.ok(coarseRange < fineRange);
 // A warp moves where the following shapes are read, and nothing else.
 const plain = createRelief(1, [reliefShape('rolling', {amplitude: 20})]);
 const still = createRelief(1, [reliefShape('warp', {strength: 0}), reliefShape('rolling', {amplitude: 20})]);
 const bent = createRelief(1, [reliefShape('warp', {strength: 50}), reliefShape('rolling', {amplitude: 20})]);
 assert.equal(createRelief(1, [reliefShape('base', {height: 5}), reliefShape('warp')]).heightAt(3, 4), 5);
 assert.notEqual(bent.heightAt(13, 7), plain.heightAt(13, 7));
 const [plateauLow, plateauHigh] = sampleRange(createRelief(1, [reliefShape('plateau', {amplitude: 30})]));
 assert.ok(plateauLow >= 0 && plateauHigh <= 30 && plateauHigh - plateauLow > 20);
 const [duneLow, duneHigh] = sampleRange(createRelief(1, [reliefShape('dunes', {amplitude: 5})]), 60, 1);
 assert.ok(duneLow >= 0 && duneHigh <= 5 && duneHigh > 3);
 // Full-strength terraces with thin risers leave most of the ground on a step.
 const stepped = createRelief(1, [reliefShape('rolling', {amplitude: 40, scale: 200}), reliefShape('terraces', {step: 5, strength: 1, riser: .05})]);
 let onStep = 0, count = 0;
 for (let x = -200; x <= 200; x += 3) { const level = stepped.heightAt(x, 11) / 5; onStep += Math.abs(level - Math.round(level)) < .02; count++; }
 assert.ok(onStep / count > .8);
 const valley = createRelief(1, [reliefShape('base', {height: 30}), reliefShape('valley', {width: 20, shoulder: 40, floor: 2})]);
 assert.equal(valley.heightAt(valley.routeX(50), 50), 2);
 assert.equal(valley.heightAt(valley.routeX(50) + 200, 50), 30);
 assert.equal(createRelief(1, recipe).routeX, undefined);
 // A river cuts down to its bed and no further, follows the valley before it, and bends on its own without one.
 const withRiver = createRelief(1, [reliefShape('base', {height: 30}), reliefShape('valley', {width: 20, shoulder: 40, floor: 2}), reliefShape('river', {width: 4, bank: 3, bed: -1})]);
 assert.equal(withRiver.heightAt(valley.routeX(50), 50), -1);
 assert.equal(withRiver.heightAt(valley.routeX(50) + 9.5, 50), 2);
 const lone = createRelief(1, [reliefShape('base', {height: 5}), reliefShape('river', {width: 4, bank: 3, bed: 1})]);
 assert.equal(lone.heightAt(lone.routeX(80), 80), 1);
 assert.equal(lone.heightAt(lone.routeX(80) + 40, 80), 5);
 assert.equal(createRelief(1, [reliefShape('base', {height: -3}), reliefShape('river', {bed: 1})]).heightAt(0, 0), -3);
 const island = createRelief(1, [reliefShape('base', {height: 20}), reliefShape('island', {inner: 40, outer: 100, sink: 6})]);
 assert.equal(island.heightAt(0, 0), 14);
 assert.equal(island.heightAt(300, 0), -6);
});

test('every catalogue biome is valid, builds finite relief and clones to an editable copy', () => {
 assert.ok(TERRAIN_BIOMES[DEFAULT_TERRAIN_BIOME]);
 for (const [id, biome] of Object.entries(TERRAIN_BIOMES)) {
  assert.equal(biome.id, id);
  validateBiome(biome);
  sampleRange(createRelief(17, biome.relief));
 }
 const copy = cloneBiome('desert');
 copy.relief[1].amplitude = 9; copy.paint.rockSlope = 1; copy.textures.grass = 'snow_02';
 assert.notEqual(TERRAIN_BIOMES.desert.relief[1].amplitude, 9);
 validateBiome(copy);
 assert.throws(() => cloneBiome('moon'), /Unknown terrain biome/);
 assert.throws(() => validateBiome({...copy, textures: {...copy.textures, rock: 'marble'}}), /texture set for rock/);
 const {sandBelow, ...paint} = copy.paint;
 assert.throws(() => validateBiome({...copy, paint}), /no paint setting: sandBelow/);
 assert.throws(() => validateBiome({...copy, paint: {...copy.paint, rockSlope: 99}}), /rockSlope/);
});
