import {createOceanSheets} from './ocean-sheets.js';
import {createOceanSprites} from './ocean-sprites.js';
import {createOceanSplash} from './ocean-splash.js';
import {SOFT_DISC} from './ocean-sheets.js';

// Airborne water effects (mist sprites + ballistic droplets). The caller schedules the target scene after its composite.
// assets: {assetBaseUrl, sheets, dropletUrl, loadTexture} — all optional; without them the generated soft disc is used.
export function createWaterSpray({
 THREE, scene, renderer, depth, surface, lighting, onDeposit = null, assets = {},
}) {
 if (!THREE || !scene || !renderer || !depth || !surface || !lighting) {
  throw Error('Water spray needs Three.js, a target scene, renderer, depth, surface and lighting bindings');
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
  sheet: mistSheet, free: true, upright: true,
  size: .9, growth: .7, life: .8, rise: .55, opacity: .42,
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
  update(dt) {
   if (disposed) return;
   if (!Number.isFinite(dt) || dt < 0) throw Error('Water spray dt must be finite and non-negative');
   depth.update();
   mist.update(dt);
   splash.updateSplash(dt);
   splash.depositFoam(null);
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
