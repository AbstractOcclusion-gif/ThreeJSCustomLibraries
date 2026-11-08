// Procedural fallback sprite: a soft radial disc as a DataTexture (no file, no DOM), used wherever a licensed
// sheet or droplet texture is not supplied. Works in node for tests.
export function createSoftDiscTexture(THREE, size = 64, hardness = 0.35) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5, r = Math.min(1, Math.hypot(dx, dy) * 2);
    const a = 1 - THREE.MathUtils.smoothstep(r, hardness, 1), i = (y * size + x) * 4;
    const v = Math.round(255 * a);
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = v;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
