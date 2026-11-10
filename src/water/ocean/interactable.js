// ocean/interactable.js -- port of WebGpuWater's WaterInteractable.cs in its default MouseLikeDrops mode: an object that disturbs
// the surface emits analytic cosine HEIGHT drops cloned from the mouse rules -- one per verticalEmitSpacing of plunge/rise, one
// wake drop per horizontalEmitSpacing of travel (the mouse drag's spacing rule), at most MaxDropsPerFrame a frame. Smooth by
// construction. This, not the sphere dipole, is what lays the demo boat's wake ridge; the dipole only shapes the bow.
import * as THREE from 'three';
import { autoRadius, sphereSubmersionWeight } from './sphere-interactor.js';

const MAX_DROPS_PER_FRAME = 4;
// WaterVolume ripple defaults (Settings.Ripples.cs: rippleStrength 0.025 m, rippleRadius 0.05 m) + the component's emit spacings.
export const INTERACTABLE_DEFAULTS = Object.freeze({ rippleStrength: 0.025, rippleRadius: 0.05, displaceScale: 1, rippleRadiusScale: 1, verticalEmitSpacing: 0.012, horizontalEmitSpacing: 0.02 });

const tmpCenter = new THREE.Vector3();
export class Interactable {
  // object: the Object3D; boundsCenterLocal / boundsHalfExtents / boundsMinYLocal describe its renderer bounds in local space.
  constructor(object, boundsCenterLocal, boundsHalfExtents, boundsMinYLocal, settings = {}) {
    this.object = object; this.centerLocal = boundsCenterLocal.clone(); this.halfExtents = boundsHalfExtents.clone(); this.minYLocal = boundsMinYLocal;
    this.s = { ...INTERACTABLE_DEFAULTS, ...settings }; this.tracking = false; this.prevRelDepth = 0; this.lastDrop = new THREE.Vector3();
  }
  // LateUpdate. waterlineY: the surface height under the bounds centre (from the sampler), undefined when unknown.
  update(window, waterlineY) {
    const center = this.object.localToWorld(tmpCenter.copy(this.centerLocal));
    const submerged = waterlineY !== undefined && this.object.position.y + this.minYLocal < waterlineY;   // Renderer.bounds.min.y < waterline
    if (!submerged) { this.tracking = false; return; }
    const depthWeight = sphereSubmersionWeight(waterlineY, center.y, autoRadius(this.halfExtents));
    if (depthWeight <= 0) { this.tracking = false; return; }
    const relDepth = waterlineY - this.object.position.y;
    if (!this.tracking) { this.tracking = true; this.prevRelDepth = relDepth; this.lastDrop.copy(center); return; }
    const s = this.s, radius = s.rippleRadius * s.rippleRadiusScale, strength = s.rippleStrength * s.displaceScale * depthWeight;
    let budget = MAX_DROPS_PER_FRAME, depthDelta = relDepth - this.prevRelDepth;
    while (Math.abs(depthDelta) >= s.verticalEmitSpacing && budget-- > 0) {
      const direction = Math.sign(depthDelta); window.addDrop(center.x, center.z, radius, -direction * strength); depthDelta -= direction * s.verticalEmitSpacing;
    }
    this.prevRelDepth = relDepth - depthDelta;
    const travel = Math.hypot(center.x - this.lastDrop.x, center.z - this.lastDrop.z);
    if (travel >= s.horizontalEmitSpacing && budget > 0) { window.addDrop(center.x, center.z, radius, strength); this.lastDrop.copy(center); }
  }
}
