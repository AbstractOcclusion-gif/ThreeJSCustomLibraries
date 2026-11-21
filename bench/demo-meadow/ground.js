import * as THREE from 'three';
import {createSandLook, createSnowLook, createTerrainAppearance, createTerrainField, createTerrainMaterial} from '../../src/terrain/index.js';
import {createSurfaceLook, createSurfaceWeather, createTrackMask} from '../../src/surface/index.js';
import {loadTerrainTextures} from '../terrain/textures.js';
import {SITE, SURFACES, groundHeight} from './layout.js';
import {createMeadowTerrainView} from './terrain-view.js';
import {createMeadowSnowSurface} from './snow-surface.js';

const LOOK = {trackResolution: 1024, trackContrast: .48, initialWetness: .19, shoreWidth: .75};

export async function createMeadowGround({renderer, scene}) {
 const {span, samples, seed, pond} = SITE, half = span / 2;
 const origin = [-half, -half], size = [span, span], cell = span / (samples - 1);
 const heights = Float32Array.from({length: samples ** 2}, (_, i) =>
  groundHeight(origin[0] + (i % samples) * cell, origin[1] + Math.floor(i / samples) * cell));
 const textures = await loadTerrainTextures(renderer, {layerDetail: true, snowDetail: true});
 const baseField = createTerrainField({origin, size, resolution: [samples, samples], heights, seed, rules: SURFACES, snowTrackRims: true});
 const snowSurface = createMeadowSnowSurface({field: baseField, heights, seed});
 const {field} = snowSurface;
 const tracks = createTrackMask({origin, size, resolution: LOOK.trackResolution, directional: true});
 const weather = createSurfaceWeather();
 weather.set({wetness: LOOK.initialWetness});
 const rainAmount = {value: 0};
 const appearance = createTerrainAppearance();
 const sand = createSandLook(), snow = createSnowLook(), surface = createSurfaceLook();
 appearance.waterLevel.value = pond.level;
 appearance.shoreWidth.value = LOOK.shoreWidth;
 const createMaterial = (field, parameters) => createTerrainMaterial(parameters, {
  field, appearance, tracks, trackContrast: LOOK.trackContrast, weather, rainAmount, fracture: false, sandLook: sand, snowLook: snow,
  snowMaterial: textures.snowMaterial, look: surface,
  layerArray: textures.layerArray, layerDetailArray: textures.layerDetailArray, detailNormal: textures.detail,
 });
 const material = createMaterial(field, {});
 const mesh = new THREE.Mesh(field.geometry, material);
 mesh.receiveShadow = true;
 scene.add(mesh);
 const terrainView = createMeadowTerrainView({renderer, scene, field, surface: mesh, createMaterial});
 return {
  heights,
  field, snowSurface, tracks, sand, snow, surface, appearance, rates: weather.rates,
  update(dt, conditions, focus, useRings) {
   rainAmount.value = conditions.rain;
   weather.update(dt, conditions);
   terrainView.update(focus, useRings || field.snowCover.value);
  },
  dispose() {
   terrainView.dispose();
   mesh.removeFromParent();
   material.dispose();
   tracks.dispose();
   snowSurface.dispose();
   field.dispose();
   for (const texture of [textures.layerArray, textures.layerDetailArray, textures.rock, textures.detail,
    textures.snowMaterial.normal, textures.snowMaterial.roughness]) texture.dispose();
  },
 };
}
