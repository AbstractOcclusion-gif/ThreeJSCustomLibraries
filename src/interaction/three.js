import {Raycaster} from 'three';

export const INTERACTION_PICKER_DEFAULTS = Object.freeze({maxDistance: 6});

export function createThreeInteractionPicker({maxDistance = INTERACTION_PICKER_DEFAULTS.maxDistance} = {}) {
  const ray = new Raycaster();
  ray.far = maxDistance;
  const targets = new Map();
  const blockers = new Set();

  return {
    bind(object, id) {
      targets.set(object, id);
      return () => { if (targets.get(object) === id) targets.delete(object); };
    },
    block(object) {
      blockers.add(object);
      return () => blockers.delete(object);
    },
    pick(camera, pointer) {
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects([...new Set([...targets.keys(), ...blockers])], true)[0];
      for (let object = hit?.object; object; object = object.parent) {
        if (blockers.has(object)) break;
        if (targets.has(object)) return targets.get(object);
      }
      return null;
    },
    clear() {
      targets.clear();
      blockers.clear();
    },
  };
}
