import {Color} from 'three';
import {createSurfaceWeather, createWeatherSurfaceMaterial} from '../../src/surface/index.js';
import {patchWeatherShader, WEATHER_STAGES} from '../../src/surface/weather-stages.js';

const SNOW = {color: '#eaf3fa', settleRate: .38, thawRate: .22, branchHold: .18};

export function createMeadowFoliageSnow(field, environment) {
 const weather = createSurfaceWeather({rates: {snowing: SNOW.settleRate, thaw: SNOW.thawRate}});
 const color = {value: new Color(SNOW.color)};
 const settings = {snow: true};
 const variants = new Map();

 function makeVariant(base) {
  const previous = base.onBeforeCompile;
  if (base.isMeshStandardMaterial) {
   const material = createWeatherSurfaceMaterial({}, {weather, snowColor: SNOW.color, puddles: 0, runoff: 0});
   const surface = material.onBeforeCompile;
   material.copy(base);
   material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    surface.call(this, shader, renderer);
    shader.fragmentShader = patchWeatherShader(shader.fragmentShader)
     .stage('ground', `${WEATHER_STAGES.ground} up = min(1.0, up + ${SNOW.branchHold});`).source;
   };
   material.customProgramCacheKey = () => `${base.customProgramCacheKey()}-meadow-snow`;
   return material;
  }
  // The impostor already contains lit foliage. Tint its green texels and leave the wood and cutout untouched.
  const material = base.clone();
  material.onBeforeCompile = function(shader, renderer) {
   previous.call(this, shader, renderer);
   shader.uniforms.foliageWeather = weather.levels;
   shader.uniforms.foliageSnowColor = color;
   shader.fragmentShader = `uniform vec2 foliageWeather; uniform vec3 foliageSnowColor;\n${shader.fragmentShader}`
    .replace('#include <color_fragment>', `#include <color_fragment>
     float leaf = smoothstep(.006, .065, diffuseColor.g - diffuseColor.r);
     diffuseColor.rgb = mix(diffuseColor.rgb, foliageSnowColor, leaf * foliageWeather.y * .74);`);
  };
  material.customProgramCacheKey = () => `${base.customProgramCacheKey()}-meadow-snow-impostor`;
  return material;
 }

 return {
  settings,
  attach(group) {
   group.traverse(mesh => {
    if (!mesh.isMesh || mesh.material.isMeshDepthMaterial) return;
    const base = mesh.material;
    if (!variants.has(base)) variants.set(base, makeVariant(base));
    mesh.material = variants.get(base);
   });
  },
  update(dt) {
   const snow = settings.snow ? (field.snowCover.value ? 1 : environment.snow) : 0;
   weather.update(dt, {snow});
  },
  dispose() { for (const material of variants.values()) material.dispose(); },
 };
}
