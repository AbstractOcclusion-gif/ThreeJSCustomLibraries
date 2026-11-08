// Sun/moon/twilight formulas retained from WebAquarium; plain numeric output.
const DEG=Math.PI/180,wrap=(n,size)=>((n%size)+size)%size;
const smooth=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const direction=(out,elevation,azimuth)=>{const e=elevation*DEG,a=azimuth*DEG;out.x=Math.cos(e)*Math.cos(a);out.y=Math.sin(e);out.z=Math.cos(e)*Math.sin(a);};
export const DAY_DEFAULTS=Object.freeze({hour:12,auto:false,cycleSeconds:720,maxElevation:65,noonAzimuth:90,nightLight:.5,nightColor:'#b6caff',moonLight:false,moonOrbit:true,moonPhase:.5,moonAuto:true,moonCycleDays:29.53});
export class DayCycle {
 constructor(options={}){const{onEvent,...settings}=options;this.listeners=new Set();if(onEvent)this.listeners.add(onEvent);this.settings={...DAY_DEFAULTS};this.sunDir={x:0,y:1,z:0};this.moonDir={x:0,y:-1,z:0};this.lightDir={x:0,y:1,z:0};this.sunTint={r:1,g:1,b:1};this.phase=null;this.time=0;this.configure(settings);}
 subscribe(listener){if(typeof listener!=='function')throw Error('Day listener must be a function');this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 configure(values){
  const settings={...this.settings,...values};for(const key of Object.keys(values))if(!(key in DAY_DEFAULTS))throw Error('Unknown day setting: '+key);
  for(const key of ['hour','cycleSeconds','maxElevation','noonAzimuth','nightLight','moonPhase','moonCycleDays'])if(!Number.isFinite(settings[key]))throw Error('Invalid day setting: '+key);
  if(settings.cycleSeconds<=0||settings.moonCycleDays<=0||settings.maxElevation<0||settings.maxElevation>=90||settings.nightLight<0||settings.nightLight>1||typeof settings.nightColor!=='string')throw Error('Invalid day range');
  settings.hour=wrap(settings.hour,24);settings.moonPhase=wrap(settings.moonPhase,1);this.settings=settings;this.update(0);return this;
 }
 get hour(){return this.settings.hour;}
 get moonPhase(){return this.settings.moonPhase;}
 get isNight(){return this.night>.5;}
 setHour(hour){return this.configure({hour});}
 update(dt){
  if(!Number.isFinite(dt)||dt<0)throw Error('Day dt must be finite and non-negative');const s=this.settings;this.time+=dt;
  if(s.auto){const days=dt/s.cycleSeconds;s.hour=wrap(s.hour+days*24,24);if(s.moonAuto)s.moonPhase=wrap(s.moonPhase+days/s.moonCycleDays,1);}
  const elevation=s.maxElevation*Math.sin((s.hour-6)/12*Math.PI),azimuth=s.noonAzimuth+(s.hour-12)*15;direction(this.sunDir,elevation,azimuth);
  this.daylight=smooth(this.sunDir.y,-.16,.26);this.night=1-this.daylight;this.warm=1-smooth(this.sunDir.y,.03,.35);
  this.sunTint.r=1;this.sunTint.g=1-this.warm*.65;this.sunTint.b=1-this.warm*.94;
  if(s.moonOrbit){const angle=(s.hour-6)/24*Math.PI*2-s.moonPhase*Math.PI*2,e=Math.sin(angle)*s.maxElevation,a=(angle+Math.atan2(this.sunDir.z,this.sunDir.x)-(s.hour-6)/24*Math.PI*2)/DEG;direction(this.moonDir,e,a);}
  else{this.moonDir.x=-this.sunDir.x;this.moonDir.y=-this.sunDir.y;this.moonDir.z=-this.sunDir.z;}
  this.moonLit=s.moonLight&&this.isNight&&this.sunDir.y<.12;Object.assign(this.lightDir,this.moonLit?this.moonDir:this.sunDir);
  if(this.moonLit){this.lightDir.y=Math.max(.12,this.lightDir.y);const n=Math.hypot(this.lightDir.x,this.lightDir.y,this.lightDir.z);for(const k of ['x','y','z'])this.lightDir[k]/=n;}
  const phase=this.daylight>.95?'day':this.daylight<.05?'night':'twilight';
  if(phase!==this.phase){const previous=this.phase;this.phase=phase;if(previous!==null)for(const listener of this.listeners)listener({type:'day:phase-changed',previous,phase,hour:this.hour,time:this.time});}
  return this;
 }
 save(){return{type:'day',version:1,settings:{...this.settings},time:this.time};}
 restore(data){if(data?.type!=='day'||data.version!==1||!Number.isFinite(data.time)||data.time<0)throw Error('Unsupported day snapshot');const candidate=new DayCycle(data.settings);this.phase=candidate.phase;this.configure(candidate.settings);this.time=data.time;return this;}
}
export function hourLabel(hour){const h=wrap(hour,24);return`${String(Math.floor(h)).padStart(2,'0')}:${String(Math.floor(h%1*60+1e-8)).padStart(2,'0')}`;}
