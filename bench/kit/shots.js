// Bench-only: camera shots for the mixed demos. 'free' is the page's orbit controls; every other shot is a director rig
// (camera module) circling a subject.
import {createCameraDirector, createOrbitRig} from '../../src/camera/director.js';

const FREE = 'free', TRANSITION_SECONDS = 1.5;

// shots: {id: {target: Vector3, radius, height, speed}}. canFree(): false while the page itself holds the camera (e.g. a dive view).
export function createCameraShots({camera, controls, shots, canFree = () => true}) {
  const director = createCameraDirector(camera), state = {id: FREE};
  for (const [id, {radius, height, speed}] of Object.entries(shots)) director.register(id, createOrbitRig({radius, height, speed}));
  function select(id) {
    const directed = id !== FREE;
    if (directed) director.select(id, {duration: TRANSITION_SECONDS});
    else { controls.target.copy(shots[director.selected].target); controls.update(); }
    state.id = id; controls.enabled = !directed && canFree();
  }
  return {
    state, select,
    get directed() { return state.id !== FREE; },
    addTo(folder) { return folder.add(state, 'id', [FREE, ...Object.keys(shots)]).name('Camera').onChange(select); },
    // Call once per frame; returns true when a shot drove the camera (the page then skips its own controls).
    update(dt) { if (state.id === FREE) return false; director.update(dt, {target: shots[state.id].target}); return true; },
  };
}
