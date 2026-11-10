import {coastControls} from '../terrain/controls.js';
import {oceanControls} from '../ocean/controls.js';
import {trailControls} from './trail-controls.js';

// Demo panels around the shared ocean ones: boat, floating block, motes and coast.
export function oceanDemoControls(gui, {boatSettings, launchBoat, applyBoatSettings, trail, ocean, sheetBase, float, camera, controls, rippleGesture, motes, coast, weather, bundled}) {
  const boatFolder = gui.addFolder('Boat');
  boatFolder.add({launchBoat}, 'launchBoat').name('Launch motorboat');
  boatFolder.add(boatSettings, 'drive').name('Cruise forward');
  boatFolder.add(boatSettings, 'follow').name('Follow boat');
  boatFolder.add(boatSettings, 'excludeHulls').name('Keep cockpit dry');
  boatFolder.add(boatSettings, 'wakeMode', ['footprint', 'drops']).name('Hull wake');
  const buoyControls = boatFolder.addFolder('Buoyancy').close();
  const driveControls = boatFolder.addFolder('Speed & steering').close();
  for (const [folder, ranges] of [[buoyControls, {
   buoyancy: [0,6,.05,'Float strength'], waterLinearDamping: [0,8,.05,'Linear damping'], waterAngularDamping: [0,8,.05,'Angular damping'],
   floatRadiusScale: [.5,3,.05,'Float radius'], waveDriftStrength: [0,4,.05,'Wave drift'], verticalSettleDamping: [0,4,.05,'Vertical settle'],
   surfaceGlueIntensity: [0,4,.05,'Surface glue'], maxBuoyancyForce: [0,60,.5,'Maximum lift'],
  }], [driveControls, {
   enginePower: [0,30,.5,'Engine power'], reverseCoefficient: [0,1,.05,'Reverse'], turnAcceleration: [0,10,.1,'Turn acceleration'],
   fullAuthoritySpeed: [.5,10,.1,'Full rudder · m/s'], forwardDrag: [0,.5,.005,'Forward drag'], lateralDrag: [0,3,.05,'Lateral drag'],
   yawDamping: [0,10,.1,'Yaw damping'], propellerDepth: [.05,2,.05,'Propeller depth'], hullDepth: [.05,2,.05,'Hull depth'],
  }]]) for (const [key, [min,max,step,label]] of Object.entries(ranges)) folder.add(boatSettings, key, min, max, step).name(label).onChange(applyBoatSettings);
  buoyControls.add(boatSettings, 'surfaceRelativeDrag').name('Surface-relative drag').onChange(applyBoatSettings);
  const disposeTrailTextures = trailControls(boatFolder.addFolder('Boat foam trail').close(), trail, ocean.uniforms.tWhitecap.value, sheetBase);
  const {settings: s, view, orbitPosition, sea, optics} = oceanControls(gui, {ocean, camera, controls, rippleGesture, bundled,
    onHeading: heading => { weather.system.weather.windHeading = heading; }});
  sea.add({drop: () => float.drop(camera)}, 'drop').name('Drop floating block');
  sea.add({mode: 'sphere'}, 'mode', ['sphere', 'footprint']).name('Block wake mode').onChange(mode => float.setMode(mode));
  optics.add(motes.s, 'on').name('Suspended particles');
  coastControls(gui, coast, ocean.caustics);
  return {settings: s, view, orbitPosition, disposeTrailTextures};
}
