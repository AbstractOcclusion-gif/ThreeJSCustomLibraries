import {SpriteMaterial, Vector2} from 'three';
import {BILLOW_GLSL} from './billow-glsl.js';

export function createPuffMaterial(map, animated) {
  const material = new SpriteMaterial({map, transparent: true, depthWrite: false});
  const tiles = {value: new Vector2(1, 1)};
  const frame = {value: 0};
  const heat = {value: 0};
  const billow = {value: 0};

  if (animated) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {puffTiles: tiles, puffFrame: frame, puffHeat: heat, puffBillow: billow});
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>', /* glsl */`
        #include <map_pars_fragment>
        uniform vec2 puffTiles;
        uniform float puffFrame, puffHeat, puffBillow;
        ${BILLOW_GLSL}

        vec2 puffFrameUv(float index, vec2 uv) {
          vec2 tile = vec2(mod(index, puffTiles.x), puffTiles.y - 1.0 - floor(index / puffTiles.x));
          vec2 inset = 0.5 * puffTiles / vec2(textureSize(map, 0));
          return (tile + mix(inset, 1.0 - inset, uv)) / puffTiles;
        }
      `).replace('#include <map_fragment>', /* glsl */`
        if (puffTiles.x * puffTiles.y > 1.0) {
          float first = floor(puffFrame);
          float last = puffTiles.x * puffTiles.y - 1.0;
          vec2 uv = vMapUv;
          float density = 1.0;
          if (puffBillow > 0.5) density = particleBillow(uv, puffFrame * 0.09);
          vec4 a = texture2D(map, puffFrameUv(first, uv));
          vec4 b = texture2D(map, puffFrameUv(min(first + 1.0, last), uv));
          vec4 sampleColor = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), fract(puffFrame));
          vec3 color = sampleColor.rgb / max(sampleColor.a, 0.0001);
          if (puffHeat > 0.5) {
            float temperature = color.r * mix(1.0, 0.78, puffFrame / last);
            color = mix(vec3(0.28, 0.015, 0.002), vec3(1.25, 0.26, 0.018), smoothstep(0.05, 0.66, temperature));
            color = mix(color, vec3(2.2, 1.22, 0.43), smoothstep(0.54, 0.94, temperature));
            sampleColor.a = smoothstep(0.035, 0.8, sampleColor.a);
            diffuseColor.rgb = vec3(1.0);
          }
          if (puffBillow > 0.5) {
            float body = 1.0 - smoothstep(0.18, 0.98, length(uv * 2.0 - 1.0));
            sampleColor.a = min(1.0, (sampleColor.a + 0.18 * body) * density);
            color = mix(vec3(0.52), color, 0.65);
          }
          diffuseColor *= vec4(color, sampleColor.a);
        } else {
          #include <map_fragment>
        }
      `);
    };
  }
  return {material, tiles: tiles.value, frame, heat, billow};
}
