// Living things shared by the mixed demos (ocean coast, all tools): leaved trees, bushes and optional grass, a camp of
// crates that burn (fire + particle prefabs) and a school of fish. Every part reads the one shared environment
// (core/environment.js) the weather fills, so wind and light reach all of them the same way. Each demo passes its layout.
import * as THREE from 'three';
import {LeavedTrees} from '../../src/trees/index.js';
import {createFreeVegetation, createGrassField} from '../../src/vegetation/index.js';
import {createFireSystem} from '../../src/fire/index.js';
import {createParticlePrefab} from '../../src/particles/index.js';
import {createFishFlock} from '../../src/flocking/index.js';
import {seededRandom} from '../../src/core/hash.js';

// Crates: [x, z, burn seconds] relative to the camp; size in metres.
const CRATES = Object.freeze({layout: [[0, 0, 10], [1.5, .35, 12], [3, -.25, 9], [4.6, .2, 11]], size: [.95, .8, .8], clearing: 6});
const LEAF_SHADE = new THREE.Color('#2f6b1f'), LEAF_LIGHT = new THREE.Color('#779640'), GRASS_GREEN = new THREE.Color('#50762e'), GRASS_DRY = new THREE.Color('#c2aa61');
const WOOD = new THREE.Color(0xb18451), CHAR = new THREE.Color(0x241b16);
const FLAME_HEIGHT = .58, FLAME_SIZE = 1.16, GLOW = Object.freeze({color: 0xff8f36, intensity: 2.8, distance: 6, lift: 1.1});

// plants: {radius, treeLine, bushLine, grassLine, trees, bushes, grass, ceiling?} - lines are the lowest ground heights each
//   kind grows on (metres), ceiling the highest; grass 0 = the demo has its own grass. blocked(x, z): extra no-plant areas.
// camp: [x, z]. fish: {bounds: Box3, counts, size, surfaceHeight()}.
export async function createDemoLife({scene, ground, centre: [centreX, centreZ], plants, camp: [campX, campZ], fish: school, blocked = () => false, environment, lighting, lightRig}) {
  const random = seededRandom(29), PLANTS = {ceiling: Infinity, ...plants};
  const camp = {x: campX, z: campZ};
  // Rejection-sample dry ground above `line`, outside the camp clearing.
  function sites(count, line) {
    const out = [];
    for (let tries = count * 12; out.length < count && tries > 0; tries--) {
      const x = centreX + (random() * 2 - 1) * PLANTS.radius, z = centreZ + (random() * 2 - 1) * PLANTS.radius, y = ground(x, z);
      if (y >= line && y <= PLANTS.ceiling && Math.hypot(x - camp.x - 2.3, z - camp.z) > CRATES.clearing && !blocked(x, z)) out.push({x, y, z, roll: random(), yaw: random() * Math.PI * 2});
    }
    return out;
  }
  const leaf = new THREE.Color(), leafTint = roll => leaf.lerpColors(LEAF_SHADE, LEAF_LIGHT, roll).toArray();

  const trees = new LeavedTrees({scene, profile: 'tree', lighting, sampleGround: ground});
  trees.place(sites(PLANTS.trees, PLANTS.treeLine).map(({x, z, yaw, roll}) => { const h = 6.5 * (.8 + roll * .5); return {x, z, yaw, h, r: h * .34, tint: leafTint(roll)}; }));
  const bushes = new LeavedTrees({scene, profile: 'bush', lighting, sampleGround: ground});
  bushes.place(sites(PLANTS.bushes, PLANTS.bushLine).map(({x, z, yaw, roll}) => { const h = 1.2 + roll * .8; return {x, z, yaw, h, r: h * .8, tint: leafTint(roll)}; }));
  trees.setEnvironment(environment); bushes.setEnvironment(environment);

  const meadow = createFreeVegetation({meadowBlades: true}), tint = new THREE.Color();
  const grass = PLANTS.grass > 0 && createGrassField({scene, geometries: meadow.grassGeometries, map: meadow.atlas, color: 0xffffff, tileSize: 8, flatColorMix: .75,
    placements: sites(PLANTS.grass, PLANTS.grassLine).map(({x, y, z, yaw, roll}) => ({x, y: y - .02, z, yaw, scale: .7 + roll * .9, tint: tint.lerpColors(GRASS_GREEN, GRASS_DRY, roll * roll).toArray()}))});

  const fire = createFireSystem({environment}), crateGeometry = new THREE.BoxGeometry(...CRATES.size);
  const crates = await Promise.all(CRATES.layout.map(async ([dx, dz, burnSeconds]) => {
    const x = camp.x + dx, z = camp.z + dz, y = ground(x, z), material = new THREE.MeshStandardMaterial({color: WOOD, roughness: .9});
    const mesh = new THREE.Mesh(crateGeometry, material); mesh.position.set(x, y + CRATES.size[1] / 2, z); mesh.castShadow = true; mesh.rotation.y = dx; scene.add(mesh);
    const glow = new THREE.PointLight(GLOW.color, 0, GLOW.distance, 2); glow.position.set(x, y + GLOW.lift, z); scene.add(glow);
    const detachGlow = lightRig?.add(glow, {shadow: Boolean(lightRig.shadows) && dx === CRATES.layout[0][0]});
    const flames = await createParticlePrefab(scene, 'fire', {position: new THREE.Vector3(x, y + FLAME_HEIGHT, z), size: FLAME_SIZE, pool: 30});
    flames.stop(); flames.setEnvironment(environment);
    return {state: fire.add({position: mesh.position, burnSeconds}), mesh, material, glow, detachGlow, flames, burning: false};
  }));

  const fish = await createFishFlock({bounds: school.bounds, counts: school.counts, size: school.size, floorHeight: ground, surfaceHeight: school.surfaceHeight, random});
  scene.add(fish.group);

  let disposed = false, time = 0;
  return {
    camp, trees, bushes, grass, fish, fire,
    get burning() { return crates.filter(crate => crate.burning).length; },
    ignite() { crates[0].state.ignite(); },
    resetFire() { fire.reset(); for (const crate of crates) { crate.burning = false; crate.glow.intensity = 0; crate.flames.stop(); crate.flames.clear(); } },
    update(dt, camera) {
      if (disposed) return;
      time += dt;
      trees.update(dt); bushes.update(dt); if (grass) grass.update(dt, {camera, environment}); fish.update(dt); fire.update(dt);
      crates.forEach((crate, index) => {
        const burning = crate.state.phase === 'burning';
        if (crate.burning !== burning) { crate.burning = burning; if (burning) crate.flames.start(); else crate.flames.stop(); }
        crate.flames.update(dt);
        crate.material.color.copy(WOOD).lerp(CHAR, 1 - crate.state.fuel);
        crate.glow.intensity = burning ? GLOW.intensity * Math.min(1, crate.state.fuel * 3) * (.9 + .1 * Math.sin(time * 17 + index)) : 0;
      });
    },
    dispose() {
      if (disposed) return; disposed = true;
      trees.dispose(); bushes.dispose(); if (grass) grass.dispose(); meadow.grassGeometries.forEach(geometry => geometry.dispose()); meadow.dispose(); fish.dispose();
      for (const {mesh, material, glow, detachGlow, flames} of crates) { detachGlow?.(); scene.remove(mesh, glow); material.dispose(); glow.dispose(); flames.dispose(); }
      crateGeometry.dispose();
    },
  };
}
