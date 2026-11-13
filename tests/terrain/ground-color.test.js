import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTerrainAppearance, terrainGroundColor, TERRAIN_PALETTE_ROLES} from '../../src/terrain/index.js';

test('the ground colour of a painted sample mixes its sets, harmonised as the material does, with sand over it', () => {
 const appearance = createTerrainAppearance(), out = new THREE.Color();
 const palette = {roles: ['grass', 'rock'], means: [new THREE.Color(.2, .4, .1), new THREE.Color(.5, .5, .5)]};
 const tint = role => appearance.roleTints.value[TERRAIN_PALETTE_ROLES.indexOf(role)];
 assert.throws(() => terrainGroundColor(out, {}, palette, appearance), /palette paint/);
 // Harmony 0: the averages of the sets as they are, by weight.
 appearance.harmony.value = 0;
 assert.deepEqual(terrainGroundColor(out, {palette: [1, 0, 0, 0], sand: 0}, palette, appearance).toArray(), palette.means[0].toArray());
 const mixed = terrainGroundColor(out, {palette: [.5, .5, 0, 0], sand: 0}, palette, appearance).toArray();
 [.35, .45, .3].forEach((value, channel) => assert.ok(Math.abs(mixed[channel] - value) < 1e-6));
 // Harmony 1: the target colour of each role; without averages the same at any harmony.
 appearance.harmony.value = 1;
 assert.deepEqual(terrainGroundColor(out, {palette: [0, 1, 0, 0], sand: 0}, palette, appearance).toArray(), tint('rock').toArray());
 appearance.harmony.value = .3;
 assert.deepEqual(terrainGroundColor(out, {palette: [1, 0, 0, 0], sand: 0}, {roles: palette.roles}, appearance).toArray(), tint('grass').toArray());
 const sand = new THREE.Color(.8, .7, .5);
 assert.deepEqual(terrainGroundColor(out, {palette: [1, 0, 0, 0], sand: 1}, palette, appearance, sand).toArray(), sand.toArray());
});
