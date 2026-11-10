// Island life for the ocean coast demo: leaved trees, bushes and grass on the hill, a camp of crates that burn (fire +
// particle prefabs) and a school of fish off the beach. Every part reads the one shared environment (core/environment.js)
// the weather fills, so wind and light reach all of them the same way.
import * as THREE from 'three';
import {LeavedTrees} from '../../src/trees/index.js';
import {createFreeVegetation, createGrassField} from '../../src/vegetation/index.js';
import {createFireSystem} from '../../src/fire/index.js';
import {createParticlePrefab} from '../../src/particles/index.js';
import {createFishFlock} from '../../src/flocking/index.js';
import {seededRandom} from '../../src/core/hash.js';

// Metres. Lines are ground heights above mean sea: nothing grows on the wave-washed beach below them.
const PLANTS = Object.freeze({radius: 64, treeLine: 6, bushLine: 3.6, grassLine: 2.4, trees: 38, bushes: 70, grass: 16000, clearing: 6});
// Offsets from the island centre, toward the default camera (+Z).
const CAMP = Object.freeze({x: 3, z: 45, crates: [[0, 0, 10], [1.5, .35, 12], [3, -.25, 9], [4.6, .2, 11]], crateSize: [.95, .8, .8]});
const FISH = Object.freeze({halfWidth: 22, near: 92, far: 116, floor: -5, ceiling: -.6, counts: {roach: 24, rudd: 12, perch: 6}, size: 1});
const LEAF_SHADE = new THREE.Color('#2f6b1f'), LEAF_LIGHT = new THREE.Color('#779640'), GRASS_GREEN = new THREE.Color('#50762e'), GRASS_DRY = new THREE.Color('#c2aa61');
const WOOD = new THREE.Color(0xb18451), CHAR = new THREE.Color(0x241b16);
const FLAME_HEIGHT = .58, FLAME_SIZE = 1.16, GLOW = Object.freeze({color: 0xff8f36, intensity: 2.8, distance: 6, lift: 1.1});

export async function createIslandLife({scene, ground, centre: [centreX, centreZ], environment, lighting}) {
  const random = seededRandom(29);
  const camp = {x: centreX + CAMP.x, z: centreZ + CAMP.z};
  // Rejection-sample dry ground above `line`, outside the camp clearing.
  function sites(count, line) {
    const out = [];
    for (let tries = count * 12; out.length < count && tries > 0; tries--) {
      const x = centreX + (random() * 2 - 1) * PLANTS.radius, z = centreZ + (random() * 2 - 1) * PLANTS.radius, y = ground(x, z);
      if (y >= line && Math.hypot(x - camp.x - 2.3, z - camp.z) > PLANTS.clearing) out.push({x, y, z, roll: random(), yaw: random() * Math.PI * 2});
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
  const grass = createGrassField({scene, geometries: meadow.grassGeometries, map: meadow.atlas, color: 0xffffff, tileSize: 8, flatColorMix: .75,
    placements: sites(PLANTS.grass, PLANTS.grassLine).map(({x, y, z, yaw, roll}) => ({x, y: y - .02, z, yaw, scale: .7 + roll * .9, tint: tint.lerpColors(GRASS_GREEN, GRASS_DRY, roll * roll).toArray()}))});

  const fire = createFireSystem({environment}), crateGeometry = new THREE.BoxGeometry(...CAMP.crateSize);
  const crates = await Promise.all(CAMP.crates.map(async ([dx, dz, burnSeconds]) => {
    const x = camp.x + dx, z = camp.z + dz, y = ground(x, z), material = new THREE.MeshStandardMaterial({color: WOOD, roughness: .9});
    const mesh = new THREE.Mesh(crateGeometry, material); mesh.position.set(x, y + CAMP.crateSize[1] / 2, z); mesh.rotation.y = dx; scene.add(mesh);
    const glow = new THREE.PointLight(GLOW.color, 0, GLOW.distance, 2); glow.position.set(x, y + GLOW.lift, z); scene.add(glow);
    const flames = await createParticlePrefab(scene, 'fire', {position: new THREE.Vector3(x, y + FLAME_HEIGHT, z), size: FLAME_SIZE, pool: 30});
    flames.stop(); flames.setEnvironment(environment);
    return {state: fire.add({position: mesh.position, burnSeconds}), mesh, material, glow, flames, burning: false};
  }));

  const fishBounds = new THREE.Box3(new THREE.Vector3(centreX - FISH.halfWidth, FISH.floor, centreZ + FISH.near), new THREE.Vector3(centreX + FISH.halfWidth, FISH.ceiling, centreZ + FISH.far));
  const fish = await createFishFlock({bounds: fishBounds, counts: FISH.counts, size: FISH.size, floorHeight: ground, surfaceHeight: () => FISH.ceiling, random});
  scene.add(fish.group);

  let disposed = false, time = 0;
  return {
    camp, trees, bushes, grass, fish, fire,
    get burning() { return crates.filter(crate => crate.burning).length; },
    ignite() { crates[0].state.ignite(); },
    resetFire() { fire.reset(); for (const crate of crates) { crate.burning = false; crate.flames.stop(); crate.flames.clear(); } },
    update(dt, camera) {
      if (disposed) return;
      time += dt;
      trees.update(dt); bushes.update(dt); grass.update(dt, {camera, environment}); fish.update(dt); fire.update(dt);
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
      trees.dispose(); bushes.dispose(); grass.dispose(); meadow.grassGeometries.forEach(geometry => geometry.dispose()); meadow.dispose(); fish.dispose();
      for (const {mesh, material, glow, flames} of crates) { scene.remove(mesh, glow); material.dispose(); glow.dispose(); flames.dispose(); }
      crateGeometry.dispose();
    },
  };
}
