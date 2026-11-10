import * as THREE from 'three';

// WebAquarium's Boat foam trail controls and texture choices.
export function trailControls(folder, trail, fallbackTexture, assetBase) {
 const {s, sheets} = trail;
 const changed = () => trail.applySettings();
 const files = {'lace (b/w)': 'foam_lace.png', 'soft (grey)': 'foam_soft.png', 'colour foam': 'foam_colour.png',
  'OceanWhitecap (package)': 'OceanWhitecap.png'};
 const settings = {texture: assetBase ? 'lace (b/w)' : 'Generated lace'};
 const textures = new Map([[settings.texture, fallbackTexture]]);
 folder.add(settings, 'texture', assetBase ? Object.keys(files) : ['Generated lace']).name('Breakup texture').onChange(name => {
  if (!textures.has(name)) {
   const tex = new THREE.TextureLoader().load(new URL(files[name], assetBase).href);
   tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
   textures.set(name, tex);
  }
  trail.setFoamTexture(textures.get(name));
 });
 folder.add(s, 'on').name('Enabled').onChange(changed);
 for (const [key, values] of Object.entries({sheet: sheets.SHEET_NAMES, blend: sheets.BLEND_MODES, color: sheets.COLOR_MODES,
  display: ['ocean foam', 'ribbon'], orientation: ['along', 'across']})) folder.add(s, key, values).onChange(changed);
 const ranges = {
  fps: [1,60,1,'FPS'], maskLow: [0,1,.01,'Mask low'], maskHigh: [0,1,.01,'Mask high'], opacity: [0,1,.05,'Opacity'],
  injectStrength: [0,3,.05,'Injection strength'], foamTexGain: [0,1,.05,'Texture breakup'], foamTexTile: [.5,30,.5,'Breakup tile · m'],
  spacing: [.1,3,.05,'Node spacing · m'], width: [.1,6,.05,'Start width · m'], spread: [0,2,.01,'Spread · m/s'], life: [1,60,.5,'Life · s'],
  tileLength: [.5,40,.5,'Tile length · m'], edgeSoftness: [.02,.5,.01,'Edge softness'], lift: [0,.2,.005,'Lift · m'],
  sternOffset: [0,1,.01,'Stern offset · × length'], speedForStart: [0,10,.1,'Start speed'], speedForFull: [0,15,.1,'Full speed'],
 };
 for (const [key, [min,max,step,label]] of Object.entries(ranges)) folder.add(s, key, min, max, step).name(label).onChange(changed);
 folder.add({clear: () => trail.clear()}, 'clear').name('Clear trail');
 return () => { for (const tex of textures.values()) if (tex !== fallbackTexture) tex.dispose(); };
}
