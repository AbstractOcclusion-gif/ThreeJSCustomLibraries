// Glider library adaptation: instance uniforms and caller-owned asset URLs.
// atmosphere/cloud-density.js -- the volumetric cloud density field of the dynamic sky (from OceanPlayTest, 14 Oct 2026; shared since 16 Oct); noise assets in library/embedded/sky.
import * as THREE from 'three';

export function createCloudUniforms(){return {
  tCloudBase: {value:null}, tCloudDetail: {value:null}, uCloudOn:{value:0},
  tCloudWeather:{value:null},uCloudMapScale:{value:30000},uCloudMapVariation:{value:.35},
  tCirrus:{value:null},uCirrusOn:{value:0},uCirrusOpacity:{value:.22},uCirrusAltitude:{value:4500},uCirrusScale:{value:16000},uCirrusOffset:{value:new THREE.Vector2()},
  uCloudBottom:{value:700}, uCloudThickness:{value:450}, uCloudScale:{value:3500},
  uCloudCoverage:{value:.55}, uCloudDensity:{value:.012}, uCloudDetail:{value:.25},
  uCloudOffset:{value:new THREE.Vector2()}, uCloudDetailOffset:{value:new THREE.Vector2()}, uCloudLift:{value:0}, uCloudSteps:{value:16}
};}
// Layer drift ratios relative to the cloud wind: the weather map lags, the detail
// erosion leads and the base noise rises slowly, so forms shear and boil instead of
// sliding as one rigid sheet.
export const CLOUD_DRIFT=Object.freeze({weatherMap:.6,detail:1.35,lift:.08});
// Shared by the sky capture and airborne light transport. Height-shaped 3D
// Perlin/Worley noise, coverage remapping and height-dependent detail erosion follow
// the Nubis/Enviro density path. The sun march uses geometric segments: short near the
// sample for self-shadow creases, long far out, each weighted by the length it covers.
export const CLOUD_GLSL = /* glsl */`
#ifndef OCEAN_CLOUD_DENSITY
#define OCEAN_CLOUD_DENSITY
uniform highp sampler3D tCloudBase, tCloudDetail;
uniform sampler2D tCloudWeather;uniform float uCloudMapScale,uCloudMapVariation;
uniform sampler2D tCirrus;uniform float uCirrusOn,uCirrusOpacity,uCirrusAltitude,uCirrusScale;uniform vec2 uCirrusOffset;
float cirrusOpacityAt(vec2 xz){
  if(uCirrusOn<.5)return 0.0;
  vec2 uv=(xz-uCirrusOffset)/uCirrusScale;
  float n=texture2D(tCirrus,uv).r*.7+texture2D(tCirrus,uv*2.03+vec2(.23,.41)).g*.3;
  return smoothstep(.3,.8,n)*uCirrusOpacity;
}
uniform float uCloudOn,uCloudBottom,uCloudThickness,uCloudScale,uCloudCoverage,uCloudDensity,uCloudDetail,uCloudSteps,uCloudLift;
uniform vec2 uCloudOffset,uCloudDetailOffset;
const float CLOUD_WEATHER_DRIFT=${CLOUD_DRIFT.weatherMap};
const float CLOUD_SHEAR=.08;            // horizontal noise shift per unit height (wind shear)
const float CLOUD_BASE_SOFTNESS=.08;    // normalised height over which the flat base fades in
const float CLOUD_TOP_TAPER=.6;         // fraction of the local top where the dome starts tapering
const float CLOUD_DETAIL_FREQUENCY=4.0; // detail noise octaves per base noise period
const float CLOUD_WISP_HEIGHT=.2;       // normalised height below which erosion makes wisps, above it billows
const float CLOUD_CORE_EROSION=.5;      // erosion kept inside dense cores so bodies stay solid
const float CLOUD_FAR_EROSION=.5;       // mean erosion assumed by the cheap far shadow samples
const int   CLOUD_SUN_SAMPLES=6;        // geometric sun segments; the first half use full detail
const float CLOUD_SUN_RANGE=4000.0;     // maximum sun path considered for self-shadowing (m)
// Low-frequency shape without detail erosion: empty-space skipping and far shadow samples.
float cloudShapeAt(vec3 p,out float h,out vec3 uv){
  h=(p.y-uCloudBottom)/uCloudThickness;
  if(h<=0.0 || h>=1.0 || uCloudCoverage<=0.0) return 0.0;
  uv=vec3(p.x-uCloudOffset.x,p.y-uCloudLift,p.z-uCloudOffset.y)/uCloudScale;
  vec4 weather=texture2D(tCloudWeather,(p.xz-uCloudOffset*CLOUD_WEATHER_DRIFT)/uCloudMapScale);
  float coverage=clamp(uCloudCoverage+(weather.r-.5)*uCloudMapVariation,0.0,1.0);
  uv.xz+=h*CLOUD_SHEAR;
  vec4 n=texture(tCloudBase,uv);
  float fbm=dot(n.gba,vec3(.625,.25,.125));
  float shape=clamp((n.r+1.0-fbm)/(2.0-fbm),0.0,1.0);
  float top=mix(.45,1.0,weather.g);
  shape*=smoothstep(0.0,CLOUD_BASE_SOFTNESS,h)*(1.0-smoothstep(top*CLOUD_TOP_TAPER,top,h));
  return clamp((shape-(1.0-coverage))/max(coverage,.01),0.0,1.0);
}
// detailed=false skips the erosion fetch: far shadow samples and empty-space tests.
float cloudDensityAt(vec3 p,bool detailed){
  float h;vec3 uv;float density=cloudShapeAt(p,h,uv);
  if(density<=0.0) return 0.0;
  if(!detailed) return density*(1.0-uCloudDetail*CLOUD_FAR_EROSION)*uCloudDensity;
  if(uCloudDetail>0.0){
    vec3 duv=(uv+vec3(-uCloudDetailOffset.x,0.0,-uCloudDetailOffset.y)/uCloudScale)*CLOUD_DETAIL_FREQUENCY;
    float detail=dot(texture(tCloudDetail,duv).rgb,vec3(.625,.25,.125));
    // Wispy near the base, billowing cauliflower higher up.
    float modifier=mix(detail,1.0-detail,clamp(h/CLOUD_WISP_HEIGHT,0.0,1.0));
    float erosion=modifier*uCloudDetail*mix(1.0,CLOUD_CORE_EROSION,density);
    density=clamp((density-erosion)/max(1.0-erosion,.01),0.0,1.0);
  }
  return density*uCloudDensity;
}
float cloudDensityAt(vec3 p){return cloudDensityAt(p,true);}
// Optical depth toward the sun. Segment i covers L0*2^i so the near creases get
// resolved and the far path still integrates all the cloud it crosses.
float cloudSunOpticalDepth(vec3 p,vec3 sun){
  if(sun.y<=.005) return 1e4;
  float start=max(0.0,(uCloudBottom-p.y)/sun.y);
  float end=max(0.0,(uCloudBottom+uCloudThickness-p.y)/sun.y);
  float range=min(end-start,CLOUD_SUN_RANGE);
  if(range<=0.0) return 0.0;
  float segment=range/(exp2(float(CLOUD_SUN_SAMPLES))-1.0), t=start, tau=0.0;
  for(int i=0;i<CLOUD_SUN_SAMPLES;i++){
    vec3 q=p+sun*(t+segment*.5);
    tau+=cloudDensityAt(q,i<CLOUD_SUN_SAMPLES/2)*segment;
    t+=segment;segment*=2.0;
  }
  return tau;
}
float cloudSunTransmittance(vec3 p,vec3 sun){
  if(sun.y<=.005) return 0.0;
  vec2 highCloud=p.xz+sun.xz*max(0.0,(uCirrusAltitude-p.y)/sun.y);
  return exp(-cloudSunOpticalDepth(p,sun))*(1.0-cirrusOpacityAt(highCloud));
}
// Lower-cost transport for sunlight reaching scene surfaces and the air below the clouds.
float cloudGroundTransmittance(vec3 p,vec3 sun){
  if(sun.y<=.01) return 1.0;
  float tau=0.0;
  if(uCloudOn>.5 && uCloudCoverage>0.0){
    float entry=max(0.0,(uCloudBottom-p.y)/sun.y);
    float exitDistance=(uCloudBottom+uCloudThickness-p.y)/sun.y;
    float segment=clamp(exitDistance-entry,0.0,CLOUD_SUN_RANGE)/float(CLOUD_SUN_SAMPLES);
    if(segment>0.0){
      for(int i=0;i<CLOUD_SUN_SAMPLES;i++){
        vec3 samplePosition=p+sun*(entry+(float(i)+.5)*segment);
        tau+=cloudDensityAt(samplePosition,false)*segment;
      }
    }
  }
  vec2 highCloud=p.xz+sun.xz*max(0.0,(uCirrusAltitude-p.y)/sun.y);
  return exp(-tau)*(1.0-cirrusOpacityAt(highCloud));
}
#endif
`;

export async function loadCloudNoise(baseUrl,{fetch:fetcher=globalThis.fetch,signal}={}){
 const results=await Promise.allSettled(['base-64','detail-32'].map(async name=>{
  const response=await fetcher(new URL('enviro-cloud-'+name+'.rgba',baseUrl).href,{signal});
  if(!response.ok)throw Error('Cloud noise '+response.status+': '+name);
  const size=name.endsWith('64')?64:32,bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==size**3*4)throw Error('Invalid cloud noise size: '+name);
  const texture=new THREE.Data3DTexture(bytes,size,size,size);texture.format=THREE.RGBAFormat;texture.type=THREE.UnsignedByteType;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.wrapS=texture.wrapT=texture.wrapR=THREE.RepeatWrapping;texture.unpackAlignment=1;texture.needsUpdate=true;return texture;
 }));
 const textures=results.filter(r=>r.status==='fulfilled').map(r=>r.value),failure=results.find(r=>r.status==='rejected');
 if(failure||signal?.aborted){textures.forEach(t=>t.dispose());throw failure?.reason??new Error('Cloud load aborted');}
 return textures;
}
