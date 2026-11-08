// Glider library adaptation: instance resources, explicit assets, ready/dispose lifecycle.
// atmosphere/dynamic-sky.js -- the dynamic sky (16 Oct 2026, batch 3 of docs/plan/11_UNIFY_ATMOSPHERE_PROMPT.md): one copy for every
// page, merged from OceanPlayTest rendering/dynamic-sky.js (the base: injected sky uniforms, capture + PMREM cross-fades) and
// WebAquarium rendering/dynamic-sky.js (its on / off switch, its own night glow settings). three's Sky (Rayleigh / Mie atmosphere)
// plus volumetric clouds (cloud-density.js, Enviro-derived noise) and cirrus, captured into a cube a few times a second and prefiltered
// (PMREM) for the scene's standard materials; the dome and the water read the capture through sky-dome.js sky(), which adds the
// per-pixel sun disc, stars, galaxy and moon. The sun, the day (twilight, moon direction) and the weather (cloud profile, wind) come
// from the page's adapter each frame: this module imports no page -- renderer, camera, GPU timer and the environment sink are injected.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createCloudUniforms, CLOUD_GLSL, CLOUD_DRIFT, loadCloudNoise } from './cloud-density.js';
import { createCloudWeatherMap } from './cloud-weather-map.js';
import { DYNAMIC_SKY_DEFAULTS } from './settings.js';
export { DYNAMIC_SKY_DEFAULTS } from './settings.js';


// nightLight / nightColor: the night sky's own glow (the capture's ambient); the scene's night light is the day's (day.js)
export const CLOUD_QUALITY = Object.freeze({ mobile: { size: 128, steps: 12 }, low: { size: 256, steps: 24 }, medium: { size: 256, steps: 40 }, high: { size: 512, steps: 64 } });

const SKY_SUN_DISC = 'float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );';   // three r160 Sky.js: the capture drops the disc, the dome draws it sharp
const CLOUD_RENDER_GLSL = /* glsl */`
uniform vec3 uCaptureOrigin,uDynamicSunColor,sunPosition; uniform float uDynamicDaylight,uNightBlend,uDynamicExposure;
uniform vec3 uNightAmbient; uniform float uNightIntensity,uDistantCloudDrop;
uniform vec2 uFlashPosition; uniform float uFlashStrength;
${CLOUD_GLSL}
float gSkyTransmittance=1.0;
vec3 nightAmbient(vec3 d){ return uNightAmbient*uNightIntensity*smoothstep(-.05,.03,d.y); }
vec3 renderCirrus(vec3 d,vec3 background){
  if(uCirrusOn<.5||d.y<=.005)return background;
  vec3 p=uCaptureOrigin+d*max(0.0,(uCirrusAltitude-uCaptureOrigin.y)/d.y);
  float opacity=cirrusOpacityAt(p.xz)*smoothstep(.015,.12,d.y);
  vec3 colour=mix(vec3(.003,.005,.009),vec3(.48,.55,.64)+uDynamicSunColor*.2,uDynamicDaylight);
  gSkyTransmittance*=1.0-opacity;
  return mix(background,colour,opacity);
}
const float CLOUD_PHASE_FORWARD=.8, CLOUD_PHASE_BACK=-.3, CLOUD_PHASE_BACK_WEIGHT=.35;
const int   CLOUD_SCATTER_OCTAVES=3;
const float CLOUD_SCATTER_ATTENUATION=.5, CLOUD_SCATTER_CONTRIBUTION=.5, CLOUD_POWDER_STRENGTH=.7, CLOUD_AMBIENT_BASE=.35, CLOUD_AMBIENT_CORE=.6, CLOUD_MIN_TRANSMITTANCE=.015;
uniform float uCloudBrightness,uCloudAmbient,uSkySaturation;
const vec3 SKY_LUMA=vec3(.2126,.7152,.0722);
const float INV_FOUR_PI=.0795774715;
float henyeyGreenstein(float mu,float g){float gg=g*g;return INV_FOUR_PI*(1.0-gg)/pow(max(1.0+gg-2.0*g*mu,.0001),1.5);}
float cloudPhase(float mu,float scale){ return mix(henyeyGreenstein(mu,CLOUD_PHASE_FORWARD*scale),henyeyGreenstein(mu,CLOUD_PHASE_BACK*scale),CLOUD_PHASE_BACK_WEIGHT); }
vec3 cloudOctavePhases(float mu){ vec3 phases;float attenuation=1.0; for(int k=0;k<CLOUD_SCATTER_OCTAVES;k++){phases[k]=cloudPhase(mu,attenuation);attenuation*=CLOUD_SCATTER_ATTENUATION;} return phases; }
float cloudSunScattering(float tau,float mu,vec3 phases){
  float sum=0.0,attenuation=1.0,contribution=1.0;
  for(int k=0;k<CLOUD_SCATTER_OCTAVES;k++){ sum+=contribution*exp(-tau*attenuation)*phases[k]; attenuation*=CLOUD_SCATTER_ATTENUATION;contribution*=CLOUD_SCATTER_CONTRIBUTION; }
  float powder=mix(1.0,1.0-exp(-2.0*tau),CLOUD_POWDER_STRENGTH*clamp(-mu,0.0,1.0));
  return sum*powder;
}
vec3 renderCloudLayer(vec3 direction,vec3 background){
  if(uCloudOn<.5 || direction.y<=.001) return background;
  vec3 origin=uCaptureOrigin;
  float baseDistance=max(0.0,(uCloudBottom-origin.y)/direction.y)*length(direction.xz);
  // Shift the sampling ray up to bring distant clouds down in the sky capture.
  float drop=min(uDistantCloudDrop,max(0.0,uCloudBottom-origin.y));
  origin.y+=drop*smoothstep(450.0,1100.0,baseDistance);
  float start=max(0.0,(uCloudBottom-origin.y)/direction.y);
  float end=min(22000.0,(uCloudBottom+uCloudThickness-origin.y)/direction.y);
  if(end<=start) return background;
  vec3 sun=normalize(sunPosition);
  float stepLen=(end-start)/uCloudSteps;
  float mu=dot(direction,sun),trans=1.0;
  vec3 phases=cloudOctavePhases(mu);
  vec3 light=vec3(0.0);
  vec3 skyAmbient=background*uCloudAmbient;
  vec3 mid=origin+direction*(start+end)*.5;
  float cirrusShadow=1.0-cirrusOpacityAt(mid.xz+sun.xz*max(0.0,(uCirrusAltitude-mid.y)/max(sun.y,.005)));
  for(int i=0;i<64;i++){
    if(float(i)>=uCloudSteps || trans<CLOUD_MIN_TRANSMITTANCE) break;
    vec3 p=origin+direction*(start+(float(i)+.5)*stepLen);
    float density=cloudDensityAt(p);
    if(density<=0.0) continue;
    float localT=exp(-density*stepLen);
    float h=clamp((p.y-uCloudBottom)/uCloudThickness,0.0,1.0);
    float core=clamp(density/max(uCloudDensity,1e-5),0.0,1.0);
    vec3 ambient=skyAmbient*mix(CLOUD_AMBIENT_BASE,1.0,h)*(1.0-CLOUD_AMBIENT_CORE*core);
    vec3 direct=uDynamicSunColor*uCloudBrightness*cloudSunScattering(cloudSunOpticalDepth(p,sun),mu,phases)*cirrusShadow;
    if(uFlashStrength>0.0){
      vec3 offset=vec3(p.x-uFlashPosition.x,p.y-uCloudBottom-uCloudThickness*.4,p.z-uFlashPosition.y)/500.0;
      direct+=vec3(.65,.78,1.0)*uFlashStrength*exp(-dot(offset,offset));
    }
    light+=trans*(1.0-localT)*(ambient+direct); trans*=localT;
  }
  float horizonFade=smoothstep(.015,.12,direction.y)*(1.0-smoothstep(8000.0,22000.0,start));
  gSkyTransmittance*=mix(1.0,trans,horizonFade);
  return mix(background,background*trans+light,horizonFade);
}`;

export class DynamicSky {
  // settings: a DYNAMIC_SKY_DEFAULTS-shaped object the page owns; sky: the page's sky uniforms (sky-dome.js names: tDynamicSky,
  // tDynamicSkyPrev, uDynamicSkyBlend, uSkySun, uMoon*, uStar*, uGalaxyIntensity, uNightIntensity, uStarsRotation, tMoon, tStars,
  // tGalaxy, uSunCol, uNightBlend, uSkyDyn); deps: the page's renderer and camera, its GPU timer section hook, and `environment`,
  // the sink for the prefiltered capture (the scene's standard materials' lighting): { setDynamic(texture, previousTexture),
  // setBlend(t 0..1), clear(), active } -- the ocean's WeatherEnvironment, or the pond's scene.environment wrapper.
  constructor(settings, sky, { renderer, camera, gpuSec = () => {}, environment, assetBaseUrl, fetch:fetcher=globalThis.fetch, loadTexture }) {
    if (!renderer || !camera || !environment) throw new Error('DynamicSky: renderer, camera and environment are required');
    this.s = settings; this.sky = sky; this.renderer = renderer; this.camera = camera; this.gpuSec = gpuSec; this.env = environment;
    this.cloudUniforms=createCloudUniforms();this.disposed=false;this.abortController=new AbortController();this.ownedTextures=[];
    this.ready = false; this.captureAge = Infinity; this.lightAge = Infinity; this.sunColor = new THREE.Color(1, 0.96, 0.9); this.nightColor = new THREE.Color();
    this.capture = new THREE.Scene(); this.dome = new Sky(); this.dome.scale.setScalar(10); this.capture.add(this.dome);
    const m = this.dome.material; Object.assign(m.uniforms, this.cloudUniforms, {
      uCaptureOrigin: { value: new THREE.Vector3() }, uDynamicSunColor: { value: this.sunColor }, uDynamicDaylight: { value: 1 }, uNightBlend: sky.uNightBlend,
      uDynamicExposure: { value: 0.18 }, uNightAmbient: { value: new THREE.Color() }, uCloudBrightness: { value: 1 }, uCloudAmbient: { value: 1 }, uSkySaturation: { value: 1 }, uNightIntensity: sky.uNightIntensity,
      uDistantCloudDrop: { value: 0 }, uFlashPosition: { value: new THREE.Vector2() }, uFlashStrength: { value: 0 } });
    if (!m.fragmentShader.includes(SKY_SUN_DISC)) throw new Error('DynamicSky: three Sky.js sun disc line not found (three version changed?)');
    m.fragmentShader = m.fragmentShader.replace('void main() {', CLOUD_RENDER_GLSL + '\nvoid main() {')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', `
        // Sky.js flattens saturation with its sunfade power curve; restore it before clouds so reflections and PMREM match.
        vec3 daySky=retColor*uDynamicExposure;daySky=max(mix(vec3(dot(daySky,SKY_LUMA)),daySky,uSkySaturation),vec3(0.0));
        vec3 base=mix(daySky,nightAmbient(direction),uNightBlend);
        base=renderCirrus(direction,base);
        gl_FragColor=vec4(min(renderCloudLayer(direction,base),vec3(24.0)),gSkyTransmittance);`)
      .replace(SKY_SUN_DISC, 'float sundisk = 0.0;').replace('#include <tonemapping_fragment>', '').replace('#include <colorspace_fragment>', '');   // render targets stay linear: screen and water do the output conversion
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const loader=new THREE.TextureLoader();
    this.readyPromise=assetBaseUrl?this.loadAssets(assetBaseUrl,loadTexture??(url=>loader.loadAsync(url)),fetcher):Promise.resolve(false);
    this.readyPromise.catch(()=>{}); // The caller still receives the rejection through readyPromise.

  }
  async loadAssets(baseUrl,loadTexture,fetcher){
    const results=await Promise.allSettled([
      loadCloudNoise(baseUrl,{fetch:fetcher,signal:this.abortController.signal}),
      ...['moon.png','stars.png','galaxy.jpg','cirrus.png'].map(name=>loadTexture(new URL(name,baseUrl).href))
    ]);
    const textures=results.filter(r=>r.status==='fulfilled').flatMap(r=>Array.isArray(r.value)?r.value:[r.value]);
    const failure=results.find(r=>r.status==='rejected');
    if(this.disposed||failure){textures.forEach(t=>t.dispose());if(!this.disposed&&failure)throw failure.reason;return false;}
    this.ownedTextures=textures;
    const [noise,moon,stars,galaxy,cirrus]=results.map(r=>r.value),u=this.cloudUniforms;
    for(const t of [moon,stars,galaxy])t.colorSpace=THREE.SRGBColorSpace;
    cirrus.colorSpace=THREE.NoColorSpace;cirrus.wrapS=cirrus.wrapT=THREE.RepeatWrapping;
    this.sky.tMoon.value=moon;this.sky.tStars.value=stars;this.sky.tGalaxy.value=galaxy;u.tCirrus.value=cirrus;u.tCloudBase.value=noise[0];u.tCloudDetail.value=noise[1];
    // Optional baked weather map (weather-map.png: r coverage around .5, g cloud top, tileable). Falls back to the procedural Worley map.
    let baked=null;try{baked=await loadTexture(new URL('weather-map.png',baseUrl).href);}catch{baked=null;}
    if(this.disposed){baked?.dispose();textures.forEach(t=>t.dispose());this.ownedTextures=[];return false;}
    if(baked){baked.colorSpace=THREE.NoColorSpace;baked.wrapS=baked.wrapT=THREE.RepeatWrapping;this.ownedTextures.push(baked);u.tCloudWeather.value=baked;}
    else{try{this.weatherMap=createCloudWeatherMap(this.renderer,u);}catch(error){textures.forEach(t=>t.dispose());this.ownedTextures=[];throw error;}}
    this.ready=true;this.captureAge=Infinity;return true;
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.abortController.abort();this.ready=false;
    if(this.envOn)this.env.clear();this.sky.uSkyDyn.value=0;
    this.targets?.forEach(t=>t.dispose());this.weatherMap?.dispose();this.ownedTextures.forEach(t=>t.dispose());this.ownedTextures=[];
    this.previousEnvironment?.dispose();if(this.environment!==this.previousEnvironment)this.environment?.dispose();
    this.pmrem.dispose();this.dome.geometry.dispose();this.dome.material.dispose();
    for(const name of ['tMoon','tStars','tGalaxy','tDynamicSky','tDynamicSkyPrev'])this.sky[name].value=null;
  }
  // active: the page shows the dynamic sky (its own switch / sky mode); sunDir: the page's sun (before any moon-light override);
  // weather: an atmosphere Weather (on, cloudProfile, weights, wind); day: an atmosphere Day (hour, daylight, moonDir, sunTint,
  // night light); windHeading: the weather wind's heading (deg); sunDim: what the page already baked into uSunCol (the pond's
  // LIGHT_MOD.sun) -- the clouds undo it and add the day's warm tint and daylight themselves (omit when uSunCol is already the day's sun)
  update(dt, { active, sunDir, weather, day, windHeading = 0, sunDim, flashPosition, flashStrength = 0 }) {
    if(this.disposed)return;const s = this.s, sky = this.sky, on = active && this.ready;
    if (sky.uSkyDyn) sky.uSkyDyn.value = on ? 1 : 0;
    if (!on) { this.cloudUniforms.uCloudOn.value = 0; this.cloudUniforms.uCirrusOn.value = 0; if (this.envOn) { this.env.clear(); this.envOn = false; } return; }
    const q = CLOUD_QUALITY[s.quality] || CLOUD_QUALITY.low, u = this.cloudUniforms, m = this.dome.material.uniforms;
    const captureSize = sky.uNightBlend.value > 0.5 ? Math.max(q.size, s.nightResolution) : q.size;
    if (!this.targets || this.size !== captureSize) {   // two captures, cross-faded by the dome: a new capture becomes visible gradually instead of snapping
      this.targets?.forEach(t => t.dispose());
      this.targets = [0, 1].map(() => new THREE.WebGLCubeRenderTarget(captureSize, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
      this.cubeCameras = this.targets.map(t => new THREE.CubeCamera(0.1, 100, t)); this.current = 0; this.size = captureSize; this.captureAge = Infinity; this.lightAge = Infinity; this.resized = true;
    }
    u.uCloudOn.value = s.clouds ? 1 : 0; u.uCloudBottom.value = s.bottom; u.uCloudThickness.value = s.thickness;
    m.uDistantCloudDrop.value = s.distantDrop;
    const flashChanged = (m.uFlashStrength.value > 0) !== (flashStrength > 0);
    m.uFlashStrength.value = flashStrength;
    if (flashPosition) m.uFlashPosition.value.copy(flashPosition);
    u.uCloudScale.value = s.scale; u.uCloudDensity.value = s.density; u.uCloudDetail.value = s.detail; u.uCloudSteps.value = q.steps;
    m.uCloudBrightness.value = s.brightness; m.uCloudAmbient.value = s.ambient; m.uSkySaturation.value = s.skySaturation;
    u.uCloudMapScale.value = s.mapScale; u.uCloudMapVariation.value = s.mapVariation;
    u.uCirrusOn.value = s.cirrus ? 1 : 0; u.uCirrusOpacity.value = s.cirrusOpacity; u.uCirrusAltitude.value = s.cirrusAltitude; u.uCirrusScale.value = s.cirrusScale;
    // the weather's cloud profile [coverage mix clear..overcast, scale, thickness, detail, cirrus], blended by the machine; manual values with the weather off
    const w = weather.on, p = weather.cloudProfile;
    u.uCloudCoverage.value = w ? THREE.MathUtils.lerp(s.clearCoverage, s.overcastCoverage, p[0]) : s.coverage;
    if (w) { u.uCloudScale.value = s.scale * p[1]; u.uCloudThickness.value = s.thickness * p[2]; u.uCloudDetail.value = Math.min(0.8, s.detail * p[3]); u.uCirrusOpacity.value = s.cirrusOpacity * (s.clearCoverage * (weather.weights[weather.names?.indexOf('clear')??0]??0) + p[4]); }
    const speed = w ? weather.wind : s.windSpeed, heading = (w ? windHeading : s.windHeading) * Math.PI / 180;
    u.uCloudOffset.value.x += Math.cos(heading) * speed * dt; u.uCloudOffset.value.y += Math.sin(heading) * speed * dt;
    u.uCloudDetailOffset.value.x += Math.cos(heading) * speed * CLOUD_DRIFT.detail * dt; u.uCloudDetailOffset.value.y += Math.sin(heading) * speed * CLOUD_DRIFT.detail * dt;
    u.uCloudLift.value += speed * CLOUD_DRIFT.lift * dt;
    u.uCirrusOffset.value.x += Math.cos(heading) * s.cirrusSpeed * dt; u.uCirrusOffset.value.y += Math.sin(heading) * s.cirrusSpeed * dt;
    // the moon: its phase runs with the simulated days; its direction is the day's (day.js: own orbit or opposite the sun)
    // Moon phase belongs to the simulation clock, never to rendering.
    sky.uMoonDir.value.copy(day.moonDir);
    sky.uMoonOn.value = s.moon ? 1 : 0; sky.uMoonPhase.value = day.moonPhase; sky.uMoonRadius.value = s.moonRadiusDeg * Math.PI / 180;
    sky.uMoonIntensity.value = s.moonIntensity; sky.uMoonEarthshine.value = s.moonEarthshine;
    sky.uStarIntensity.value = s.starIntensity; sky.uStarReflection.value = 1; sky.uGalaxyIntensity.value = s.galaxyIntensity; sky.uNightIntensity.value = s.nightIntensity;
    sky.uStarsRotation.value = day.s.hour / 24 * Math.PI * 2;
    // the sun's colour for the clouds: the page's sun; where the page dimmed it (sunDim) the clouds undo that and add the warm horizon + daylight themselves
    this.sunColor.copy(sky.uSunCol.value);
    if (sunDim !== undefined) this.sunColor.multiply(day.sunTint).multiplyScalar(Math.max(day.daylight, 0.02) / Math.max(sunDim, 0.05));
    m.turbidity.value = s.turbidity; m.rayleigh.value = s.rayleigh; m.mieCoefficient.value = s.mie; m.mieDirectionalG.value = s.mieG;
    m.sunPosition.value.copy(sunDir).multiplyScalar(450000); sky.uSkySun.value.copy(sunDir); m.uDynamicDaylight.value = day.daylight; m.uDynamicExposure.value = s.exposure;
    if (this.nightColor._s !== s.nightColor) { this.nightColor.set(s.nightColor); this.nightColor._s = s.nightColor; }
    m.uNightAmbient.value.copy(this.nightColor).multiplyScalar(s.nightLight * 0.35);
    m.uCaptureOrigin.value.copy(this.camera.position); m.uCaptureOrigin.value.y = Math.max(0.1, this.camera.position.y);
    this.captureAge += dt; this.lightAge += dt;
    // a manual control change forces a fresh capture at once (also when the animation is paused); timed captures fade in over the next interval
    const sunKey = day.s.on && day.s.auto && dt>0 ? 'auto' : [sunDir.x, sunDir.y, sunDir.z].map(v => v.toFixed(4)).join(',');
    const weatherKey=w?(weather.transitioning&&dt>0?'transition':p.join(',')):s.coverage;
    const key = [sunKey, weatherKey, s.clearCoverage, s.overcastCoverage, s.clouds, s.density, s.bottom, s.distantDrop, s.thickness, s.scale, s.detail, s.brightness, s.ambient, s.turbidity, s.rayleigh, s.mie, s.mieG,
      s.exposure, s.skySaturation, s.mapScale, s.mapVariation, s.cirrus, s.cirrusOpacity, s.cirrusAltitude, s.cirrusScale, s.quality, s.nightColor, s.nightLight].join('|');
    const manual = key !== this.key;
    if (this.captureAge >= s.captureInterval || manual || flashChanged) {
      this.gpuSec('dynamic sky + clouds');
      const next = 1 - this.current; this.cubeCameras[next].update(this.renderer, this.capture);
      const snap = manual || this.resized || flashChanged || flashStrength > 0;
      if (sky.tDynamicSkyPrev) sky.tDynamicSkyPrev.value = this.targets[snap ? next : this.current].texture;
      sky.tDynamicSky.value = this.targets[next].texture; this.current = next; this.captureAge = 0; this.key = key;
      if (flashStrength === 0 && (this.lightAge >= s.lightingInterval || manual || !this.environment || !this.env.active)) {
        this.gpuSec('dynamic sky PMREM');
        const fresh = this.pmrem.fromCubemap(this.targets[next].texture);
        // keep the previous PMREM for the lighting cross-fade; textureCubeUV needs both at the same size, so a resize snaps
        this.previousEnvironment?.dispose(); this.previousEnvironment = snap || !this.environment ? null : this.environment;
        if (!this.previousEnvironment) this.environment?.dispose();
        this.environment = fresh; this.env.setDynamic(fresh.texture, (this.previousEnvironment || fresh).texture); this.envOn = true; this.lightAge = 0;
      }
      this.resized = false;
    }
    if (sky.uDynamicSkyBlend) sky.uDynamicSkyBlend.value = Math.min(1, this.captureAge / s.captureInterval);
    this.env.setBlend(Math.min(1, this.lightAge / s.lightingInterval));
  }
}
