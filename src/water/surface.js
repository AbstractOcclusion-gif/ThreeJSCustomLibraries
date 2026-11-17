import * as THREE from 'three';
import {createWaveBank} from './waves.js';
import {proceduralSky} from './sky-binding.js';
import {createFoamTexture} from './foam-texture.js';
import {createIceLook, iceLookUniforms} from './freeze.js';
import {createPondShadow} from './pond-shadow.js';
import {sunCovers} from '../core/lighting.js';
import {addLightSlot} from '../core/light-slots.js';
import {channelLightingGLSL, createChannelMaterial, MAX_GOD_STEPS} from './channel-material.js';
import {createChannelPasses} from './channel-passes.js';
import {WATER_IOR} from './water-optics.js';
export {CHANNEL_OBSTACLE_COUNT} from './channel-material.js';
export {POND_REFLECTION_DEFAULTS} from './channel-passes.js';

// What render(seconds, settings) uses for a setting the host leaves out. clarity drives the refraction; pondClarity is the
// pond-optics clarity, read from the same settings.clarity but with its own default.
export const CHANNEL_RENDER_DEFAULTS = Object.freeze({
  clarity: 1,
  pondClarity: 0.93,
  haze: 0.25,
  depthDark: 1.2,
  bankFoam: 1,
  godRays: 0,
  f0: 0.02,
  fresnelPower: 5,
  sunGlint: 0.07,
  reflection: 1,
  rippleStrength: 1,
  microRipples: 0,
  caustics: 0,
  causticDepth: 2.4,
  causticFalloff: 0.35,
  causticFocus: 0.3,
  causticNormalScale: 1,
  shaftLength: 4,
  godFalloff: 0.9,
  godSteps: 24,
  godColor: '#bfeaff',
  pondColor: '#377e68',
  waveHeight: 0,
  wavelength: 1.2,
  waveDirection: 0,
  waveSpread: Math.PI / 4, // m, m, rad, rad
});
const POND_CAUSTIC_MIP = 2.5; // mip bias the volumetric shafts read the caustic map at (pond optics)
const FALLBACK_AMBIENT = [0.3, 0.3, 0.3]; // pond ambient when the sky hook has no uAmb
const DEFAULT_CAPTURE_SCALE = 0.5;
const DEFAULT_CAUSTIC_SEGMENTS = 160;

// Inland water surface (river / pond): refraction against a half-resolution bed capture, Beer-Lambert absorption, wind-wave
// bank, interactive ripples, rock wakes, baked flow foam, underwater light shafts. Draws the sky through the `sky` hook:
// {glsl, uniforms, defines} where glsl defines vec3 sky(vec3 dir, float sunMul) and the uniforms carry uSkySun, uSunCol,
// uDaylight (see sky-binding.js: skyFromWeather(view) or proceduralSky()). foamTexture (rgba tile: r/g brightness,
// b density threshold, a coverage) is optional; without it a generated tile is used.
// The host calls render(seconds, settings) once per frame (it captures the bed), then draws the scene itself.
export function createChannelSurface({
  renderer,
  scene,
  camera,
  sky = proceduralSky(),
  ripples,
  obstacles,
  flow,
  foamTexture,
  foamLayer,
  freezeMap,
  iceDamage,
  iceLook = createIceLook(),
  captureScale = DEFAULT_CAPTURE_SCALE,
  causticSegments = DEFAULT_CAUSTIC_SEGMENTS,
  clipToBed = false,
  pondOptics = false,
  bedCaustics = 'screen',
  lightOccluders,
  sun,
}) {
  if (!renderer || !scene || !camera || !ripples || !obstacles || !flow)
    throw Error('Channel surface needs renderer, scene, camera, ripples, obstacles and flow');
  const waves = createWaveBank();
  // What shades the light under the water. `sun`: one sun cover or a list (core/lighting.js), e.g. the sun shadows of the
  // lighting module: the shafts and the caustics then take the shadows the rest of the scene has. Without it,
  // `lightOccluders` builds the pond's own shadow map of those meshes. The covers are read along the sun in the air:
  // the bend of the light at the surface is left out.
  const covers = sunCovers(sun),
    coverUniforms = Object.assign({}, ...covers.map(cover => cover.uniforms));
  const shadow = !covers.length && lightOccluders ? createPondShadow(renderer, lightOccluders) : null;
  const lightingGLSL = channelLightingGLSL({covers, shadow, iceDamage});
  const ownsFoam = !foamTexture;
  const foamTile = foamTexture ?? createFoamTexture();
  foamTile.wrapS = foamTile.wrapT = THREE.RepeatWrapping;
  const R = CHANNEL_RENDER_DEFAULTS;
  const uniforms = {
    ...shadow?.uniforms,
    ...coverUniforms,
    ...sky.uniforms,
    ...waves.uniforms,
    bedColor: {value: null},
    bedDepth: {value: null},
    clipRange: {value: new THREE.Vector2(camera.near, camera.far)},
    bedClipToWorld: {value: new THREE.Matrix4()},
    causticMap: {value: null},
    causticDepth: {value: R.causticDepth},
    causticFalloff: {value: R.causticFalloff},
    causticFocus: {value: R.causticFocus},
    causticNormalScale: {value: R.causticNormalScale},
    // Volumetric shafts are a wide light sample; use filtered projection to avoid
    // reading the caustic triangles as a checker pattern through the volume.
    pondCausticMip: {value: pondOptics ? POND_CAUSTIC_MIP : 0},
    uCausticOn: {value: 0},
    pondLightLevel: {value: 0},
    pondRefractedSun: {value: new THREE.Vector3(0, -1, 0)},
    shaftLength: {value: R.shaftLength},
    godFalloff: {value: R.godFalloff},
    godColor: {value: new THREE.Color(R.godColor)},
    godSteps: {value: R.godSteps},
    pondGodHalf: {value: false},
    tPondGod: {value: null},
    currentTime: {value: 0},
    foamAmount: {value: 0.55},
    bankFoam: {value: R.bankFoam},
    foamFeather: {value: 0.65},
    refraction: {value: 1},
    rippleMap: {value: ripples.texture},
    rippleBounds: {value: ripples.bounds},
    rippleCell: {value: ripples.cell},
    rippleActive: {value: false},
    rocks: {value: obstacles},
    flowSpeed: {value: 1},
    flowMap: {value: flow.texture},
    flowBounds: {value: flow.bounds},
    bakedFlow: {value: false},
    foamTile: {value: foamTile},
    waveTime: {value: 0},
    godRays: {value: 0.55},
    impactFoam: {value: new THREE.Vector4()},
    foamLayerMap: {value: foamLayer?.texture ?? null},
    foamLayerBounds: {value: foamLayer?.bounds ?? new THREE.Vector4(0, 0, 1, 1)},
    splashFoam: {value: foamLayer ? 1 : 0},
    waterTint: {value: new THREE.Color()},
    pondColor: {value: new THREE.Color(R.pondColor)},
    pondHaze: {value: R.haze},
    pondDepthDark: {value: R.depthDark},
    pondClarity: {value: R.pondClarity},
    pondAmbient: sky.uniforms.uAmb ?? {value: new THREE.Color(...FALLBACK_AMBIENT)},
    f0: {value: R.f0},
    fresnelPower: {value: R.fresnelPower},
    sunGlint: {value: R.sunGlint},
    clarity: {value: R.clarity},
    reflectionStrength: {value: R.reflection},
    tPlanar: {value: null},
    uPlanarMatrix: {value: new THREE.Matrix4()},
    uPlanarMix: {value: 0},
    uPlanarDistort: {value: 0},
    uPlanarFloor: {value: 0},
    uUnderMirror: {value: 0},
    rippleStrength: {value: R.rippleStrength},
    microRipples: {value: R.microRipples},
    caustics: {value: R.caustics},
    freezeProgress: {value: 0},
    freezeThaw: {value: 0},
    freezeMap: {value: freezeMap ?? foamTile},
    ...iceLookUniforms(iceLook),
    ...(iceDamage
      ? {
          iceDamageMap: {value: iceDamage.texture},
          iceDamageBounds: {value: iceDamage.bounds},
          iceHasDamage: iceDamage.active,
          iceSolidSurface: iceDamage.solidSurface ?? {value: false},
        }
      : {}),
  };
  const material = createChannelMaterial({uniforms, sky, clipToBed, iceDamage, pondOptics, lightingGLSL, bedCaustics});
  const surface = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const passes = createChannelPasses({
    renderer,
    scene,
    camera,
    surface,
    uniforms,
    ripples,
    shadow,
    captureScale,
    causticSegments,
    pondOptics,
    bedCaustics,
  });
  const worldPosition = new THREE.Vector3();
  scene.add(surface);
  const lightingUniforms = {
    ...shadow?.uniforms,
    ...coverUniforms,
    ...(iceDamage
      ? {
          freezeProgress: uniforms.freezeProgress,
          iceDamageMap: uniforms.iceDamageMap,
          iceDamageBounds: uniforms.iceDamageBounds,
          iceHasDamage: uniforms.iceHasDamage,
        }
      : {}),
    causticMap: uniforms.causticMap,
    rippleBounds: uniforms.rippleBounds,
    pondRefractedSun: uniforms.pondRefractedSun,
    pondLightLevel: uniforms.pondLightLevel,
    pondCausticMip: uniforms.pondCausticMip,
    uCausticOn: uniforms.uCausticOn,
    uCausticStrength: uniforms.caustics,
    causticFalloff: uniforms.causticFalloff,
    shaftLength: uniforms.shaftLength,
    causticFocus: uniforms.causticFocus,
    godFalloff: uniforms.godFalloff,
    godColor: uniforms.godColor,
    godSteps: uniforms.godSteps,
    pondColor: uniforms.pondColor,
    pondHaze: uniforms.pondHaze,
    pondDepthDark: uniforms.pondDepthDark,
    pondClarity: uniforms.pondClarity,
  };
  const litMaterials = new Map();
  // WebAquarium rendering/underwater-lit.js multiplies the material's direct
  // diffuse and specular. The same caustics then appear in capture, refraction,
  // reflection, and on a diver's view, without a second screen-space light.
  function bindBedMaterial(mat) {
    if (bedCaustics !== 'material') throw new Error('Set bedCaustics to material before binding a bed material.');
    if (litMaterials.has(mat)) return mat;
    const detach = addLightSlot(mat, {
      key: `pond-caustics:${Boolean(shadow)}:${Boolean(iceDamage)}:${covers.map(cover => cover.read).join(',')}`,
      worldPosition: true,
      uniforms: lightingUniforms,
      declarations: lightingGLSL,
      after: `float pondFocus = max(0.0, 1.0 + pondBedFocus(vLightWorld) * uCausticStrength);
     if (vLightWorld.y < pondLightLevel - .03) pondFocus *= pondShadow(vLightWorld, .5);
     reflectedLight.directDiffuse *= pondFocus;
     reflectedLight.directSpecular *= pondFocus;`,
    });
    litMaterials.set(mat, detach);
    return mat;
  }
  return {
    surface,
    material,
    uniforms,
    lighting: {
      glsl: lightingGLSL,
      lightsBed: true,
      screenBed: bedCaustics === 'screen',
      pondOptics,
      uniforms: lightingUniforms,
      bindBedMaterial,
    },
    get depthTexture() {
      return passes.depthTexture;
    },
    get viewport() {
      return passes.viewport;
    },
    render(seconds, settings) {
      uniforms.freezeProgress.value =
        settings.frozen === true ? 1 : THREE.MathUtils.clamp(settings.freezeProgress ?? 0, 0, 1);
      uniforms.freezeThaw.value = THREE.MathUtils.clamp(settings.freezeThaw ?? 0, 0, 1);
      uniforms.uCausticOn.value = 0;
      if (shadow) shadow.uniforms.pondShadowOn.value = 0;
      uniforms.pondGodHalf.value = false;
      uniforms.pondClarity.value = settings.clarity ?? R.pondClarity;
      if (settings.pondColor) uniforms.pondColor.value.set(settings.pondColor);
      uniforms.pondHaze.value = settings.haze ?? R.haze;
      uniforms.pondDepthDark.value = settings.depthDark ?? R.depthDark;
      // A frozen pond still draws what lies under its clear ice, so the captures keep running.
      if (!surface.visible) return;
      uniforms.currentTime.value = seconds;
      uniforms.foamAmount.value = settings.foam;
      uniforms.bankFoam.value = settings.bankFoam ?? R.bankFoam;
      uniforms.foamFeather.value = settings.foamFeather;
      uniforms.refraction.value = settings.refraction;
      uniforms.flowSpeed.value = settings.speed;
      uniforms.rippleActive.value = ripples.active;
      uniforms.bakedFlow.value = flow.ready;
      uniforms.waveTime.value = settings.waveTime ?? seconds;
      uniforms.uWindTime.value = uniforms.waveTime.value;
      uniforms.godRays.value = settings.godRays ?? R.godRays;
      if (settings.tint) uniforms.waterTint.value.set(settings.tint);
      uniforms.clarity.value = settings.clarity ?? R.clarity;
      uniforms.f0.value = settings.f0 ?? R.f0;
      uniforms.fresnelPower.value = settings.fresnelPower ?? R.fresnelPower;
      uniforms.sunGlint.value = settings.sunGlint ?? R.sunGlint;
      uniforms.reflectionStrength.value = settings.reflection ?? R.reflection;
      uniforms.rippleStrength.value = settings.rippleStrength ?? R.rippleStrength;
      uniforms.microRipples.value = settings.microRipples ?? R.microRipples;
      uniforms.caustics.value = settings.caustics ?? R.caustics;
      uniforms.causticDepth.value = settings.causticDepth ?? R.causticDepth;
      uniforms.causticFalloff.value = settings.causticFalloff ?? R.causticFalloff;
      uniforms.causticFocus.value = Math.max(0, settings.causticFocus ?? R.causticFocus);
      uniforms.causticNormalScale.value = Math.max(0, settings.causticNormalScale ?? R.causticNormalScale);
      uniforms.shaftLength.value = settings.shaftLength ?? R.shaftLength;
      uniforms.godFalloff.value = settings.godFalloff ?? R.godFalloff;
      uniforms.godSteps.value = THREE.MathUtils.clamp(Math.round(settings.godSteps ?? R.godSteps), 1, MAX_GOD_STEPS);
      if (settings.godColor) uniforms.godColor.value.set(settings.godColor);
      uniforms.pondLightLevel.value = surface.getWorldPosition(worldPosition).y;
      const sun = uniforms.uSkySun.value,
        eta = 1 / WATER_IOR;
      uniforms.pondRefractedSun.value.set(-eta * sun.x, -Math.sqrt(1 - eta * eta * (1 - sun.y * sun.y)), -eta * sun.z);
      uniforms.clipRange.value.set(camera.near, camera.far);
      if (settings.impactFoam) uniforms.impactFoam.value.copy(settings.impactFoam);
      if (foamLayer) uniforms.splashFoam.value = THREE.MathUtils.clamp(settings.splashFoam ?? 1, 0, 1);
      if (settings.windWaves) waves.configure(settings.windWaves);
      else
        waves.update(
          settings.waveHeight ?? R.waveHeight,
          settings.wavelength ?? R.wavelength,
          settings.waveDirection ?? R.waveDirection,
          settings.waveSpread ?? R.waveSpread,
        );
      passes.render(settings, sun.y);
    },
    dispose() {
      for (const detach of litMaterials.values()) detach();
      litMaterials.clear();
      scene.remove(surface);
      passes.dispose();
      shadow?.dispose();
      surface.geometry.dispose();
      if (ownsFoam) foamTile.dispose();
      material.dispose();
    },
  };
}
