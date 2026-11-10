// Bench-only page plumbing shared by every demo: the renderer and page-leave cleanup.
import * as THREE from 'three';
import '../ui-demo.js';

export function benchRenderer() {
  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.prepend(renderer.domElement);
  const error = document.getElementById('error');
  renderer.debug.onShaderError = (gl, program, v, f) => { const msg = 'Shader error: ' + gl.getProgramInfoLog(program) + ' ' + gl.getShaderInfoLog(v) + ' ' + gl.getShaderInfoLog(f); if (error) { error.hidden = false; error.textContent = msg; } console.error(msg); };
  return renderer;
}

// Keep the renderer and a perspective camera on the window size. `after` runs once the sizes are set (render targets etc.).
// Returns the function that removes the listener.
export function bindResize(renderer, camera, after) {
  const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); after?.(); };
  addEventListener('resize', resize);
  return () => removeEventListener('resize', resize);
}

const MAX_FRAME_SECONDS = .05;   // a slow or resumed frame advances the scene at most this much: no jump after a hitch

// The bench frame loop: frame(dt, now) runs on every visible frame. dt is in seconds, 0 on the first frame and on the first
// frame after the tab was hidden, and clamped to maxDt. onHidden() runs on frames skipped while the tab is hidden.
// Stop it with renderer.setAnimationLoop(null), as before.
export function startFrameLoop(renderer, frame, {maxDt = MAX_FRAME_SECONDS, onHidden} = {}) {
  let last = null;
  renderer.setAnimationLoop(now => {
    if (document.hidden) { last = null; onHidden?.(); return; }
    const dt = last === null ? 0 : Math.min(maxDt, Math.max(0, (now - last) / 1000)); last = now;
    frame(dt, now);
  });
}

// Run `dispose` once when the page is really left (not when it is parked in the back/forward cache).
export function onLeave(dispose) {
  addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, {once: true});
}
