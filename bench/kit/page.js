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

export const STATUS_REFRESH_MS = 250;   // how often the pages rewrite their status text
export {startFrameLoop, onLeave} from './page-lifecycle.js';
