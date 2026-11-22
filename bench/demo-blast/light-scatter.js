// Phase relative to isotropic scattering, capped for this real-time comparison.
// Existing extinction/self-shadowing supplies the light's transmittance.
export const BALL_SCATTER_GLSL = `
  float ballScatterPhase(float cosine){
    const float g=.45;
    float phase=(1.-g*g)/pow(max(.001,1.+g*g-2.*g*clamp(cosine,-1.,1.)),1.5);
    return min(4.,phase);
  }
  float cloudLightResponse(float unshadowed,float opticalDepth,float cosine,float shadowStrength,float scatterStrength){
    const float ambient=.35;
    float visibility=exp(-max(0.,opticalDepth)*shadowStrength);
    float phase=mix(1.,ballScatterPhase(cosine),scatterStrength);
    // Scattering is volume light, independent of a billboard's face normal.
    // Blend toward the gas's common base rather than magnifying facet shading.
    float direct=mix(max(0.,unshadowed-ambient),1.31-ambient,scatterStrength);
    return ambient+direct*visibility*phase;
  }
`;
