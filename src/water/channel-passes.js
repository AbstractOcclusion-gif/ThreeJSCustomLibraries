import * as THREE from 'three';
import {createPlanarCapture} from './planar-capture.js';
import {createRenderScope} from '../core/render-state.js';
import {createChannelCausticMaterial, MIN_SUN_HEIGHT} from './channel-material.js';

// WebAquarium's Fishing pond reflection settings.
export const POND_REFLECTION_DEFAULTS = Object.freeze({
  on: true,
  mix: 0.75,
  distort: 0.08,
  resolution: 512,
  hz: 15,
  floor: 0.15,
});
const MIN_MIRROR_EYE_HEIGHT = 0.005; // m: an eye this close to the surface skips the planar mirror
const CAUSTIC_MAP_SIZE = 512; // texels of the projected caustic map

export function createChannelPasses({
  renderer,
  scene,
  camera,
  surface,
  uniforms,
  ripples,
  shadow,
  captureScale,
  causticSegments,
  pondOptics,
  bedCaustics,
}) {
  const {material} = surface;
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const capture = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthTexture: depth});
  const causticTarget = new THREE.WebGLRenderTarget(CAUSTIC_MAP_SIZE, CAUSTIC_MAP_SIZE, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    ...(pondOptics ? {generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter} : {}),
  });
  const causticGrid = new THREE.PlaneGeometry(2, 2, causticSegments, causticSegments).rotateX(-Math.PI / 2);
  uniforms.bedColor.value = capture.texture;
  uniforms.bedDepth.value = depth;
  uniforms.causticMap.value = causticTarget.texture;
  const causticMaterial = createChannelCausticMaterial(uniforms);
  const causticScene = new THREE.Scene();
  causticScene.background = new THREE.Color(0);
  const causticMesh = new THREE.Mesh(causticGrid, causticMaterial);
  causticMesh.frustumCulled = false;
  causticScene.add(causticMesh);
  const causticCamera = new THREE.Camera();
  // Same surface geometry and refracted path as the final draw. WebAquarium's
  // half-resolution shaft pass avoids screen-door jitter and costs fewer samples.
  const godTarget = pondOptics
    ? new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthBuffer: false})
    : null;
  const godMaterial =
    godTarget &&
    new THREE.ShaderMaterial({
      uniforms,
      side: material.side,
      depthTest: false,
      depthWrite: false,
      defines: {...material.defines, POND_GOD_PASS: 1},
      vertexShader: material.vertexShader,
      fragmentShader: material.fragmentShader,
    });
  const godScene = godTarget && new THREE.Scene();
  const godMesh = godTarget && new THREE.Mesh(surface.geometry, godMaterial);
  if (godMesh) {
    godMesh.matrixAutoUpdate = false;
    godScene.background = new THREE.Color(0);
    godScene.add(godMesh);
    uniforms.tPondGod.value = godTarget.texture;
  }
  const size = new THREE.Vector2();
  const scope = createRenderScope(renderer, {clearColor: false});
  const eye = new THREE.Vector3();
  const planar = createPlanarCapture(renderer);

  function renderReflection(settings) {
    uniforms.uPlanarMix.value = 0;
    uniforms.uUnderMirror.value = 0;
    if (!settings?.on || uniforms.reflectionStrength.value <= 0) return;
    const waterLevel = uniforms.pondLightLevel.value;
    const eyeHeight = camera.getWorldPosition(eye).y - waterLevel;
    if (Math.abs(eyeHeight) <= MIN_MIRROR_EYE_HEIGHT) return;
    const below = eyeHeight < 0;
    const {resolution, mix, distort, floor, hz} = {...POND_REFLECTION_DEFAULTS, ...settings};
    planar.render(scene, camera, {height: waterLevel, below, resolution, hz});
    uniforms.tPlanar.value = planar.texture;
    uniforms.uPlanarMatrix.value.copy(planar.matrix);
    uniforms.uUnderMirror.value = below ? 1 : 0;
    uniforms.uPlanarMix.value = below ? 0 : mix;
    uniforms.uPlanarDistort.value = distort;
    uniforms.uPlanarFloor.value = floor;
  }
  return {
    get depthTexture() {
      return capture.depthTexture;
    },
    viewport: size,
    render(settings, sunHeight) {
      renderer.getDrawingBufferSize(size);
      capture.setSize(Math.max(1, Math.floor(size.x * captureScale)), Math.max(1, Math.floor(size.y * captureScale)));
      const sunAboveHorizon = sunHeight > MIN_SUN_HEIGHT;
      const visible = surface.visible;
      try {
        surface.visible = false;
        scope(() => {
          if (sunAboveHorizon)
            shadow?.render(ripples.bounds, uniforms.pondLightLevel.value, uniforms.pondRefractedSun.value, settings);
          if ((uniforms.caustics.value > 0 || uniforms.godRays.value > 0) && sunAboveHorizon) {
            renderer.setRenderTarget(causticTarget);
            renderer.render(causticScene, causticCamera);
            uniforms.uCausticOn.value = 1;
          }
          renderReflection(settings.planarReflection);
          renderer.setRenderTarget(capture);
          renderer.render(scene, camera);
          if (bedCaustics === 'screen' && uniforms.caustics.value > 0)
            uniforms.bedClipToWorld.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
          if (
            godTarget &&
            settings.godHalf !== false &&
            uniforms.godRays.value > 0 &&
            uniforms.uCausticOn.value > 0.5
          ) {
            godTarget.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
            godMesh.geometry = surface.geometry;
            godMesh.matrix.copy(surface.matrixWorld);
            renderer.setRenderTarget(godTarget);
            renderer.render(godScene, camera);
            uniforms.pondGodHalf.value = true;
          }
        });
      } finally {
        surface.visible = visible;
      }
    },
    dispose() {
      godTarget?.dispose();
      godMaterial?.dispose();
      capture.dispose();
      planar.dispose();
      causticTarget.dispose();
      causticGrid.dispose();
      causticMaterial.dispose();
    },
  };
}
