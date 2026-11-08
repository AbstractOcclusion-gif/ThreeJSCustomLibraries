import {DEFAULT_WEATHER_STATES,WEATHER_FIELDS,defineWeatherStates} from './states.js';

const finite=(value,name,min=0)=>{if(!Number.isFinite(value)||value<min)throw Error(`${name} must be finite and >= ${min}`);return value;};
const smooth=t=>t*t*(3-2*t);
function range(value,name,min){if(!Array.isArray(value)||value.length!==2)throw Error(`${name} needs [minimum, maximum]`);value.forEach(v=>finite(v,name,min));return [...value].sort((a,b)=>a-b);}

export class Weather {
 constructor({states=DEFAULT_WEATHER_STATES,initial=states[0]?.name,transitionSeconds=45,seed=1,onEvent,auto=false,holdSeconds=[120,360],autoTransitionSeconds=[40,120],windHeading=0,windScale=1,fogScale=1,rainScale=1}={}){
  this.states=defineWeatherStates(states);this.names=this.states.map(s=>s.name);this.index(initial);
  this.duration=finite(transitionSeconds,'transitionSeconds');this.defaultDuration=this.duration;this.elapsed=this.duration;this.current=this.target=initial;this.time=0;
  this.weights=this.names.map(n=>Number(n===initial));this.start=this.weights.slice();this.cloudProfile=new Array(5).fill(0);this.listeners=new Set();if(onEvent)this.listeners.add(onEvent);
  if(!Number.isInteger(seed))throw Error('Weather seed must be an integer');this.randomState=seed>>>0;
  this.enabled=true;this.scales={wind:finite(windScale,'windScale'),fog:finite(fogScale,'fogScale'),rain:finite(rainScale,'rainScale')};
  this.windHeading=finite(windHeading,'windHeading',-Infinity);this.auto={enabled:false,hold:range(holdSeconds,'holdSeconds',.1),transition:range(autoTransitionSeconds,'autoTransitionSeconds',0)};this.autoRemaining=0;
  this.update(0);this.setAuto(auto);
 }
 index(name){const i=this.names.indexOf(name);if(i<0)throw Error(`Unknown weather state: ${name}`);return i;}
 get on(){return this.enabled;}
 get transitioning(){return this.elapsed<this.duration;}
 get dominant(){return this.names[this.weights.indexOf(Math.max(...this.weights))];}
 get weightsByName(){return Object.fromEntries(this.names.map((n,i)=>[n,this.weights[i]]));}
 subscribe(listener){if(typeof listener!=='function')throw Error('Weather listener must be a function');this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 emit(type,data){const event=Object.freeze({type,time:this.time,...data});for(const listener of this.listeners)listener(event);}
 random(){this.randomState=(Math.imul(1664525,this.randomState)+1013904223)>>>0;return this.randomState/4294967296;}
 between([a,b]){return a+(b-a)*this.random();}
 transitionTo(name,{seconds=this.defaultDuration}={}){
  this.index(name);finite(seconds,'transition duration');
  if(name===this.target&&(this.transitioning||this.current===name))return this;
  const from=this.dominant;this.target=name;this.start=this.weights.slice();this.elapsed=0;this.duration=seconds;
  this.emit('weather:transition-start',{from,to:name,duration:seconds});
  if(seconds===0){this.advance(0);this.blend();}
  if(this.auto.enabled)this.autoRemaining=seconds+this.between(this.auto.hold);
  return this;
 }
 setAuto(enabled,{holdSeconds=this.auto.hold,transitionSeconds=this.auto.transition}={}){
  const hold=range(holdSeconds,'holdSeconds',.1),transition=range(transitionSeconds,'autoTransitionSeconds',0);
  this.auto={enabled:!!enabled,hold,transition};this.autoRemaining=enabled?Math.max(0,this.duration-this.elapsed)+this.between(hold):0;return this;
 }
 setEnabled(enabled){this.enabled=!!enabled;this.blend();return this;}
 setStates(states){
  const rows=defineWeatherStates(states),names=rows.map(s=>s.name),weights=this.weightsByName,start=Object.fromEntries(this.names.map((n,i)=>[n,this.start[i]]));
  if(names.length!==this.names.length||names.some(n=>!this.names.includes(n)))throw Error('Live profile editing must keep the same state names');
  this.states=rows;this.names=names;this.weights=names.map(n=>weights[n]);this.start=names.map(n=>start[n]);this.blend();return this;
 }
 setScales({wind=this.scales.wind,fog=this.scales.fog,rain=this.scales.rain}={}){this.scales={wind:finite(wind,'wind scale'),fog:finite(fog,'fog scale'),rain:finite(rain,'rain scale')};this.blend();return this;}
 chooseNext(){const entries=Object.entries(this.states[this.index(this.target)].next);if(!entries.length)return this.target;let roll=this.random()*entries.reduce((sum,[,v])=>sum+v,0);for(const [name,odds]of entries){roll-=odds;if(roll<=0)return name;}return entries.at(-1)[0];}
 advance(dt){
  const wasTransitioning=this.transitioning;this.time+=dt;this.elapsed=Math.min(this.duration,this.elapsed+dt);
  const t=this.duration===0?1:smooth(this.elapsed/this.duration),index=this.index(this.target);
  for(let i=0;i<this.weights.length;i++)this.weights[i]=this.start[i]+(Number(i===index)-this.start[i])*t;
  if(!this.transitioning&&(wasTransitioning||this.current!==this.target)){const previous=this.current;this.current=this.target;this.blend();this.emit('weather:changed',{previous,state:this.current});}
 }
 blend(){
  const weights=this.enabled?this.weights:this.names.map((_,i)=>Number(i===0));
  for(const key of WEATHER_FIELDS)this[key]=this.states.reduce((sum,s,i)=>sum+s[key]*weights[i],0);
  this.wind*=this.scales.wind;this.density*=this.scales.fog;this.rain*=this.scales.rain;this.snow*=this.scales.rain;
  for(let j=0;j<5;j++)this.cloudProfile[j]=this.states.reduce((sum,s,i)=>sum+s.cloud[j]*weights[i],0);
 }
 update(dt){
  finite(dt,'weather dt');if(!this.enabled||dt===0){this.blend();return this;}
  if(!this.auto.enabled)this.advance(dt);
  else{
   let remaining=dt;
   while(remaining>1e-10||this.autoRemaining<=1e-10){
    if(this.autoRemaining<=1e-10){const next=this.chooseNext();const duration=this.between(this.auto.transition);this.transitionTo(next,{seconds:duration});this.autoRemaining=duration+this.between(this.auto.hold);}
    if(remaining<=1e-10)break;
    const step=Math.min(remaining,this.autoRemaining);this.advance(step);this.autoRemaining-=step;remaining-=step;
   }
  }
  this.blend();return this;
 }
 save(){return{type:'weather',version:1,current:this.current,target:this.target,weights:this.weightsByName,start:Object.fromEntries(this.names.map((n,i)=>[n,this.start[i]])),duration:this.duration,elapsed:this.elapsed,time:this.time,defaultDuration:this.defaultDuration,randomState:this.randomState,enabled:this.enabled,scales:{...this.scales},windHeading:this.windHeading,auto:structuredClone(this.auto),autoRemaining:this.autoRemaining};}
 restore(data){
  if(data?.type!=='weather'||data.version!==1)throw Error('Unsupported weather snapshot');
  this.index(data.current);this.index(data.target);
  const readWeights=map=>{if(!map||Object.keys(map).length!==this.names.length)throw Error('Snapshot state table differs');const values=this.names.map(n=>finite(map[n],`weight ${n}`));if(Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-6)throw Error('Snapshot weights must sum to one');return values;};
  const weights=readWeights(data.weights),start=readWeights(data.start);
  for(const key of ['duration','elapsed','time','defaultDuration','autoRemaining'])finite(data[key],key);
  if(data.elapsed>data.duration||!Number.isInteger(data.randomState)||data.randomState<0||data.randomState>0xffffffff)throw Error('Invalid weather snapshot timing/RNG');
  const auto={enabled:!!data.auto?.enabled,hold:range(data.auto?.hold,'holdSeconds',.1),transition:range(data.auto?.transition,'autoTransitionSeconds',0)};
  const scales={wind:finite(data.scales?.wind,'wind scale'),fog:finite(data.scales?.fog,'fog scale'),rain:finite(data.scales?.rain,'rain scale')};finite(data.windHeading,'windHeading',-Infinity);
  Object.assign(this,{current:data.current,target:data.target,weights,start,duration:data.duration,elapsed:data.elapsed,time:data.time,defaultDuration:data.defaultDuration,randomState:data.randomState,enabled:!!data.enabled,scales,windHeading:data.windHeading,auto,autoRemaining:data.autoRemaining});this.blend();return this;
 }
}
