// Public controls and validation share one schema. No renderer or DOM dependency.
const number=(label,min,max,step=0.01,help='')=>({label,type:'number',min,max,step,help});
const bool=label=>({label,type:'boolean'});
const color=label=>({label,type:'color'});
const choice=(label,options)=>({label,type:'select',options});
export const DAY_FIELDS=Object.freeze({
 hour:number('Hour',0,24,.05),auto:bool('Advance time'),cycleSeconds:number('Day duration · s',1,86400,1),
 maxElevation:number('Maximum sun elevation · degrees',0,89,.5),noonAzimuth:number('Noon azimuth · degrees',-360,360,1),
 nightLight:number('Scene night lighting',0,1,.01,'Controls scene lights and fog, independently of sky glow.'),
 nightColor:color('Scene night tint'),moonLight:bool('Moon lights the scene'),moonOrbit:bool('Moon orbit'),
 moonPhase:number('Moon phase · 0 new / 0.5 full',0,.9999,.01),moonAuto:bool('Advance moon phase'),moonCycleDays:number('Lunar cycle · days',.01,365,.01),
});
export const DYNAMIC_SKY_DEFAULTS=Object.freeze({
 quality:'mobile',clouds:true,coverage:.3,clearCoverage:0,overcastCoverage:.95,density:.006,
 bottom:700,distantDrop:0,thickness:450,scale:14000,detail:.25,windSpeed:8,windHeading:0,cloudDrift:1,brightness:5,ambient:1,
 turbidity:.5,rayleigh:1,mie:.0005,mieG:.8,exposure:.18,skySaturation:2.2,
 mapScale:30000,mapVariation:.35,captureInterval:.35,lightingInterval:3,
 cirrus:true,cirrusOpacity:.14,cirrusAltitude:4500,cirrusScale:16000,cirrusSpeed:12,
 nightResolution:128,starIntensity:1,galaxyIntensity:.2,nightIntensity:1,
 moon:true,moonRadiusDeg:1.5,moonIntensity:1,moonEarthshine:.02,
 aurora:false,auroraHeading:0,auroraIntensity:1,auroraSpeed:1,
 nightLight:.45,nightColor:'#8daeff',
 lightningStrength:3,lightningInterval:10,
});
export const SKY_FIELDS={
 'Atmosphere':{
  turbidity:number('Haze / turbidity',0,20,.1),rayleigh:number('Rayleigh scattering',0,10,.1),
  mie:number('Mie scattering',0,.1,.0001),mieG:number('Mie directionality',0,.99,.01),
  exposure:number('Sky exposure',.001,5,.001),skySaturation:number('Sky saturation',0,5,.05),
 },
 'Clouds':{
  clouds:bool('Volumetric clouds'),coverage:number('Manual coverage',0,1,.01,'Used when weather profiles are disabled.'),
  clearCoverage:number('Clear coverage endpoint',0,1),overcastCoverage:number('Overcast coverage endpoint',0,1),
  density:number('Cloud density',0,.1,.0001),bottom:number('Cloud base · m',1,15000,1),thickness:number('Thickness · m',1,10000,1),
  distantDrop:number('Distant cloud drop · m',0,300,5,'Lowers the apparent cloud base toward the horizon in the sky capture.'),
  scale:number('Shape scale · m',100,100000,100),detail:number('Detail erosion',0,.8),brightness:number('Sunlit cloud brightness',0,30,.1),ambient:number('Cloud ambient',0,10,.1),
  mapScale:number('Weather map scale · m',100,150000,100),mapVariation:number('Weather map variation',0,1),
  cloudDrift:number('Cloud drift ×',0,20,.1,'Scale on how fast the clouds travel with the wind. 1 is the real wind speed at cloud height.'),
  windSpeed:number('Manual wind · m/s',0,100,.5,'Used when weather profiles are disabled.'),windHeading:number('Manual heading · degrees',0,360,1,'Used when weather profiles are disabled.'),
 },
 'Cirrus':{cirrus:bool('Cirrus'),cirrusOpacity:number('Opacity',0,1),cirrusAltitude:number('Altitude · m',1,20000,1),cirrusScale:number('Scale · m',100,100000,100),cirrusSpeed:number('Drift · m/s',0,100,.5)},
 'Storm lightning':{
  lightningStrength:number('Cloud flash strength',0,8,.1,'Set to zero to disable storm flashes.'),
  lightningInterval:number('Average time between flashes · s',4,60,1),
 },
 'Night sky & moon':{
  nightLight:number('Sky glow',0,3,.01,'Sky and environment glow. Scene lighting is controlled separately below.'),
  nightColor:color('Sky glow color'),nightIntensity:number('Night sky intensity',0,10,.1),
  starIntensity:number('Stars',0,10,.1),galaxyIntensity:number('Galaxy',0,5,.05),
  moon:bool('Moon disc'),moonRadiusDeg:number('Moon radius · degrees',.05,10,.05),moonIntensity:number('Moon brightness',0,10,.1),moonEarthshine:number('Earthshine',0,1,.01),
 },
 'Aurora':{
  aurora:bool('Aurora curtains'),auroraHeading:number('Heading · degrees',0,360,1,'0 faces +X and 90 faces +Z.'),
  auroraIntensity:number('Curtain intensity',0,4,.05),auroraSpeed:number('Curtain animation speed',0,4,.05),
 },
 'Capture & performance':{
  quality:choice('Cloud quality',['mobile','low','medium','high']),
  nightResolution:choice('Minimum night cube size',[64,128,256,512,1024]),
  captureInterval:number('Sky capture interval · s',.05,30,.05),lightingInterval:number('Lighting refresh interval · s',.1,60,.1),
 },
};
export const APPEARANCE_DEFAULTS=Object.freeze({fog:true,fogColor:'#bcd3ce',visibilityScale:1,sunColor:'#fff0d5',sunIntensity:2.7,hemiColor:'#c9e0ef',groundColor:'#53634b',hemiIntensity:1.2,cloudShadowStrength:1,sunShafts:false,shaftStrength:1,shaftDensity:.0003,shaftHeight:350,shaftRange:6000,shaftContrast:1,shaftRays:1,shaftRayGlare:1.6,windStreaks:false,windStreakAmount:1,windDebris:false,windDebrisAmount:1,rainbow:true,rainbowStrength:1,rainbowSecond:true,heightFog:false,bankDensity:.025,bankHeight:16,bankScale:100,bankLevel:0,bankCoverage:.55,bankPuffiness:.65,bankDrift:.5,bankAmbientTint:.7,bankSunGlow:1,bankSteps:16});
export const APPEARANCE_FIELDS={
 cloudShadowStrength:number('Surface cloud shadow strength',0,1,.05,'Applies to materials registered as cloud shadow receivers.'),
 sunShafts:bool('Volumetric sunlight'),shaftStrength:number('Sun shaft strength',0,4,.05),
 shaftRays:number('Sun ray strength',0,4,.05,'Light streaks spreading from the sun through gaps in the clouds, cut by clouds, terrain and trees.'),
 shaftRayGlare:number('Sun ray glare threshold',.2,10,.05,'Sky brightness that counts as sun glare. Lower lets bright clouds feed the rays too; higher keeps only the sun.'),
 shaftDensity:number('Shaft haze density · 1/m',0,.01,.0001,'How much the air scatters sunlight near the ground.'),
 shaftHeight:number('Shaft haze height · m',10,3000,10,'The haze thins with altitude over this height: raise it toward the cloud base so beams show all the way up.'),
 shaftRange:number('Shaft range · m',100,12000,50,'How far the beams are traced.'),
 shaftContrast:number('Shaft shadow contrast',0,3,.05,'How much the air in cloud shadow darkens the view behind it. This is what separates the beams.'),
 windStreaks:bool('Wind streaks'),windStreakAmount:number('Wind streak amount',0,4,.05,'More streaks for the same wind. None show in calm air.'),
 windDebris:bool('Wind-blown leaves and dust'),windDebrisAmount:number('Wind debris amount',0,4,.05,'More debris for the same wind. None flies in a light breeze.'),
 rainbow:bool('Rainbow'),rainbowStrength:number('Rainbow strength',0,3,.05,'Shows while the air is still wet from rain and the sun is out.'),rainbowSecond:bool('Second rainbow'),
 heightFog:bool('3D height fog'),bankDensity:number('Bank density',0,.2,.001),
 bankHeight:number('Bank falloff height · m',1,200,1),bankScale:number('Bank noise scale · m',10,1000,1),
 bankLevel:number('Bank base elevation · m',-1000,1000,1),
 bankCoverage:number('Bank coverage',0,1,.01,'How much of the ground the banks cover: 0 scattered wisps, 1 one blanket.'),
 bankPuffiness:number('Bank puffiness',0,1,.01,'0 is a smooth blanket; 1 gives billows with lumpy, sharply lit tops.'),
 bankDrift:number('Bank wind drift',0,1.5,.01,'Share of the wind speed the banks travel at.'),
 bankAmbientTint:number('Bank ambient tint',0,1,.01,'How far the bank colour follows the sky light and the sun tint instead of the fog color.'),
 bankSunGlow:number('Bank sun glow',0,3,.05,'Sunlight scattered by the banks.'),
 bankSteps:choice('Bank quality · samples per pixel',[16,24,32,48]),
 fog:bool('Distance fog'),fogColor:color('Fog color'),visibilityScale:number('Visibility multiplier',.01,100,.01),
 sunColor:color('Sun / moon light color'),sunIntensity:number('Sun / moon base intensity',0,1000,.1),
 hemiColor:color('Ambient sky color'),groundColor:color('Ambient ground color'),hemiIntensity:number('Ambient base intensity',0,1000,.1),
};
export const PRECIPITATION_DEFAULTS=Object.freeze({count:800,radius:30,height:30,floorHeight:0});
export const PRECIPITATION_FIELDS={
 count:number('Maximum particles / type',1,6000,1),radius:number('Radius · m',.1,1000,.1),height:number('Height · m',.1,1000,.1),floorHeight:number('Floor height · m',-10000,10000,1),
};
const skyFields=Object.assign({},...Object.values(SKY_FIELDS));
function checked(values,fields,label){
 for(const [key,value]of Object.entries(values)){
  const field=fields[key];if(!field)throw Error('Unknown '+label+' setting: '+key);
  const valid=field.type==='boolean'?typeof value==='boolean':field.type==='color'?/^#[0-9a-f]{6}$/i.test(value):
   field.type==='select'?field.options.includes(value):Number.isFinite(value)&&value>=field.min&&value<=field.max;
  if(!valid||(key==='count'&&!Number.isInteger(value)))throw Error('Invalid '+label+' setting: '+key);
 }
 return values;
}
export function resolveVisualConfig(value={},base={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Visual config must be an object');
 for(const key of Object.keys(value))if(!['sky','appearance','precipitation'].includes(key))throw Error('Unknown visual section: '+key);
 for(const key of ['sky','appearance','precipitation'])if(key in value&&!(key==='precipitation'&&value[key]===false)&&(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key])))throw Error('Invalid visual section: '+key);
 const sky=checked({...DYNAMIC_SKY_DEFAULTS,...base.sky,...value.sky},skyFields,'sky');
 const appearance=checked({...APPEARANCE_DEFAULTS,...base.appearance,...value.appearance},APPEARANCE_FIELDS,'appearance');
 const requested=value.precipitation===undefined?base.precipitation:value.precipitation;
 const precipitation=requested===false?false:checked({...PRECIPITATION_DEFAULTS,...(base.precipitation||{}),...(requested??{})},PRECIPITATION_FIELDS,'precipitation');
 return{sky,appearance,precipitation};
}
