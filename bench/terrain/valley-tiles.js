import * as THREE from 'three';

const SIDES = [
  {dx: -1, dz: 0, vertex: (i, n) => i * (n + 1)},
  {dx: 1, dz: 0, vertex: (i, n) => i * (n + 1) + n},
  {dx: 0, dz: -1, vertex: i => i},
  {dx: 0, dz: 1, vertex: (i, n) => n * (n + 1) + i},
];

export function createValleyTiles({field, scene, material, sample, config, biomeColors, detailBounds}) {
  const {tileCount, tileSize, cells, distances, hysteresis, lodColors} = config;
  const half = tileCount * tileSize / 2;
  const templates = cells.map(count => new THREE.PlaneGeometry(tileSize, tileSize, count, count).rotateX(-Math.PI / 2));
  const overlays = lodColors.map(color => new THREE.MeshBasicMaterial({color, wireframe: true}));
  const tiles = [];
  for (let z = 0; z < tileCount; z++) {
    for (let x = 0; x < tileCount; x++) {
      const mesh = new THREE.Mesh(undefined, material);
      mesh.position.set(x * tileSize - half + tileSize / 2, 0, z * tileSize - half + tileSize / 2);
      scene.add(mesh);
      const {x: cx, z: cz} = mesh.position;
      const margin = tileSize / 2 + tileSize / cells[0];
      const keepDetail = detailBounds && cx + margin >= detailBounds.minX && cx - margin <= detailBounds.maxX
        && cz + margin >= detailBounds.minZ && cz - margin <= detailBounds.maxZ;
      tiles.push({x, z, mesh, keepDetail, level: 0, signature: ''});
    }
  }

  const neighbor = (x, z) => x >= 0 && z >= 0 && x < tileCount && z < tileCount
    ? tiles[z * tileCount + x] : undefined;
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  function rebuild(tile, levels) {
    const {mesh, level} = tile;
    const count = cells[level];
    const geometry = templates[level].clone();
    const position = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const colors = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
    geometry.setAttribute('color', colors);
    for (let i = 0; i < position.count; i++) {
      const x = mesh.position.x + position.getX(i), z = mesh.position.z + position.getZ(i);
      position.setY(i, field.heightAt(x, z));
      const {dx, dz, weights} = sample(x, z);
      normal.set(-dx, 1, -dz).normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
      color.setRGB(0, 0, 0);
      for (const [name, tint] of biomeColors) {
        const weight = weights[name];
        color.r += tint.r * weight;
        color.g += tint.g * weight;
        color.b += tint.b * weight;
      }
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    SIDES.forEach(({vertex}, side) => {
      const coarse = cells[levels[side]];
      if (coarse >= count) return;
      const stride = count / coarse;
      for (let i = 0; i < count; i++) {
        const remainder = i % stride;
        if (remainder === 0) continue;
        const a = vertex(i - remainder, count), b = vertex(i - remainder + stride, count);
        const index = vertex(i, count), t = remainder / stride;
        const mix = (attribute, axis) => THREE.MathUtils.lerp(attribute[axis](a), attribute[axis](b), t);
        position.setY(index, mix(position, 'getY'));
        normals.setXYZ(index, mix(normals, 'getX'), mix(normals, 'getY'), mix(normals, 'getZ'));
        colors.setXYZ(index, mix(colors, 'getX'), mix(colors, 'getY'), mix(colors, 'getZ'));
      }
    });
    geometry.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }

  return {
    update(camera, {lod, wireframe, surfaceMaterial = material}) {
      for (const tile of tiles) {
        const p = tile.mesh.position;
        const distance = Math.hypot(camera.position.x - p.x, camera.position.y, camera.position.z - p.z);
        if (!lod || tile.keepDetail) tile.level = 0;
        else {
          while (tile.level < distances.length && distance > distances[tile.level] + hysteresis) tile.level++;
          while (tile.level > 0 && distance < distances[tile.level - 1] - hysteresis) tile.level--;
        }
      }
      const counts = cells.map(() => 0);
      for (const tile of tiles) {
        const levels = SIDES.map(({dx, dz}) => neighbor(tile.x + dx, tile.z + dz)?.level ?? tile.level);
        const signature = [tile.level, ...levels].join('/');
        if (signature !== tile.signature) {
          rebuild(tile, levels);
          tile.signature = signature;
        }
        tile.mesh.material = wireframe ? overlays[tile.level] : surfaceMaterial;
        counts[tile.level]++;
      }
      return counts;
    },
    tiles,
    dispose() {
      for (const {mesh} of tiles) { scene.remove(mesh); mesh.geometry.dispose(); }
      for (const geometry of templates) geometry.dispose();
      for (const overlay of overlays) overlay.dispose();
    },
  };
}
