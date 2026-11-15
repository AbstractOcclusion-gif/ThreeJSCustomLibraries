const PROJECTION = '#include <project_vertex>';

export function injectWorldPosition(source, varying) {
  if (!source.includes(PROJECTION)) throw Error('World position needs the Three material projection');
  return `varying vec3 ${varying};\n` + source.replace(PROJECTION, `${PROJECTION}
{
  vec4 worldVertex = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
  worldVertex = batchingMatrix * worldVertex;
  #endif
  #ifdef USE_INSTANCING
  worldVertex = instanceMatrix * worldVertex;
  #endif
  ${varying} = (modelMatrix * worldVertex).xyz;
}`);
}
