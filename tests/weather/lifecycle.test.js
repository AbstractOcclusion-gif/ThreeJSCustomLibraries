import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadCloudNoise,createCloudUniforms} from '../../src/weather/three/cloud-density.js';
import {createCloudWeatherMap} from '../../src/weather/three/cloud-weather-map.js';
import {createPrecipitation} from '../../src/weather/three/precipitation.js';
import {resolveVisualConfig,DYNAMIC_SKY_DEFAULTS,SKY_FIELDS} from '../../src/weather/three/settings.js';

test('visual config exposes every active sky setting and validates changes before application',()=>{
 const fields=Object.assign({},...Object.values(SKY_FIELDS));assert.deepEqual(Object.keys(fields).sort(),Object.keys(DYNAMIC_SKY_DEFAULTS).sort());
 const initial=resolveVisualConfig({precipitation:{count:120,radius:45}});
 const next=resolveVisualConfig({sky:{turbidity:1},appearance:{hemiIntensity:2},precipitation:{count:240}},initial);
 assert.equal(next.precipitation.radius,45);assert.equal(next.precipitation.count,240);assert.equal(initial.precipitation.count,120);
 for(const bad of [{sky:{quality:'ultra'}},{sky:{captureInterval:0}},{appearance:{sunIntensity:-1}},{precipitation:{count:1.5}},{precipitation:true},{sky:null},{unknown:1}])assert.throws(()=>resolveVisualConfig(bad,initial));
 assert.equal(resolveVisualConfig({precipitation:false},initial).precipitation,false);
});

test('noise volumes validate bytes and reject failed or cancelled loads',async()=>{
 const fetch=async url=>({ok:true,arrayBuffer:async()=>new ArrayBuffer((url.includes('base-64')?64:32)**3*4)});
 const textures=await loadCloudNoise('https://example.invalid/',{fetch});
 assert.deepEqual(textures.map(t=>t.image.width),[64,32]);assert.notEqual(textures[0],textures[1]);textures.forEach(t=>t.dispose());
 await assert.rejects(loadCloudNoise('https://example.invalid/',{fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(2)})}),/size/);
 const signal=AbortSignal.abort();await assert.rejects(loadCloudNoise('https://example.invalid/',{fetch,signal}),/aborted/);
});
test('offscreen weather map restores the caller render state, also on failure',()=>{
 const original={name:'host target'},viewport=new THREE.Vector4(2,3,40,50),scissor=new THREE.Vector4(6,7,20,30);
 for(const fail of [false,true]){
  let target=original,face=4,level=2,v=viewport.clone(),s=scissor.clone(),scissorTest=true;
  const renderer={getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>level,getViewport:out=>out.copy(v),getScissor:out=>out.copy(s),getScissorTest:()=>scissorTest,
   setRenderTarget(t,f=0,l=0){target=t;face=f;level=l;v.set(0,0,256,256);},setViewport:value=>v.copy(value),setScissor:value=>s.copy(value),setScissorTest:value=>scissorTest=value,
   render(){if(fail)throw Error('GPU failure');}};
  const uniforms=createCloudUniforms();if(fail)assert.throws(()=>createCloudWeatherMap(renderer,uniforms),/GPU failure/);
  else{const map=createCloudWeatherMap(renderer,uniforms);assert.equal(uniforms.tCloudWeather.value,map.texture);map.dispose();}
  assert.equal(target,original);assert.equal(face,4);assert.equal(level,2);assert.deepEqual(v,viewport);assert.deepEqual(s,scissor);assert.equal(scissorTest,true);
 }
});
test('precipitation is bounded, isolated and releases its scene nodes/resources',()=>{
 const group=new THREE.Group();assert.throws(()=>createPrecipitation(group,{radius:0}),/radius/);assert.equal(group.children.length,0);
 const rain=createPrecipitation(group,{count:100});const nodes=[...group.children];let disposed=0;
 for(const n of nodes){n.geometry.addEventListener('dispose',()=>disposed++);n.material.addEventListener('dispose',()=>disposed++);}
 rain.update(1,{windHeading:0,wind:6,rain:2,snow:.25},{daylight:1},new THREE.Vector3(2,3,4));
 assert.equal(rain.instanceCount,125);assert.equal(nodes[0].geometry.instanceCount,100);
 rain.dispose();assert.equal(group.children.length,0);assert.equal(disposed,4);
});
