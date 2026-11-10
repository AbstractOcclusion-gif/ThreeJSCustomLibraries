import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {createTargetScope} from './ocean/passes.js';

// Shared adaptation of WebAquarium's pond-reflection and ocean-reflections passes.
export function createPlanarCapture(renderer) {
 const matrix = new THREE.Matrix4(), inverse = new THREE.Matrix4();
 const scoped = createTargetScope(renderer);
 let reflector, lastCapture = -Infinity, lastHeight, lastBelow;
 return {
  matrix,
  get texture() { return reflector?.getRenderTarget().texture ?? null; },
  render(scene, camera, {height = 0, below = false, resolution = 512, hz = 15} = {}) {
   if (!reflector) {
    reflector = new Reflector(new THREE.PlaneGeometry(1, 1), {
     textureWidth: resolution, textureHeight: resolution, multisample: 0, clipBias: .003,
    });
   }
   const target = reflector.getRenderTarget();
   if (target.width !== resolution) {
    target.setSize(resolution, resolution);
    lastCapture = -Infinity;
   }
   const now = performance.now();
   if (height === lastHeight && below === lastBelow && now - lastCapture < 1000 / hz) return;
   reflector.rotation.x = (below ? 1 : -1) * Math.PI / 2;
   reflector.position.y = height;
   reflector.updateMatrixWorld(true);
   camera.updateWorldMatrix(true, false);
   const xr = renderer.xr.enabled, shadows = renderer.shadowMap.autoUpdate;
   try {
    scoped(() => reflector.onBeforeRender(renderer, scene, camera));
   } finally {
    renderer.xr.enabled = xr;
    renderer.shadowMap.autoUpdate = shadows;
   }
   matrix.copy(reflector.material.uniforms.textureMatrix.value).multiply(inverse.copy(reflector.matrixWorld).invert());
   lastCapture = now;
   lastHeight = height;
   lastBelow = below;
  },
  dispose() {
   reflector?.geometry.dispose();
   reflector?.dispose();
   reflector = null;
  },
 };
}
