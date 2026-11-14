import {syncLighting} from '../../src/core/lighting.js';

// Three materials and the lighting hook both need to leave fog to the water composite underwater.
export function createSceneFogScope(scene, camera, lighting) {
  // Disable the hook's smoothstep by putting its entire range beyond the visible scene.
  const beyondView = [camera.far * 2, camera.far * 3];
  return (submerged, draw) => {
    const fog = scene.fog;
    if (submerged) scene.fog = null;
    try {
      syncLighting(lighting.uniforms, {fog: scene.fog, fogRange: beyondView});
      return draw();
    } finally {
      scene.fog = fog;
      if (submerged) syncLighting(lighting.uniforms, {fog, fogRange: beyondView});
    }
  };
}
