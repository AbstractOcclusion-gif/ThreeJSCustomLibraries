import {BoxGeometry, Color, DynamicDrawUsage, Euler, InstancedMesh, MeshStandardMaterial, Object3D, Vector3} from 'three';
import {Body, Box, Vec3} from 'cannon-es';
import {seededRandom} from '../../src/core/hash.js';
import {FRONT} from './timing.js';

const GRID = {columns: 9, rows: 7, spacing: 17, clearing: 29, seed: 32};
const HERO_BUILDINGS = 3;
const MAX_SWAPS_PER_FRAME = 8;
const WALL = .55;
const ROOF = .45;
const WALL_COLORS = [0xc2a185, 0xcdba9e, 0xba9270, 0xd0c6b1, 0xaebaab];
const ROOF_COLORS = [0x70584a, 0x89806a, 0x918073, 0x93795e];
const OPENING = 0x554a40;

function layout(heightAt, center, spacingScale) {
  const random = seededRandom(GRID.seed), sites = [];
  for (let row = 0; row < GRID.rows; row++) {
    for (let col = 0; col < GRID.columns; col++) {
      const x = ((col - (GRID.columns - 1) / 2) * GRID.spacing + (random() - .5) * 3) * spacingScale;
      const z = ((row - (GRID.rows - 1) / 2) * GRID.spacing + (random() - .5) * 3) * spacingScale;
      const distance = Math.hypot(x - center.x, z - center.z);
      if (distance < GRID.clearing * spacingScale) continue;
      const width = 6 + random() * 4, depth = 6 + random() * 4;
      const height = 3.2 + random() * (row % 3 === 0 ? 5 : 2);
      const floor = heightAt(x, z) - .35;
      sites.push({x, z, floor, width, height, depth, distance, seed: Math.floor(random() * 100000),
        wall: WALL_COLORS[Math.floor(random() * WALL_COLORS.length)], roof: ROOF_COLORS[Math.floor(random() * ROOF_COLORS.length)]});
    }
  }
  return sites.sort((a, b) => a.distance - b.distance);
}

function structure({x, z, floor, width, depth, height, wall, roof}, opening = true) {
  const middle = floor + height / 2, top = floor + height;
  const wallX = (width - WALL) / 2, wallZ = (depth - WALL) / 2;
  const pieces = [
    {at: [x - wallX, middle, z], size: [WALL, height, depth - WALL * 2], tint: wall},
    {at: [x + wallX, middle, z], size: [WALL, height, depth - WALL * 2], tint: wall},
    {at: [x, middle, z - wallZ], size: [width, height, WALL], tint: wall},
    {at: [x, middle, z + wallZ], size: [width, height, WALL], tint: wall},
    {at: [x, top + ROOF / 2, z], size: [width + .35, ROOF, depth + .35], tint: roof},
  ];
  if (opening) {
    const face = z + depth / 2;
    pieces.push(
      {at: [x - width * .2, floor + 1.5, face], size: [1.05, 3, .06], tint: OPENING},
      {at: [x + width * .17, floor + height * .62, face], size: [1.45, 1, .06], tint: OPENING},
    );
  }
  return pieces;
}

function rubble(site, heightAt) {
  const {x, z, width, depth, wall, roof} = site, random = seededRandom(site.seed);
  const pieces = [];
  for (let i = 0; i < 6; i++) {
    const px = x + (random() - .5) * width, pz = z + (random() - .5) * depth;
    const tall = i < 2, height = tall ? 1.5 + random() * 1.4 : .45 + random() * .75;
    pieces.push({at: [px, heightAt(px, pz) + height * .33, pz],
      size: [1.3 + random() * 2, height, tall ? .7 : 1.25 + random() * 1.3],
      angles: [(random() - .5) * .55, random() * Math.PI, (random() - .5) * .45], tint: i % 3 ? wall : roof});
  }
  return pieces;
}

export function createSettlement({scene, heightAt, center, physics, dust, scale}) {
  const sites = layout(heightAt, center, scale?.length ?? 1);
  const standing = sites.map(site => structure(site));
  const destroyed = sites.map(site => rubble(site, heightAt));
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial({roughness: 1});
  function batch(capacity) {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  }
  const intact = batch(standing.flat().length);
  const wreckage = batch(destroyed.flat().length);
  const wallsPerBuilding = structure(sites[0], false).length;
  const debris = batch(HERO_BUILDINGS * wallsPerBuilding);
  const transform = new Object3D(), color = new Color(), euler = new Euler(), point = new Vector3();
  const moving = [];
  let cursor = 0, lastDrawn = -1;

  function write(mesh, index, {at, size, angles = [0, 0, 0], tint}, body) {
    if (body) {
      transform.position.copy(body.position);
      transform.quaternion.copy(body.quaternion);
    } else {
      transform.position.fromArray(at);
      transform.quaternion.setFromEuler(euler.fromArray(angles));
    }
    transform.scale.fromArray(size);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, color.setHex(tint));
  }

  function drawStatic() {
    intact.count = wreckage.count = 0;
    for (let i = cursor; i < sites.length; i++) for (const piece of standing[i]) write(intact, intact.count++, piece);
    for (let i = HERO_BUILDINGS; i < cursor; i++) for (const piece of destroyed[i]) write(wreckage, wreckage.count++, piece);
    for (const mesh of [intact, wreckage]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    lastDrawn = cursor;
  }

  function breakHero(site) {
    const dx = (site.x - center.x) / site.distance, dz = (site.z - center.z) / site.distance;
    const random = seededRandom(site.seed);
    for (const piece of structure(site, false)) {
      const [x, y, z] = piece.at, [w, h, d] = piece.size;
      const body = new Body({
        mass: w * h * d * 80,
        shape: new Box(new Vec3(w / 2, h / 2, d / 2)),
        position: new Vec3(x, y + .3, z),
        angularDamping: .25,
      });
      const speed = 3 + random() * 4;
      body.velocity.set(dx * speed + random() - .5, 1.2 + random() * 3, dz * speed + random() - .5);
      body.angularVelocity.set((random() - .5) * 1.9, (random() - .5) * 1.9, (random() - .5) * 1.9);
      physics.addBody(body);
      moving.push({body, piece});
    }
  }

  drawStatic();
  return {
    advance(time) {
      const reach = scale ? scale.shock.radiusAt(time) : (time - FRONT.delay) * FRONT.pace;
      for (let work = 0; work < MAX_SWAPS_PER_FRAME && cursor < sites.length && sites[cursor].distance <= reach; work++) {
        const index = cursor++, site = sites[index];
        if (index < HERO_BUILDINGS) breakHero(site);
        if (index % 2 === 0) dust.dust(point.set(site.x, site.floor + .5, site.z), site.width * .68, 0xbaa187);
      }
      if (cursor !== lastDrawn) drawStatic();
    },
    sync() {
      for (let i = 0; i < moving.length; i++) write(debris, i, moving[i].piece, moving[i].body);
      debris.count = moving.length;
      if (debris.count) {
        debris.instanceMatrix.needsUpdate = true;
        debris.instanceColor.needsUpdate = true;
      }
    },
    reset() {
      for (const {body} of moving) physics.removeBody(body);
      moving.length = debris.count = cursor = 0;
      drawStatic();
    },
    dispose() {
      for (const {body} of moving) physics.removeBody(body);
      for (const mesh of [intact, wreckage, debris]) { scene.remove(mesh); mesh.dispose(); }
      geometry.dispose();
      material.dispose();
    },
    get total() { return sites.length; },
    get damaged() { return cursor; },
    get bodyCount() { return moving.length; },
    get simulating() { return moving.some(({body}) => body.sleepState !== Body.SLEEPING); },
  };
}
