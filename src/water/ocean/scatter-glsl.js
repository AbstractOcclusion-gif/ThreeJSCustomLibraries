// WebAquarium ocean/surface.js volume and crest scattering.
export const SCATTER_GLSL = /* glsl */`
#define SCATTER_PHASE_FLOOR 1e-4
#define SSS_AMPLITUDE_EPSILON 1e-3
uniform vec3 uScatterColor, uScatterAmbient; uniform float uScatterIntensity, uScatterAnisotropy, uScatterAmbientTerm, uScatterSunTerm;
uniform float uSssIntensity, uSssSunFalloff, uSssPinchMin, uSssPinchMax, uSssPinchFalloff;
float volumeSchlickPhase(float g, float cosTheta){ float k = 1.5 * g - 0.5 * g * g * g; float denom = 1.0 + k * cosTheta; return (1.0 - k * k) / max(denom * denom, SCATTER_PHASE_FLOOR); }
// The water's lit body colour: what the eye sees through the surface of deep water (WaterInscatterColor).
vec3 waterInscatterColor(vec3 viewDirWS){ float phase = volumeSchlickPhase(uScatterAnisotropy, dot(uSunDir, viewDirWS));
  return uScatterColor * uScatterIntensity * (uScatterAmbientTerm * uScatterAmbient + uScatterSunTerm * phase * uSunCol); }
// Steep crests scatter sunlight toward the viewer (EvaluateCrestGlow): fold = the FFT Jacobian pinch sum.
float crestGlow(float fold, vec3 V){
  float ramp = clamp((fold - uSssPinchMin) / max(uSssPinchMax - uSssPinchMin, SSS_AMPLITUDE_EPSILON), 0.0, 1.0);
  float pinch = pow(ramp, uSssPinchFalloff);
  float sunFacing = pow(clamp(dot(V, uSunDir), 0.0, 1.0), uSssSunFalloff);
  return pinch * sunFacing * uSssIntensity; }`;
