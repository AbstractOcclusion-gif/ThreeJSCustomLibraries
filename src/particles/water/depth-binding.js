// Optional post-composite binding. The host owns depth targets, light and fog.
export function createParticleDepthBinding({
 THREE, camera, depthTexture, viewport,
 inverseViewProjection = new THREE.Matrix4(),
 waterDistanceTexture = null,
 waterPlane = null,
 nearFade = [0.1, 0.6],
 softDistance = 0.15,
 fogGLSL = 'vec3 particleFog(vec3 color, vec3 world, float additive) { return color; }',
 fogUniforms = {},
}) {
 if (!camera || !depthTexture || !viewport) throw Error('Particle depth binding needs a camera, depth texture and viewport');
 const uniforms = {
  ...fogUniforms,
  tFxDepth: {value: depthTexture},
  tFxWater: {value: waterDistanceTexture},
  uFxResolution: {value: viewport},
  uFxInvVP: {value: inverseViewProjection},
  uFxWaterOn: {value: waterDistanceTexture ? 1 : 0},
  uFxPlaneOn: {value: waterPlane ? 1 : 0},
  uFxPlane: {value: waterPlane ?? new THREE.Vector4(0, 1, 0, 0)},
  uFxNearFade: {value: new THREE.Vector2(...nearFade)},
  uFxSoftDistance: {value: softDistance},
  uFxAdditive: {value: 0},
 };
 const glsl = `
 uniform highp sampler2D tFxDepth, tFxWater;
 uniform vec2 uFxResolution, uFxNearFade;
 uniform mat4 uFxInvVP;
 uniform float uFxWaterOn, uFxPlaneOn, uFxSoftDistance, uFxAdditive;
 uniform vec4 uFxPlane;
 ${fogGLSL}
 float fxSeparation(vec3 world) {
  vec2 uv = gl_FragCoord.xy / uFxResolution;
  float depth = texture2D(tFxDepth, uv).r;
  vec4 p = uFxInvVP * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  float distanceToScene = distance(p.xyz / p.w, cameraPosition);
  if (uFxWaterOn > .5) {
   float water = texture2D(tFxWater, uv).a;
   if (water > 0.0) distanceToScene = min(distanceToScene, water);
  }
  if (uFxPlaneOn > .5) {
   float start = dot(vec4(cameraPosition, 1.0), uFxPlane);
   float end = dot(vec4(world, 1.0), uFxPlane);
   if (start * end < 0.0) {
    float crossing = abs(start / (start - end)) * distance(world, cameraPosition);
    distanceToScene = min(distanceToScene, crossing);
   }
  }
  return distanceToScene - distance(world, cameraPosition);
 }
 bool fxHidden(vec3 world) { return fxSeparation(world) < -.02; }
 float fxDepthFade(vec3 world) {
  return clamp(fxSeparation(world) / max(.001, uFxSoftDistance), 0.0, 1.0);
 }
 float fxNearFade(vec3 world) {
  return smoothstep(uFxNearFade.x, uFxNearFade.y, distance(world, cameraPosition)) * fxDepthFade(world);
 }
 vec3 fxFog(vec3 color, vec3 world) { return particleFog(color, world, uFxAdditive); }
 `;
 return {
  uniforms, glsl,
  update() {
   camera.updateMatrixWorld();
   inverseViewProjection.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  },
 };
}
