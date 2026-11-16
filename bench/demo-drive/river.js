// The valley's river as reactive water: the water tool's inland surface (the All tools demo's recipe, under the
// weather) laid over every stretch of the valley whose ground lies under the water level, with one ripple field over
// it and the particles tool's splashes. It replaces the flat sheet the World demo draws. Assembly only: what makes
// ripples and splashes is decided by the tools' events, see reactions.js.
import * as THREE from 'three';
import {CHANNEL_OBSTACLE_COUNT, createChannelSurface, createFlowBake, createRipples, skyFromWeather} from '../../src/water/index.js';
import {createImpactSplash, createParticleDepthBinding} from '../../src/particles/water/index.js';
import {createBenchPondSettings} from '../water/controls.js';

export const RIVER = Object.freeze({
 cell: 1,             // m between two samples of the surface, which shares the ground's heights as its bed
 rippleCell: .5,      // m, cell of the ripple field
 shore: .65,          // m above the water level up to which ground still gets a surface cell (the shoreline is clipped to the bed)
 captureScale: .4, causticSegments: 280,   // as the All tools demo
 softParticles: .25,  // m over which a splash fades into the water
});

// land: {heightAt(x, z), waterLevel}. bounds: {x: [min, max], z: [min, max]}, the box of ground the river can lie in.
// weatherView: the weather kit's view; sunCover: the sun covers of the lighting (shadows on the bed and the shafts).
export function createRiver({renderer, scene, camera, land, bounds, weatherView, sunCover}) {
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
 const flow = createFlowBake(), obstacles = Array.from({length: CHANNEL_OBSTACLE_COUNT}, () => new THREE.Vector4());
 const water = createChannelSurface({renderer, scene, camera, sky: skyFromWeather(weatherView, {water: true, celestial: false}), ripples, flow, obstacles,
  captureScale: RIVER.captureScale, causticSegments: RIVER.causticSegments, clipToBed: true, pondOptics: true, sun: sunCover});
 water.surface.geometry.dispose();
 water.surface.geometry = geometry;
 water.surface.position.y = level;
 const settings = createBenchPondSettings();
 settings.waveTime = 0;

 // Splashes are drawn in their own pass over the frame, faded against the water's depth capture.
 const splashScene = new THREE.Scene(), at = new THREE.Vector3(), light = weatherView.uniforms;
 const depth = createParticleDepthBinding({THREE, camera, depthTexture: water.depthTexture, viewport: water.viewport,
  waterPlane: new THREE.Vector4(0, 1, 0, -level), softDistance: RIVER.softParticles});
 const splashes = createImpactSplash({THREE, scene: splashScene, depth,
  lighting: {uniforms: {uSunCol: light.uSunCol, uFxAmbient: light.uAmb}, direction: light.uSkySunDir.value}});
 splashes.ready.catch(console.error);

 return {
  ripples,
  // Throws a splash at the surface: strength 0..1, radius m.
  splash(x, z, strength, radius) { splashes.emit(at.set(x, level, z), strength, radius); },
  update(dt) {
   settings.waveTime += dt;
   ripples.update(dt);
   splashes.update(dt);
  },
  // Captures the bed and lights the water: call before the frame is drawn, inside the host's fog scope.
  render() { water.render(settings.waveTime, settings); },
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
