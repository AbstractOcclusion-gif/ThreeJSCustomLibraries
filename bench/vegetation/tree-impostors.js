import * as THREE from 'three';

const VIEW_COUNT = 4;
const TILE_SIZE = 256;
const PADDING = 1.08;
export const VIEW_STEP = Math.PI * 2 / VIEW_COUNT;

export function bakeTreeImpostor(renderer, scene, model, bounds) {
  const size = bounds.getSize(new THREE.Vector3());
  const width = Math.hypot(size.x, size.z) * PADDING;
  const height = size.y * PADDING;
  const centre = size.y / 2;
  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .01, width * 4);
  const bakeScene = new THREE.Scene();
  for (const light of scene.children) {
    if (!light.isDirectionalLight && !light.isHemisphereLight) continue;
    const copy = light.clone();
    copy.castShadow = false;
    bakeScene.add(copy);
    if (copy.isDirectionalLight) bakeScene.add(copy.target);
  }
  bakeScene.add(model.clone());
  const atlas = new THREE.WebGLRenderTarget(TILE_SIZE * VIEW_COUNT, TILE_SIZE);
  atlas.scissorTest = true;
  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color());
  const alpha = renderer.getClearAlpha();
  // Bake outside the normal render loop, into a transparent linear target.
  try {
    renderer.setClearColor(0, 0);
    for (let view = 0; view < VIEW_COUNT; view++) {
      const angle = view * VIEW_STEP;
      camera.position.set(Math.sin(angle) * width * 2, centre, Math.cos(angle) * width * 2);
      camera.lookAt(0, centre, 0);
      atlas.viewport.set(view * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
      atlas.scissor.copy(atlas.viewport);
      renderer.setRenderTarget(atlas);
      renderer.render(bakeScene, camera);
    }
  } catch (error) {
    atlas.dispose();
    throw error;
  } finally {
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, alpha);
  }
  const geometry = new THREE.PlaneGeometry(width, height).translate(0, centre, 0);
  const material = new THREE.MeshBasicMaterial({map: atlas.texture, alphaTest: .35});
  return {atlas, geometry, material, viewCount: VIEW_COUNT};
}
