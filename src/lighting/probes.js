// Light probes: ambient light that changes from place to place. A square grid of probe columns follows a focus point;
// each column stands on the ground and holds, at a few heights above it, the share of the sky seen from there (core
// sky-visibility.js), and under it the colour of the ground. A surface then takes from above the sky dimmed by what
// the relief hides, and from below the light that this ground returns of the sun and the sky (core groundBounce).
// The probes hold no light, only what the ground does to it: the sun and sky of the lighting hook are applied when
// shading, so a change of light costs nothing. Only the ground blocks and returns light; objects receive it.
import * as THREE from 'three';
import {createSkyVisibility} from '../core/sky-visibility.js';

export const LIGHT_PROBE_DEFAULTS = Object.freeze({
  columns: 32,      // probe columns per side of the grid
  spacing: 4,       // m between columns
  layers: 4,        // probes of a column
  firstLayer: 1,    // m above the ground of the lowest probe
  layerRatio: 4,    // each probe stands this many times higher than the one below
  budget: 12,       // columns measured per update
  edge: .2,         // share of the grid's half-width over which the probes give way to the plain ambient
  strength: 1,      // share of the probes in the ambient light (0 = the plain hemisphere)
});
export const LIGHT_PROBE_LIMITS = Object.freeze({
  columns: [4, 128], spacing: [.25, 64], layers: [1, 8], firstLayer: [.05, 20], layerRatio: [1.5, 16], budget: [1, 4096], edge: [.01, 1], strength: [0, 1],
});
const WHOLE = ['columns', 'layers', 'budget'];
const BYTE = 255, VOLUME_CHANNELS = 4, GROUND_CHANNELS = 2;
const UNOWNED = 0x7fffffff;   // no world cell: the column was never measured

// `vec3 lightAmbient(vec3 n, vec3 worldPosition)` for the lighting hook (core createLighting({ambient})); it uses the
// hook's sun and hemisphere uniforms.
export const LIGHT_PROBE_GLSL = /* glsl */`
uniform highp sampler3D uProbeVolume;   // rgb: ground colour x the sky it sees, a: sky seen at this height
uniform sampler2D uProbeGround;         // r: height of the ground, g: 1 where the column is measured
uniform vec4 uProbeGrid;                // 1 / spacing, 1 / columns, half-width of the grid (m), share of it that fades
uniform vec4 uProbeLayers;              // first layer (m), 1 / log(layer ratio), layers, strength
uniform vec2 uProbeFocus;               // world XZ the grid is centred on
vec3 lightAmbient(vec3 n, vec3 worldPosition) {
  vec3 plain = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5);
  vec2 away = abs(worldPosition.xz - uProbeFocus) / uProbeGrid.z;
  float share = uProbeLayers.w * (1.0 - smoothstep(1.0 - uProbeGrid.w, 1.0, max(away.x, away.y)));
  if (share <= 0.0) return plain;
  vec2 uv = (worldPosition.xz * uProbeGrid.x + 0.5) * uProbeGrid.y;
  vec2 ground = texture(uProbeGround, uv).rg;
  float lift = max(worldPosition.y - ground.x, uProbeLayers.x);
  float layer = min(log(lift / uProbeLayers.x) * uProbeLayers.y, uProbeLayers.z - 1.0);
  vec4 probe = texture(uProbeVolume, vec3(uv, (layer + 0.5) / uProbeLayers.z));
  vec3 below = probe.rgb * (uSunColor * max(uSunDir.y, 0.0) + uHemiSky);
  return mix(plain, mix(below, uHemiSky * probe.a, n.y * 0.5 + 0.5), share * ground.y);
}`;

// ground: {heightAt(x, z, cell), colorAt(x, z, target)} - the height of the ground (band-limited to `cell` m when it
// can) and its colour (a linear THREE.Color written into target). sky: settings of the sky scan (SKY_VISIBILITY_DEFAULTS).
// Returns {ambient: {glsl, uniforms}, strength: {value}, update(x, z) -> columns measured, pending, columnAt(x, z),
// refresh(), applyTo(material, lighting), dispose()}.
export function createLightProbes({ground, sky, ...overrides} = {}) {
  if (typeof ground?.heightAt !== 'function' || typeof ground.colorAt !== 'function') throw new TypeError('Light probes need a ground with heightAt and colorAt');
  const settings = {...LIGHT_PROBE_DEFAULTS, ...overrides};
  for (const [name, [min, max]] of Object.entries(LIGHT_PROBE_LIMITS)) {
    const value = settings[name];
    if (!Number.isFinite(value) || value < min || value > max || (WHOLE.includes(name) && !Number.isInteger(value))) throw new RangeError(`Invalid light probe ${name}`);
  }
  const {columns, spacing, layers, firstLayer, layerRatio, budget, edge} = settings;
  const visibility = createSkyVisibility(ground.heightAt, sky);
  const lifts = Array.from({length: layers}, (_, layer) => firstLayer * layerRatio ** layer);
  const count = columns * columns;
  const volume = new Uint8Array(count * layers * VOLUME_CHANNELS), groundData = new Uint16Array(count * GROUND_CHANNELS);
  // Each texel holds the column of one world cell at a time: cell c lives in texel c mod columns, so the grid follows
  // the focus without moving anything in memory. owner: the world cell (x, z) a texel was measured for.
  const owner = new Int32Array(count * 2).fill(UNOWNED);
  const outdated = new Uint8Array(count);   // 1: measured before the ground changed (refresh): shown until measured again
  const volumeTexture = new THREE.Data3DTexture(volume, columns, columns, layers);
  volumeTexture.minFilter = volumeTexture.magFilter = THREE.LinearFilter;
  volumeTexture.wrapS = volumeTexture.wrapT = THREE.RepeatWrapping;
  volumeTexture.unpackAlignment = 1;
  const groundTexture = new THREE.DataTexture(groundData, columns, columns, THREE.RGFormat, THREE.HalfFloatType);
  groundTexture.minFilter = groundTexture.magFilter = THREE.LinearFilter;
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
  volumeTexture.needsUpdate = groundTexture.needsUpdate = true;
  const strength = {value: settings.strength};
  const layersUniform = new THREE.Vector4(firstLayer, 1 / Math.log(layerRatio), layers, strength.value);
  const uniforms = {
    uProbeVolume: {value: volumeTexture}, uProbeGround: {value: groundTexture},
    uProbeGrid: {value: new THREE.Vector4(1 / spacing, 1 / columns, (columns / 2 - 1) * spacing, edge)},
    uProbeLayers: {value: layersUniform}, uProbeFocus: {value: new THREE.Vector2()},
  };
  const wrap = cell => ((cell % columns) + columns) % columns;
  const color = new THREE.Color(), stale = [];
  const ONE = THREE.DataUtils.toHalfFloat(1);

  // Measures the column of world cell (cx, cz) into its texel.
  function measure(cx, cz) {
    const x = cx * spacing, z = cz * spacing, texel = wrap(cz) * columns + wrap(cx);
    const open = visibility.at(x, z, spacing);
    ground.colorAt(x, z, color);
    for (let layer = 0; layer < layers; layer++) {
      const at = (layer * count + texel) * VOLUME_CHANNELS;
      volume[at] = Math.round(Math.min(color.r * open, 1) * BYTE);
      volume[at + 1] = Math.round(Math.min(color.g * open, 1) * BYTE);
      volume[at + 2] = Math.round(Math.min(color.b * open, 1) * BYTE);
      volume[at + 3] = Math.round(visibility.at(x, z, spacing, lifts[layer]) * BYTE);
    }
    groundData[texel * GROUND_CHANNELS] = THREE.DataUtils.toHalfFloat(ground.heightAt(x, z, spacing));
    groundData[texel * GROUND_CHANNELS + 1] = ONE;
    owner[texel * 2] = cx; owner[texel * 2 + 1] = cz;
    outdated[texel] = 0;
  }

  let pending = count, disposed = false;
  return {
    settings, ambient: {glsl: LIGHT_PROBE_GLSL, uniforms}, strength,
    volume: volumeTexture, ground: groundTexture,
    // Columns still to measure around the last focus.
    get pending() { return pending; },
    // The measured column nearest a point: {height, color: [r, g, b] (ground colour x sky seen), sky: [per layer]},
    // or null where it is not measured. For tests and debug views.
    columnAt(x, z) {
      const cx = Math.round(x / spacing), cz = Math.round(z / spacing), texel = wrap(cz) * columns + wrap(cx);
      if (owner[texel * 2] !== cx || owner[texel * 2 + 1] !== cz) return null;
      const at = layer => (layer * count + texel) * VOLUME_CHANNELS;
      return {
        height: THREE.DataUtils.fromHalfFloat(groundData[texel * GROUND_CHANNELS]),
        color: [0, 1, 2].map(channel => volume[at(0) + channel] / BYTE),
        sky: lifts.map((_, layer) => volume[at(layer) + 3] / BYTE),
      };
    },
    // Centres the grid on a point and measures up to `budget` of the columns that came into it, nearest first.
    // Call once per frame. Returns the columns measured.
    update(x, z) {
      if (disposed) return 0;
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('Light probe focus must be finite');
      uniforms.uProbeFocus.value.set(x, z);
      layersUniform.w = strength.value;
      const firstX = Math.round(x / spacing) - columns / 2, firstZ = Math.round(z / spacing) - columns / 2;
      stale.length = 0;
      let dropped = false;
      for (let j = 0; j < columns; j++) for (let i = 0; i < columns; i++) {
        // The world cell this texel stands for now.
        const cx = firstX + wrap(i - firstX), cz = firstZ + wrap(j - firstZ), texel = j * columns + i;
        const kept = owner[texel * 2] === cx && owner[texel * 2 + 1] === cz;
        if (kept && !outdated[texel]) continue;
        // What it held belongs to ground that left the grid: not shown here.
        if (!kept && groundData[texel * GROUND_CHANNELS + 1]) { groundData[texel * GROUND_CHANNELS + 1] = 0; dropped = true; }
        stale.push([Math.hypot(cx * spacing - x, cz * spacing - z), cx, cz]);
      }
      stale.sort((a, b) => a[0] - b[0]);
      const measured = Math.min(budget, stale.length);
      for (let index = 0; index < measured; index++) measure(stale[index][1], stale[index][2]);
      pending = stale.length - measured;
      if (measured) volumeTexture.needsUpdate = true;
      if (measured || dropped) groundTexture.needsUpdate = true;
      return measured;
    },
    // The ground changed (its shape or its colour): every column is measured again, over the next updates.
    refresh() { outdated.fill(1); },
    // Gives a lit Three material (standard, physical, lambert, phong...) the same ambient as the hook: the scene's
    // hemisphere light is replaced, for this material, by the probes. lighting: the hook built with this `ambient`
    // (its uniforms carry the sun and hemisphere the probes need: keep it in step with the scene, syncLighting).
    applyTo(material, lighting) {
      if (!material?.isMaterial || typeof material.onBeforeCompile !== 'function') throw new TypeError('Light probes apply to a Three material');
      if (lighting?.uniforms?.uProbeVolume !== uniforms.uProbeVolume) throw Error('Light probes need the lighting hook built with their ambient');
      const compile = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        if (!shader.fragmentShader.includes('#include <lights_fragment_begin>') || !shader.vertexShader.includes('#include <project_vertex>')) throw Error('Light probes need a lit Three material');
        Object.assign(shader.uniforms, lighting.uniforms);
        shader.vertexShader = 'varying vec3 vLightProbeWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 probeWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          probeWorld = instanceMatrix * probeWorld;
          #endif
          vLightProbeWorld = (modelMatrix * probeWorld).xyz;
        }`);
        shader.fragmentShader = 'varying vec3 vLightProbeWorld;\n' + shader.fragmentShader.replace('void main() {', `${lighting.glsl}\nvoid main() {`)
          .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
        {
          // The hemisphere light Three just added gives way to the ambient of the probes.
          vec3 probeNormal = inverseTransformDirection(geometryNormal, viewMatrix);
          irradiance = max(irradiance + lightAmbient(probeNormal, vLightProbeWorld) - mix(uHemiGround, uHemiSky, probeNormal.y * 0.5 + 0.5), vec3(0.0));
        }`);
      };
      material.customProgramCacheKey = () => key() + '|light-probes';
      material.needsUpdate = true;
      return material;
    },
    dispose() { if (disposed) return; disposed = true; volumeTexture.dispose(); groundTexture.dispose(); },
  };
}
