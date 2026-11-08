// Instanced leaved trees: one InstancedMesh per (80 m cell × silhouette variant) so off-screen cells are frustum-culled,
// per-instance (r, h, r) scale and tint. Best FPS of everything tried in InvestorsJourney; hedges use the 'bush' profile.
import * as THREE from 'three';
import {hash2} from '../core/hash.js';
import {leavedTreeGeometry} from './leaved-geometry.js';
import {resolveProfile} from './profiles.js';
import {createLeavedMaterial, meanLeafLuminance} from './leaved-material.js';
import {createVegetationAtlas, FREE_ATLAS_RECTS} from '../vegetation/free-assets.js';

const SCALE_RANGE = [.35, 2.2];

export class LeavedTrees {
  /**
   * profile: 'tree' | 'bush' | profile object; lighting: core/lighting.js hook; leafTexture + leafRect: a leaf-cluster alpha
   * region (default: the generated atlas); sampleGround(x, z) -> y; canopy: {texture, extent: Vector2} enables the canopy
   * sun-visibility map; nearHole: enables the dithered near hole (setNearHole()).
   */
  constructor({scene, profile = 'tree', lighting, leafTexture, leafRect, leafLuminance, leafCutoff = .5, cellSize = 80, sampleGround = () => 0, canopy = null, nearHole = false} = {}) {
    if (!scene) throw Error('LeavedTrees needs a scene');
    this.scene = scene; this.cellSize = cellSize; this.sampleGround = sampleGround;
    this.group = new THREE.Group(); this.group.name = 'leaved-trees'; scene.add(this.group);
    this.meshes = []; this.items = []; this.scaleMultiplier = 1;
    this.ownsLeaf = !leafTexture;
    this.leafTexture = leafTexture ?? createVegetationAtlas();
    this.leafRect = leafRect ?? (leafTexture ? [0, 0, 1, 1] : FREE_ATLAS_RECTS.leaf);
    const luminance = leafLuminance ?? meanLeafLuminance(this.leafTexture, this.leafRect);
    this.material = createLeavedMaterial({lighting, leafTexture: this.leafTexture, leafCutoff, leafLuminance: luminance, canopy, nearHole});
    this.setProfile(profile);
  }

  /** Rebuild the silhouette templates from a profile; re-places the current items. */
  setProfile(profile) {
    this.profile = resolveProfile(profile);
    for (const t of this.templates ?? []) t.dispose();
    this.templates = Array.from({length: this.profile.variants}, (_, v) => leavedTreeGeometry(this.profile, v, this.leafRect));
    if (this.items.length) this.place(this.items, this.scaleMultiplier);
  }

  /** items: {x, z, h, r, yaw?, tint?: [r, g, b] linear 0..1 | tint8?: [r, g, b] sRGB 0..255}; scaleMultiplier enlarges all. */
  place(items, scaleMultiplier = 1) {
    this.clear(); this.items = items; this.scaleMultiplier = scaleMultiplier;
    const cells = new Map(), V = this.profile.variants, C = this.cellSize;
    for (const item of items) {
      const variant = Math.floor(hash2(item.x, item.z, 9) * V) % V, key = `${Math.floor(item.x / C)},${Math.floor(item.z / C)},${variant}`;
      if (!cells.has(key)) cells.set(key, {variant, list: []});
      cells.get(key).list.push(item);
    }
    const pose = new THREE.Object3D(), tint = new THREE.Color(), scale = THREE.MathUtils.clamp(scaleMultiplier, ...SCALE_RANGE);
    for (const {variant, list} of cells.values()) {
      const mesh = new THREE.InstancedMesh(this.templates[variant], this.material, list.length);
      mesh.name = `leaved-${this.profile.name}-${variant}`;
      list.forEach((item, i) => {
        pose.position.set(item.x, item.y ?? this.sampleGround(item.x, item.z), item.z);
        pose.rotation.y = item.yaw ?? hash2(item.x, item.z, 1) * Math.PI * 2;
        pose.scale.set(item.r * scale, item.h * scale, item.r * scale); pose.updateMatrix(); mesh.setMatrixAt(i, pose.matrix);
        if (item.tint8) tint.setRGB(item.tint8[0] / 255, item.tint8[1] / 255, item.tint8[2] / 255, THREE.SRGBColorSpace);
        else if (item.tint) tint.setRGB(item.tint[0], item.tint[1], item.tint[2], THREE.LinearSRGBColorSpace);
        else tint.setRGB(1, 1, 1);
        mesh.setColorAt(i, tint);
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = mesh.receiveShadow = false; mesh.computeBoundingSphere();
      this.meshes.push(mesh); this.group.add(mesh);
    }
  }

  update(dt) { this.material.uniforms.uTime.value += dt; }
  setWind(strength) { this.material.uniforms.uWind.value = strength; }
  setNearHole(centre, inner, outer) { this.material.uniforms.uNearCentre.value.copy(centre); this.material.uniforms.uNearRadius.value.set(inner, outer); }
  get count() { return this.meshes.reduce((n, m) => n + m.count, 0); }
  clear() { for (const m of this.meshes) { this.group.remove(m); m.dispose(); } this.meshes = []; }
  dispose() {
    this.clear(); this.items = []; this.scene.remove(this.group); this.material.dispose();
    for (const t of this.templates) t.dispose(); if (this.ownsLeaf) this.leafTexture.dispose();
  }
}
