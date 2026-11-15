import * as THREE from 'three';
import {NOISE_GLSL} from '../core/lighting.js';

// Premultiplied: emitted glow adds light while alpha masks the background.
const FLAME_BLENDING = {
  transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
};

const FLAME_COLOR_GLSL = `
// Black-body style ramp: dark red where it is coolest, orange, then a pale core.
vec3 flameColor(float heat) {
  vec3 color = mix(vec3(.3, .01, 0.0), vec3(1.0, .24, .012), smoothstep(.03, .4, heat));
  color = mix(color, vec3(1.0, .58, .12), smoothstep(.34, .7, heat));
  return mix(color, vec3(1.0, .86, .5), smoothstep(.78, 1.0, heat));
}
const float FLAME_GLOW = 1.3;
const float FLAME_COVER = .5;
const float MIN_FLAME_ALPHA = .003;
`;

export function createSheetFlameMaterial(uniforms) {
  return new THREE.ShaderMaterial({uniforms, ...FLAME_BLENDING,
    vertexShader: /* glsl */`
      attribute vec4 iStart, iMotion, iShape;
      uniform float uTime, uPulse;
      uniform vec2 uWind, uSway;
      varying vec2 vUv;
      varying vec4 vFlame;   // age 0..1, seed, heat, detached
      void main() {
        float age = (uTime - iStart.w) / iMotion.y;
        if (age < 0.0 || age >= 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        float detached = iShape.z;
        const float tipShrink = .55;   // size a torn-off tip loses while it flies
        // A standing sheet breathes with the fire; a detached tip only shrinks.
        float scale = mix(uPulse, 1.0 - tipShrink * age, detached);
        float risen = iMotion.x * age * iMotion.y;
        float reach = risen + position.y * iShape.y * scale;
        // The fire bends from its base: more the higher it reaches, with the wind and with its own sway.
        vec2 bend = (uWind + uSway * sqrt(max(reach, 0.0))) * reach;
        vec3 world = iStart.xyz + vec3(bend.x, reach, bend.y);
        vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
        world += right * (position.x * iShape.x * mix(1.0, scale, detached));
        vUv = vec2(position.x + .5, position.y);
        vFlame = vec4(age, iMotion.z, iMotion.w, detached);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uBrightness, uTurbulence;
      varying vec2 vUv;
      varying vec4 vFlame;
      ${NOISE_GLSL}
      // Three octaves of noise, much finer across than along: streaks that run up the flame.
      float streaks(vec3 p) {
        return valueNoise(p) * .55 + valueNoise(p * vec3(2.1, 1.9, 1.7) + 7.3) * .3 + valueNoise(p * vec3(4.3, 3.6, 2.9) + 19.1) * .15;
      }
      ${FLAME_COLOR_GLSL}
      void main() {
        float age = vFlame.x, seed = vFlame.y, detached = vFlame.w;
        vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y);
        const float flow = 2.1;          // sheet heights per second the streaks travel upward
        const vec2 grain = vec2(3.6, 1.5);    // streaks across the sheet, and along it
        float n = streaks(vec3(p.x * grain.x + seed * 13.0, p.y * grain.y - uTime * flow, seed * 5.0 + uTime * .22));
        // Fuel: plenty at the base and in the middle, running out toward the tip and the sides. The column is
        // narrower than the sheet and tapers, so the sheet's own edges never show.
        const vec2 column = vec2(.72, .3);   // half width of the column at the base and at the tip, in half sheets
        float side = abs(p.x) / mix(column.x, column.y, p.y);
        float fuel = (1.0 - p.y) * (1.0 - side * side);
        // A torn-off tip has no base: it is a ragged blob that burns out from its edge.
        vec2 blob = vec2(p.x, p.y * 2.0 - 1.0);
        fuel = mix(fuel, (1.0 - dot(blob, blob)) * (1.0 - .6 * age), detached);
        const float solid = .95;         // how firmly the base holds together
        const float ragged = 1.8;        // how far the noise eats into the flame
        // Noise matters little at the base and decides everything near the tip: tongues, holes, torn tips.
        float field = fuel * solid + (n - .5) * ragged * uTurbulence * mix(.55, 1.0, max(p.y, detached));
        float density = smoothstep(.36, .6, field) * smoothstep(0.0, .2, p.y + detached);
        float fade = smoothstep(0.0, .22, age) * (1.0 - smoothstep(.62, 1.0, age));
        float heat = smoothstep(.36, 1.35, field) * mix(1.0, .55, p.y) * vFlame.z;
        float alpha = density * fade;
        if (alpha <= MIN_FLAME_ALPHA) discard;
        gl_FragColor = vec4(flameColor(heat) * (FLAME_GLOW * uBrightness * alpha), alpha * FLAME_COVER);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function createFluidFlameMaterial(uniforms) {
  return new THREE.ShaderMaterial({uniforms, ...FLAME_BLENDING,
    vertexShader: /* glsl */`
        attribute float aPlane;
        uniform vec3 uBase;
        uniform vec2 uSize, uLean;
        uniform float uPlanes, uTurn;
        varying vec2 vUv;
        varying float vFacing;   // 1 seen face-on, 0 edge-on
        void main() {
          if (aPlane >= uPlanes) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
          vec3 toEye = normalize(vec3(viewMatrix[0][2], 0.0, viewMatrix[2][2]));
          // One sheet turns about the vertical to face the camera; several stand crossed at even angles.
          vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          if (uPlanes > 1.5) {
            float angle = aPlane * 3.14159265 / uPlanes + uTurn;
            right = vec3(cos(angle), 0.0, sin(angle));
          }
          vFacing = abs(dot(cross(right, vec3(0.0, 1.0, 0.0)), toEye));
          float height = position.y * uSize.y;
          vec3 world = uBase + right * (position.x * uSize.x) + vec3(0.0, height, 0.0);
          // The wind bends the whole fire from its base, more the higher it reaches.
          world.xz += uLean * height * height;
          // Alternate sheets are mirrored so the crossed flames do not line up.
          vUv = vec2(mod(aPlane, 2.0) > .5 ? 1.0 - uv.x : uv.x, uv.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tHeat;
        uniform float uBrightness, uPlanes;
        varying vec2 vUv;
        varying float vFacing;
      ${FLAME_COLOR_GLSL}
        void main() {
          float t = texture2D(tHeat, vUv).r;
          const vec2 visible = vec2(.1, .3);     // heat where a flame starts to show, and where it is solid
          float density = smoothstep(visible.x, visible.y, t);
          // The slice ends at its sides and top: fade there so its border never shows.
          float edge = smoothstep(0.0, .08, vUv.x) * smoothstep(0.0, .08, 1.0 - vUv.x) * smoothstep(0.0, .12, 1.0 - vUv.y);
          // A sheet seen edge-on is a line: fade it out there and let the others carry the fire. Crossed sheets
          // overlap, so each gives less light.
          const float overlapLight = .62;        // light of each sheet when several are crossed
          float crossed = step(1.5, uPlanes);
          float alpha = density * edge * mix(1.0, smoothstep(.08, .45, vFacing) * overlapLight, crossed);
          if (alpha <= MIN_FLAME_ALPHA) discard;
          gl_FragColor = vec4(flameColor(smoothstep(visible.x, 1.0, t)) * (FLAME_GLOW * uBrightness * alpha), alpha * FLAME_COVER);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
  });
}
