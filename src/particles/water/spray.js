import {createOceanSheets, SOFT_DISC} from './ocean-sheets.js';
import {createOceanSprites} from './ocean-sprites.js';
import {createOceanSplash} from './ocean-splash.js';

// Airborne water effects (mist sprites + ballistic droplets). The caller schedules the target scene after its composite.
// assets: {assetBaseUrl, sheets, dropletUrl, loadTexture} — all optional; without them the generated soft disc is used.
// lighting: {uniforms: {uSunCol, uFxAmbient}, direction, ambient} - optional; without it the spray owns a clear-noon set
// that setEnvironment() (core/environment.js contract) keeps in step with the scene light.
const SPRAY_SUN = [1, .96, .9], SPRAY_AMBIENT = [.35, .45, .55], SPRAY_SUN_DIRECTION = [.3, .8, .5];
export function createWaterSpray({
 THREE, scene, renderer, depth, surface, lighting, onDeposit = null, assets = {},
}) {
 if (!THREE || !scene || !renderer || !depth || !surface) {
  throw Error('Water spray needs Three.js, a target scene, renderer, depth and surface bindings');
 }
 const ownsLighting = !lighting;
 if (ownsLighting) {
  const ambient = new THREE.Color(...SPRAY_AMBIENT);
  lighting = {uniforms: {uSunCol: {value: new THREE.Color(...SPRAY_SUN)}, uFxAmbient: {value: ambient}},
   direction: new THREE.Vector3(...SPRAY_SUN_DIRECTION).normalize(), ambient};
 }
 const sheets = createOceanSheets({THREE, assetBaseUrl: assets.assetBaseUrl, sheets: assets.sheets, loadTexture: assets.loadTexture});
 const mistSheet = sheets.SHEETS['mist (8x8)'] ? 'mist (8x8)' : SOFT_DISC;
 const host = {
  THREE, fxScene: scene,
  FX_DEPTH_GLSL: depth.glsl, FX_DEPTH_U: depth.uniforms,
  SURFACE_HEIGHT_GLSL: surface.glsl, surfaceHeightUniforms: () => surface.uniforms,
 };
 const {SheetSprites} = createOceanSprites({...host, ...sheets});
 const mist = new SheetSprites(lighting.uniforms, lighting.direction, {
  sheet: mistSheet, free: true, upright: true, billow: true,
  size: .9, growth: .85, life: 1.05, rise: .48, opacity: .42,
 });
 const splash = createOceanSplash({...host, renderer, ...sheets, dropletUrl: assets.dropletUrl, loadTexture: assets.loadTexture, onDeposit});
 splash.initSplash(lighting.uniforms, lighting.ambient, lighting.direction);
 splash.setSplashSettings({sprite: 'droplet', dropletSize: .055, opacity: .7});
 let disposed = false;
 return {
  meshes: [mist.mesh, splash.mesh],
  mist(position, intensity = 1, size = 1) {
   if (!disposed) mist.spawn(position.x, position.z, intensity, size, position.y);
  },
  splash(position, strength = .6, radius = .2) {
   if (!disposed) splash.emitSplash(position.x, position.y, position.z, strength, radius);
  },
  emitSplash(...args) {
   if (!disposed) splash.emitSplash(...args);
  },
  // Follow a shared environment. Only applies to the spray's own lighting: a host that passed `lighting` drives it itself.
  setEnvironment(environment) {
   if (disposed || !ownsLighting || !environment) return;
   lighting.uniforms.uSunCol.value.setRGB(...SPRAY_SUN).multiply(environment.light);
   lighting.uniforms.uFxAmbient.value.setRGB(...SPRAY_AMBIENT).multiply(environment.light);
   lighting.direction.copy(environment.sun.direction);
  },
  update(dt, simWindow = null) {
   if (disposed) return;
   if (!Number.isFinite(dt) || dt < 0) throw Error('Water spray dt must be finite and non-negative');
   depth.update();
   mist.update(dt);
   splash.updateSplash(dt);
   splash.depositFoam(simWindow);
  },
  get active() { return {mist: mist.active, droplets: splash.splashStats().droplets}; },
  clear() { mist.clear(); splash.clear(); },
  dispose() {
   if (disposed) return;
   disposed = true;
   mist.dispose();
   splash.dispose();
   sheets.dispose();
  },
  sheets,
 };
}
