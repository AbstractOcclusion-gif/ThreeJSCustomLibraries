// The play area of the terrain pages: a square of deformable ground (a terrain field, 25 cm cells) laid in place of
// the rings where the test balls roll, so they leave ruts and marks, and pack real snow. It sits on a `snap` m grid so
// its edge follows the cells of every ring; the rings leave it a square `margin` m smaller (the shared `cutout`) and it
// is drawn just in front of them. A ball is launched `ahead` m in front of the focus; one started within `edge` m of
// the border moves the area there (its marks are lost).
import * as THREE from 'three';
import {bakeSkyMap, createSkyVisibility, createTerrainField, createTerrainMaterial, SNOW_DEFAULTS} from '../../src/terrain/index.js';
import {createDataTexture} from '../../src/core/data-texture.js';
import {createTrackMask} from '../../src/surface/index.js';
import {createTerrainImpacts} from './impacts.js';

export const PLAY = {size: 64, cells: 256, snap: 16, margin: 1, skyTexel: 2, trackResolution: 512, trackContrast: .12, edge: 12, ahead: 6,
  ball: {radius: 1.5, minRadius: .4, maxRadius: 4, baseRadius: .72, speed: 7, color: 0x8d8478, roughness: .8}, fallBelow: 12,
  offset: -1};

// world, textures, seed and rules are read when an area is laid, so they are given as functions: () => the current
// terrain world, its loaded palette textures, the world seed and the paint rules of its first biome.
// cutout: the {value: Vector4} the ring materials were built with. weather: the surface weather of the ground.
// Returns {area (the laid area: {field, tracks, material, mesh, impacts, origin, sky}, or undefined), lay(x, z),
// clear(), roll({focus, camera, radius}), setSnow(on), update(dt), reset(), dispose()}.
export function createTerrainPlay({scene, world, textures, seed, rules, appearance, sandLook, weather, cutout}) {
  const ballMaterial = new THREE.MeshStandardMaterial({color: PLAY.ball.color, roughness: PLAY.ball.roughness});
  let area, snow = false;

  function clear() {
    if (!area) return;
    area.impacts.dispose();
    scene.remove(area.mesh);
    area.material.dispose(); area.field.dispose(); area.tracks.dispose(); area.sky.map.dispose();
    area = undefined;
    cutout.value.set(0, 0, 0, 0);
  }
  // Snow lies as a real layer on the area, where the balls pack it down.
  function setSnow(on) {
    snow = Boolean(on);
    if (area && area.field.snowCover.value !== snow) area.impacts.setSurface(snow ? 'snow' : 'mud');
  }
  // Lays the area around a point. Its ground is sampled and painted from the world, like the rings.
  function lay(x, z) {
    clear();
    const ground = world(), loaded = textures();
    const {size, cells, snap, margin} = PLAY, n = cells + 1, step = size / cells;
    const origin = [Math.round((x - size / 2) / snap) * snap, Math.round((z - size / 2) / snap) * snap];
    let lowest = Infinity;
    const heights = Float32Array.from({length: n * n}, (_, index) => {
      // Asked with the cell of the innermost ring, so the area carries the same fine relief as the ground around it.
      const height = ground.heightAt(origin[0] + index % n * step, origin[1] + Math.floor(index / n) * step, step);
      lowest = Math.min(lowest, height);
      return height;
    });
    const field = createTerrainField({origin, size: [size, size], resolution: [n, n], heights, seed: seed(), rules: rules(),
      paintAt: sample => ground.paintAt(ground.sampleAt(sample.x, sample.z)), paletteSize: ground.palette.size, snowTrackRims: true});
    const tracks = createTrackMask({origin, size: [size, size], resolution: PLAY.trackResolution, directional: true});
    // The area's own sky map, measured like the rings' so the ambient light does not change at its edge.
    const skySide = size / PLAY.skyTexel + 1;
    const sky = {map: createDataTexture(bakeSkyMap(createSkyVisibility(ground.heightAt), origin, size, skySide), skySide, skySide, {format: THREE.RedFormat, filter: 'linear'}), bounds: field.bounds};
    const material = createTerrainMaterial({polygonOffset: true, polygonOffsetFactor: PLAY.offset, polygonOffsetUnits: PLAY.offset}, {
      field, palette: {...ground.palette, means: loaded.means}, layerArray: loaded.layerArray, layerDetailArray: loaded.layerDetailArray,
      detailNormal: loaded.detail, appearance, sandLook, weather, tracks, trackContrast: PLAY.trackContrast, sky});
    const mesh = new THREE.Mesh(field.geometry, material);
    mesh.receiveShadow = true;
    scene.add(mesh);
    cutout.value.set(origin[0] + margin, origin[1] + margin, size - 2 * margin, size - 2 * margin);
    const impacts = createTerrainImpacts({scene, field, tracks, material: ballMaterial, fallOutHeight: lowest - PLAY.fallBelow,
      surround: {heightAt: ground.heightAt, lift: () => snow ? SNOW_DEFAULTS.driftDepth : 0}});
    area = {field, tracks, material, mesh, impacts, origin, sky};
    setSnow(snow);
  }

  return {
    get area() { return area; },
    lay, clear, setSnow,
    // Rolls a ball of `radius` m from just ahead of the focus, away from the camera.
    roll({focus, camera, radius = PLAY.ball.radius}) {
      const heading = new THREE.Vector3().subVectors(focus, camera.position).setY(0);
      if (heading.lengthSq() === 0) heading.set(0, 0, 1);
      heading.normalize();
      const x = focus.x + heading.x * PLAY.ahead, z = focus.z + heading.z * PLAY.ahead;
      const inside = area && [x - area.origin[0], z - area.origin[1]].every(offset => offset > PLAY.edge && offset < PLAY.size - PLAY.edge);
      if (!inside) lay(x, z);
      area.impacts.launch('sphere', snow ? 'snow' : 'mud', undefined, {position: [x, z], velocity: [heading.x * PLAY.ball.speed, heading.z * PLAY.ball.speed], scale: radius / PLAY.ball.baseRadius});
    },
    update(dt) { area?.impacts.update(dt); },
    reset() { area?.impacts.reset(); },
    dispose() { clear(); ballMaterial.dispose(); },
  };
}
