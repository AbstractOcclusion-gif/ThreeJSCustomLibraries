// Weather profiles adapted from WebAquarium's inspected shared atmosphere table.
// No renderer, physics, DOM, quest engine or application imports.
const rows=[
 {name:'clear',visibility:6000,density:.25,wind:6,rain:0,snow:0,sunlight:1,bank:0,coverage:.3,cloud:[0,1,1,1,0],next:{'cloudy 1':3,'cloudy 2':1,foggy:.5}},
 {name:'overcast',visibility:2400,density:.5,wind:12,rain:.08,snow:0,sunlight:.22,bank:.6,coverage:.45,cloud:[1,1,1,1,.5],next:{'cloudy 3':2,stormy:1.5,foggy:1}},
 {name:'foggy',visibility:160,density:1,wind:4,rain:0,snow:0,sunlight:.12,bank:3,coverage:.75,cloud:[.68,1,1,1,.6],next:{clear:1,'cloudy 1':1,overcast:1}},
 {name:'stormy',visibility:850,density:1.1,wind:20,rain:1,snow:0,sunlight:.06,bank:1.2,coverage:.58,cloud:[1.03,1.2,1.4,.7,.8],next:{overcast:3,'cloudy 3':1}},
 {name:'cloudy 1',visibility:6000,density:.25,wind:7,rain:0,snow:0,sunlight:.95,bank:0,coverage:.3,cloud:[.3,.45,.65,1.3,.15],next:{clear:2,'cloudy 2':2,'cloudy 3':1}},
 {name:'cloudy 2',visibility:5000,density:.3,wind:9,rain:0,snow:0,sunlight:.8,bank:0,coverage:.3,cloud:[.53,.8,1.4,.6,.3],next:{'cloudy 1':2,'cloudy 3':2,clear:1}},
 {name:'cloudy 3',visibility:3500,density:.4,wind:10,rain:0,snow:0,sunlight:.55,bank:.2,coverage:.4,cloud:[.76,1.1,.9,.9,.45],next:{'cloudy 2':2,overcast:2,'cloudy 1':1}},
];
export const WEATHER_FIELDS=Object.freeze(['visibility','density','wind','rain','snow','sunlight','bank','coverage']);
export function defineWeatherStates(states){
 if(!Array.isArray(states)||!states.length)throw Error('Weather needs a non-empty state table');
 const names=new Set();
 for(const s of states){if(typeof s.name!=='string'||!s.name||names.has(s.name))throw Error('Weather state names must be unique non-empty strings');names.add(s.name);}
 return Object.freeze(states.map(s=>{
  for(const key of WEATHER_FIELDS)if(!Number.isFinite(s[key])||s[key]<0)throw Error(`${s.name}: ${key} must be finite and non-negative`);
  if(s.visibility<=0)throw Error(`${s.name}: visibility must be positive`);
  if(!Array.isArray(s.cloud)||s.cloud.length!==5||!s.cloud.every(v=>Number.isFinite(v)&&v>=0))throw Error(`${s.name}: cloud profile needs five non-negative numbers`);
  for(const [name,odds]of Object.entries(s.next??{}))if(!names.has(name)||!Number.isFinite(odds)||odds<=0)throw Error(`${s.name}: invalid automatic transition to ${name}`);
  return Object.freeze({...s,cloud:Object.freeze([...s.cloud]),next:Object.freeze({...s.next})});
 }));
}
export const DEFAULT_WEATHER_STATES=defineWeatherStates(rows);
