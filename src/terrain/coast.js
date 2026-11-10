// Test island and sea floor for the ocean: a heightfield (beach -> slope plunging to the abyss) on a 2 m grid around the island,
// and a flat abyss plane under everything else. Shaded through the core `lighting` hook (shade() + applyFog()); sand / rock /
// grass by height and slope, hashed detail; optional water bindings for shore depth and caustics.
// Wet sand (port of WaterWetness.hlsl + the WaterTerrain.shader wetness block): ground touched by water darkens (albedo^2, the
// porous-wet term), and gets a mirror-flat sheen; WHERE it is wet comes from the band above the live surface and the swash's wet line.
import * as THREE from 'three';
import {createLighting} from '../core/lighting.js';
import {valueNoise, fbm} from '../core/value-noise.js';

export const TERRAIN_DEFAULTS = Object.freeze({ on: true, centerX: 0, centerZ: 220, peakHeight: 18, hillRadius: 70, beachRadius: 85, slopeEndRadius: 330, abyssDepth: 100, noiseAmp: 5, noiseScale: 55, seed: 7 });
const ISLAND_EXTENT = 400, CELL = 2, ABYSS_EXTENT = 20000;   // island mesh half-size (m), grid cell (m), abyss plane half-size (m)
// WaterTerrain.shader wetness defaults: _WetStrength 1, _WetBandHeight .25, _WetSwashStrength 1, _BeachWetDarken .85, _BeachWetSmoothness .85.
export const WET_DEFAULTS = Object.freeze({ strength: 1, bandHeight: 0.25, swashStrength: 1, darken: 0.85, smoothness: 0.85 });

// 5-octave fbm over the shared terrain value noise (core/value-noise.js), deterministic per seed
const COAST_FBM = Object.freeze({octaves: 5, amplitude: 0.5, gain: 0.5, lacunarity: 2.1});
function makeNoise(seed) {
  const value = valueNoise(seed);
  return (x, y) => fbm(value, x, y, COAST_FBM);
}
const smooth01 = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class OceanCoastTerrain {
  constructor({scene, settings, water, onHeightField, lighting = createLighting()} = {}) {
    this.lighting = lighting;
    this.scene = scene;
    this.water = water;
    this.onHeightField = onHeightField;
    this.s = {...TERRAIN_DEFAULTS, ...settings};
    this.wetUniforms = createWetUniforms();
    this.group = new THREE.Group();
    scene?.add(this.group);
    this.build();
  }
  // Height of the sea floor / island at a world xz (also used by anything that needs the bed: caustic plane, camera clamp).
  heightAt(x, z) {
    const s = this.s, n = this.noise, warp = n((x + 500) / 180, (z - 500) / 180) * 25;
    const r = Math.hypot(x - s.centerX, z - s.centerZ) + warp;
    const hill = s.peakHeight * smooth01(s.hillRadius, 0, r), slope = -s.abyssDepth * smooth01(s.beachRadius, s.slopeEndRadius, r);
    const detail = n(x / s.noiseScale, z / s.noiseScale) * s.noiseAmp * (0.4 + 0.6 * smooth01(s.beachRadius, s.slopeEndRadius, r)) * (1 - 0.7 * smooth01(s.beachRadius + 10, s.beachRadius - 10, r));
    const edge = smooth01(ISLAND_EXTENT * 0.8, ISLAND_EXTENT, Math.max(Math.abs(x - s.centerX), Math.abs(z - s.centerZ)));   // sink under the abyss plane at the mesh border
    return THREE.MathUtils.lerp(hill + slope + detail, -s.abyssDepth - 2, edge);
  }
  // Match the rendered triangles rather than sampling the smoother generating function.
  collisionHeightAt(x, z) {
    if (!this.s.on) return undefined;
    const gx = (x - this.s.centerX + ISLAND_EXTENT) / CELL, gz = (z - this.s.centerZ + ISLAND_EXTENT) / CELL;
    const n = Math.round(2 * ISLAND_EXTENT / CELL);
    if (gx < 0 || gz < 0 || gx >= n || gz >= n) return -this.s.abyssDepth;
    const ix = Math.floor(gx), iz = Math.floor(gz), tx = gx - ix, tz = gz - iz, p = this.island.geometry.attributes.position;
    const a = iz * (n + 1) + ix, b = a + n + 1, d = a + 1, c = b + 1;
    const h = tx + tz <= 1 ? p.getY(a) * (1 - tx - tz) + p.getY(d) * tx + p.getY(b) * tz
      : p.getY(c) * (tx + tz - 1) + p.getY(b) * (1 - tx) + p.getY(d) * (1 - tz);
    return Math.max(h, -this.s.abyssDepth);
  }
  build() {
    const s = this.s; this.noise = makeNoise(s.seed); this.dispose(false);
    const n = Math.round(2 * ISLAND_EXTENT / CELL), geo = new THREE.PlaneGeometry(2 * ISLAND_EXTENT, 2 * ISLAND_EXTENT, n, n); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i) + s.centerX, z = p.getZ(i) + s.centerZ; p.setX(i, x); p.setZ(i, z); p.setY(i, this.heightAt(x, z)); }
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    this.material = terrainMaterial(this.water, this.wetUniforms, this.lighting);
    this.island = new THREE.Mesh(geo, this.material); this.island.frustumCulled = true; this.island.castShadow = true; this.group.add(this.island);
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(2 * ABYSS_EXTENT, 2 * ABYSS_EXTENT, 1, 1).rotateX(-Math.PI / 2), this.material); abyss.position.y = -s.abyssDepth; abyss.frustumCulled = false; this.abyss = abyss; this.group.add(abyss);
    this.group.visible = s.on; this.bakeBed();
  }
  // The shore substrate is baked from the RENDERED triangles (collisionHeightAt), so wave damping and the ground agree exactly.
  bakeBed() {
    const {centerX, centerZ, abyssDepth} = this.s;
    this.onHeightField?.((x, z) => this.collisionHeightAt(x, z) ?? -abyssDepth,
      {centerX, centerZ, half: ISLAND_EXTENT, offFieldDepth: abyssDepth});
  }
  applySettings(settings) { const rebuild = ['centerX', 'centerZ', 'peakHeight', 'hillRadius', 'beachRadius', 'slopeEndRadius', 'abyssDepth', 'noiseAmp', 'noiseScale', 'seed'].some(k => k in settings && settings[k] !== this.s[k]);
    Object.assign(this.s, settings); if (rebuild) this.build(); else if ('on' in settings) this.bakeBed(); this.group.visible = this.s.on; }
  // Lighting comes from the shared `lighting` uniforms (drive them with syncLighting or by hand); this stays for convenience.
  update({sunDirection, sunColor, skyColor, groundColor} = {}) {
    const u = this.lighting.uniforms;
    if (sunDirection) u.uSunDir.value.copy(sunDirection);
    if (sunColor) u.uSunColor.value.copy(sunColor);
    if (skyColor) u.uHemiSky.value.copy(skyColor);
    if (groundColor) u.uHemiGround.value.copy(groundColor);
  }
  applyWet(w) { const u = this.wetUniforms; u.uWetStrength.value = w.strength; u.uWetBandHeight.value = w.bandHeight; u.uWetSwashStrength.value = w.swashStrength; u.uWetDarken.value = w.darken; u.uWetSmoothness.value = w.smoothness; }
  dispose(all = true) { for (const m of [this.island, this.abyss]) if (m) { this.group.remove(m); m.geometry.dispose(); } if (this.material) this.material.dispose(); if (all) this.group.removeFromParent(); }
}

// Shared underwater uniforms hook: depth darkening (downwelling) and caustics are filled in by the underwater batch; defaults = none.
const createWetUniforms = () => ({ uWetStrength: { value: 1 }, uWetBandHeight: { value: 0.25 }, uWetSwashStrength: { value: 1 }, uWetDarken: { value: 0.85 }, uWetSmoothness: { value: 0.85 } });
function terrainMaterial(water, wet, lighting) {
  return new THREE.ShaderMaterial({
    uniforms: {...lighting.uniforms, ...wet, ...water?.uniforms},
    defines: water ? {COAST_WATER: 1} : {},
    vertexShader: /* glsl */`varying vec3 vWorld, vNormal; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`${lighting.glsl}
      varying vec3 vWorld, vNormal;
      ${water?.glsl ?? ''}
      // ---- wetness model (WaterWetness.hlsl): HOW wet looks; where it is wet is decided in main() from the band + the swash
      #define WET_POROUS_SQUARE_GAIN 1.0
      #define WET_SMOOTHNESS_CEILING 0.92
      #define WET_BAND_MIN_HEIGHT 1e-3
      #define WET_SWASH_EDGE_FRACTION 0.25
      #define WET_QUERY_RISE_MAX 8.0      // m above the level past which no swash reaches: the surface query is skipped there
      #define WET_SHEEN_STRENGTH 0.5      // this Lambert terrain has no dry specular, so the wet sheen is the only one
      uniform float uWetStrength, uWetBandHeight, uWetSwashStrength, uWetDarken, uWetSmoothness;
      float waterWetBand(float worldY, float surfaceY, float wetFloorY, float bandHeight){ float wetLine = max(surfaceY, wetFloorY);
        if (bandHeight <= WET_BAND_MIN_HEIGHT) return worldY <= wetLine ? 1.0 : 0.0; return 1.0 - smoothstep(wetLine, wetLine + bandHeight, worldY); }
      float waterWetSwash(float riseAboveStill, float wetLevel){ if (wetLevel <= 0.0) return 0.0; return 1.0 - smoothstep(wetLevel * (1.0 - WET_SWASH_EDGE_FRACTION), wetLevel, riseAboveStill); }
      vec3 waterWetAlbedo(vec3 albedo, float wet, float darken){ vec3 porous = albedo * mix(vec3(1.0), albedo, WET_POROUS_SQUARE_GAIN); return mix(albedo, porous, clamp(wet * darken, 0.0, 1.0)); }   // multiplicative: wet sand stays coloured
      float waterSpecularExponent(float smoothness){ return exp2(smoothness * 10.0 + 1.0); }
      float wetnessAt(vec3 p){
        #ifdef COAST_WATER
        if (uWetStrength <= 0.0 || uShoreOn < 0.5) return 0.0; ShoreData shore = shoreSample(p.xz);
        if (shore.influence <= 0.0 || shore.depth < -WET_QUERY_RISE_MAX) return 0.0;
        float bandWet = waterWetBand(p.y, surfaceHeightAt(p.xz), 0.0, uWetBandHeight);
        vec2 swash = evaluateSurfSwash(p.xz, shore.toShore, shore.slopeTan, shore.influence, uSurfBeatTime);
        return uWetStrength * clamp(max(bandWet, waterWetSwash(-shore.depth, swash.y) * uWetSwashStrength), 0.0, 1.0);
        #else
        return 0.0;
        #endif
      }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){ vec3 n = normalize(vNormal); float slope = 1.0 - n.y, h = vWorld.y;
        float grain = vnoise(vWorld.xz * 1.7) * 0.5 + vnoise(vWorld.xz * 7.3) * 0.5;                                     // sand grain / rock speckle
        vec3 sand = mix(vec3(0.62, 0.56, 0.42), vec3(0.78, 0.72, 0.55), grain), deepSand = vec3(0.36, 0.38, 0.33), rock = mix(vec3(0.30, 0.28, 0.26), vec3(0.42, 0.40, 0.36), grain), grass = mix(vec3(0.20, 0.36, 0.14), vec3(0.32, 0.46, 0.18), grain);
        vec3 albedo = mix(sand, deepSand, 1.0 - smoothstep(-40.0, -4.0, h));
        albedo = mix(albedo, grass, smoothstep(2.0, 6.0, h) * (1.0 - smoothstep(0.25, 0.5, slope)));
        albedo = mix(albedo, rock, smoothstep(0.3, 0.6, slope));
        float ripple = 0.9 + 0.1 * sin(vWorld.x * 2.1 + vnoise(vWorld.xz * 0.3) * 6.0);                                 // faint sand ripples
        float wet = wetnessAt(vWorld); albedo = waterWetAlbedo(albedo, wet, uWetDarken);
        float focus = 1.0;
        #ifdef COAST_CAUSTICS
        focus = causticLight(vWorld);
        #endif
        vec3 color = shade(albedo * ripple, n, focus, 1.0, 0.0);
        if (wet > 0.0) { vec3 V = normalize(cameraPosition - vWorld), H = normalize(V + uSunDir);   // the film's mirror-flat sheen
          color += uSunColor * pow(max(dot(n, H), 0.0), waterSpecularExponent(min(uWetSmoothness, WET_SMOOTHNESS_CEILING))) * (wet * WET_SHEEN_STRENGTH); }
        gl_FragColor = vec4(applyFog(color, distance(vWorld, cameraPosition)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
}
