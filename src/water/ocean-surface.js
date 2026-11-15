import * as THREE from 'three';
import {proceduralSky} from './sky-binding.js';
import {createLaceTexture} from './foam-texture.js';
import {OceanFft} from './ocean/fft.js';
import {OceanClipmap} from './ocean/clipmap.js';
import {SHORE_DEFAULTS} from './ocean/bed.js';
import {applySurf, setSurfTime, SURF_DEFAULTS, SURF_WARP_REACH_SPACINGS} from './ocean/surf-waves.js';
import {JERLOV} from './jerlov.js';
import {createOceanCaustics} from './ocean/caustics.js';
import {SimWindow} from './ocean/sim-window.js';
import {ObstacleFootprint} from './ocean/obstacle.js';
import {createPlanarCapture} from './planar-capture.js';
import {createWaveBank} from './waves.js';
import {ExclusionVolumes} from './ocean/exclusion.js';
import {createRenderScope} from '../core/render-state.js';
import {createOceanMaterial} from './ocean/material.js';

export const OCEAN_REFLECTION_MODES = Object.freeze(['sky capture', 'planar', 'screen space']);

// Deep-water analytic ocean: two Gerstner bands (chop + swell) in the vertex shader, crest compression -> whitecaps, lace
// foam, Fresnel sky reflection through the `sky` hook (see sky-binding.js), sun glint, horizon blend. Reduced from
// WebAquarium's large-waves / surface pair. laceTexture (pattern in r, tiling) is optional; a generated one is the default.
export const OCEAN_DEFAULTS = Object.freeze({
  swell: .65, swellLength: 65, chop: .8, choppiness: .65, whitecaps: .75, waveSpeed: 1, heading: 0,
  waterTint: '#ffffff', foamTint: '#ffffff', reflection: 1, fresnelPower: 5, glint: 1, fineRipples: 1,
  foamOpacity: .82, foamFeather: .25, foamScale: 1,
  refractionStrength: .6, clarity: 1, tirStrength: .4, crestGlow: 3,
  reflectionSource: 'sky capture', reflectionMix: .65, planarResolution: 256, planarHz: 15, reflectionSteps: 16,
});
export const OCEAN_PRESETS = Object.freeze({
  calm: {swell: .18, swellLength: 46, chop: .28, choppiness: .35, whitecaps: .25},
  rolling: {swell: .65, swellLength: 65, chop: .8, choppiness: .65, whitecaps: .75},
  rough: {swell: 1.4, swellLength: 82, chop: 2, choppiness: .85, whitecaps: 1},
});

// Look and behaviour constants outside OCEAN_DEFAULTS (not in the panels or presets).
const DEFAULT_WATER_TYPE = 'Open ocean II';   // Jerlov type when captureScene is not told one
const WAKE_RESOLUTION = 256;                  // texels across the moving ripple window, unless wake.resolution says
const FOAM_TILES = Object.freeze({foam: 8, wake: 4, streakStretch: 2});   // m per foam tile at foamScale 1; streak length x width
// Subsurface scatter through the crests (uScatter*, uSss*): colour before captureScene sets it from the Jerlov body colour.
const SCATTER = Object.freeze({color: '#0d3852', ambient: [.3, .3, .3], intensity: 2, anisotropy: .5,
  crestFalloff: 2, pinch: [.1, .6], pinchFalloff: 1.5});
const PLANAR_MIN_EYE_HEIGHT = .05;            // m: at or below the surface the mirror pass is skipped
const WIND_CHOP = Object.freeze({base: .75, perMetrePerSecond: .045});   // chop x (base + gain x wind speed) when a wind is given
const MIN_SEA_WIND = .1;                      // m/s: floor of the sea state's own wind when scaling by the weather wind
const GEOMETRY_FALLOFF = 6;                   // rim spacing grows with |x|^this

// Vertices concentrated near the origin, spacing widening offshore (extent ~ near + far metres at the rim).
export function createOceanGeometry({segments = 224, near = 150, far = 7100} = {}) {
  const geometry = new THREE.PlaneGeometry(2, 2, segments, segments).rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const spread = x => Math.sign(x) * (near * Math.abs(x) + far * Math.abs(x) ** GEOMETRY_FALLOFF);
  for (let i = 0; i < positions.count; i++) positions.setXYZ(i, spread(positions.getX(i)), 0, spread(positions.getZ(i)));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createOceanSurface({renderer, sky = proceduralSky(), geometry, laceTexture, settings = {}, fft: fftOptions = {},
  clipmap: clipmapSettings, caustics: causticSettings = false, wake: wakeSettings = false, exclusion: exclude = false, sun} = {}) {
  const fft = renderer && fftOptions !== false ? new OceanFft(renderer, fftOptions) : null;
  const windDetail = fft ? createWaveBank() : null;
  const obstacles = fft && wakeSettings ? new ObstacleFootprint(renderer, wakeSettings.resolution ?? WAKE_RESOLUTION) : null;
  const wake = obstacles ? new SimWindow(renderer, wakeSettings, obstacles.uniforms) : null;
  const caustics = fft && causticSettings ? createOceanCaustics(fft, sky.uniforms.uSkySun, causticSettings, wake, sun) : null;
  const capture = renderer ? new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  }) : null;
  const waterTarget = renderer ? new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  }) : null;
  const planar = renderer ? createPlanarCapture(renderer) : null;
  const exclusion = renderer && exclude ? new ExclusionVolumes(renderer) : null;
  let unmaskedWater;
  const eye = new THREE.Vector3();
  const captureSize = new THREE.Vector2();
  // Offscreen captures put the host's target, viewport and scissor back; the water layer also its clear colour.
  const sceneScope = renderer ? createRenderScope(renderer, {clearColor: false}) : null, waterScope = renderer ? createRenderScope(renderer) : null;
  const useClipmap = !geometry && (clipmapSettings ?? !!fft);
  const ownsGeometry = !geometry && !useClipmap, ownsLace = !laceTexture;
  if (ownsGeometry) geometry = createOceanGeometry();
  const lace = laceTexture ?? createLaceTexture();
  const D = OCEAN_DEFAULTS;
  lace.wrapS = lace.wrapT = THREE.RepeatWrapping;
  const uniforms = {
    ...sky.uniforms,
    ...fft?.uniforms,
    ...windDetail?.uniforms,
    ...wake?.uniforms,
    ...(useClipmap ? {uMorphStart: {value: 0}, uMorphScale: {value: 1}} : {}),
    // Starting values; apply() below sets every OCEAN_DEFAULTS-driven one from the settings.
    clock: {value: 0}, heading: {value: 0}, swell: {value: D.swell},
    swellLength: {value: D.swellLength}, chop: {value: D.chop}, choppiness: {value: D.choppiness},
    whitecaps: {value: D.whitecaps}, lace: {value: lace},
    waterTint: {value: new THREE.Color()}, foamTint: {value: new THREE.Color()},
    reflection: {value: D.reflection}, fresnelPower: {value: D.fresnelPower}, glint: {value: D.glint}, fineRipples: {value: D.fineRipples},
    foamOpacity: {value: D.foamOpacity}, foamFeather: {value: D.foamFeather}, foamScale: {value: D.foamScale},
    ...(fft ? {
      tWhitecap: {value: lace}, tWakeFoam: {value: lace},
      uWindDirXZ: {value: new THREE.Vector2(1, 0)}, uFoamTileSize: {value: FOAM_TILES.foam},
      uFoamFeather: {value: D.foamFeather}, uFoamStreakStretch: {value: FOAM_TILES.streakStretch}, uFoamTextureInfluence: {value: 1},
      uFoamTime: {value: 0}, uFoamPatternDrift: {value: 0}, uSurfaceDetailLod: {value: 1},
      uWakeFoamTileSize: {value: FOAM_TILES.wake}, uWakeFoamFeather: {value: D.foamFeather}, uWakeFoamTextureInfluence: {value: 1},
    } : {}),
    ...(capture ? {
      tOceanScene: {value: capture.texture}, tOceanSceneDepth: {value: capture.depthTexture},
      uOceanInvVP: {value: new THREE.Matrix4()}, uOceanVP: {value: new THREE.Matrix4()}, uOceanSceneReady: {value: false},
      uOceanWaterLayer: {value: false},
      uOceanExtinction: {value: new THREE.Vector3(...JERLOV[DEFAULT_WATER_TYPE].extinction)},
      uOceanRefraction: {value: D.refractionStrength}, uOceanClarity: {value: D.clarity}, uOceanTir: {value: D.tirStrength},
      uReflectionMode: {value: 0}, uReflectionMix: {value: D.reflectionMix}, uReflectionSteps: {value: D.reflectionSteps},
      tPlanarReflection: {value: null}, uPlanarMatrix: {value: planar.matrix},
      uScatterColor: {value: new THREE.Color(SCATTER.color)},
      uScatterAmbient: sky.uniforms.uAmb ?? {value: new THREE.Color(...SCATTER.ambient)},
      uScatterIntensity: {value: SCATTER.intensity}, uScatterAnisotropy: {value: SCATTER.anisotropy},
      uScatterAmbientTerm: {value: 1}, uScatterSunTerm: {value: 1},
      uSssIntensity: {value: D.crestGlow}, uSssSunFalloff: {value: SCATTER.crestFalloff}, uSssPinchMin: {value: SCATTER.pinch[0]},
      uSssPinchMax: {value: SCATTER.pinch[1]}, uSssPinchFalloff: {value: SCATTER.pinchFalloff},
    } : {}),
  };
  const material = createOceanMaterial({uniforms, sky, fft, wake, useClipmap, sceneOptics: Boolean(capture)});
  const mesh = useClipmap ? new THREE.Group() : new THREE.Mesh(geometry, material);
  const clipmap = useClipmap ? new OceanClipmap(mesh, material, clipmapSettings === true ? {} : clipmapSettings) : null;
  if (!clipmap) mesh.frustumCulled = false;
  const state = {...OCEAN_DEFAULTS, ...settings};
  let shoreSettings, surfSettings, shoreHeading, fftTime = 0;
  let environment = null;   // optional core/environment.js contract: supplies the wind update() was not given
  function syncSurf(heading) {
    if (!surfSettings || heading === shoreHeading) return;
    const wavelength = applySurf(fft.surf, surfSettings, fft.sea.swellHeight, THREE.MathUtils.degToRad(heading), shoreSettings);
    fft.shore.apply(shoreSettings, SURF_WARP_REACH_SPACINGS * wavelength);
    shoreHeading = heading;
  }
  function apply(values = {}) {
    Object.assign(state, values);
    uniforms.heading.value = THREE.MathUtils.degToRad(state.heading);
    uniforms.swell.value = state.swell; uniforms.swellLength.value = state.swellLength;
    uniforms.chop.value = state.chop; uniforms.choppiness.value = state.choppiness; uniforms.whitecaps.value = state.whitecaps;
    uniforms.waterTint.value.set(state.waterTint); uniforms.foamTint.value.set(state.foamTint);
    uniforms.reflection.value = state.reflection; uniforms.fresnelPower.value = state.fresnelPower; uniforms.glint.value = state.glint;
    uniforms.fineRipples.value = state.fineRipples; uniforms.foamOpacity.value = state.foamOpacity;
    uniforms.foamFeather.value = state.foamFeather; uniforms.foamScale.value = state.foamScale;
    if (fft) {
      uniforms.uFoamFeather.value = state.foamFeather;
      uniforms.uFoamTileSize.value = FOAM_TILES.foam * state.foamScale;
      uniforms.uWakeFoamTileSize.value = FOAM_TILES.wake * state.foamScale;
    }
    if (capture) {
      uniforms.uOceanRefraction.value = state.refractionStrength;
      uniforms.uOceanClarity.value = state.clarity;
      uniforms.uOceanTir.value = state.tirStrength;
      uniforms.uSssIntensity.value = state.crestGlow;
      uniforms.uReflectionMix.value = state.reflectionMix;
      uniforms.uReflectionSteps.value = state.reflectionSteps;
      const ssr = state.reflectionSource === 'screen space';
      if (ssr !== Boolean(material.defines.OCEAN_REFLECTION_SSR)) {
        if (ssr) material.defines.OCEAN_REFLECTION_SSR = 1;
        else delete material.defines.OCEAN_REFLECTION_SSR;
        material.needsUpdate = true;
      }
    }
    return state;
  }
  apply();
  return {
    mesh, material, uniforms, settings: state, apply, fft, clipmap, caustics, wake, obstacles, exclusion,
    get depthTexture() { return capture?.depthTexture; },
    get waterDistanceTexture() { return waterTarget?.texture; },
    get viewport() { return captureSize; },
    shoreBinding: fft ? {
      uniforms: {...fft.uniforms, ...caustics?.uniforms, ...wake?.uniforms},
      glsl: `${FFT_SAMPLE_GLSL}
        ${caustics ? OCEAN_CAUSTIC_GLSL : ''}
        ${wake ? SIM_SAMPLE_GLSL : ''}
        float surfaceHeightAt(vec2 xz) {
          float height = uOceanFftActive > .5 ? oceanDisplacement(xz, 1.0).y : 0.0;
          ${wake ? 'float fade; height += sampleRipple(xz, fade).r;' : ''}
          return height;
        }`,
    } : null,
    captureScene(scene, camera, {waterType = DEFAULT_WATER_TYPE, bodyGain = .45, excludeHulls = true} = {}) {
      if (!capture) throw new Error('Ocean scene capture requires a renderer');
      const water = Object.hasOwn(JERLOV, waterType) ? JERLOV[waterType] : JERLOV[DEFAULT_WATER_TYPE];
      uniforms.uOceanExtinction.value.fromArray(water.extinction);
      uniforms.uScatterColor.value.setRGB(...water.body, THREE.SRGBColorSpace).multiplyScalar(bodyGain);
      const wasVisible = mesh.visible;
      renderer.getDrawingBufferSize(captureSize);
      capture.setSize(captureSize.x, captureSize.y);
      mesh.visible = false;
      sceneScope(() => { try {
        if (exclusion) exclusion.uniforms.uExclusionOn.value = 0;
        uniforms.uReflectionMode.value = 0;
        if (state.reflectionMix > 0 && state.reflectionSource === 'planar' && camera.getWorldPosition(eye).y > PLANAR_MIN_EYE_HEIGHT) {
          planar.render(scene, camera, {resolution: state.planarResolution, hz: state.planarHz});
          uniforms.tPlanarReflection.value = planar.texture;
          uniforms.uReflectionMode.value = 1;
        } else if (state.reflectionSource === 'screen space') uniforms.uReflectionMode.value = 2;
        exclusion?.update(camera, capture.width, capture.height, excludeHulls);
        renderer.setRenderTarget(capture);
        renderer.clear();
        renderer.render(scene, camera);
        uniforms.uOceanInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
        uniforms.uOceanVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        uniforms.uOceanSceneReady.value = true;
      } finally {
        mesh.visible = wasVisible;
      } });
      return capture;
    },
    captureWater(waterScene, camera) {
      if (!uniforms.uOceanSceneReady?.value) throw new Error('Capture the opaque scene before the water layer');
      waterTarget.setSize(capture.width, capture.height);
      const mask = exclusion?.uniforms.uExclusionOn.value > .5;
      if (mask) {
        unmaskedWater ??= new THREE.WebGLRenderTarget(1, 1, {type: THREE.FloatType,
          minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
          depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)});
        unmaskedWater.setSize(capture.width, capture.height);
      }
      uniforms.uOceanWaterLayer.value = true;
      waterScope(() => { try {
        renderer.setRenderTarget(mask ? unmaskedWater : waterTarget);
        renderer.setClearColor(0, 0);
        renderer.clear();
        renderer.render(waterScene, camera);
        // Keep the exclusion depth samplers outside the ocean material: its water,
        // shore and reflection samplers already fill the WebGL2 minimum budget.
        if (mask) exclusion.filter(unmaskedWater, waterTarget);
      } finally {
        uniforms.uOceanWaterLayer.value = false;
      } });
      return waterTarget;
    },
    setShore(heightAt, {centerX = 0, centerZ = 0, half, shore, surf, offFieldDepth} = {}) {
      if (!fft) throw new Error('Ocean shore needs the FFT surface');
      if (typeof heightAt !== 'function' || !(half > 0)) throw new TypeError('Ocean shore needs heightAt and a positive half extent');
      shoreSettings = {...SHORE_DEFAULTS, ...shore};
      surfSettings = {...SURF_DEFAULTS, ...surf};
      fft.shore.bake(heightAt, centerX, centerZ, half, shoreSettings, offFieldDepth);
      shoreHeading = undefined;
      syncSurf(state.heading);
    },
    // windSpeed (m/s) optionally sharpens chop like the weather-driven demo did.
    setEnvironment(next) { environment = next ?? null; },
    update(dt, windSpeed, cameraPosition, windHeading, wakeFocus = cameraPosition) {
      if (environment) {
        windSpeed ??= environment.wind.speed;
        if (windHeading === undefined && environment.wind.speed > 0) windHeading = THREE.MathUtils.radToDeg(Math.atan2(environment.wind.z, environment.wind.x));
      }
      windHeading ??= state.heading;
      uniforms.clock.value += dt * state.waveSpeed;
      if (capture) uniforms.uOceanSceneReady.value = false;
      uniforms.chop.value = state.chop * (windSpeed ? WIND_CHOP.base + WIND_CHOP.perMetrePerSecond * windSpeed : 1);
      uniforms.heading.value = THREE.MathUtils.degToRad(windHeading);
      if (cameraPosition) clipmap?.update(cameraPosition);
      if (fft) {
        const wind = windSpeed ?? fft.sea.windSpeed;
        windDetail.configure({windFromDegrees: windHeading});
        windDetail.uniforms.uWindTime.value = uniforms.clock.value;
        uniforms.uWindDirXZ.value.set(Math.cos(uniforms.heading.value), Math.sin(uniforms.heading.value));
        uniforms.uFoamPatternDrift.value = wind * fft.foam.drift;
        uniforms.uFoamTime.value = uniforms.clock.value;
        fft.setWeatherWind(wind, fft.sea.windDrivesSeaState ? wind / Math.max(MIN_SEA_WIND, fft.sea.windSpeed) : 1, windHeading);
        fftTime += dt * state.waveSpeed;
        syncSurf(windHeading);
        if (surfSettings) setSurfTime(fft.surf, fftTime, surfSettings.period);
        fft.update(fftTime, dt);
        if (wake && wakeFocus) {
          wake.track(wakeFocus.x, wakeFocus.z);
          if (obstacles.objects.length || obstacles.uniforms.uObstacleOn.value > 0) {
            obstacles.render(wake.center.x, wake.center.y, wake.halfSize);
          }
          wake.update(dt);
        }
        if (cameraPosition) caustics?.update(cameraPosition);
      }
    },
    dispose() {
      clipmap?.dispose();
      caustics?.dispose();
      wake?.dispose();
      obstacles?.dispose();
      fft?.dispose();
      capture?.dispose();
      waterTarget?.dispose();
      unmaskedWater?.dispose();
      planar?.dispose();
      exclusion?.dispose();
      if (ownsGeometry) geometry.dispose();
      if (ownsLace) lace.dispose();
      material.dispose();
    },
  };
}
