import * as THREE from 'three';
import {seededRandom} from '../../src/core/index.js';
import {BENCH_SNOW as settings} from './setups.js';

export function createBenchSnow(scene) {
  const random = seededRandom(settings.seed);
  const positions = new Float32Array(settings.count * 3);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const material = new THREE.PointsMaterial({color: settings.color, size: settings.size});
  const flakes = new THREE.Points(geometry, material);
  flakes.frustumCulled = false;
  scene.add(flakes);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] = (random() - .5) * settings.width;
    positions[index + 1] = random() * settings.height;
    positions[index + 2] = (random() - .5) * settings.width;
  }

  const wrap = value => THREE.MathUtils.euclideanModulo(value + settings.width / 2, settings.width) - settings.width / 2;
  return {
    update(dt, environment) {
      const amount = environment.snow;
      flakes.visible = amount > 0;
      if (!flakes.visible) return;
      const count = Math.round(settings.count * amount);
      geometry.setDrawRange(0, count);
      const drift = settings.windDrift * dt;
      for (let index = 0; index < count * 3; index += 3) {
        positions[index] = wrap(positions[index] + environment.wind.x * drift);
        positions[index + 1] = THREE.MathUtils.euclideanModulo(positions[index + 1] - settings.fallSpeed * dt, settings.height);
        positions[index + 2] = wrap(positions[index + 2] + environment.wind.z * drift);
      }
      attribute.needsUpdate = true;
    },
    dispose() {
      scene.remove(flakes);
      geometry.dispose();
      material.dispose();
    },
  };
}
