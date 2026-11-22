import {SpriteMaterial, Vector2, Vector3} from 'three';
import {BILLOW_GLSL, glslFloat as f, glslVec3 as v3} from './billow-glsl.js';
import {PUFF_SHADING} from './puff-config.js';
import {PUFF_VOLUME_GLSL} from './puff-volume-glsl.js';

const {heat: HEAT, billow: BILLOW} = PUFF_SHADING;

export function createPuffMaterial(map, animated, noiseVolume, sunDirection) {
  const material = new SpriteMaterial({map, transparent: true, depthWrite: false});
  const tiles = {value: new Vector2(1, 1)};
  const frame = {value: 0};
  const heat = {value: 0};
  const billow = {value: 0};
  const volume = {value: 0}, age = {value: 0}, seed = {value: 0};
  const rollAxis = {value: new Vector3(0, 0, 0)};

  if (animated || noiseVolume) {
    const noise = {value: noiseVolume};
    const sun = {value: sunDirection ?? new Vector3(.5, .7, .5).normalize()};
    material.customProgramCacheKey = () => noiseVolume ? 'puffs-volume' : 'puffs-atlas';
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {puffTiles: tiles, puffFrame: frame, puffHeat: heat, puffBillow: billow});
      if (noiseVolume) Object.assign(shader.uniforms, {puffNoise: noise, puffSun: sun, puffVolume: volume, puffAge: age, puffSeed: seed, puffRollAxis: rollAxis});
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>', /* glsl */`
        #include <map_pars_fragment>
        uniform vec2 puffTiles;
        uniform float puffFrame, puffHeat, puffBillow;
        ${BILLOW_GLSL}
        ${noiseVolume ? PUFF_VOLUME_GLSL : ''}

        vec2 puffFrameUv(float index, vec2 uv) {
          vec2 tile = vec2(mod(index, puffTiles.x), puffTiles.y - 1.0 - floor(index / puffTiles.x));
          vec2 inset = 0.5 * puffTiles / vec2(textureSize(map, 0));
          return (tile + mix(inset, 1.0 - inset, uv)) / puffTiles;
        }
      `).replace('#include <map_fragment>', /* glsl */`
        ${noiseVolume ? 'if (puffVolume > 0.5) { diffuseColor *= puffVolumeColor(vMapUv); } else' : ''}
        if (puffTiles.x * puffTiles.y > 1.0) {
          float first = floor(puffFrame);
          float last = puffTiles.x * puffTiles.y - 1.0;
          vec2 uv = vMapUv;
          float density = 1.0;
          if (puffBillow > 0.5) density = particleBillow(uv, puffFrame * ${f(BILLOW.phasePerFrame)});
          vec4 a = texture2D(map, puffFrameUv(first, uv));
          vec4 b = texture2D(map, puffFrameUv(min(first + 1.0, last), uv));
          vec4 sampleColor = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), fract(puffFrame));
          vec3 color = sampleColor.rgb / max(sampleColor.a, ${f(PUFF_SHADING.minAlpha)});
          if (puffHeat > 0.5) {
            float temperature = color.r * mix(1.0, ${f(HEAT.cool)}, puffFrame / last);
            color = mix(${v3(HEAT.ember)}, ${v3(HEAT.flame)}, smoothstep(${f(HEAT.flameRamp[0])}, ${f(HEAT.flameRamp[1])}, temperature));
            color = mix(color, ${v3(HEAT.core)}, smoothstep(${f(HEAT.coreRamp[0])}, ${f(HEAT.coreRamp[1])}, temperature));
            sampleColor.a = smoothstep(${f(HEAT.alphaRamp[0])}, ${f(HEAT.alphaRamp[1])}, sampleColor.a);
            diffuseColor.rgb = vec3(1.0);
          }
          if (puffBillow > 0.5) {
            float body = 1.0 - smoothstep(${f(BILLOW.body[0])}, ${f(BILLOW.body[1])}, length(uv * 2.0 - 1.0));
            sampleColor.a = min(1.0, (sampleColor.a + ${f(BILLOW.bodyAlpha)} * body) * density);
            color = mix(vec3(${f(BILLOW.grey)}), color, ${f(BILLOW.keep)});
          }
          diffuseColor *= vec4(color, sampleColor.a);
        } else {
          #include <map_fragment>
        }
      `);
    };
  }
  return {material, tiles: tiles.value, frame, heat, billow, volume, volumeAge: age, volumeSeed: seed, rollAxis};
}
