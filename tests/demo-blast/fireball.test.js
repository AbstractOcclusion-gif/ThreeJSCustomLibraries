import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Scene, Vector3} from 'three';
import {createFireball} from '../../bench/demo-blast/fireball.js';
import {createBlastScale} from '../../bench/demo-blast/blast-scale.js';

test('volume partitions stay contiguous and in front of an orbiting or internal camera', () => {
  const scene = new Scene(), camera = new PerspectiveCamera(48, 1.4, .4, 5000);
  const origin = new Vector3(7, 3, -9), size = 3.4;
  const extent = new Vector3(120, 216, 120);
  const fire = createFireball(scene, {glow: 1}, null, {extent, texture: null, head: {height: 40}}, null, 40);
  try {
    fire.update(0, 10, origin, size);
    const target = origin.clone().add(new Vector3(0, 50, 0).multiplyScalar(size));
    for (const position of [[135,52,218], [-135,52,-218], [10,55,10], [0,300,0]]) {
      camera.position.fromArray(position).multiplyScalar(size).add(origin);
      camera.lookAt(target);camera.updateMatrixWorld();fire.sort(camera);
      const planes = scene.children.filter(object => object.isMesh && object.visible);
      assert.equal(planes.length, 8);
      const normal = camera.getWorldDirection(new Vector3());
      const material = planes[0].material;
      for (let i = 0; i < planes.length; i++) {
        const plane = planes[i];
        assert.equal(plane.material, material);
        assert.ok(plane.position.clone().sub(camera.position).dot(normal) > camera.near);
        assert.ok(plane.userData.shell.y>plane.userData.shell.x);
        assert.ok(Math.abs(plane.userData.sortDistance-(plane.userData.shell.x+plane.userData.shell.y)*size/2)<1e-9);
        if (i) assert.equal(plane.userData.shell.x,planes[i-1].userData.shell.y,'ray shells are contiguous');
        assert.ok(plane.position.distanceTo(planes[0].position)<1e-9,'shells share a camera-facing quad');
      }
      assert.equal(material.defines.BLAST_STEPS,40,'all shells use one 40-sample ray lattice');
    }
    camera.position.set(2000, 100, 0);camera.lookAt(3000, 100, 0);fire.sort(camera);
    // Looking away is rejected by camera clipping / the ray-box intersection,
    // rather than removing the shared proxy from the scene graph.
    for(const plane of scene.children.filter(object=>object.isMesh&&object.visible))
      assert.ok(plane.userData.shell.y>plane.userData.shell.x);
    fire.clear();fire.sort(camera);
    assert.ok(scene.children.filter(object => object.isMesh).every(object => !object.visible));
  } finally { fire.dispose(); }
  assert.equal(scene.children.length, 0);
});

test('yield anchors retain metre scale and buoyancy similarity; front stays monotonic', () => {
  const one = createBlastScale(1), twenty = createBlastScale(20);
  assert.ok(Math.abs(one.breakawayRadius - 44.196) < 1e-6);
  assert.ok(Math.abs(twenty.breakawayRadius - 146.48560975) < 1e-6);
  assert.ok(twenty.terrainSpan > one.terrainSpan * 3);
  for (const scale of [one, twenty]) {
    assert.ok(Math.abs(scale.length / scale.seconds ** 2 - 1) < 1e-12);
    let radius = 0;
    for (let time = .001; time <= 10; time += .001) {
      const next = scale.shock.radiusAt(time);
      assert.ok(next > radius); radius = next;
    }
    assert.equal(scale.shock.radiusAt(0), 0);
  }
});
