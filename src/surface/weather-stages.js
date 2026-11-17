// Shared GLSL for the weather surface and the terrain material that extends it.
export const WEATHER_STAGES = Object.freeze({
  ground: 'float up = inverseTransformDirection(surfaceGeometricNormal, viewMatrix).y;',
  snowTracks: 'snowCoverage *= 1.0 - track * .92;',
  runoffSlope: 'float runoffSlope = 1.0 - smoothstep(.35, .88, abs(up));',
  runoffCondition: 'if (surfaceRunoff > 0.0 && wet > .1 && runoffSlope > 0.0) {',
  runoffStreak:
    'float streak = surfaceRainStreaks(vSurfaceWorld) * surfaceRunoff * runoffSlope * smoothstep(.1, .72, wet);',
  runoffDarkening: 'diffuseColor.rgb *= 1.0 - .42 * streak;',
  puddleCondition: 'if (wet > .45 && surfacePuddles > 0.0) {',
  puddleDarkening: 'diffuseColor.rgb *= 1.0 - surfacePuddleDarkening * puddle;',
  standingWater: 'float standingWater = puddle;',
  snowColor: 'diffuseColor.rgb = mix(diffuseColor.rgb, surfaceSnowColor, snowCoverage);',
  snowRoughness: 'roughnessFactor = mix(roughnessFactor, .83, snowCoverage);',
});

const begin = name => `/* weather:${name} */`;
const end = '/* end weather stage */';

export function weatherStage(name) {
  return begin(name) + WEATHER_STAGES[name] + end;
}

export function patchWeatherShader(source) {
  return {
    get source() {
      return source;
    },
    stage(name, replacement) {
      const marker = begin(name);
      const start = source.indexOf(marker);
      const finish = source.indexOf(end, start + marker.length);
      if (start < 0 || finish < 0) throw Error(`Weather surface is missing the ${name} shader stage`);
      source = source.slice(0, start) + replacement + source.slice(finish + end.length);
      return this;
    },
  };
}
