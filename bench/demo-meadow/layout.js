import {createRelief, reliefShape} from '../../src/terrain/index.js';

export const SITE = {
 span: 52, samples: 257, seed: 23, spawn: [-12, -18], heading: .26,
 pond: {x: -7, z: 3, level: .48, depth: 2.16, radii: [9.4, 7.8]},
 ridge: {x: 13, z: 12, rise: 3.25, radii: [13, 12]},
};
export const SURFACES = {
 rockSlope: .84, snowLine: 3.45, snowBlend: 1, snowJitter: .55, snowShade: 1.4,
 sandBelow: .93, sandBlend: .34, mudBelow: 1.56, mudBlend: .35, forestCover: .18,
};

// x, z and height in metres. Trees rim the meadow and leave the pond approach open.
export const TREES = {
 'ez-birch': [[-16, -13, 7.2], [-20, -8, 8.1], [-18, -1, 6.8], [-21, 7, 8.8], [-18, 13, 7.9],
  [3, -10, 7.2], [8, -7, 8.7], [11, -10, 6.8], [-2, 14, 7.1], [-8, 17, 9.1], [1, 18, 7.6]],
 'ez-spruce': [[-22, 18, 10.8], [-15, 21, 11.9], [-6, 22, 10.3], [2, 21, 11.3], [18, 5, 9.6], [21, 11, 11.1],
  [17, 17, 12.3], [20, 21, 10.8], [8, 21, 9.6], [23, -2, 10.4]],
};
export const UNDERGROWTH = [[-14, -11], [-10.5, -10], [-12, -6], [-16, -3], [-17, 2], [-14, 9],
 [-9, 12], [-1, 11], [2, 6], [4, 3], [7, 1], [9, -5], [9, 17], [18, -3], [20, 7]];

// Patch centres and radii (metres). Leave the spawn approach, the beach, and the ridge path open.
export const GRASS_PATCHES = [
 [-17, -17, 3.7, 3], [-7, -19, 3.3, 2.7], [-17, -11, 2.5, 2.7], [-5, -13, 3.5, 2.6],
 [-14, -7, 2.7, 2.4], [-4.5, -8, 2.2, 1.9], [1, -15, 3.5, 2.7], [8, -17, 3.4, 2.6],
 [-19, -2, 3.1, 3.5], [-22, 6, 2.4, 3.0], [-17, 8, 3.1, 2.5], [-13, 14.5, 3.6, 2.8],
 [-6, 17, 3.5, 2.9], [1, 13, 3.1, 2.9], [4.5, 4, 2.3, 2.8], [7.5, -6, 3.3, 3],
 [16, -8, 3.1, 3.0], [20, -1, 2.8, 2.6], [21, 13, 2.7, 2.9], [13, 20, 3.6, 2.5],
];

const relief = createRelief(SITE.seed, [
 reliefShape('base', {height: 1.88}),
 reliefShape('rolling', {amplitude: .4, scale: 17}),
 reliefShape('micro', {amplitude: .09, size: 4}),
]);
const mound = (x, z, {x: cx, z: cz, radii: [rx, rz]}) =>
 Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));

export function groundHeight(x, z) {
 return relief.heightAt(x, z) - SITE.pond.depth * mound(x, z, SITE.pond) + SITE.ridge.rise * mound(x, z, SITE.ridge);
}
