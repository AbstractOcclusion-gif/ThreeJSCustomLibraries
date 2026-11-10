// Texture setup in one call, for textures built from arrays in code and for loaded ones. Only the options given are set; the
// rest keep Three's defaults. filter: 'nearest', 'linear', 'mipmap' (trilinear with generated mipmaps) or a Three filter
// constant used for both. wrap: a Three wrapping constant for both axes.
import * as THREE from 'three';

export function configureTexture(texture, {wrap, filter, colorSpace, flipY, anisotropy, repeat} = {}) {
  if (wrap !== undefined) texture.wrapS = texture.wrapT = wrap;
  if (filter === 'mipmap') {
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true;
  } else if (filter !== undefined) {
    texture.minFilter = texture.magFilter = filter === 'nearest' ? THREE.NearestFilter : filter === 'linear' ? THREE.LinearFilter : filter;
  }
  if (colorSpace !== undefined) texture.colorSpace = colorSpace;
  if (flipY !== undefined) texture.flipY = flipY;
  if (anisotropy !== undefined) texture.anisotropy = anisotropy;
  if (repeat !== undefined) texture.repeat.setScalar(repeat);
  return texture;
}

// A DataTexture, marked for upload unless `upload: false` (the host fills and uploads it later). format / type default to
// RGBA bytes, as THREE.DataTexture does.
export function createDataTexture(data, width, height, {format = THREE.RGBAFormat, type = THREE.UnsignedByteType, upload = true, ...options} = {}) {
  if (!(width > 0 && height > 0)) throw Error('Data texture needs a positive width and height');
  const texture = configureTexture(new THREE.DataTexture(data, width, height, format, type), options);
  if (upload) texture.needsUpdate = true;
  return texture;
}
