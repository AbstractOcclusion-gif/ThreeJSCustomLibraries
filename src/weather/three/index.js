import * as THREE from 'three';
import {DynamicSky,DYNAMIC_SKY_DEFAULTS,CLOUD_QUALITY} from './dynamic-sky.js';
import {createSkyUniforms,createSkyDome,skyDefines} from './sky-dome.js';
import {createPrecipitation} from './precipitation.js';
import {createSunScattering} from './sun-scattering.js';
import {createLightning} from './lightning.js';
import {createCloudShadows} from './cloud-shadows.js';
import {resolveVisualConfig} from './settings.js';
export {SKY_FIELDS,APPEARANCE_FIELDS,PRECIPITATION_FIELDS,resolveVisualConfig} from './settings.js';

export {DYNAMIC_SKY_DEFAULTS,CLOUD_QUALITY};

// Host owns the render loop and simulation. This binding only consumes their data.
// resolveLightningHit(x, z) may return a world-space point for a scheduled flash.
export function createThreeWeather({system,scene,renderer,camera,sun,hemi,lightTarget,assetBaseUrl,sky={},appearance={},fog=true,fogColor='#bcd3ce',visibilityScale=1,precipitation={},environment,fetch,loadTexture,resolveLightningHit}={}){
 if(!system?.weather||!system?.day||!scene||!renderer||!camera)throw Error('Three weather needs system, scene, renderer and camera');
 if(!Number.isFinite(visibilityScale)||visibilityScale<=0)throw Error('visibilityScale must be positive');
 const initial=resolveVisualConfig({sky,appearance:{fog,fogColor,visibilityScale,...(sun?{sunColor:'#'+sun.color.getHexString(),sunIntensity:sun.intensity}:{}),...(hemi?{hemiColor:'#'+hemi.color.getHexString(),groundColor:'#'+hemi.groundColor.getHexString(),hemiIntensity:hemi.intensity}:{}),...appearance},precipitation});
 const settings=initial.sky,look=initial.appearance;
 let precipitationConfig=initial.precipitation;
 const assets=assetBaseUrl?new URL(assetBaseUrl,globalThis.location?.href??import.meta.url).href:undefined;
 const saved={background:scene.background,environment:scene.environment,fog:scene.fog},group=new THREE.Group();group.name='Weather';scene.add(group);scene.background=null;
 const ownsSun=!sun,ownsHemi=!hemi;sun??=new THREE.DirectionalLight(0xfff0d5,2.7);hemi??=new THREE.HemisphereLight(0xc9e0ef,0x53634b,1.2);
 if(ownsSun){scene.add(sun,sun.target);}if(ownsHemi)scene.add(hemi);
 const lightState=light=>({color:light.color.clone(),intensity:light.intensity,position:light.position.clone()});
 const sunState={...lightState(sun),target:sun.target.position.clone()},hemiState={...lightState(hemi),ground:hemi.groundColor.clone()};
 const sunDir=new THREE.Vector3(),worldPosition=new THREE.Vector3(),lightDirection=new THREE.Vector3(),lightTint=new THREE.Color(),nightColor=new THREE.Color(),white=new THREE.Color(1,1,1),sunTint=new THREE.Color();
 const uniforms=createSkyUniforms(sunDir),dome=createSkyDome(uniforms,{radius:100,defines:skyDefines({dynamic:true,celestial:true}),atFarPlane:true});group.add(dome);
 const fogObject=new THREE.FogExp2();if(look.fog)scene.fog=fogObject;
 let ownedEnvironment=null,disposed=false;
 const defaultEnvironment={active:false,setDynamic(texture){ownedEnvironment=texture;scene.environment=texture;this.active=true;},setBlend(){},clear(){if(scene.environment===ownedEnvironment)scene.environment=saved.environment;ownedEnvironment=null;this.active=false;}};
 const dynamic=new DynamicSky(settings,uniforms,{renderer,camera:{position:worldPosition},environment:environment??defaultEnvironment,assetBaseUrl:assets,fetch,loadTexture});
 const cloudShadows=createCloudShadows(dynamic.cloudUniforms);
 let scattering;
 const bankOffset=new THREE.Vector2(),bankSettings=new THREE.Vector4();
 const wakeHead=new THREE.Vector4(),wakeTail=new THREE.Vector3();
 let bankTime=0;
 let rain=precipitationConfig===false?null:createPrecipitation(group,precipitationConfig);
 const viewport=new THREE.Vector4(),scissor=new THREE.Vector4();
 const bridge={s:{on:true,auto:false,hour:12},daylight:1,moonDir:new THREE.Vector3(),moonPhase:.5};
 const reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
 const flashPosition=new THREE.Vector2();
 let untilFlash=1,flashRemaining=0,flashStrength=0;
 let bolt,pendingHit,groundStrike=false;
 const strikeStart=new THREE.Vector3();
 const finitePoint=point=>[point?.x,point?.y,point?.z].every(Number.isFinite);
 function startStrike(hit){
  const point=new THREE.Vector3(hit.x,hit.y,hit.z);
  const weather=system.weather;
  const thickness=settings.thickness*(weather.on?weather.cloudProfile[2]:1);
  strikeStart.set(point.x,Math.max(point.y+30,settings.bottom+thickness*.4),point.z);
  bolt??=createLightning(group);
  bolt.strike(strikeStart,point);
  flashPosition.set(strikeStart.x,strikeStart.z);
  flashRemaining=.18;
  groundStrike=true;
 }
 const view={group,settings,uniforms,sun,hemi,sky:dynamic,ready:dynamic.readyPromise,get precipitationCount(){return rain?.instanceCount??0;},
  get lightningFlash(){return flashStrength;},
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
   if(disposed)return;if(!Number.isFinite(dt)||dt<0)throw Error('Visual weather dt must be finite and non-negative');dt=system.paused?0:dt;
   const w=system.weather,d=system.day;camera.getWorldPosition(worldPosition);sunDir.copy(d.sunDir);nightColor.set(d.settings.nightColor);sunTint.setRGB(d.sunTint.r,d.sunTint.g,d.sunTint.b);
   bridge.s.auto=d.settings.auto;bridge.s.hour=d.hour;bridge.daylight=d.daylight;bridge.moonDir.copy(d.moonDir);bridge.moonPhase=d.moonPhase;
   uniforms.uNightBlend.value=d.night;uniforms.uDaylight.value=d.daylight;uniforms.uSkySunDir.value.copy(sunDir);uniforms.uSky.value=d.daylight<.05?3:w.sunlight<.3?2:0;
   const auroraHeading=THREE.MathUtils.degToRad(settings.auroraHeading);
   uniforms.uAuroraDirection.value.set(Math.cos(auroraHeading),Math.sin(auroraHeading));
   uniforms.uAuroraIntensity.value=settings.aurora?settings.auroraIntensity:0;
   if(settings.aurora&&!reducedMotion?.matches)uniforms.uAuroraTime.value+=dt*settings.auroraSpeed;
   uniforms.uSunCol.value.copy(sunTint).multiplyScalar(w.sunlight*Math.max(.02,d.daylight));uniforms.uAmb.value.copy(nightColor).lerp(white,d.daylight).multiplyScalar(.3);
   dome.position.copy(worldPosition);
   sun.color.set(look.sunColor).multiply(d.moonLit?nightColor:sunTint);sun.intensity=look.sunIntensity*(d.moonLit?d.settings.nightLight*.55:w.sunlight*d.daylight);
   sun.target.position.copy(lightTarget??worldPosition);sun.position.copy(sun.target.position).addScaledVector(lightDirection.copy(d.lightDir),100);lightTint.copy(nightColor).lerp(white,d.daylight);
   hemi.color.set(look.hemiColor).multiply(lightTint);hemi.groundColor.set(look.groundColor).multiply(lightTint);
   const ambientLight=(.3+.7*w.sunlight)*(d.settings.nightLight+(1-d.settings.nightLight)*d.daylight);
   hemi.intensity=look.hemiIntensity*ambientLight;
   fogObject.color.set(look.fogColor).multiply(lightTint).multiplyScalar(ambientLight);
   if(look.fog)fogObject.density=Math.sqrt(-Math.log(.02))*w.density/(w.visibility*look.visibilityScale);
   if(look.heightFog){
    bankTime+=dt;
    const heading=THREE.MathUtils.degToRad(w.windHeading),drift=w.wind*dt*.25;
    bankOffset.x+=Math.cos(heading)*drift;bankOffset.y+=Math.sin(heading)*drift;
   }
   rain?.update(dt,w,d,worldPosition);
   const stormWeight=w.weights[w.names.indexOf('stormy')]??0;
   flashRemaining=Math.max(0,flashRemaining-dt);
   const lightningEnabled=settings.lightningStrength>0&&!reducedMotion?.matches;
   const automatic=w.on&&stormWeight>=.55&&settings.clouds&&lightningEnabled;
   if(pendingHit&&lightningEnabled){
    startStrike(pendingHit);
   }else if(automatic){
    untilFlash-=dt;
    if(untilFlash<=0&&flashRemaining===0){
     const angle=Math.random()*Math.PI*2,distance=1200+Math.random()*900;
     flashPosition.set(worldPosition.x+Math.cos(angle)*distance,worldPosition.z+Math.sin(angle)*distance);
     const hit=resolveLightningHit?.(flashPosition.x,flashPosition.y);
     groundStrike=false;
     flashRemaining=.18;
     if(finitePoint(hit))startStrike(hit);
     untilFlash=settings.lightningInterval*(.65+Math.random()*.7);
    }
   }else{untilFlash=1;if(!groundStrike||!lightningEnabled)flashRemaining=0;}
   pendingHit=null;
   flashStrength=flashRemaining>0?settings.lightningStrength*(groundStrike?1:stormWeight):0;
   bolt?.update(groundStrike&&flashStrength>0?flashRemaining/.18*settings.lightningStrength/3:0);
   // Offscreen captures may be invoked within a host render pass. Restore its target,
   // viewport and scissor even when a shader/asset error interrupts the update.
   const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel(),test=renderer.getScissorTest();renderer.getViewport(viewport);renderer.getScissor(scissor);
   try{dynamic.update(dt,{active:true,sunDir,weather:w,day:bridge,windHeading:w.windHeading,flashPosition,flashStrength});}
   finally{renderer.setRenderTarget(target,face,level);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(test);}
   cloudShadows.update(sun,dynamic.ready&&!d.moonLit&&sun.intensity>0?look.cloudShadowStrength:0);
   return view;
  },
  get postEnabled(){
   return (look.sunShafts&&sunDir.y>.01&&!system.day.moonLit&&system.weather.sunlight>0&&look.shaftStrength>0)||
    (look.heightFog&&look.bankDensity>0);
  },
  // Optional final draw for a perspective camera. A host can supply its own captured layers.
  render(input){
   if(disposed)return;
   const shafts=look.sunShafts&&sunDir.y>.01&&!system.day.moonLit&&system.weather.sunlight>0?look.shaftStrength:0;
   const bankDensity=look.heightFog?look.bankDensity*Math.min(2,.55+system.weather.bank):0;
   if(!input&&((shafts===0&&bankDensity===0)||!camera.isPerspectiveCamera||renderer.getRenderTarget()!==null||
      renderer.capabilities.logarithmicDepthBuffer||renderer.capabilities.reversedDepthBuffer||renderer.xr.isPresenting)){
    renderer.render(scene,camera);
    return;
   }
   scattering??=createSunScattering(dynamic.cloudUniforms,sunDir);
   bankSettings.set(bankDensity,look.bankHeight,look.bankScale,look.bankLevel);
   const bankSunStrength=bankDensity>0&&sunDir.y>.01&&!system.day.moonLit?Math.min(1,Math.sqrt(sun.intensity/2.7)):0;
   scattering.render(renderer,scene,camera,uniforms.uSunCol.value,shafts,fogObject.color,sun.color,bankSunStrength,bankSettings,bankOffset,bankTime,wakeHead,wakeTail,input);
  },
  dispose(){
   if(disposed)return;disposed=true;cloudShadows.dispose();bolt?.dispose();scattering?.dispose();dynamic.dispose();rain?.dispose();dome.geometry.dispose();dome.material.dispose();scene.remove(group);
   if(scene.background===null)scene.background=saved.background;if(scene.fog===fogObject)scene.fog=saved.fog;defaultEnvironment.clear();
   if(ownsSun){scene.remove(sun,sun.target);sun.dispose();}else{sun.color.copy(sunState.color);sun.intensity=sunState.intensity;sun.position.copy(sunState.position);sun.target.position.copy(sunState.target);}
   if(ownsHemi){scene.remove(hemi);hemi.dispose();}else{hemi.color.copy(hemiState.color);hemi.groundColor.copy(hemiState.ground);hemi.intensity=hemiState.intensity;hemi.position.copy(hemiState.position);}
  },
 };
 return view;
}
