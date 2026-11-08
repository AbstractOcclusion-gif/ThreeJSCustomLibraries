import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Weather,DayCycle,createWeatherSystem,DEFAULT_WEATHER_STATES,defineWeatherStates,hourLabel} from '../../src/weather/index.js';
import {createCloudUniforms} from '../../src/weather/three/cloud-density.js';

test('core dependency graph contains no renderer, DOM, physics, quest or application dependency',()=>{
 for(const name of ['index.js','weather.js','day.js','states.js']){
  const source=fs.readFileSync(new URL('../../src/weather/'+name,import.meta.url),'utf8');const imports=[...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]);
  assert.ok(imports.every(p=>p.startsWith('./')&&!p.includes('three')));assert.ok(!/\b(?:window|document|localStorage|requestAnimationFrame)\b/.test(source));
 }
});
test('existing weather profiles blend smoothly and interrupted transitions keep their current mixture',()=>{
 const weather=new Weather();weather.transitionTo('stormy');weather.update(22.5);assert.ok(Math.abs(weather.rain-.5)<1e-8);assert.equal(weather.visibility,3425);
 const before=weather.weights.slice();weather.transitionTo('foggy',{seconds:10});weather.update(0);assert.deepEqual(weather.weights,before);weather.update(10);assert.equal(weather.current,'foggy');assert.equal(weather.visibility,160);
 weather.transitionTo('clear',{seconds:0});assert.equal(weather.current,'clear');assert.equal(weather.rain,0);
});
test('custom state rows, including snow, are data and do not depend on fixed names or array order',()=>{
 const base=DEFAULT_WEATHER_STATES[0],states=defineWeatherStates([{...base,name:'snow',snow:1,wind:3,next:{dry:1}},{...base,name:'dry',next:{snow:1}}]);
 const weather=new Weather({states,initial:'snow'});assert.equal(weather.snow,1);weather.transitionTo('dry',{seconds:1});weather.update(1);assert.equal(weather.snow,0);
 assert.throws(()=>defineWeatherStates([{...base,next:{missing:1}}]));assert.throws(()=>states[0].cloud.push(2));
});
test('automatic schedules are deterministic across frame sizes and save/restore preserves future choices',()=>{
 const options={seed:17,auto:true,holdSeconds:[1,1],autoTransitionSeconds:[2,2]},a=new Weather(options),b=new Weather(options);
 a.update(10);for(let i=0;i<100;i++)b.update(.1);assert.equal(a.target,b.target);assert.equal(a.randomState,b.randomState);a.weights.forEach((v,i)=>assert.ok(Math.abs(v-b.weights[i])<1e-8));
 const c=new Weather(options).restore(a.save());for(let i=0;i<20;i++){a.update(.37);c.update(.37);}assert.deepEqual(a.save(),c.save());
});
test('weather snapshots use state names, reject invalid data atomically and do not emit quest events on restore',()=>{
 const a=new Weather();a.transitionTo('stormy');a.update(5);const data=a.save(),b=new Weather({states:[...DEFAULT_WEATHER_STATES].reverse()});let events=0;b.subscribe(()=>events++);b.restore(data);assert.equal(events,0);assert.equal(b.rain,a.rain);assert.deepEqual(b.weightsByName,a.weightsByName);
 const before=b.save(),bad=structuredClone(data);bad.weights.clear=-1;assert.throws(()=>b.restore(bad));assert.deepEqual(b.save(),before);assert.throws(()=>b.update(-1));
});
test('each weather/day/visual uniform instance owns its own mutable state',()=>{
 const a=createWeatherSystem(),b=createWeatherSystem();a.weather.transitionTo('stormy',{seconds:0});a.day.setHour(0);assert.equal(b.weather.current,'clear');assert.equal(b.day.hour,12);
 const u=createCloudUniforms(),v=createCloudUniforms();u.uCloudOffset.value.x=90;assert.equal(v.uCloudOffset.value.x,0);assert.notEqual(u.tCloudBase,v.tCloudBase);
});
test('live profile editing preserves transition progress, name-based weights and listeners',()=>{
 const events=[],w=new Weather({onEvent:e=>events.push(e)});w.transitionTo('stormy',{seconds:10});w.update(3);
 const before=w.save(),rows=structuredClone(w.states).reverse();rows.find(r=>r.name==='stormy').wind=40;
 w.setStates(rows);assert.deepEqual(w.weightsByName,before.weights);assert.equal(w.elapsed,3);assert.ok(w.wind>6);
 const current=w.save(),bad=structuredClone(rows);bad[0].next.unknown=1;assert.throws(()=>w.setStates(bad));assert.deepEqual(w.save(),current);
 assert.throws(()=>w.setStates(rows.slice(1)));w.update(7);assert.equal(w.wind,40);assert.ok(events.some(e=>e.type==='weather:changed'));
});
test('day cycle has unit sun/moon directions, twilight, scene-light choice and a phase event',()=>{
 const events=[],day=new DayCycle({moonLight:true,onEvent:e=>events.push(e)});assert.ok(day.sunDir.y>.8);assert.equal(day.phase,'day');day.setHour(0);assert.equal(day.phase,'night');assert.ok(day.moonLit);assert.ok(day.lightDir.y>0);
 for(const vector of [day.sunDir,day.moonDir,day.lightDir])assert.ok(Math.abs(Math.hypot(vector.x,vector.y,vector.z)-1)<1e-8);
 day.setHour(6);assert.equal(day.phase,'twilight');assert.ok(events.some(e=>e.type==='day:phase-changed'));assert.equal(hourLabel(24),'00:00');assert.equal(hourLabel(-1),'23:00');
});
test('combined system pauses, round-trips and validates both branches before restoration',()=>{
 const events=[],a=createWeatherSystem({day:{auto:true,cycleSeconds:60},onEvent:e=>events.push(e)});a.weather.transitionTo('stormy',{seconds:10});a.update(3);a.paused=true;const before=a.save();a.update(100);assert.deepEqual(a.save(),before);
 const b=createWeatherSystem();b.restore(before);assert.deepEqual(b.save(),before);const bad=structuredClone(before);bad.day.settings.cycleSeconds=0;assert.throws(()=>b.restore(bad));assert.deepEqual(b.save(),before);
 a.paused=false;a.update(10);assert.ok(events.some(e=>e.type==='weather:changed'));const count=events.length;a.restore(before);assert.equal(events.length,count);
});
