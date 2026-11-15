// The play area of the terrain pages: a square of deformable ground (a terrain field, 25 cm cells) laid in place of
// the rings where the test balls roll, so they leave ruts and marks, and pack real snow. It sits on a `snap` m grid so
// its edge follows the cells of every ring; the rings leave it a square `margin` m smaller (the shared `cutout`) and it
// is drawn just in front of them. A ball is launched `ahead` m in front of the focus; one started within `edge` m of
// the border moves the area there (its marks are lost).
import * as THREE from 'three';
import {createTerrainField, createTerrainMaterial, SNOW_DEFAULTS} from '../../src/terrain/index.js';
import {samplePlayArea} from './play-samples.js';
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
export function createTerrainPlay({scene, world, textures, seed, rules, appearance, sandLook, weather, cutout, cells = PLAY.cells, reliefCellSize = PLAY.size / cells, prepare, sampleArea}) {
  const ballMaterial = new THREE.MeshStandardMaterial({color: PLAY.ball.color, roughness: PLAY.ball.roughness});
  const airborneGeometry = sampleArea && new THREE.SphereGeometry(PLAY.ball.baseRadius, 24, 16);
  const airborne = new Set();
  let area, snow = false;
  let pending;

  function clear() {
    pending = undefined;
    for (const shot of airborne) shot.mesh.removeFromParent();
    airborne.clear();
    if (!area) return;
    area.impacts.dispose();
    scene.remove(area.mesh);
    const {material, ready} = area;
    if (ready) ready.then(() => material.dispose(), () => material.dispose());
    else material.dispose();
    area.field.dispose(); area.tracks.dispose(); area.sky.map.dispose();
    area = undefined;
    cutout.value.set(0, 0, 0, 0);
  }
  // Snow lies as a real layer on the area, where the balls pack it down.
  function setSnow(on) {
    snow = Boolean(on);
    if (area && area.field.snowCover.value !== snow) area.impacts.setSurface(snow ? 'snow' : 'mud');
  }
  // Lays the area around a point. Its ground is sampled and painted from the world, like the rings.
  function build(origin, {heights, paint, lowest, skyData, surroundSamples}, hidden = false) {
    const ground = world(), loaded = textures();
    const {size, margin} = PLAY, n = cells + 1, step = size / cells;
    const skySide = size / PLAY.skyTexel + 1;
    const field = createTerrainField({origin, size: [size, size], resolution: [n, n], heights, seed: seed(), rules: rules(),
      paintAt: sample => paint ? paint[Math.round((sample.z - origin[1]) / step) * n + Math.round((sample.x - origin[0]) / step)]
        : ground.paintAt(ground.sampleAt(sample.x, sample.z)), paletteSize: ground.palette.size, snowTrackRims: true});
    const tracks = createTrackMask({origin, size: [size, size], resolution: PLAY.trackResolution, directional: true});
    // The area's own sky map, measured like the rings' so the ambient light does not change at its edge.
    const sky = {map: createDataTexture(skyData, skySide, skySide, {format: THREE.RedFormat, filter: 'linear'}), bounds: field.bounds};
    const material = createTerrainMaterial({polygonOffset: true, polygonOffsetFactor: PLAY.offset, polygonOffsetUnits: PLAY.offset}, {
      field, palette: {...ground.palette, means: loaded.means}, layerArray: loaded.layerArray, layerDetailArray: loaded.layerDetailArray,
      detailNormal: loaded.detail, appearance, sandLook, weather, tracks, trackContrast: PLAY.trackContrast, sky});
    const mesh = new THREE.Mesh(field.geometry, material);
    mesh.receiveShadow = true;
    mesh.visible = !prepare;
    scene.add(mesh);
    const impacts = createTerrainImpacts({scene, field, tracks, material: ballMaterial, fallOutHeight: lowest - PLAY.fallBelow,
      surround: {heightAt: ground.heightAt, lift: () => snow ? SNOW_DEFAULTS.driftDepth : 0, samples: surroundSamples}});
    const laid = area = {field, tracks, material, mesh, impacts, origin, sky};
    setSnow(snow);
    laid.reveal = () => {
      if (area !== laid) return;
      mesh.visible = true;
      cutout.value.set(origin[0] + margin, origin[1] + margin, size - 2 * margin, size - 2 * margin);
    };
    if (prepare) {
      laid.ready = Promise.resolve().then(() => area === laid && prepare(mesh)).then(() => {
        if (!hidden) laid.reveal();
      }, error => {
        if (area === laid) clear();
        throw error;
      });
    } else laid.reveal();
    return laid;
  }

  function lay(x, z, hidden = false) {
    const {size, snap} = PLAY;
    const origin = [x, z].map(value => Math.round((value - size / 2) / snap) * snap);
    if (pending?.origin.every((value, index) => origin[index] === value)) return pending.result;
    clear();
    const options = {origin, center: [x, z], size, cells, reliefCellSize, skySide: size / PLAY.skyTexel + 1};
    if (!sampleArea) return build(origin, samplePlayArea(world(), options, false));
    const request = {origin};
    pending = request;
    request.result = sampleArea(options).then(samples => {
      if (pending !== request) return;
      pending = undefined;
      return build(origin, samples, hidden);
    }, error => {
      if (pending === request) pending = undefined;
      throw error;
    });
    return request.result;
  }

  return {
    get area() { return area; },
    lay, clear, setSnow,
    warm({focus, camera}) { return roll({focus, camera}, true); },
    roll,
    update(dt) {
      area?.impacts.update(dt);
      for (const shot of airborne) {
        const {mesh, velocity} = shot;
        const x = mesh.position.x + velocity[0] * dt, z = mesh.position.z + velocity[1] * dt;
        const floor = shot.ground(x, z) + shot.radius;
        if (shot.contact) {
          const previous = shot.path.at(-1);
          if (!previous || Math.hypot(x - previous.x, z - previous.z) >= .24) shot.path.push({x, z});
          mesh.position.set(x, floor, z);
          continue;
        }
        shot.verticalSpeed -= 9.82 * dt;
        const y = mesh.position.y + shot.verticalSpeed * dt;
        mesh.position.set(x, Math.max(y, floor), z);
        shot.contact = y <= floor;
      }
    },
    reset() {
      for (const shot of airborne) shot.mesh.removeFromParent();
      airborne.clear();
      area?.impacts.reset();
    },
    dispose() { clear(); airborneGeometry?.dispose(); ballMaterial.dispose(); },
  };

  // Rolls a ball of `radius` m from just ahead of the focus, away from the camera.
  function roll({focus, camera, radius = PLAY.ball.radius}, warm = false) {
    const heading = new THREE.Vector3().subVectors(focus, camera.position).setY(0);
    if (heading.lengthSq() === 0) heading.set(0, 0, 1);
    heading.normalize();
    const x = focus.x + heading.x * PLAY.ahead, z = focus.z + heading.z * PLAY.ahead;
    const inside = area && [x - area.origin[0], z - area.origin[1]].every(offset => offset > PLAY.edge && offset < PLAY.size - PLAY.edge);
    const target = inside ? area : lay(x, z, warm);
    if (warm) return Promise.resolve(target).then(laid => laid?.ready);
    const velocity = [heading.x * PLAY.ball.speed, heading.z * PLAY.ball.speed], scale = radius / PLAY.ball.baseRadius;
    let shot;
    if (sampleArea && (!inside || !area.mesh.visible)) {
      const ground = world();
      const floor = (px, pz) => ground.heightAt(px, pz, reliefCellSize) + (snow ? SNOW_DEFAULTS.driftDepth : 0);
      const mesh = new THREE.Mesh(airborneGeometry, ballMaterial);
      mesh.position.set(x, floor(x, z) + .88 * scale, z);
      mesh.scale.setScalar(scale);
      mesh.castShadow = true;
      scene.add(mesh);
      shot = {mesh, velocity, radius, ground: floor, verticalSpeed: 0, contact: false, path: []};
      airborne.add(shot);
    }
    const launch = laid => {
      if (!laid) return;
      if (laid.ready && !shot) return laid.ready.then(() => spawn(laid));
      spawn(laid);
    };
    const spawn = laid => {
      if (area !== laid) return;
      if (shot && !airborne.delete(shot)) return;
      if (laid.ready) laid.ready.then(laid.reveal, () => {});
      else laid.reveal();
      shot?.mesh.removeFromParent();
      const position = shot ? shot.mesh.position : {x, z};
      const ground = laid.field.heightAt(position.x, position.z);
      for (const [index, point] of (shot?.path ?? []).entries()) {
        laid.tracks.stamp(shot.path[index - 1] ?? point, point, .31 * scale, .8);
      }
      const inPatch = ground !== undefined;
      laid.impacts.launch('sphere', snow ? 'snow' : 'mud', undefined, {position: inPatch ? [position.x, position.z] : [x, z], velocity, scale,
        height: shot && inPatch ? Math.max(position.y, ground + radius) : undefined, verticalSpeed: shot?.contact ? 0 : shot?.verticalSpeed});
    };
    if (!shot) return launch(target);
    return Promise.resolve(target).then(launch).finally(() => {
      if (airborne.delete(shot)) shot.mesh.removeFromParent();
    });
  }
}
