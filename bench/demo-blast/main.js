import {HalfFloatType, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderTarget} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Vec3, World} from 'cannon-es';
import initJolt from 'jolt-physics/wasm';
import joltWasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url';
import {createFixedStep} from '../../src/core/fixed-step.js';
import {createJoltDriver} from '../../src/destruction/index.js';
import {createChips, createPuffs} from '../../src/particles/index.js';
import {createCameraPost, createCameraPostPanel} from '../../src/camera/index.js';
import {createBenchPanel} from '../panel.js';
import {createCraterEffects, CRATER_DUST, CRATER_SHARDS} from '../kit/crater-effects.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop, STATUS_REFRESH_MS} from '../kit/page.js';
import {createBenchWeather, mountWeatherControls} from '../kit/weather.js';
import {createMushroomCloud} from './cloud.js';
import {FIRE_LOOK} from './fire-look.js';
import {mountCloudControls} from './controls.js';
import {createBlastGround} from './ground.js';
import {createBlastGroundShadow} from './ground-shadow.js';
import {createSkirtChunks} from './skirt-chunks.js';
import {createSettlement} from './settlement.js';
import {createShockwave} from './shockwave.js';
import {BLAST_QUALITY, resolveBlastQuality} from './quality.js';
import {BLAST_YIELDS, createBlastScale, resolveBlastYield} from './blast-scale.js';
import {createBrowserPerformance} from '../destruction/browser-performance.js';
import '../../src/camera/panel.css';
import '../bench.css';
import './style.css';

const VIEWS = {
  Overview: {position: [135, 52, 218], target: [0, 68, 0]},
  'Ground level': {position: [71, 10, 140], target: [0, 60, 0]},
  Backlit: {position: [198, 16, -107], target: [0, 69, 0]},
  'Fixed observer · 1 km': {position: [450, 10, 900], target: [0, 180, 0], fixed: true},
};
const FLASH = Object.freeze({gain: 65, exposure: 7, bloom: .8, hold: .1, decay: .25, duration: 1.5, color: 0xfff2b0});
const GRAVITY = 9.82;
const $ = id => document.getElementById(id);

// One order for every transparent object: farther from the eye draws first.
// Distance, unlike view depth, does not change when the camera turns in place.
// The gas shells give their own distance (userData.sortDistance).
function eyeDistanceSort(camera) {
  const eye = camera.matrixWorld.elements;
  const distance = ({object}) => {
    if (object.userData.sortDistance !== undefined) return object.userData.sortDistance;
    const at = object.matrixWorld.elements;
    return Math.hypot(at[12] - eye[12], at[13] - eye[13], at[14] - eye[14]);
  };
  return (a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder
    || distance(b) - distance(a) || a.id - b.id;
}

async function start() {
  const params = new URLSearchParams(location.search);
  const qualityId = resolveBlastQuality(params.get('quality'));
  const quality = BLAST_QUALITY[qualityId];
  const scale = createBlastScale(resolveBlastYield(params.get('yield')));
  const joltReady = initJolt({locateFile: () => joltWasmUrl});
  joltReady.catch(() => {}); // Report through the awaited startup path below.
  $('status').textContent = 'Loading terrain, physics and cloud assets…';
  const renderer = benchRenderer();
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
  renderer.info.autoReset = false;
  const post = createCameraPost(renderer);
  Object.assign(post.settings, {enabled: true, bloom: quality.bloom, contrast: 1.05, vignette: .06});
  const shockwave = createShockwave(renderer, scale);
  const weatherFrame = new WebGLRenderTarget(1, 1, {type: HalfFloatType, depthBuffer: true});
  const frameSize = new Vector2();
  const scene = new Scene(), camera = new PerspectiveCamera(48, innerWidth / innerHeight, .4, Math.max(1400*scale.length,scale.cloud.top*8));
  renderer.setTransparentSort(eyeDistanceSort(camera));
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.minDistance = 16;
  orbit.maxDistance = Math.max(430*scale.length,scale.cloud.top*3);
  orbit.maxPolarAngle = Math.PI * .62;
  function view(name) {
    camera.position.fromArray(VIEWS[name].position);
    orbit.target.fromArray(VIEWS[name].target);
    if (!VIEWS[name].fixed) {
      camera.position.multiplyScalar(scale.length);
      orbit.target.multiplyScalar(scale.length);
    }
    orbit.update();
  }
  view('Overview');
  const weather = await createBenchWeather({scene, renderer, camera, lightTarget: new Vector3(), initial: 'cloudy 1', hour: 16, precipitation: false});
  weather.view.configure({
    sky: {captureInterval: quality.skyCapture},
    appearance: {
      sunShafts: quality.shafts, shaftStrength: 1.25, shaftRays: 1.45, shaftRayGlare: 1.2,
      heightFog: quality.fog, bankDensity: .002, rainbow: qualityId !== 'low',
    },
  });
  const {environment, sun, hemi} = weather.view;
  const fireLook = {...FIRE_LOOK};
  fireLook.cloudMotion=params.get('motion')==='accepted'?'accepted':'shared';
  const cloudReady = createMushroomCloud(scene, {environment, fireLook, quality, size: scale.length, scale});
  const dustReady = createPuffs(scene, {environment, pool: CRATER_DUST.pool});
  cloudReady.catch(() => {}); dustReady.catch(() => {});
  const physics = new World({gravity: new Vec3(0, -GRAVITY, 0), allowSleep: true});
  const driver = createJoltDriver(await joltReady);
  driver.attach(physics);
  const stepper = createFixedStep({step: driver.rigidStep});
  const ground = await createBlastGround({scene, renderer, physics, driver, scale});
  const heightAt = ground.field.heightAt;
  const center = new Vector3(0, heightAt(0, 0), 0);
  const [cloud, dust] = await Promise.all([cloudReady, dustReady]);
  const groundShadow=createBlastGroundShadow(renderer,cloud.shadowField,ground.material,ground.field.bounds,fireLook,qualityId==='high'?256:128);
  const skirtChunks=await createSkirtChunks(scene,{environment,size:scale.length,seconds:scale.seconds,heightAt});
  const chips = createChips(scene, {pool: CRATER_SHARDS.max});
  chips.setGround(heightAt);
  const crater = createCraterEffects({chips, puffs: dust, heightAt});
  const unsubscribe = ground.field.subscribe(event => {
    if(!ground.emitCraterDebris)return;
    crater.throwDust(event, event.height);
    crater.throwShards({...event,depth:scale.crater.depth}, event.height);
  });
  const settlement = createSettlement({scene, heightAt, center, physics, dust, scale});

  let time = 0, played = false, lastStatus = -Infinity;
  function status() {
    const late=cloud.diagnostics.late;
    const height=late?`\nCloud top ≈ ${Math.round(late.height+late.radius)} m · reference ${cloud.settings.visibility.top} m`:'';
    const clock=time<60?`${time.toFixed(1)} s`:`${Math.floor(time/60)}m ${Math.floor(time%60)}s`;
    $('status').textContent = `${scale.yieldKt} kt · ${clock} · camera ${Math.round(camera.position.distanceTo(center))} m\n${cloud.phase}${height}\n${settlement.damaged}/${settlement.total} buildings damaged · ${settlement.bodyCount} Jolt bodies · ${cloud.active + dust.active} puffs`;
  }
  function reset() {
    settlement.reset();
    ground.reset();
    stepper.reset();
    cloud.clear(); dust.clear(); chips.clear();skirtChunks.clear();
    played = false;
    time = 0;
    status();
  }
  function play() {
    reset();
    played = true;
    cloud.start(center);
    status();
  }
  const gui = createBenchPanel('Desert Blast');
  const state = {view: 'Overview', quality: qualityId, yield: scale.yieldKt, speed: 1, track: true,
    stableHeight: fireLook.ceiling * scale.length, shockwave: true, skirtChunks:true, weatherAir:true, play, reset};
  gui.add(state, 'yield', Object.fromEntries(Object.entries(BLAST_YIELDS).map(([id,label]) => [label, Number(id)])))
    .name('Yield (restarts scene)').onChange(id => {
      const url = new URL(location.href); url.searchParams.set('yield', id); location.assign(url.href);
    });
  gui.add(state, 'quality', Object.fromEntries(Object.entries(BLAST_QUALITY).map(([id, tier]) => [tier.label, id])))
    .name('Quality (restarts scene)').onChange(id => {
      const url = new URL(location.href);
      url.searchParams.set('quality', id);
      location.assign(url.href);
    });
  gui.add(state, 'play').name('Play blast');
  gui.add(state, 'reset').name('Reset scene');
  gui.add(state, 'speed', [.25,1,2,4,10,30,60]).name('Playback ×');
  gui.add(state, 'track').name('Frame rising cloud').listen();
  gui.add(state, 'view', Object.keys(VIEWS)).name('View').onChange(name => {state.track=name==='Overview';view(name);});
  orbit.addEventListener('start', () => {state.track=false;});
  gui.add(state, 'shockwave').name('Shock wave');
  gui.add(state,'skirtChunks').name('Skirt chunks').onChange(enabled=>{if(!enabled)skirtChunks.clear();});
  gui.add(state,'weatherAir').name('Weather air pass');
  const fire = gui.addFolder('Fireball').close();
  fire.add(fireLook,'cloudMotion',{'Accepted motion':'accepted','Shared solver · trial':'shared'})
    .name('Cloud motion (restarts blast)').onChange(value=>{
      const url=new URL(location.href);url.searchParams.set('motion',value);
      history.replaceState(null,'',url);view(state.view);play();
    });
  fire.add(fireLook, 'fuel', .2, 1.5, .05).name('Fuel (next blast)');
  fire.add(fireLook, 'drag', 0, 3, .05).name('Drag');
  fire.add(fireLook, 'headFriction', 0, 1.5, .05).name('Head friction');
  fire.add(fireLook, 'viscosity', 0, .24, .01).name('Viscosity');
  fire.add(fireLook, 'glow', 0, 2, .05).name('Glow');
  fire.add(fireLook, 'density', .5, 4, .05).name('Density');
  fire.add(fireLook, 'coreDensity', 1, 4, .1).name('Ball core density');
  fire.add(fireLook, 'selfShadow', 0, 1, .05).name('Cloud self shadow');
  fire.add(fireLook, 'lightScatter', 0, 1, .05).name('Ball light scatter');
  fire.add(fireLook, 'groundShadow', 0, 1, .05).name('Ground cloud shadow');
  fire.add(fireLook, 'light', 0, 4, .05).name('Inner light');
  fire.add(fireLook, 'riseSpeed', .3, 1.3, .05).name('Buoyant rise ×');
  fire.add(state, 'stableHeight', 55 * scale.length, 150 * scale.length, 1)
    .name('Early stable layer · m').onChange(value => { fireLook.ceiling = value / scale.length; });
  mountCloudControls(gui,{settings:cloud.settings,scale,restart:()=>{view(state.view);play();}});
  const weatherUI = mountWeatherControls(weather);
  const postUI = createCameraPostPanel({post, parent: document.querySelector('aside')});
  const resize = bindResize(renderer, camera);
  const performanceUI = createBrowserPerformance({
    renderer,
    readState: () => ({quality: qualityId, puffs: cloud.active, bodies: settlement.bodyCount, fluid: quality.fluid}),
  });
  status();
  const cameraOffset = new Vector3(), desiredTarget = new Vector3();
  function frameCloud(dt) {
    const late=cloud.diagnostics.late;
    if (!late || !state.track) return;
    const top=late.height+late.radius;
    const stem=late.columnOpacity;
    const share=1-.5*stem;
    desiredTarget.set(center.x+(late.wind[0]+late.offset[0]*late.expansion)*scale.length*share,
      center.y+(late.height*(1-stem)+top*.5*stem),center.z+(late.wind[1]+late.offset[1]*late.expansion)*scale.length*share);
    cameraOffset.copy(camera.position).sub(orbit.target);
    const height=2*late.radius*(1-stem)+top*stem;
    const distance=height/(2*Math.tan(camera.fov*Math.PI/360))*1.6;
    cameraOffset.setLength(distance);
    const follow=1-Math.exp(-dt/.7);
    orbit.target.lerp(desiredTarget,follow);
    camera.position.lerp(cameraOffset.add(orbit.target),follow);
    orbit.update();
  }
  function update(dt) {
    if (!played) return;
    time += dt;
    ground.advanceCrater(center.x,center.z,time);
    settlement.advance(time);
    if (settlement.simulating) {
      stepper.advance(dt, step => physics.step(step));
      settlement.sync();
    }
    cloud.update(dt / scale.seconds);
    skirtChunks.update(dt,time/scale.seconds,state.skirtChunks?(out,index)=>cloud.sampleSkirtEdge(out,index):null);
    dust.update(dt);
    chips.update(dt);
  }
  const flashSunColor=sun.color.clone(), flashHemiColor=hemi.color.clone();
  function render(dt = 0) {
    // Reuse the scene's lights for the exposure pulse. Adding a new light here would
    // change the shader variant on every lit material at the start of the shot.
    const sunIntensity = sun.intensity, hemiIntensity = hemi.intensity;
    const exposure=post.settings.exposure, bloom=post.settings.bloom;
    flashSunColor.copy(sun.color);flashHemiColor.copy(hemi.color);
    if (played && time < FLASH.duration) {
      const tail=1-time/FLASH.duration;
      const pulse = Math.exp(-Math.max(0,time-FLASH.hold)/FLASH.decay)*tail*tail;
      const gain = 1 + FLASH.gain * pulse;
      sun.intensity *= gain;
      hemi.intensity *= gain;
      sun.color.setHex(FLASH.color).lerp(flashSunColor,1-pulse);
      hemi.color.setHex(FLASH.color).lerp(flashHemiColor,1-pulse);
      post.settings.exposure=exposure*(1+FLASH.exposure*pulse);
      post.settings.bloom=bloom+FLASH.bloom*pulse;
    }
    try {
      cloud.sort(camera);
      groundShadow.render();
      renderer.getDrawingBufferSize(frameSize);
      if (weatherFrame.width !== frameSize.x || weatherFrame.height !== frameSize.y) {
        weatherFrame.setSize(frameSize.x, frameSize.y);
      }
      if(state.weatherAir)weather.view.render({output: weatherFrame});
      else {
        const previous=renderer.getRenderTarget();
        try{renderer.setRenderTarget(weatherFrame);renderer.render(scene,camera);}
        finally{renderer.setRenderTarget(previous);}
      }
      const color = shockwave.render(weatherFrame.texture, camera, center, time, played && state.shockwave);
      post.render(scene, camera, dt, {color});
    }
    finally {
      sun.intensity = sunIntensity; hemi.intensity = hemiIntensity;
      sun.color.copy(flashSunColor);hemi.color.copy(flashHemiColor);
      post.settings.exposure=exposure;post.settings.bloom=bloom;
    }
  }
  startFrameLoop(renderer, (dt, now) => {
    renderer.info.reset();
    performanceUI?.beginFrame(now);
    orbit.update();
    weather.system.update(dt);
    weather.view.update(dt);
    // Bound each integration step when playback is accelerated; neither solver
    // should silently drop its fixed-step backlog while the visual clock advances.
    const elapsed = dt * state.speed;
    // Keep late anchoring, parcel guidance and camera targets on bounded steps
    // too; one accelerated frame must not become one large handoff/map jump.
    const steps=Math.max(1,Math.ceil(elapsed*(cloud.diagnostics.late?30:60)));
    for(let i=0;i<steps;i++)update(elapsed/steps);
    frameCloud(dt);
    weatherUI.sync();
    performanceUI?.beforeRender();
    render(dt);
    performanceUI?.afterRender(now);
    if (now - lastStatus >= STATUS_REFRESH_MS) { lastStatus = now; status(); }
  });
  onLeave(() => {
    renderer.setAnimationLoop(null);
    resize(); unsubscribe();
    groundShadow.dispose();settlement.dispose(); ground.dispose(); driver.dispose();
    skirtChunks.dispose();cloud.dispose(); dust.dispose(); chips.dispose();
    orbit.dispose(); gui.destroy(); performanceUI?.dispose(); postUI.dispose(); post.dispose(); shockwave.dispose(); weatherFrame.dispose();
    weatherUI.dispose(); weather.view.dispose(); renderer.dispose();
  });
  document.body.dataset.ready = 'true';
  window.blastDemo = {scene, camera, renderer, post, quality: qualityId, performance: performanceUI,
    field: ground.field, settlement, cloud, scale, weather, play, reset, orbit, update, render, get time() { return time; }};
}

start().catch(error => {
  $('error').hidden = false;
  $('error').textContent = String(error);
  console.error(error);
});
