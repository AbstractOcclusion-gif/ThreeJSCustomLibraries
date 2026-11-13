// Instanced leaved trees: one InstancedMesh per (80 m cell × silhouette variant) so off-screen cells are frustum-culled,
// per-instance (r, h, r) scale and tint. Best FPS of everything tried in InvestorsJourney; hedges use the 'bush' profile.
import * as THREE from 'three';
import {hash2} from '../core/hash.js';
import {leavedTreeGeometry} from './leaved-geometry.js';
import {resolveProfile} from './profiles.js';
import {createLeavedMaterial, meanLeafLuminance} from './leaved-material.js';
import {createLighting, syncLightingFromEnvironment} from '../core/lighting.js';
import {createVegetationAtlas, FREE_ATLAS_RECTS} from '../core/vegetation-atlas.js';

const SCALE_RANGE = [.35, 2.2];
// Environment wind (m/s) to sway strength: per m/s, extra per m/s at full gust, and the cap.
const WIND_SWAY = Object.freeze({perSpeed: .08, perGust: .1, max: 3});

export class LeavedTrees {
  /**
   * profile: 'tree' | 'bush' | profile object; lighting: core/lighting.js hook; leafTexture + leafRect: a leaf-cluster alpha
   * region (default: the generated atlas); sampleGround(x, z) -> y; canopy: {texture, extent: Vector2} enables the canopy
   * sun-visibility map; nearHole: enables the dithered near hole (setNearHole()).
   */
  constructor({scene, profile = 'tree', lighting, leafTexture, leafRect, barkTexture, barkRect, leafLuminance, leafCutoff = .5, cellSize = 80, sampleGround = () => 0, canopy = null, nearHole = false} = {}) {
    if (!scene) throw Error('LeavedTrees needs a scene');
    this.scene = scene; this.cellSize = cellSize; this.sampleGround = sampleGround;
    this.group = new THREE.Group(); this.group.name = 'leaved-trees'; scene.add(this.group);
    this.meshes = []; this.items = []; this.scaleMultiplier = 1;
    // Without a `lighting` hook the trees own a default one, which setEnvironment() may drive.
    this.ownsLighting = !lighting; lighting ??= createLighting(); this.environment = null;
    this.ownsLeaf = !leafTexture;
    const initialProfile = resolveProfile(profile);
    this.cardStyle = initialProfile.cards.needle ? 'needle' : initialProfile.branches ? 'twig' : 'cluster';
    this.leafTexture = leafTexture ?? createVegetationAtlas({twigCards: this.cardStyle === 'twig', needleCards: this.cardStyle === 'needle'});
    this.leafRect = leafRect ?? (leafTexture ? [0, 0, 1, 1] : FREE_ATLAS_RECTS.leaf);
    const luminance = leafLuminance ?? meanLeafLuminance(this.leafTexture, this.leafRect);
    this.barkUsesLeafAtlas = this.ownsLeaf && !barkTexture;
    this.leafLuminance = leafLuminance;
    this.material = createLeavedMaterial({lighting, leafTexture: this.leafTexture, leafCutoff, leafLuminance: luminance, canopy, nearHole,
      barkTexture: barkTexture ?? (this.ownsLeaf ? this.leafTexture : null),
      barkRect: barkRect ?? (barkTexture ? [0, 0, 1, 1] : FREE_ATLAS_RECTS.bark)});
    this.setProfile(profile);
  }

  /** Rebuild the silhouette templates from a profile; re-places the current items. */
  setProfile(profile) {
    this.profile = resolveProfile(profile);
    const style = this.profile.cards.needle ? 'needle' : this.profile.branches ? 'twig' : 'cluster';
    if (this.ownsLeaf && style !== this.cardStyle) {
      const atlas = createVegetationAtlas({twigCards: style === 'twig', needleCards: style === 'needle'});
      this.leafTexture.dispose();
      this.leafTexture = atlas;
      this.cardStyle = style;
      this.material.uniforms.uLeaf.value = atlas;
      this.material.uniforms.uLeafLuminance.value = this.leafLuminance ?? meanLeafLuminance(atlas, this.leafRect);
      if (this.barkUsesLeafAtlas) this.material.uniforms.uBark.value = atlas;
    }
    for (const t of this.templates ?? []) t.dispose();
    this.templates = Array.from({length: this.profile.variants}, (_, v) => leavedTreeGeometry(this.profile, v, this.leafRect));
    if (this.items.length) this.place(this.items, this.scaleMultiplier);
  }

  /** Items accept an optional zero-based variant; by default placement selects it by position. */
  place(items, scaleMultiplier = 1) {
    this.clear(); this.items = items; this.scaleMultiplier = scaleMultiplier;
    const cells = new Map(), V = this.profile.variants, C = this.cellSize;
    for (const item of items) {
      const variant = Number.isInteger(item.variant) && item.variant >= 0 && item.variant < V
        ? item.variant : Math.floor(hash2(item.x, item.z, 9) * V) % V;
      const key = `${Math.floor(item.x / C)},${Math.floor(item.z / C)},${variant}`;
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

  // Optional shared environment (core/environment.js), held by reference: wind sets the sway, and its light drives the
  // trees' own lighting. A host that passed its own `lighting` hook keeps driving that itself. null detaches.
  setEnvironment(environment) { this.environment = environment ?? null; }
  update(dt) {
    this.material.uniforms.uTime.value += dt;
    const environment = this.environment; if (!environment) return;
    this.setWind(Math.min(WIND_SWAY.max, environment.wind.speed * (WIND_SWAY.perSpeed + environment.wind.gust * WIND_SWAY.perGust)));
    if (this.ownsLighting) syncLightingFromEnvironment(this.material.uniforms, environment);
  }
  setWind(strength) { this.material.uniforms.uWind.value = strength; }
  setNearHole(centre, inner, outer) { this.material.uniforms.uNearCentre.value.copy(centre); this.material.uniforms.uNearRadius.value.set(inner, outer); }
  get count() { return this.meshes.reduce((n, m) => n + m.count, 0); }
  clear() { for (const m of this.meshes) { this.group.remove(m); m.dispose(); } this.meshes = []; }
  dispose() {
    this.clear(); this.items = []; this.scene.remove(this.group); this.material.dispose();
    for (const t of this.templates) t.dispose(); if (this.ownsLeaf) this.leafTexture.dispose();
  }
}
