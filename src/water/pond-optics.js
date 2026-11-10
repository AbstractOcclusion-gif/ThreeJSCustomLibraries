// WebAquarium src/water/body.js, open-pond color absorption and depth haze.
// A single definition is used for the view through the surface and for a diver.
export const POND_OPTICS_GLSL = `
 uniform vec3 pondColor;
 uniform float pondHaze, pondDepthDark, pondClarity;
 vec3 pondRadiance(vec3 behind, float thick, float depth, vec3 sun, vec3 ambient) {
  vec3 inLight = (ambient + sun * 0.5) * 1.2;
  vec3 absorb = (vec3(1.0) - pondColor) * (1.6 / max(pondClarity, 0.05)) * 0.35;
  vec3 T = exp(-absorb * thick);
  float scat = 1.0 - exp(-pondHaze * thick);
  vec3 fogC = pondColor * inLight * 0.6 * (0.3 + 0.7 * exp(-depth * pondDepthDark));
  return (behind * T + pondColor * (1.0 - T) * 0.55 * inLight) * (1.0 - scat) + fogC * scat;
 }`;
