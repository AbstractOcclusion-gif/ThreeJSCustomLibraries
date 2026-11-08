import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {validateLayout, layout, makeRun, repeatModules, walkRun, electricMounts, conductorPoints, createBoundaries} from '../../src/boundaries/index.js';

test('layout validation: schema, kinds, spacing, limits; glider schema still accepted', () => {
 const runs = [makeRun('hedge', [[-10, 5], [0, 5]]), makeRun('electric', [[-10, -5], [10, -5]], 'pole-a')];
 assert.equal(validateLayout(layout(runs)).length, 2);
 assert.equal(validateLayout({schema: 'glider.boundary-layout', version: 1, runs}).length, 2);
 assert.throws(() => validateLayout(layout([makeRun('moat', [[0, 0], [5, 0]])])), /Invalid run/);
 assert.throws(() => validateLayout(layout([makeRun('wall', [[0, 0], [.5, 0]])])), /route point/);
 assert.throws(() => validateLayout(layout([makeRun('wall', [[-40, 0], [40, 0], [40, 39], [-40, 39]])]), {maxMetres: 100}), /Layout limit/);
 assert.equal(validateLayout(layout([makeRun('pond', [[0, 0], [5, 0]])]), {kinds: ['pond']}).length, 1);
});

test('run helpers: module repetition stretches to fit, walk spacing, electric mounts and sag', () => {
 const modules = []; repeatModules([[0, 0], [5, 0], [5, 5]], 2, m => modules.push(m));
 assert.equal(modules.length, 6);
 assert.ok(modules.every(m => Math.abs(m.scaleX - 5 / 6) < 1e-9));
 const walked = []; walkRun([[0, 0], [10, 0]], 2.5, p => walked.push(p.x));
 assert.deepEqual(walked, [0, 2.5, 5, 7.5]);
 const {angles, mounts} = electricMounts([[0, 0], [10, 0], [10, 10]], [[6, -1], [6, 0], [6, 1]]);
 assert.equal(angles[0], 0);
 assert.ok(Math.abs(angles[1] - Math.PI / 4) < 1e-9 || Math.abs(angles[1] + Math.PI / 4) < 1e-9);
 assert.equal(mounts[0][1][1], 6);
 const pts = conductorPoints([0, 6, 0], [20, 6, 0]);
 assert.equal(pts.length, 13);
 assert.ok(Math.abs(pts[6][1] - (6 - Math.min(2, 20 * .045))) < 1e-9);
});

test('boundaries build modules, poles/wires and leaved-bush hedges from runs, and clear', () => {
 const scene = new THREE.Scene();
 const boundaries = createBoundaries({scene});
 boundaries.setRuns([makeRun('fence', [[0, 0], [6, 0]]), makeRun('wall', [[0, 3], [4, 3]]), makeRun('electric', [[-5, -5], [5, -5]]), makeRun('hedge', [[0, 8], [9, 8]])]);
 const names = [], tubes = [];
 boundaries.group.traverse(o => { if (o.name === 'utility-pole') names.push(o.name); if (o.geometry?.type === 'TubeGeometry') tubes.push(o); });
 assert.equal(names.length, 2);
 assert.equal(tubes.length, 3);
 assert.equal(boundaries.hedges.count, 10);
 assert.ok(boundaries.hedges.profile.name === 'bush');
 boundaries.update(.1);
 boundaries.clear();
 assert.equal(boundaries.hedges.count, 0);
 boundaries.dispose();
 assert.equal(scene.children.length, 0);
});
