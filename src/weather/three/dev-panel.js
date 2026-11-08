// Optional browser-only authoring UI. Never imported by the core or visual binding.
import {NoToneMapping,LinearToneMapping,ReinhardToneMapping,CineonToneMapping,ACESFilmicToneMapping,AgXToneMapping,NeutralToneMapping} from 'three';
import {Weather,DayCycle} from '../index.js';
import {DAY_FIELDS,SKY_FIELDS,APPEARANCE_FIELDS,PRECIPITATION_FIELDS,PRECIPITATION_DEFAULTS,resolveVisualConfig} from './settings.js';

const num=(label,min,max,step=.01,help='')=>({label,type:'number',min,max,step,help});
const flag=label=>({label,type:'boolean'});
const TONES={'None':NoToneMapping,'Linear':LinearToneMapping,'Reinhard':ReinhardToneMapping,'Cineon':CineonToneMapping,'ACES filmic':ACESFilmicToneMapping,'AgX':AgXToneMapping,'Neutral':NeutralToneMapping};

export function createWeatherDevPanel({system,view,renderer,container,onChange=()=>{}}={}){
 if(!system?.weather||!view?.getConfig||!renderer||!container)throw Error('Weather dev panel needs system, view, renderer and container');
 const root=document.createElement('section');root.className='weather-dev';container.append(root);
 const style=document.createElement('style');
 style.textContent='.weather-dev{font:12px/1.5 system-ui;color:inherit}.weather-dev *{box-sizing:border-box}.weather-dev .wd-search,.weather-dev textarea{width:100%;color:inherit;background:#07181780;border:1px solid #ffffff30;border-radius:6px;padding:8px}.weather-dev details{border-top:1px solid #ffffff20;padding-top:8px;margin-top:12px}.weather-dev summary{cursor:pointer;font-weight:600;color:#ebcf9f}.weather-dev .wd-field{display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:8px;align-items:center;margin:10px 0}.weather-dev .wd-field input,.weather-dev .wd-field select{width:100%;min-width:0;font:inherit;padding:6px;color:inherit;background:#081e2380;border:1px solid #ffffff30;border-radius:5px}.weather-dev .wd-field input[type=checkbox]{width:18px;height:18px;justify-self:end;accent-color:#e6be79}.weather-dev .wd-field input[type=color]{height:30px;padding:2px}.weather-dev .wd-field select option{background:#263c3d}.weather-dev textarea{min-height:220px;resize:vertical;font:10px/1.5 ui-monospace,monospace;tab-size:2}.weather-dev .wd-note{color:#aabfb8;font-size:11px}.weather-dev .wd-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.weather-dev .wd-message{white-space:pre-wrap;overflow-wrap:anywhere;color:#edcf9f}.weather-dev .wd-message[data-error=true]{color:#ffb3ad}.weather-dev [hidden]{display:none!important}';
 root.append(style);
 function element(tag,parent=root,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;parent.append(el);return el;}
 const intro=element('p',root,'All settings are live. Sky glow and scene night lighting are separate.');intro.className='wd-note';
 const search=element('input');search.type='search';search.placeholder='Find a setting…';search.className='wd-search';search.setAttribute('aria-label','Find developer setting');
 const message=element('p');message.className='wd-message';message.setAttribute('role','status');
 const fields=[],groups=[];
 function report(text,error=false){message.textContent=text;message.dataset.error=String(error);}
 function changed(action){try{action();view.configure({});refresh();onChange();report('Applied.');}catch(error){report(error.message,true);refresh();}}
 function group(title,open=false){const details=element('details');details.open=open;element('summary',details,title);groups.push(details);return details;}
 function field(parent,section,key,spec,read,write){
  const row=element('label',parent);row.className='wd-field';row.title=spec.help||spec.label;
  element('span',row,spec.label);
  const input=element(spec.type==='select'?'select':'input',row);input.id='dev-'+section+'-'+key;input.dataset.config=section+'.'+key;
  if(spec.type==='select'){
   const options=Array.isArray(spec.options)?spec.options.map(v=>[v,v]):Object.entries(spec.options);
   for(const [label,value]of options){const o=element('option',input,String(label));o.value=value;}
  }else{
   input.type=spec.type==='boolean'?'checkbox':spec.type==='color'?'color':'number';
   if(spec.type==='number'){input.min=spec.min;input.max=spec.max;input.step=spec.step;input.required=true;}
  }
  input.onchange=()=>changed(()=>{
   if(!input.checkValidity())throw Error('Invalid '+spec.label);
   const value=spec.type==='boolean'?input.checked:spec.type==='number'?Number(input.value):spec.type==='select'&&typeof read()==='number'?Number(input.value):input.value;
   write(value);
  });
  fields.push({row,input,spec,read});return input;
 }
 for(const [title,schema]of Object.entries(SKY_FIELDS)){
  const parent=group(title,title==='Atmosphere');
  if(title==='Clouds')element('p',parent,'Profile weather drives coverage, shape and wind. Disable profiles below to use manual coverage and wind.').className='wd-note';
  for(const [key,spec]of Object.entries(schema))field(parent,'sky',key,spec,()=>view.settings[key],value=>view.configure({sky:{[key]:value}}));
 }
 const clock=group('Day cycle & scene night lighting');
 for(const [key,spec]of Object.entries(DAY_FIELDS))field(clock,'day',key,spec,()=>system.day.settings[key],value=>system.day.configure({[key]:value}));
 const lighting=group('Scene lighting & fog');
 for(const [key,spec]of Object.entries(APPEARANCE_FIELDS))field(lighting,'appearance',key,spec,()=>view.getConfig().appearance[key],value=>view.configure({appearance:{[key]:value}}));
 const precipitation=group('Rain & snow');
 field(precipitation,'precipitation','enabled',flag('Precipitation rendering'),()=>view.getConfig().precipitation!==false,value=>view.configure({precipitation:value?lastPrecipitation:false}));
 let lastPrecipitation={...PRECIPITATION_DEFAULTS,...view.getConfig().precipitation};
 for(const [key,spec]of Object.entries(PRECIPITATION_FIELDS))field(precipitation,'precipitation',key,spec,()=>view.getConfig().precipitation?.[key]??lastPrecipitation[key],value=>{
  const next={...lastPrecipitation,[key]:value};view.configure({precipitation:next});lastPrecipitation=next;
 });
 const weather=group('Weather engine');
 field(weather,'weather','enabled',flag('Use weather profiles'),()=>system.weather.on,value=>system.weather.setEnabled(value));
 field(weather,'weather','auto',flag('Automatic transitions'),()=>system.weather.auto.enabled,value=>system.weather.setAuto(value));
 field(weather,'weather','defaultDuration',num('Manual transition duration · s',0,600,1),()=>system.weather.defaultDuration,value=>system.weather.defaultDuration=value);
 field(weather,'weather','windHeading',num('Weather wind heading · degrees',0,360,1),()=>system.weather.windHeading,value=>system.weather.windHeading=value);
 for(const key of ['wind','fog','rain'])field(weather,'scales',key,num(key==='rain'?'Rain / snow multiplier':key+' multiplier',0,10,.1),()=>system.weather.scales[key],value=>system.weather.setScales({[key]:value}));
 for(const [key,label]of [['hold','Hold'],['transition','Transition']])for(const [i,side]of ['minimum','maximum'].entries()){
  field(weather,'auto',key+i,num(label+' '+side+' · s',key==='hold'?.1:0,3600,.1),()=>system.weather.auto[key][i],value=>{
   const range=[...system.weather.auto[key]];range[i]=value;
   system.weather.setAuto(system.weather.auto.enabled,{[key==='hold'?'holdSeconds':'transitionSeconds']:range});
  });
 }
 const render=group('Renderer');
 field(render,'renderer','exposure',num('Renderer exposure',.01,10,.01),()=>renderer.toneMappingExposure,value=>renderer.toneMappingExposure=value);
 field(render,'renderer','toneMapping',{label:'Tone mapping',type:'select',options:TONES},()=>renderer.toneMapping,value=>renderer.toneMapping=value);
 const profiles=group('Weather profile data');
 element('p',profiles,'Edit visibility, wind, rain/snow, sunlight, cloud shape and next-state odds. Keep the same state names. bank/coverage are host data; this sky uses cloud[].').className='wd-note';
 const editor=element('textarea',profiles);editor.setAttribute('aria-label','Weather profile JSON');editor.spellcheck=false;
 const apply=element('button',profiles,'Apply profile data');apply.onclick=()=>changed(()=>system.weather.setStates(JSON.parse(editor.value)));
 function refreshProfiles(){editor.value=JSON.stringify(system.weather.states,null,2);}
 function refresh(){
  for(const {input,spec,read}of fields){
   if(document.activeElement===input)continue;const value=read();
   if(spec.type==='boolean')input.checked=value;else if(input.value!==String(value))input.value=value;
  }
  const current=view.getConfig().precipitation;if(current)lastPrecipitation=current;
 }
 function getPreset(){return{type:'weather-preset',version:1,states:structuredClone(system.weather.states),simulation:system.save(),visual:view.getConfig(),renderer:{exposure:renderer.toneMappingExposure,toneMapping:renderer.toneMapping}};}
 function loadPreset(data){
  if(data?.type==='weather-system'){system.restore(data);}
  else{
   if(data?.type!=='weather-preset'||data.version!==1)throw Error('Unsupported weather preset');
   new Weather({states:data.states}).restore(data.simulation?.weather);new DayCycle().restore(data.simulation?.day);
   if(data.simulation?.type!=='weather-system'||data.simulation.version!==1)throw Error('Missing simulation snapshot');
   const names=data.states.map(s=>s.name);
   if(names.length!==system.weather.names.length||names.some(n=>!system.weather.names.includes(n)))throw Error('Preset needs the same named weather profiles');
   if(!data.visual||!data.renderer||!Number.isFinite(data.renderer.exposure)||data.renderer.exposure<.01||data.renderer.exposure>10||!Object.values(TONES).includes(data.renderer.toneMapping))throw Error('Invalid visual/renderer preset');
   const visual=resolveVisualConfig(data.visual);
   // Validate all data before changing the live scene or simulation.
   view.configure(visual);system.weather.setStates(data.states);system.restore(data.simulation);
   renderer.toneMappingExposure=data.renderer.exposure;renderer.toneMapping=data.renderer.toneMapping;
  }
  view.configure({});refresh();refreshProfiles();onChange();report('Preset loaded.');
 }
 const initial=getPreset(),actions=element('div');actions.className='wd-actions';
 const reset=element('button',actions,'Reset defaults');reset.onclick=()=>{try{loadPreset(structuredClone(initial));}catch(error){report(error.message,true);}};
 const copy=element('button',actions,'Copy preset JSON');copy.onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(getPreset(),null,2));report('Preset copied.');}catch(error){report('Clipboard unavailable; use Save preset.',true);}};
 search.oninput=()=>{
  const term=search.value.trim().toLowerCase();for(const {row,input,spec}of fields)row.hidden=!!term&&!(spec.label+' '+input.dataset.config+' '+row.parentElement.querySelector('summary')?.textContent).toLowerCase().includes(term);
  for(const details of groups){const rows=fields.filter(f=>f.row.parentElement===details);details.hidden=!!term&&(!rows.length||rows.every(f=>f.row.hidden));if(term&&!details.hidden)details.open=true;}
 };
 refresh();refreshProfiles();
 return{element:root,refresh,getPreset,loadPreset,reset:()=>loadPreset(structuredClone(initial)),dispose(){root.remove();}};
}
