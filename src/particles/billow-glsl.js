import {NOISE_GLSL} from '../core/lighting.js';

// GLSL literals from JS numbers, so shader constants can live in one JS object shared with the node (TSL) materials.
export const glslFloat = value => (Number.isInteger(value) ? value.toFixed(1) : String(value));
export const glslVec3 = ([x, y, z]) => `vec3(${glslFloat(x)}, ${glslFloat(y)}, ${glslFloat(z)})`;
// Billow: a rounded slice through 3D value noise. scale: noise cells across the sprite; depth: how far the dome reaches
// into the noise; detail: frequency and offset of the second octave; warp: uv distortion; density: [thin, thick] output,
// mapped from the noise over `ramp`; detailMix: share of the second octave.
export const BILLOW = Object.freeze({
  scale: 3.4, depth: 0.85, detail: [2.05, 13], warp: 0.15, density: [0.65, 1.18], ramp: [0.13, 0.87], detailMix: 0.25,
});
const f = glslFloat;

export const BILLOW_GLSL = /* glsl */`
${NOISE_GLSL}
// Sample a rounded slice through the noise field as the billboard ages.
float particleBillow(inout vec2 uv, float phase) {
  vec2 centered = uv * 2.0 - 1.0;
  float depth = sqrt(max(0.0, 1.0 - dot(centered, centered)));
  vec3 p = vec3(uv * ${f(BILLOW.scale)}, depth * ${f(BILLOW.depth)} + phase);
  float coarse = valueNoise(p);
  float detail = valueNoise(p * ${f(BILLOW.detail[0])} + ${f(BILLOW.detail[1])});
  uv = clamp(uv + (vec2(coarse, detail) - 0.5) * ${f(BILLOW.warp)}, 0.0, 1.0);
  return mix(${f(BILLOW.density[0])}, ${f(BILLOW.density[1])}, smoothstep(${f(BILLOW.ramp[0])}, ${f(BILLOW.ramp[1])}, mix(coarse, detail, ${f(BILLOW.detailMix)})));
}
`;
