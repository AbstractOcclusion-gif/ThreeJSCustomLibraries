// rendering/passes.js -- copied from WebAquarium src/rendering/passes.js: the full-screen pass helper and its vertex shader.
// Trimmed to what the ocean needs (no sim / foam / drop queues). Array render targets take the layer to draw into.
import * as THREE from 'three';
import {createRenderScope} from '../../core/render-state.js';
function createPass(renderer) {
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  const geometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geometry, null);
  quad.frustumCulled = false;
  scene.add(quad);
  return {
    render(material, target, layer = 0) {
      quad.material = material;
      renderer.setRenderTarget(target, layer);
      renderer.render(scene, camera);
    },
    dispose() { geometry.dispose(); },
  };
}
// The ocean passes' scope: unscissored, clear colour restored (core/render-state.js).
const createTargetScope = renderer => createRenderScope(renderer);
const QV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
// ping-pong pair: passes read `.read` and write `.write`, then swap()
const pingPong = make => { const a = make(); return { read: a, write: make(), swap() { const t = this.read; this.read = this.write; this.write = t; },
  dispose() { this.read.dispose(); this.write.dispose(); } }; };

export { QV, createPass, createTargetScope, pingPong };
