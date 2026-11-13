// The leaved-crown material: instanced, per-instance tint (instanceColor), wind sway, noise-broken normals and leaf clumps,
// alpha-cut leaf cards. Lighting and fog come through the `lighting` hook (core/lighting.js contract: shade() + applyFog()).
// Optional features by define: USE_CANOPY_MAP (sun visibility from a top-down canopy texture, uCanopy.a over uExtent) and
// USE_NEAR_HOLE (crowns dither out inside uNearRadius of uNearCentre) — both off by default.
import * as THREE from 'three';
import {createLighting, NOISE_GLSL} from '../core/lighting.js';

export function createLeavedMaterial({lighting = createLighting(), leafTexture, leafCutoff = .5, leafLuminance = .56, canopy = null, nearHole = false} = {}) {
  const defines = {};
  if (canopy) defines.USE_CANOPY_MAP = 1;
  if (nearHole) defines.USE_NEAR_HOLE = 1;
  const uniforms = {
    ...lighting.uniforms,
    uTime: {value: 0}, uWind: {value: 1}, uLeaf: {value: leafTexture}, uLeafCutoff: {value: leafCutoff}, uLeafLuminance: {value: leafLuminance},
    uCanopy: {value: canopy?.texture ?? null}, uExtent: {value: canopy?.extent ?? new THREE.Vector2(1, 1)},
    uNearCentre: {value: new THREE.Vector2()}, uNearRadius: {value: new THREE.Vector2(0, 0)},
  };
  return new THREE.ShaderMaterial({
    uniforms, defines, side: THREE.DoubleSide, vertexColors: true,   // declares `attribute vec3 color` (the baked shade)
    vertexShader: /* glsl */`
      attribute float sway; attribute float leaf;
      uniform float uTime; uniform float uWind;
      varying vec3 vColor; varying vec3 vNormal; varying vec3 vWorld; varying vec2 vUv; varying float vLeaf;
      void main() {
        vec3 p = position;
        float phase = p.x * 0.21 + p.z * 0.17;
        p.xz += sway * uWind * vec2(sin(uTime * 1.3 + phase), cos(uTime * 1.1 + phase)) * 0.12;
        vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorld = world.xyz; vColor = color; vUv = uv; vLeaf = leaf;
        #ifdef USE_INSTANCING_COLOR
        vColor *= instanceColor;
        #endif
        vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      ${lighting.glsl}
      ${NOISE_GLSL}
      uniform sampler2D uLeaf; uniform float uLeafCutoff, uLeafLuminance;
      uniform sampler2D uCanopy; uniform vec2 uExtent; uniform vec2 uNearCentre; uniform vec2 uNearRadius;
      varying vec3 vColor; varying vec3 vNormal; varying vec3 vWorld; varying vec2 vUv; varying float vLeaf;
      void main() {
        #ifdef USE_NEAR_HOLE
        float nearFade = smoothstep(uNearRadius.x, uNearRadius.y, distance(vWorld.xz, uNearCentre));
        if (nearFade < hash12(floor(gl_FragCoord.xy))) discard;
        #endif
        float sunVisibility = 1.0;
        #ifdef USE_CANOPY_MAP
        sunVisibility = texture2D(uCanopy, vec2(vWorld.x / uExtent.x + 0.5, 0.5 - vWorld.z / uExtent.y)).a;
        #endif
        float clumps = valueNoise(vWorld * 0.9) * 0.65 + valueNoise(vWorld * 2.3) * 0.35;
        vec3 n = normalize(vNormal + (vec3(valueNoise(vWorld * 1.7 + 11.0), valueNoise(vWorld * 1.7 + 23.0), valueNoise(vWorld * 1.7 + 37.0)) - 0.5) * 0.9);
        vec3 albedo = vColor * (0.85 + 0.45 * clumps);
        if (vLeaf > 0.5) {
          vec4 leafTexel = texture2D(uLeaf, vUv);
          if (leafTexel.a < uLeafCutoff) discard;
          albedo *= dot(leafTexel.rgb, vec3(0.2126, 0.7152, 0.0722)) / uLeafLuminance;
        }
        #ifdef LIGHT_SHADE_AT
        vec3 color = shadeAt(albedo, n, mix(0.35, 1.0, sunVisibility), 0.6 + 0.4 * clumps, 0.45, vWorld);
        #else
        vec3 color = shade(albedo, n, mix(0.35, 1.0, sunVisibility), 0.6 + 0.4 * clumps, 0.45);
        #endif
        gl_FragColor = vec4(applyFog(color, distance(vWorld, cameraPosition)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Mean luminance of the opaque texels of a DataTexture (for uLeafLuminance when the leaf mask is generated).
export function meanLeafLuminance(texture, rect = [0, 0, 1, 1]) {
  const {data, width, height} = texture.image; if (!data) return .56;
  const x0 = Math.floor(rect[0] * width), y0 = Math.floor(rect[1] * height), x1 = Math.ceil((rect[0] + rect[2]) * width), y1 = Math.ceil((rect[1] + rect[3]) * height);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * width + x) * 4; if (data[i + 3] > 128) { sum += (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) / 255; n++; } }
  return n ? sum / n : .56;
}
