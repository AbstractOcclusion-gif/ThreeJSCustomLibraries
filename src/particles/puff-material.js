import {SpriteMaterial, Vector2} from 'three';

export function createPuffMaterial(map, animated) {
  const material = new SpriteMaterial({map, transparent: true, depthWrite: false});
  const tiles = {value: new Vector2(1, 1)};
  const frame = {value: 0};
  const heat = {value: 0};

  if (animated) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {puffTiles: tiles, puffFrame: frame, puffHeat: heat});
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>', /* glsl */`
        #include <map_pars_fragment>
        uniform vec2 puffTiles;
        uniform float puffFrame, puffHeat;

        vec2 puffFrameUv(float index, vec2 uv) {
          vec2 tile = vec2(mod(index, puffTiles.x), puffTiles.y - 1.0 - floor(index / puffTiles.x));
          vec2 inset = 0.5 * puffTiles / vec2(textureSize(map, 0));
          return (tile + mix(inset, 1.0 - inset, uv)) / puffTiles;
        }
      `).replace('#include <map_fragment>', /* glsl */`
        if (puffTiles.x * puffTiles.y > 1.0) {
          float first = floor(puffFrame);
          float last = puffTiles.x * puffTiles.y - 1.0;
          vec4 a = texture2D(map, puffFrameUv(first, vMapUv));
          vec4 b = texture2D(map, puffFrameUv(min(first + 1.0, last), vMapUv));
          vec4 sampleColor = mix(vec4(a.rgb * a.a, a.a), vec4(b.rgb * b.a, b.a), fract(puffFrame));
          vec3 color = sampleColor.rgb / max(sampleColor.a, 0.0001);
          if (puffHeat > 0.5) {
            float temperature = color.r;
            color = mix(vec3(0.18, 0.006, 0.001), vec3(1.0, 0.18, 0.012), smoothstep(0.0, 0.65, temperature));
            color = mix(color, vec3(1.65, 1.25, 0.67), smoothstep(0.53, 1.0, temperature));
            diffuseColor.rgb = vec3(1.0);
          }
          diffuseColor *= vec4(color, sampleColor.a);
        } else {
          #include <map_fragment>
        }
      `);
    };
  }
  return {material, tiles: tiles.value, frame, heat};
}
