import {Quaternion, Vector3} from 'three';

export function createThreeSound(sound, {listener, metersPerUnit = 1} = {}) {
  const bindings = new Map();
  const position = new Vector3();
  const rotation = new Quaternion();
  const forward = new Vector3();
  const up = new Vector3();

  function pose(object, forwardZ) {
    object.getWorldPosition(position).multiplyScalar(metersPerUnit);
    object.getWorldQuaternion(rotation);
    forward.set(0, 0, forwardZ).applyQuaternion(rotation);
  }

  return {
    setListener(object) { listener = object; },
    attach(voice, object) {
      pose(object, 1);
      voice.setPose(position, forward);
      bindings.set(voice, object);
      return () => { if (bindings.get(voice) === object) bindings.delete(voice); };
    },
    update() {
      if (listener) {
        pose(listener, -1);
        up.set(0, 1, 0).applyQuaternion(rotation);
        sound.setListener(position, forward, up);
      }
      for (const [voice, object] of bindings) {
        if (voice.ended) bindings.delete(voice);
        else {
          pose(object, 1);
          voice.setPose(position, forward);
        }
      }
    },
    dispose() { bindings.clear(); listener = null; },
  };
}
