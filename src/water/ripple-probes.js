// Ripple probes: the surface probes the buoyancy reads (ocean/buoyancy.js: {points, samples: [{valid, height,
// velocity}]}), taken from a ripple field (ripples.js) under a horizontal surface instead of the ocean. A thing floating
// in a glass or a pond then rides its ripples. Read at once (the field is on the CPU); the velocity is the change of
// height between two reads.
import * as THREE from 'three';

// ripples: a createRipples() field; surface: the Object3D whose own x and z are the field's (its y is the still level);
// heightScale: m of surface per unit of the field. Returns {factory(count) -> probes, update(dt)}: hand `factory` to
// the Buoyancy; call update(dt) once per step, after the probes' points are placed (Buoyancy.updateProbePoints).
export function createRippleProbes({ripples, surface, heightScale = 1} = {}) {
  if (typeof ripples?.heightAt !== 'function') throw new TypeError('Ripple probes need a ripple field (createRipples)');
  if (!surface?.isObject3D) throw new TypeError('Ripple probes need the surface (an Object3D)');
  if (!(heightScale > 0)) throw new RangeError('Ripple probe height scale must be above 0');
  const sets = new Set(), local = new THREE.Vector3(), level = new THREE.Vector3();
  return {
    factory(count) {
      const probes = {
        points: Array.from({length: count}, () => new THREE.Vector3()),
        samples: Array.from({length: count}, () => ({valid: false, height: 0, velocity: new THREE.Vector3()})),
        dispose: () => sets.delete(probes),
      };
      sets.add(probes);
      return probes;
    },
    update(dt) {
      surface.updateWorldMatrix(true, false);
      surface.getWorldPosition(level);
      for (const {points, samples} of sets) {
        points.forEach((point, index) => {
          surface.worldToLocal(local.copy(point));
          const sample = samples[index], height = level.y + ripples.heightAt(local.x, local.z) * heightScale;
          sample.velocity.set(0, sample.valid && dt > 0 ? (height - sample.height) / dt : 0, 0);
          sample.height = height; sample.valid = true;
        });
      }
    },
  };
}
