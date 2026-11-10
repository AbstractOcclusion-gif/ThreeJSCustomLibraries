// rendering/passes.js -- copied from WebAquarium src/rendering/passes.js: the full-screen pass helper and its vertex shader.
// Trimmed to what the ocean needs (no sim / foam / drop queues). Array render targets take the layer to draw into.
import * as THREE from 'three';
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
function createTargetScope(renderer) {
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), color = new THREE.Color();
  return draw => {
    const target = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    const scissorTest = renderer.getScissorTest(), alpha = renderer.getClearAlpha();
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);
    renderer.getClearColor(color);
    try {
      renderer.setScissorTest(false);
      return draw();
    } finally {
      renderer.setRenderTarget(target, face, level);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      renderer.setClearColor(color, alpha);
    }
  };
}
const QV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
// ping-pong pair: passes read `.read` and write `.write`, then swap()
const pingPong = make => { const a = make(); return { read: a, write: make(), swap() { const t = this.read; this.read = this.write; this.write = t; },
  dispose() { this.read.dispose(); this.write.dispose(); } }; };

export { QV, createPass, createTargetScope, pingPong };
