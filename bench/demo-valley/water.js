import * as THREE from 'three';
import {createChannelSurface, createFlowBake, createRipples, customSky} from '../../src/water/index.js';
import {SKY_GLSL} from '../../src/core/sky.js';
import {createBenchPondSettings} from '../water/controls.js';
import {aimRay} from '../kit/input.js';
import {bindRippleGesture} from '../ripple-gesture.js';

const RENDER = {captureScale: .5, causticSegments: 128, lakeWaveScale: 2};
const OBSTACLE_COUNT = 4;

export function createValleyWaterView({water, field, scene, renderer, camera, stage, orbit, spacing, flying, kind}) {
  if (!water.bounds) return;
  const {level, bounds: {minX, minZ, maxX, maxZ}} = water;
  const origin = [minX, minZ].map(value => Math.floor(value / spacing) * spacing);
  const cells = [maxX, maxZ].map((value, axis) => Math.ceil((value - origin[axis]) / spacing));
  const size = cells.map(count => count * spacing);
  const geometry = new THREE.PlaneGeometry(...size, ...cells).rotateX(-Math.PI / 2);
  geometry.translate(origin[0] + size[0] / 2, 0, origin[1] + size[1] / 2);
  const positions = geometry.attributes.position;
  const bed = new Float32Array(positions.count);
  const wetAt = (x, z) => water.inFootprint(x, z) && field.heightAt(x, z) < level;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const height = field.heightAt(x, z);
    bed[i] = water.inFootprint(x, z) ? height : Math.max(level, height);
  }
  geometry.setAttribute('bedHeight', new THREE.BufferAttribute(bed, 1));
  geometry.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3));

  const ripples = createRipples({origin, size});
  ripples.mask(wetAt);
  const flow = createFlowBake();
  const obstacles = Array.from({length: OBSTACLE_COUNT}, () => new THREE.Vector4());
  const view = createChannelSurface({
    renderer, scene, camera, ripples, flow, obstacles, clipToBed: true, pondOptics: true,
    sky: customSky({glsl: SKY_GLSL, uniforms: stage.skyUniforms}),
    captureScale: RENDER.captureScale, causticSegments: RENDER.causticSegments,
  });
  view.surface.geometry.dispose();
  view.surface.geometry = geometry;
  view.surface.position.y = level;
  view.surface.updateMatrixWorld(true);
  const settings = createBenchPondSettings();
  settings.speed = 0;
  if (kind === 'Lake') settings.windWaves.waveLengthMeters *= RENDER.lakeWaveScale;

  const ray = new THREE.Raycaster(), canvas = renderer.domElement;
  const gesture = bindRippleGesture(canvas, orbit, event => {
    if (flying()) return;
    const point = aimRay(ray, event, canvas, camera).intersectObject(view.surface)[0]?.point;
    if (point && wetAt(point.x, point.z)) return point;
  }, ({x, z}, strength) => ripples.splash(x, z, strength));
  let time = 0;
  return {
    cancelGesture: gesture.cancel,
    render(dt, inspectTiles) {
      view.surface.visible = !inspectTiles;
      if (inspectTiles || flying()) gesture.cancel();
      gesture.update(dt);
      ripples.update(dt);
      time += dt;
      view.render(time, settings);
    },
    dispose() {
      gesture.dispose();
      view.dispose();
      flow.dispose();
      ripples.dispose();
    },
  };
}
