import * as THREE from 'three';
import {DynamicSky,DYNAMIC_SKY_DEFAULTS,CLOUD_QUALITY} from './dynamic-sky.js';
import {createSkyUniforms,createSkyDome,skyDefines} from './sky-dome.js';
import {createPrecipitation} from './precipitation.js';
import {createWindStreaks,createWindDebris} from '../../particles/wind.js';
import {createSunScattering} from './sun-scattering.js';
import {createLightning} from './lightning.js';
import {createCloudShadows} from './cloud-shadows.js';
import {resolveVisualConfig,APPEARANCE_DEFAULTS} from './settings.js';
import {createEnvironment,setEnvironmentWind} from '../../core/environment.js';
import {assertFrameTime} from '../../core/validate.js';
import {createRenderScope} from '../../core/render-state.js';
export {SKY_FIELDS,APPEARANCE_FIELDS,PRECIPITATION_FIELDS,resolveVisualConfig} from './settings.js';

export {DYNAMIC_SKY_DEFAULTS,CLOUD_QUALITY};

const SKY_DOME_RADIUS=100,SUN_DISTANCE=100;   // m: dome drawn at the far plane; light placed this far up the light direction
// Sky preset for the static paths (core/sky.js uSky): night below nightDaylight, overcast below overcastSunlight, else clear.
const SKY_PRESET=Object.freeze({clear:0,overcast:2,night:3,nightDaylight:.05,overcastSunlight:.3});
// Light levels: the sky's sun colour never drops under minDaylight; ambient sky = skyAmbient x the night-to-day tint; the moon
// lights at moonShare of the night light; hemisphere = (base + sunGain x sunlight) x the night-to-day level.
const LIGHT=Object.freeze({minDaylight:.02,skyAmbient:.3,moonShare:.55,ambientBase:.3,ambientSunGain:.7});
const VISIBILITY_TRANSMITTANCE=.02;   // exponential fog keeps 2 % of the light at the weather's visibility distance
// Fog bank: density x min(max, base + bank). Its billows churn at churn[0] + churn[1] x wind (m/s) times real time.
// Its colour leans sunShare of the way from the ambient sky toward the sun tint, so banks warm up at dusk.
const BANK=Object.freeze({base:.55,max:2,churn:[.6,.07],sunShare:.35});
// Rainbow: the air stays wet for drySeconds after the rain; the bow fades in over these wetness and sunlight ranges,
// and the second bow is secondShare as bright as the primary.
const RAINBOW=Object.freeze({drySeconds:90,wetness:[.03,.35],sunlight:[.25,.7],secondShare:.3});
const SHAFT_MIN_SUN=.01;              // sun direction y: below this no sun shafts or bank glow
// Lightning: automatic flashes above stormFrom storm weight, distance [min, span] m, interval x [min, span], flash seconds;
// a strike starts strikeAbove m over the hit or cloudShare into the cloud layer; the bolt strength is divided by boltScale.
const LIGHTNING=Object.freeze({stormFrom:.55,distance:[1200,900],interval:[.65,.7],flashSeconds:.18,strikeAbove:30,cloudShare:.4,boltScale:3});
const NOON=12;   // placeholder hour until the first update

// Host owns the render loop and simulation. This binding only consumes their data.
// resolveLightningHit(x, z) may return a world-space point for a scheduled flash.
export function createThreeWeather({system,scene,renderer,camera,sun,hemi,lightTarget,assetBaseUrl,sky={},appearance={},fog=true,fogColor=APPEARANCE_DEFAULTS.fogColor,visibilityScale=1,precipitation={},environment,fetch,loadTexture,resolveLightningHit}={}){
 if(!system?.weather||!system?.day||!scene||!renderer||!camera)throw Error('Three weather needs system, scene, renderer and camera');
 if(!Number.isFinite(visibilityScale)||visibilityScale<=0)throw Error('visibilityScale must be positive');
 const initial=resolveVisualConfig({sky,appearance:{fog,fogColor,visibilityScale,...(sun?{sunColor:'#'+sun.color.getHexString(),sunIntensity:sun.intensity}:{}),...(hemi?{hemiColor:'#'+hemi.color.getHexString(),groundColor:'#'+hemi.groundColor.getHexString(),hemiIntensity:hemi.intensity}:{}),...appearance},precipitation});
 const settings=initial.sky,look=initial.appearance;
 let precipitationConfig=initial.precipitation;
 const assets=assetBaseUrl?new URL(assetBaseUrl,globalThis.location?.href??import.meta.url).href:undefined;
 const saved={background:scene.background,environment:scene.environment,fog:scene.fog},group=new THREE.Group();group.name='Weather';scene.add(group);scene.background=null;
 const ownsSun=!sun,ownsHemi=!hemi;const D=APPEARANCE_DEFAULTS;sun??=new THREE.DirectionalLight(D.sunColor,D.sunIntensity);hemi??=new THREE.HemisphereLight(D.hemiColor,D.groundColor,D.hemiIntensity);
 if(ownsSun){scene.add(sun,sun.target);}if(ownsHemi)scene.add(hemi);
 const lightState=light=>({color:light.color.clone(),intensity:light.intensity,position:light.position.clone()});
 const sunState={...lightState(sun),target:sun.target.position.clone()},hemiState={...lightState(hemi),ground:hemi.groundColor.clone()};
 const sunDir=new THREE.Vector3(),worldPosition=new THREE.Vector3(),lightDirection=new THREE.Vector3(),lightTint=new THREE.Color(),nightColor=new THREE.Color(),white=new THREE.Color(1,1,1),sunTint=new THREE.Color();
 const uniforms=createSkyUniforms(sunDir),dome=createSkyDome(uniforms,{radius:SKY_DOME_RADIUS,defines:skyDefines({dynamic:true,celestial:true}),atFarPlane:true});group.add(dome);
 const fogObject=new THREE.FogExp2();if(look.fog)scene.fog=fogObject;
 let ownedEnvironment=null,disposed=false;
 // Shared contract (core/environment.js) the other modules may read; refreshed by update(). wind.gust is left to the host.
 const shared=createEnvironment();
 const defaultEnvironment={active:false,setDynamic(texture){ownedEnvironment=texture;scene.environment=texture;this.active=true;},setBlend(){},clear(){if(scene.environment===ownedEnvironment)scene.environment=saved.environment;ownedEnvironment=null;this.active=false;}};
 const dynamic=new DynamicSky(settings,uniforms,{renderer,camera:{position:worldPosition},environment:environment??defaultEnvironment,assetBaseUrl:assets,fetch,loadTexture});
 const cloudShadows=createCloudShadows(dynamic.cloudUniforms);
 let scattering,coverUsed=false;
 const bankOffset=new THREE.Vector2(),bankSettings=new THREE.Vector4(),bankShape=new THREE.Vector4(),shaftHaze=new THREE.Vector4(),bankColor=new THREE.Color(),bankAmbient=new THREE.Color();
 const wakeHead=new THREE.Vector4(),wakeTail=new THREE.Vector3();
 let bankTime=0,airWetness=0;
 const rainbowBows=new THREE.Vector2();
 // Strength of the primary bow: wet air, direct sun, daytime.
 function rainbowAmount(){
  if(!look.rainbow||sunDir.y<=SHAFT_MIN_SUN||system.day.moonLit)return 0;
  const {smoothstep}=THREE.MathUtils;
  return look.rainbowStrength*smoothstep(airWetness,...RAINBOW.wetness)*smoothstep(system.weather.sunlight,...RAINBOW.sunlight)*system.day.daylight;
 }
 let rain=precipitationConfig===false?null:createPrecipitation(group,precipitationConfig);
 let windStreaks=null,windDebris=null;
 // Each wind effect exists only while its setting is ticked.
 function syncWindEffect(effect,enabled,create){
  if(enabled)return effect??create({THREE,group});
  effect?.dispose();return null;
 }
 const updateScope=createRenderScope(renderer,{clearColor:false,scissorOff:false});   // the sky captures put the host's target, viewport and scissor back
 const bridge={s:{on:true,auto:false,hour:NOON},daylight:1,moonDir:new THREE.Vector3(),moonPhase:.5};
 const reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
 const flashPosition=new THREE.Vector2();
 let untilFlash=1,flashRemaining=0,flashStrength=0;
 let bolt,pendingHit,groundStrike=false;
 const strikeStart=new THREE.Vector3(),strikeHit=new THREE.Vector3();
 const finitePoint=point=>[point?.x,point?.y,point?.z].every(Number.isFinite);
 function startStrike(hit){
  const point=new THREE.Vector3(hit.x,hit.y,hit.z);
  strikeHit.copy(point);
  const weather=system.weather;
  const thickness=settings.thickness*(weather.on?weather.cloudProfile[2]:1);
  strikeStart.set(point.x,Math.max(point.y+LIGHTNING.strikeAbove,settings.bottom+thickness*LIGHTNING.cloudShare),point.z);
  bolt??=createLightning(group);
  bolt.strike(strikeStart,point);
  flashPosition.set(strikeStart.x,strikeStart.z);
  flashRemaining=LIGHTNING.flashSeconds;
  groundStrike=true;
 }
 const view={group,settings,uniforms,sun,hemi,environment:shared,sky:dynamic,ready:dynamic.readyPromise,get precipitationCount(){return rain?.instanceCount??0;},
  get lightningFlash(){return flashStrength;},
  // Copies the active ground hit into a caller-owned vector. Distant sky flashes have no ground hit.
  getLightningHit(target){return groundStrike&&flashStrength>0?target.copy(strikeHit):undefined;},
  // The clouds as a sun cover (core/lighting.js): createLighting({sun:[...,view.sunCover]}) shades the hook's materials
  // under them, createVolumetricLight({sun:[...,view.sunCover]}) cuts the sun's shafts with them.
  get sunCover(){
   if(disposed)throw Error('Weather view is disposed');
   scattering??=createSunScattering(dynamic.cloudUniforms,sunDir);coverUsed=true;
   return scattering.cover;
  },
  addCloudShadowReceiver(material){
   if(disposed)throw Error('Weather view is disposed');
   return cloudShadows.add(material);
  },
  strikeLightning(point){
   if(!finitePoint(point))throw Error('Lightning needs a finite world-space hit point');
   if(disposed||system.paused||reducedMotion?.matches||settings.lightningStrength===0)return false;
   pendingHit=new THREE.Vector3(point.x,point.y,point.z);
   return true;
  },
  // The host supplies the moving head and trailing endpoint in world space.
  setFogWake(head,tail,radius=0){
   if(disposed)return;
   if(radius===0){wakeHead.w=0;return;}
   if(!finitePoint(head)||!finitePoint(tail)||!Number.isFinite(radius)||radius<0)throw Error('Fog wake needs finite world-space endpoints and a positive radius');
   wakeHead.set(head.x,head.y,head.z,radius);
   wakeTail.copy(tail);
  },
  getConfig(){return structuredClone({sky:settings,appearance:look,precipitation:precipitationConfig});},
  configure(values={}){
   if(disposed)throw Error('Weather view is disposed');
   const next=resolveVisualConfig(values,view.getConfig());
   if(JSON.stringify(next.precipitation)!==JSON.stringify(precipitationConfig)){
    const replacement=next.precipitation===false?null:createPrecipitation(group,next.precipitation);
    rain?.dispose();rain=replacement;precipitationConfig=next.precipitation;
   }
   Object.assign(settings,next.sky);Object.assign(look,next.appearance);
   scene.fog=look.fog?fogObject:saved.fog;dynamic.key=null;return view;
  },
  update(dt){
   if(disposed)return;assertFrameTime(dt,'Visual weather');dt=system.paused?0:dt;
   const w=system.weather,d=system.day;camera.getWorldPosition(worldPosition);sunDir.copy(d.sunDir);nightColor.set(d.settings.nightColor);sunTint.setRGB(d.sunTint.r,d.sunTint.g,d.sunTint.b);
   bridge.s.auto=d.settings.auto;bridge.s.hour=d.hour;bridge.daylight=d.daylight;bridge.moonDir.copy(d.moonDir);bridge.moonPhase=d.moonPhase;
   uniforms.uNightBlend.value=d.night;uniforms.uDaylight.value=d.daylight;uniforms.uSkySunDir.value.copy(sunDir);uniforms.uSky.value=d.daylight<SKY_PRESET.nightDaylight?SKY_PRESET.night:w.sunlight<SKY_PRESET.overcastSunlight?SKY_PRESET.overcast:SKY_PRESET.clear;
   const auroraHeading=THREE.MathUtils.degToRad(settings.auroraHeading);
   uniforms.uAuroraDirection.value.set(Math.cos(auroraHeading),Math.sin(auroraHeading));
   uniforms.uAuroraIntensity.value=settings.aurora?settings.auroraIntensity:0;
   if(settings.aurora&&!reducedMotion?.matches)uniforms.uAuroraTime.value+=dt*settings.auroraSpeed;
   uniforms.uSunCol.value.copy(sunTint).multiplyScalar(w.sunlight*Math.max(LIGHT.minDaylight,d.daylight));uniforms.uAmb.value.copy(nightColor).lerp(white,d.daylight).multiplyScalar(LIGHT.skyAmbient);
   dome.position.copy(worldPosition);
   sun.color.set(look.sunColor).multiply(d.moonLit?nightColor:sunTint);sun.intensity=look.sunIntensity*(d.moonLit?d.settings.nightLight*LIGHT.moonShare:w.sunlight*d.daylight);
   sun.target.position.copy(lightTarget??worldPosition);sun.position.copy(sun.target.position).addScaledVector(lightDirection.copy(d.lightDir),SUN_DISTANCE);lightTint.copy(nightColor).lerp(white,d.daylight);
   hemi.color.set(look.hemiColor).multiply(lightTint);hemi.groundColor.set(look.groundColor).multiply(lightTint);
   const ambientLight=(LIGHT.ambientBase+LIGHT.ambientSunGain*w.sunlight)*(d.settings.nightLight+(1-d.settings.nightLight)*d.daylight);
   hemi.intensity=look.hemiIntensity*ambientLight;
   fogObject.color.set(look.fogColor).multiply(lightTint).multiplyScalar(ambientLight);
   setEnvironmentWind(shared,w.wind,w.windHeading);shared.sun.direction.copy(lightDirection);shared.sun.color.copy(sun.color).multiplyScalar(sun.intensity);
   shared.ambient.sky.copy(hemi.color).multiplyScalar(hemi.intensity);shared.ambient.ground.copy(hemi.groundColor).multiplyScalar(hemi.intensity);
   shared.light.copy(lightTint).multiplyScalar(ambientLight);shared.daylight=d.daylight;shared.rain=w.rain;shared.snow=w.snow;
   if(look.fog)fogObject.density=Math.sqrt(-Math.log(VISIBILITY_TRANSMITTANCE))*w.density/(w.visibility*look.visibilityScale);
   if(look.heightFog){
    bankTime+=dt*(BANK.churn[0]+BANK.churn[1]*w.wind);
    const heading=THREE.MathUtils.degToRad(w.windHeading),drift=w.wind*dt*look.bankDrift;
    // The sky lights the bank: its ambient colour, warmed by the sun tint, at the fog's own brightness.
    bankAmbient.copy(hemi.color).lerp(sunTint,BANK.sunShare*d.daylight).multiplyScalar(ambientLight);
    bankColor.copy(fogObject.color).lerp(bankAmbient,look.bankAmbientTint);
    bankOffset.x+=Math.cos(heading)*drift;bankOffset.y+=Math.sin(heading)*drift;
   }
   airWetness=Math.max(Math.min(1,w.rain),airWetness-dt/RAINBOW.drySeconds);
   rain?.update(dt,shared,worldPosition);
   windStreaks=syncWindEffect(windStreaks,look.windStreaks,createWindStreaks);windStreaks?.update(dt,shared,worldPosition,look.windStreakAmount);
   windDebris=syncWindEffect(windDebris,look.windDebris,createWindDebris);windDebris?.update(dt,shared,worldPosition,look.windDebrisAmount);
   const stormWeight=w.weights[w.names.indexOf('stormy')]??0;
   flashRemaining=Math.max(0,flashRemaining-dt);
   const lightningEnabled=settings.lightningStrength>0&&!reducedMotion?.matches;
   const automatic=w.on&&stormWeight>=LIGHTNING.stormFrom&&settings.clouds&&lightningEnabled;
   if(pendingHit&&lightningEnabled){
    startStrike(pendingHit);
   }else if(automatic){
    untilFlash-=dt;
    if(untilFlash<=0&&flashRemaining===0){
     const angle=Math.random()*Math.PI*2,distance=LIGHTNING.distance[0]+Math.random()*LIGHTNING.distance[1];
     flashPosition.set(worldPosition.x+Math.cos(angle)*distance,worldPosition.z+Math.sin(angle)*distance);
     const hit=resolveLightningHit?.(flashPosition.x,flashPosition.y);
     groundStrike=false;
     flashRemaining=LIGHTNING.flashSeconds;
     if(finitePoint(hit))startStrike(hit);
     untilFlash=settings.lightningInterval*(LIGHTNING.interval[0]+Math.random()*LIGHTNING.interval[1]);
    }
   }else{untilFlash=1;if(!groundStrike||!lightningEnabled)flashRemaining=0;}
   pendingHit=null;
   flashStrength=flashRemaining>0?settings.lightningStrength*(groundStrike?1:stormWeight):0;
   bolt?.update(groundStrike&&flashStrength>0?flashRemaining/LIGHTNING.flashSeconds*settings.lightningStrength/LIGHTNING.boltScale:0);
   // Offscreen captures may be invoked within a host render pass. Restore its target,
   // viewport and scissor even when a shader/asset error interrupts the update.
   updateScope(()=>dynamic.update(dt,{active:true,sunDir,weather:w,day:bridge,windHeading:w.windHeading,flashPosition,flashStrength}));
   cloudShadows.update(sun,dynamic.ready&&!d.moonLit&&sun.intensity>0?look.cloudShadowStrength:0);
   if(coverUsed){
    // The sun cover reads the cloud shadow map: drawn here, since the pass that owns it may leave the shafts to the host.
    const cover=dynamic.ready&&!d.moonLit&&sun.intensity>0&&sunDir.y>SHAFT_MIN_SUN?look.cloudShadowStrength:0;
    scattering.cover.uniforms.uWeatherCover.value.y=cover;
    if(cover>0)updateScope(()=>scattering.renderCloudShadow(renderer,camera));
   }
   return view;
  },
  get postEnabled(){
   return (look.sunShafts&&sunDir.y>SHAFT_MIN_SUN&&!system.day.moonLit&&system.weather.sunlight>0&&look.shaftStrength>0)||
    (look.heightFog&&look.bankDensity>0)||rainbowAmount()>0;
  },
  // Optional final draw for a perspective camera. A host can supply its own captured layers; with input.airLit the
  // air of that capture is already lit (a volumetric pass): the sun's shafts are left to it, the fog bank and the
  // rainbow are still drawn.
  render(input){
   if(disposed)return;
   const shafts=!input?.airLit&&look.sunShafts&&sunDir.y>SHAFT_MIN_SUN&&!system.day.moonLit&&system.weather.sunlight>0?look.shaftStrength:0;
   const bankDensity=look.heightFog?look.bankDensity*Math.min(BANK.max,BANK.base+system.weather.bank):0;
   const bow=rainbowAmount();
   if(!input&&((shafts===0&&bankDensity===0&&bow===0)||!camera.isPerspectiveCamera||renderer.getRenderTarget()!==null||
      renderer.capabilities.logarithmicDepthBuffer||renderer.capabilities.reversedDepthBuffer||renderer.xr.isPresenting)){
    renderer.render(scene,camera);
    return;
   }
   scattering??=createSunScattering(dynamic.cloudUniforms,sunDir);
   bankSettings.set(bankDensity,look.bankHeight,look.bankScale,look.bankLevel);
   bankShape.set(look.bankCoverage,look.bankPuffiness,look.bankSunGlow,look.bankSteps);
   const bankSunStrength=bankDensity>0&&sunDir.y>SHAFT_MIN_SUN&&!system.day.moonLit?Math.min(1,Math.sqrt(sun.intensity/APPEARANCE_DEFAULTS.sunIntensity)):0;
   shaftHaze.set(look.shaftDensity,look.shaftHeight,look.shaftRange,look.shaftContrast);
   scattering.render(renderer,scene,camera,uniforms.uSunCol.value,shafts,shaftHaze,look.shaftRays,look.shaftRayGlare,look.heightFog?bankColor:fogObject.color,sun.color,bankSunStrength,bankSettings,bankShape,bankOffset,bankTime,wakeHead,wakeTail,rainbowBows.set(bow,look.rainbowSecond?bow*RAINBOW.secondShare:0),input);
  },
  dispose(){
   if(disposed)return;disposed=true;cloudShadows.dispose();bolt?.dispose();scattering?.dispose();dynamic.dispose();rain?.dispose();windStreaks?.dispose();windDebris?.dispose();dome.geometry.dispose();dome.material.dispose();scene.remove(group);
   if(scene.background===null)scene.background=saved.background;if(scene.fog===fogObject)scene.fog=saved.fog;defaultEnvironment.clear();
   if(ownsSun){scene.remove(sun,sun.target);sun.dispose();}else{sun.color.copy(sunState.color);sun.intensity=sunState.intensity;sun.position.copy(sunState.position);sun.target.position.copy(sunState.target);}
   if(ownsHemi){scene.remove(hemi);hemi.dispose();}else{hemi.color.copy(hemiState.color);hemi.groundColor.copy(hemiState.ground);hemi.intensity=hemiState.intensity;hemi.position.copy(hemiState.position);}
  },
 };
 return view;
}
