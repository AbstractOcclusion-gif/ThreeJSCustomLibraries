// The valley's river as reactive water: the water tool's inland surface (the All tools demo's optics, under the
// weather) laid over every stretch of the valley whose ground lies under the water level, moving as the Water page's
// stream does (a baked current along the valley, the foam it carries, its small waves), with one ripple field over it
// and the particles tool's splashes. It replaces the flat sheet the World demo draws. Assembly only: what makes
// ripples and splashes is decided by the tools' events, see reactions.js.
import * as THREE from 'three';
import {CHANNEL_OBSTACLE_COUNT, createChannelSurface, createFlowBake, createRipples, skyFromWeather} from '../../src/water/index.js';
import {createImpactSplash, createParticleDepthBinding} from '../../src/particles/water/index.js';
import {createBenchPondSettings, STREAM_MOTION, STREAM_WAVES} from '../water/controls.js';

export const RIVER = Object.freeze({
 cell: 1,             // m between two samples of the surface, which shares the ground's heights as its bed
 rippleCell: .4,      // m, cell of the ripple field, as the All tools demo
 flowCell: .65, bakeIterations: 90,   // the baked current: its grid (m) and its pressure passes, as the Water page
 speed: .9,           // m/s of the current
 widthStep: .5, maxHalfWidth: 30,     // the wet half width is measured outward from the route in these steps (m), this far at most
 shore: .65,          // m above the water level up to which ground still gets a surface cell (the shoreline is clipped to the bed)
 captureScale: .4, causticSegments: 280,   // as the All tools demo
 softParticles: .25,  // m over which a splash fades into the water
});

// land: {heightAt(x, z), waterLevel}. route: {routeX(z)}, the line the river follows down the valley (+Z). bounds: {x: [min, max], z: [min, max]}, the box of ground the river can lie in.
// weatherView: the weather kit's view; sunCover: the sun covers of the lighting (shadows on the bed and the shafts).
export function createRiver({renderer, scene, camera, land, route, bounds, weatherView, sunCover}) {
 const [minX, maxX] = bounds.x, [minZ, maxZ] = bounds.z, level = land.waterLevel;
 const columns = Math.round((maxX - minX) / RIVER.cell) + 1, rows = Math.round((maxZ - minZ) / RIVER.cell) + 1;
 const positions = new Float32Array(columns * rows * 3), bed = new Float32Array(columns * rows), wet = [];
 for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
  const i = row * columns + column, x = minX + column * RIVER.cell, z = minZ + row * RIVER.cell;
  positions[i * 3] = x; positions[i * 3 + 2] = z;
  bed[i] = land.heightAt(x, z);
 }
 // Two triangles per cell, kept where the ground comes under (or close to) the water.
 for (let row = 0; row < rows - 1; row++) for (let column = 0; column < columns - 1; column++) {
  const a = row * columns + column, b = a + 1, c = a + columns, d = c + 1;
  if (Math.min(bed[a], bed[b], bed[c], bed[d]) < level + RIVER.shore) wet.push(a, c, b, b, c, d);
 }
 const geometry = new THREE.BufferGeometry();
 geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
 geometry.setAttribute('bedHeight', new THREE.BufferAttribute(bed, 1));
 geometry.setIndex(wet);
 geometry.computeVertexNormals();

 const ripples = createRipples({origin: [minX, minZ], cell: RIVER.rippleCell,
  size: [Math.round((maxX - minX) / RIVER.rippleCell), Math.round((maxZ - minZ) / RIVER.rippleCell)]});
 ripples.mask((x, z) => land.heightAt(x, z) < level);
 // The river as the flow bake's channel, along +Z: where the route lies under water, its centre, its wet half width,
 // its speed and its heading (dx/dz).
 const cell = RIVER.flowCell, sectionAt = z => {
  const centre = route.routeX(z);
  if (!(land.heightAt(centre, z) < level)) return null;
  let width = RIVER.widthStep;
  while (width < RIVER.maxHalfWidth && land.heightAt(centre - width, z) < level && land.heightAt(centre + width, z) < level) width += RIVER.widthStep;
  return {centre, width, speed: RIVER.speed, slope: (route.routeX(z + cell / 2) - route.routeX(z - cell / 2)) / cell};
 };
 // The current is baked over the wet stretch only, so water enters at its first cross section and leaves at its last.
 const wetRows = Array.from({length: Math.floor((maxZ - minZ) / cell)}, (_, row) => row).filter(row => sectionAt(minZ + (row + .5) * cell));
 const firstRow = wetRows[0] ?? 0, obstacles = Array.from({length: CHANNEL_OBSTACLE_COUNT}, () => new THREE.Vector4());
 const flow = createFlowBake({origin: [minX, minZ + firstRow * cell], size: [Math.ceil((maxX - minX) / cell), Math.max(1, (wetRows.at(-1) ?? 0) - firstRow + 1)], cell, along: 'z'});
 if (wetRows.length) flow.bake({sectionAt}, obstacles, RIVER.bakeIterations);
 const water = createChannelSurface({renderer, scene, camera, sky: skyFromWeather(weatherView, {water: true, celestial: false}), ripples, flow, obstacles,
  captureScale: RIVER.captureScale, causticSegments: RIVER.causticSegments, clipToBed: true, pondOptics: true, sun: sunCover});
 water.surface.geometry.dispose();
 water.surface.geometry = geometry;
 water.surface.position.y = level;
 // The pond's optics, moving as the stream: its waves run the way the river does.
 const heading = Math.atan2(maxZ - minZ, route.routeX(maxZ) - route.routeX(minZ));   // rad from +X
 const settings = {...createBenchPondSettings(), windWaves: undefined, ...STREAM_MOTION, waveHeight: STREAM_WAVES.height, wavelength: STREAM_WAVES.wavelength,
  waveDirection: heading + THREE.MathUtils.degToRad(STREAM_WAVES.direction), waveSpread: THREE.MathUtils.degToRad(STREAM_WAVES.spread), waveTime: 0};
 let flowTime = 0;

 // Splashes are drawn in their own pass over the frame, faded against the water's depth capture.
 const splashScene = new THREE.Scene(), at = new THREE.Vector3(), light = weatherView.uniforms;
 const depth = createParticleDepthBinding({THREE, camera, depthTexture: water.depthTexture, viewport: water.viewport,
  waterPlane: new THREE.Vector4(0, 1, 0, -level), softDistance: RIVER.softParticles});
 const splashes = createImpactSplash({THREE, scene: splashScene, depth,
  lighting: {uniforms: {uSunCol: light.uSunCol, uFxAmbient: light.uAmb}, direction: light.uSkySunDir.value}});
 splashes.ready.catch(console.error);

 return {
  ripples, settings,
  // Throws a splash at the surface: strength 0..1, radius m.
  splash(x, z, strength, radius) { splashes.emit(at.set(x, level, z), strength, radius); },
  update(dt) {
   flowTime += dt * settings.speed;
   settings.waveTime += dt * STREAM_WAVES.speed;
   ripples.update(dt);
   splashes.update(dt);
  },
  // Captures the bed and lights the water: call before the frame is drawn, inside the host's fog scope.
  render() { water.render(flowTime, settings); },
  // Draws the splashes over the finished frame.
  renderSplashes() {
   if (!(splashes.active > 0)) return;
   const autoClear = renderer.autoClear;
   renderer.autoClear = false;
   try { renderer.render(splashScene, camera); }
   finally { renderer.autoClear = autoClear; }
  },
  clear() { ripples.clear(); splashes.clear(); },
  dispose() { splashes.dispose(); water.dispose(); ripples.dispose(); flow.dispose(); geometry.dispose(); },
 };
}
