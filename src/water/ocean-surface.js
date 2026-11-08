import * as THREE from 'three';
import {proceduralSky} from './sky-binding.js';
import {createLaceTexture} from './foam-texture.js';

// Deep-water analytic ocean: two Gerstner bands (chop + swell) in the vertex shader, crest compression -> whitecaps, lace
// foam, Fresnel sky reflection through the `sky` hook (see sky-binding.js), sun glint, horizon blend. Reduced from
// WebAquarium's large-waves / surface pair. laceTexture (pattern in r, tiling) is optional; a generated one is the default.
export const OCEAN_DEFAULTS = Object.freeze({
  swell: .65, swellLength: 65, chop: .8, choppiness: .65, whitecaps: .75, waveSpeed: 1, heading: 0,
  waterTint: '#ffffff', foamTint: '#ffffff', reflection: 1, fresnelPower: 5, glint: 1, fineRipples: 1,
  foamOpacity: .82, foamFeather: .25, foamScale: 1,
});
export const OCEAN_PRESETS = Object.freeze({
  calm: {swell: .18, swellLength: 46, chop: .28, choppiness: .35, whitecaps: .25},
  rolling: {swell: .65, swellLength: 65, chop: .8, choppiness: .65, whitecaps: .75},
  rough: {swell: 1.4, swellLength: 82, chop: 2, choppiness: .85, whitecaps: 1},
});

// Vertices concentrated near the origin, spacing widening offshore (extent ~ near + far metres at the rim).
export function createOceanGeometry({segments = 224, near = 150, far = 7100} = {}) {
  const geometry = new THREE.PlaneGeometry(2, 2, segments, segments).rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const spread = x => Math.sign(x) * (near * Math.abs(x) + far * Math.abs(x) ** 6);
  for (let i = 0; i < positions.count; i++) positions.setXYZ(i, spread(positions.getX(i)), 0, spread(positions.getZ(i)));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createOceanSurface({sky = proceduralSky(), geometry, laceTexture, settings = {}} = {}) {
  const ownsGeometry = !geometry, ownsLace = !laceTexture;
  geometry ??= createOceanGeometry();
  const lace = laceTexture ?? createLaceTexture();
  lace.wrapS = lace.wrapT = THREE.RepeatWrapping;
  const uniforms = {
    ...sky.uniforms,
    clock: {value: 0}, heading: {value: 0}, swell: {value: .65},
    swellLength: {value: 65}, chop: {value: .8}, choppiness: {value: .65},
    whitecaps: {value: .75}, lace: {value: lace},
    waterTint: {value: new THREE.Color()}, foamTint: {value: new THREE.Color()},
    reflection: {value: 1}, fresnelPower: {value: 5}, glint: {value: 1}, fineRipples: {value: 1},
    foamOpacity: {value: .82}, foamFeather: {value: .25}, foamScale: {value: 1},
  };
  const material = new THREE.ShaderMaterial({
    uniforms, defines: {...sky.defines},
 vertexShader: `
 uniform float clock, heading, swell, swellLength, chop, choppiness;
 varying vec3 vWorld, vNormal;
 varying float vCrest;
 varying vec2 vSource;
 struct WaveField { float height; vec2 slope; vec2 shift; vec3 derivative; };
 float waveHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
 // The deep-water branches of WebAquarium's analytic Gerstner bands.
 void band(inout WaveField field, vec2 xz, float limit, int count, float length0,
  float lengthDecay, float amplitude, float amplitudeDecay, float fan, float seed, float direction) {
  for (int i = 0; i < 12; i++) {
   if (i >= count) break;
   float wave = float(i) + seed;
   float angle = direction + (waveHash(wave) * 2.0 - 1.0) * fan;
   vec2 dir = vec2(cos(angle), sin(angle));
   float k = 6.2831853 / length0;
   float phase = k * dot(dir, xz) - sqrt(9.81 * k) * clock + waveHash(wave + 16.0) * 6.2831853;
   float a = amplitude * smoothstep(limit * .7, limit * 1.5, length0);
   float s = sin(phase), c = cos(phase);
   field.height += a * s;
   field.slope += a * k * c * dir;
   field.shift += a * c * dir;
   field.derivative -= a * k * s * vec3(dir.x * dir.x, dir.x * dir.y, dir.y * dir.y);
   length0 *= lengthDecay;
   amplitude *= amplitudeDecay;
  }
 }
 void main() {
  vSource = position.xz;
  float range = length(vSource);
  float limit = max(1.9, max(distance(vSource, cameraPosition.xz) * .032, range * .047));
  WaveField field = WaveField(0.0, vec2(0), vec2(0), vec3(0));
  band(field, vSource, limit, 12, 9.0, .82, chop * .14, .76, 1.05, 1.0, heading);
  band(field, vSource, limit, 4, swellLength, .68, swell, .85, .5, 101.0, heading + .35);
  vec3 d = choppiness * field.derivative;
  vec3 tx = vec3(1.0 + d.x, field.slope.x, d.y);
  vec3 tz = vec3(d.y, field.slope.y, 1.0 + d.z);
  vNormal = normalize(cross(tz, tx));
  float jacobian = (1.0 + d.x) * (1.0 + d.z) - d.y * d.y;
  vCrest = max(clamp((1.0 - jacobian) * 1.5, 0.0, 1.0), smoothstep(.28,.65,length(field.slope)));
  vWorld = position + vec3(choppiness * field.shift.x, field.height, choppiness * field.shift.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
 }`,
 fragmentShader: `
 ${sky.glsl}
 uniform float clock, heading, chop, whitecaps;
 uniform float reflection, fresnelPower, glint, fineRipples, foamOpacity, foamFeather, foamScale;
 uniform vec3 waterTint, foamTint;
 uniform sampler2D lace;
 varying vec3 vWorld, vNormal;
 varying float vCrest;
 varying vec2 vSource;
 void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float range = distance(cameraPosition, vWorld);
  vec2 wind = vec2(cos(heading), sin(heading));
  vec2 crosswind = vec2(-wind.y, wind.x);
  vec3 n = normalize(vNormal);
  float fine = (1.0 - smoothstep(18.0,120.0,range)) * min(chop,.95) * .06;
  vec2 detail = wind * sin(dot(vSource, wind)*12.0 - clock*9.0) +
   crosswind * sin(dot(vSource, crosswind)*8.0 + dot(vSource,wind)*4.0 - clock*6.0);
  n = normalize(n + vec3(detail.x,0,detail.y)*fine*fineRipples);
  vec3 reflected = reflect(-V,n);
  reflected.y = abs(reflected.y);
  float F = .02 + .98 * pow(1.0 - clamp(dot(n,V),0.0,1.0),fresnelPower);
  vec3 body = vec3(.009,.047,.055) * waterTint * (.17 + .83 * uDaylight);
  vec3 color = mix(body, sky(reflected,.18), clamp(F * reflection,0.0,1.0));
  vec3 H = normalize(V + uSkySun + vec3(0,.001,0));
  color += uSunCol * pow(max(0.0,dot(n,H)), mix(180.0,50.0,clamp(chop,0.0,1.0))) * .64 * glint;
  float coverage = smoothstep(.18,.66,vCrest) * whitecaps;
  vec2 tex = vec2(dot(vSource,wind) * .18 - clock * .24, dot(vSource,crosswind) * .36) / foamScale;
  float pattern = texture2D(lace,tex).r;
  float threshold = 1.0 - sqrt(coverage);
  float foam = smoothstep(threshold,threshold + foamFeather,pow(pattern,1.35)) * (1.0 - smoothstep(90.0,360.0,range));
  color = mix(color, vec3(.74,.83,.84) * foamTint * (.13 + .87 * uDaylight), foam * foamOpacity);
  vec3 horizon = sky(normalize(vec3(-V.x,.016,-V.z)),0.0);
  color = mix(color, horizon, smoothstep(900.0,6800.0,range));
  gl_FragColor = vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`,
});
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const state = {...OCEAN_DEFAULTS, ...settings};
  function apply(values = {}) {
    Object.assign(state, values);
    uniforms.heading.value = THREE.MathUtils.degToRad(state.heading);
    uniforms.swell.value = state.swell; uniforms.swellLength.value = state.swellLength;
    uniforms.chop.value = state.chop; uniforms.choppiness.value = state.choppiness; uniforms.whitecaps.value = state.whitecaps;
    uniforms.waterTint.value.set(state.waterTint); uniforms.foamTint.value.set(state.foamTint);
    uniforms.reflection.value = state.reflection; uniforms.fresnelPower.value = state.fresnelPower; uniforms.glint.value = state.glint;
    uniforms.fineRipples.value = state.fineRipples; uniforms.foamOpacity.value = state.foamOpacity;
    uniforms.foamFeather.value = state.foamFeather; uniforms.foamScale.value = state.foamScale;
    return state;
  }
  apply();
  return {
    mesh, material, uniforms, settings: state, apply,
    // windSpeed (m/s) optionally sharpens chop like the weather-driven demo did.
    update(dt, windSpeed = 0) { uniforms.clock.value += dt * state.waveSpeed; uniforms.chop.value = state.chop * (windSpeed ? .75 + .045 * windSpeed : 1); },
    dispose() { if (ownsGeometry) geometry.dispose(); if (ownsLace) lace.dispose(); material.dispose(); },
  };
}
