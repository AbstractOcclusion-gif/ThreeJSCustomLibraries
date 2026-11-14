// Light slots: the one place where the light loop of a lit Three material (standard, physical, lambert, phong...) is
// extended. Three resolves `#include <lights_fragment_begin>` once per program, so two features that each rewrite it
// cannot share a material. Here every feature adds a slot instead, and one compile hook writes them all in:
//   directional     right after a directional light is read: may change directLight.color (shadow, cloud cover)
//   directionalLit  right after that light is applied: may add to reflectedLight (light through a thin leaf)
//   after           after the whole loop: may change `irradiance` (ambient by place)
// A slot is {key, uniforms?, declarations?, worldPosition?, directional?, directionalLit?, after?}: GLSL strings, each
// written inside its own block. declarations go before main(); worldPosition: true gives the code `vLightWorld`, the
// world position of the fragment. The hook runs after the material's own onBeforeCompile and keeps it; a feature that
// assigns onBeforeCompile must do so before it adds a slot.
import * as THREE from 'three';

const LIGHT_LOOP = '#include <lights_fragment_begin>', PROJECTION = '#include <project_vertex>', MAIN = 'void main() {';
const DIRECTIONAL_READ = 'getDirectionalLightInfo( directionalLight, directLight );';
const DIRECTIONAL_APPLY = 'RE_Direct( directLight', AFTER_DIRECTIONAL = '#if ( NUM_RECT_AREA_LIGHTS';
const STAGES = ['directional', 'directionalLit', 'after'];
const WORLD_VARYING = 'varying vec3 vLightWorld;';
const WORLD_VERTEX = /* glsl */`
{
  vec4 lightWorld = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
  lightWorld = batchingMatrix * lightWorld;
  #endif
  #ifdef USE_INSTANCING
  lightWorld = instanceMatrix * lightWorld;
  #endif
  vLightWorld = (modelMatrix * lightWorld).xyz;
}`;
const states = new WeakMap();   // material -> {slots, previousCompile, previousKey, compile, key}

const block = (slots, stage) => slots.filter(slot => slot[stage]).map(slot => `\n{ // light slot: ${slot.key}\n${slot[stage]}\n}`).join('');

// Three's light loop with the slots written in. Throws when this Three no longer has the statements the slots follow.
function lightLoop(slots) {
  const source = THREE.ShaderChunk.lights_fragment_begin;
  const read = source.indexOf(DIRECTIONAL_READ);
  const apply = source.lastIndexOf(DIRECTIONAL_APPLY, source.indexOf(AFTER_DIRECTIONAL));
  const applied = source.indexOf(';', apply) + 1;
  if (read < 0 || apply < read || applied === 0) throw Error(`Light slots do not know the light loop of Three r${THREE.REVISION}`);
  const readEnd = read + DIRECTIONAL_READ.length;
  return source.slice(0, readEnd) + block(slots, 'directional') + source.slice(readEnd, applied) + block(slots, 'directionalLit')
    + source.slice(applied) + block(slots, 'after');
}

function install(material) {
  const state = {slots: [], previousCompile: material.onBeforeCompile, previousKey: material.customProgramCacheKey};
  state.compile = function (shader, renderer) {
    state.previousCompile.call(this, shader, renderer);
    const {slots} = state;
    if (!slots.length) return;
    if (!shader.fragmentShader.includes(LIGHT_LOOP) || !shader.fragmentShader.includes(MAIN)) throw Error('Light slots need a lit Three material that keeps its light loop');
    const world = slots.some(slot => slot.worldPosition);
    if (world) {
      if (!shader.vertexShader.includes(PROJECTION)) throw Error('Light slots need a lit Three material that keeps its projection');
      shader.vertexShader = WORLD_VARYING + '\n' + shader.vertexShader.replace(PROJECTION, PROJECTION + WORLD_VERTEX);
    }
    for (const slot of slots) Object.assign(shader.uniforms, slot.uniforms);
    const declarations = [world ? WORLD_VARYING : '', ...slots.map(slot => slot.declarations ?? '')].filter(Boolean).join('\n');
    shader.fragmentShader = shader.fragmentShader.replace(MAIN, `${declarations}\n${MAIN}`).replace(LIGHT_LOOP, lightLoop(slots));
  };
  state.key = function () {
    // Three's default key is the text of onBeforeCompile, which is now this hook: the material's own one is used instead.
    const base = state.previousKey === THREE.Material.prototype.customProgramCacheKey ? state.previousCompile.toString() : state.previousKey.call(this);
    return state.slots.length ? `${base}|light-slots:${state.slots.map(slot => slot.key).join(',')}` : base;
  };
  material.onBeforeCompile = state.compile; material.customProgramCacheKey = state.key;
  states.set(material, state);
  return state;
}

// Adds a slot to a lit Three material. Returns the function that takes it away again; with its last slot gone the
// material gets back the onBeforeCompile and cache key it had, unless something else replaced them since.
export function addLightSlot(material, slot) {
  if (!material?.isMaterial || typeof material.onBeforeCompile !== 'function') throw new TypeError('Light slots apply to a Three material');
  if (typeof slot?.key !== 'string' || !slot.key) throw new TypeError('A light slot needs a key');
  if (!STAGES.some(stage => typeof slot[stage] === 'string' && slot[stage])) throw new TypeError(`Light slot ${slot.key} needs GLSL for one of: ${STAGES.join(', ')}`);
  const state = states.get(material) ?? install(material);
  if (state.slots.some(other => other.key === slot.key)) throw Error(`Light slot ${slot.key} is already on this material`);
  state.slots.push(slot); material.needsUpdate = true;
  return function detach() {
    const index = state.slots.indexOf(slot);
    if (index < 0) return;
    state.slots.splice(index, 1); material.needsUpdate = true;
    if (state.slots.length || material.onBeforeCompile !== state.compile || material.customProgramCacheKey !== state.key) return;
    material.onBeforeCompile = state.previousCompile; material.customProgramCacheKey = state.previousKey;
    states.delete(material);
  };
}
