// Mixed scenes can rebuild meshes and materials while the lighting passes stay alive.
export function createShadowReceivers(scene, shadows, weather, rig) {
  const receivers = new Map();
  return {
    update() {
      const present = new Set();
      scene.traverse(object => {
        if (!object.isMesh || !object.receiveShadow) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial)) continue;
          present.add(material);
          if (receivers.has(material)) continue;
          const removeCloud = material.isMeshStandardMaterial ? weather.addCloudShadowReceiver(material) : undefined;
          const removeSun = shadows.applyTo(material), removeLocal = rig?.applyTo(material);
          receivers.set(material, () => { removeCloud?.(); removeSun(); removeLocal?.(); });
        }
      });
      for (const [material, detach] of receivers) if (!present.has(material)) { detach(); receivers.delete(material); }
    },
    dispose() {
      for (const detach of receivers.values()) detach();
      receivers.clear();
    },
  };
}
