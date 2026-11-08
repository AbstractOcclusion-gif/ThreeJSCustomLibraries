import {NOISE_GLSL} from '../core/lighting.js';

export const BILLOW_GLSL = /* glsl */`
${NOISE_GLSL}
// Sample a rounded slice through the noise field as the billboard ages.
float particleBillow(inout vec2 uv, float phase) {
  vec2 centered = uv * 2.0 - 1.0;
  float depth = sqrt(max(0.0, 1.0 - dot(centered, centered)));
  vec3 p = vec3(uv * 3.4, depth * 0.85 + phase);
  float coarse = valueNoise(p);
  float detail = valueNoise(p * 2.05 + 13.0);
  uv = clamp(uv + (vec2(coarse, detail) - 0.5) * 0.15, 0.0, 1.0);
  return mix(0.65, 1.18, smoothstep(0.13, 0.87, mix(coarse, detail, 0.25)));
}
`;
