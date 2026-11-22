import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene, Texture, Vector3} from 'three';
import {createBlastScale} from '../../bench/demo-blast/blast-scale.js';
import {createLateCloud, mapLatePoint} from '../../bench/demo-blast/late-cloud.js';
import {createPuffs} from '../../src/particles/puffs.js';

test('bulk handoff inherits plume velocity and introduces acceleration without a speed jump',()=>{
  for(const yieldKt of [1,20])for(const rise of [0,.5,3]) {
    const scale=createBlastScale(yieldKt);
    const model=createLateCloud(scale,{height:70,radius:35,rise});
    const expected=rise*scale.length/scale.seconds;
    assert.equal(model.state.velocity,expected);
    const height=model.state.height;
    model.update(.01);
    assert.ok(Math.abs(model.state.velocity-expected)<1e-9);
    assert.ok(Math.abs(model.state.height-height-expected*.01)<1e-9);
    const limit=Math.max(expected,2*scale.length/scale.seconds);
    for(let i=0;i<600;i++){
      model.update(1);
      assert.ok(model.state.velocity<=limit+1e-8,'bulk rise cannot regain the old fast ascent');
    }
    assert.ok(model.state.height+model.state.radius>scale.cloud.top*.8);
    assert.ok(model.state.height+model.state.radius<scale.cloud.top*1.2);
  }
});

test('entraining thermals rise, brake, spread, and retain their configured visible lifetime', () => {
  for (const yieldKt of [1,20]) {
    const scale=createBlastScale(yieldKt), model=createLateCloud(scale,{height:70,radius:35});
    let atTenMinutes;
    for(let time=1;time<=scale.cloud.visibleSeconds;time++) {
      const state=model.update(1,{x:2,z:-1});
      assert.ok(Number.isFinite(state.height) && state.height>0);
      assert.ok(Math.abs(state.density*state.expansion-1)<1e-12);
      if(time<300 && state.height+state.radius<scale.cloud.top*.9) assert.equal(state.columnOpacity,1);
      if(time===600) atTenMinutes={...state};
    }
    assert.ok(atTenMinutes.height+atTenMinutes.radius>scale.cloud.top*.8);
    assert.ok(atTenMinutes.height+atTenMinutes.radius<scale.cloud.top*1.2);
    assert.equal(atTenMinutes.cloudOpacity,1);
    assert.ok(atTenMinutes.liquidExtinction>0);
    assert.ok(Math.abs(atTenMinutes.velocity)<3);
    assert.equal(model.state.settled,true);
    const settledHeight=model.state.height;
    model.update(60);
    assert.equal(model.state.height,settledHeight);
    assert.equal(model.state.velocity,0);
    assert.ok(model.state.radius>35*scale.length);
    assert.equal(model.state.cloudOpacity,0);
    assert.equal(model.state.columnOpacity,0);
    assert.ok(Math.abs(model.state.wind[0]*scale.length-scale.cloud.visibleSeconds*2*.15)<1e-6);
  }
});

test('late mapping is continuous at handoff and expands the head without stretching it', () => {
  const scale=createBlastScale(1), head={height:70,radius:35};
  const model=createLateCloud(scale,head), origin=new Vector3(7,3,-9), point=new Vector3(22,240,13);
  const out=new Vector3();
  mapLatePoint(out,point,origin,scale.length,model.state);
  assert.ok(out.distanceTo(point)<1e-9);
  model.update(600);
  const centre=origin.clone().add(new Vector3(0,head.height*scale.length,0));
  const mappedCentre=mapLatePoint(new Vector3(),centre,origin,scale.length,model.state);
  const distances=[[10,0,0],[0,10,0],[0,0,10]].map(offset=>
    mapLatePoint(new Vector3(),centre.clone().add(new Vector3(...offset)),origin,scale.length,model.state).distanceTo(mappedCentre));
  assert.ok(Math.max(...distances)-Math.min(...distances)<1e-9);
  const join=head.height-head.radius*1.35;
  const before=origin.clone().add(new Vector3(2,(join-1e-6)*scale.length,3));
  const after=origin.clone().add(new Vector3(2,(join+1e-6)*scale.length,3));
  assert.ok(mapLatePoint(out,before,origin,scale.length,model.state).distanceTo(
    mapLatePoint(new Vector3(),after,origin,scale.length,model.state))<.001);
});

test('held puff parcels retain age and position while volume noise keeps rolling', async () => {
  const scene=new Scene();
  const puffs=await createPuffs(scene,{pool:1,noiseVolume:{},loadTexture:async()=>{
    const texture=new Texture();texture.image={width:64,height:64};return texture;
  }});
  try {
    puffs.emit('dust-soft',new Vector3(),[1,2,3],10,1,0xffffff,0,{volume:true});
    const sprite=scene.children[0], shader={uniforms:{},fragmentShader:'#include <map_pars_fragment>\n#include <map_fragment>'};
    sprite.material.onBeforeCompile(shader);
    puffs.update(.25);
    const position=sprite.position.clone(),opacity=sprite.material.opacity;
    puffs.update(10,{ageDt:0,motionDt:0});
    assert.ok(sprite.position.equals(position));
    assert.equal(sprite.material.opacity,opacity);
    assert.equal(puffs.active,1);
    assert.equal(shader.uniforms.puffAge.value,10.25);
    puffs.update(.8);
    assert.equal(puffs.active,0);
    puffs.emit('dust-soft',new Vector3(),[0,0,0],10,1,0xffffff,0,{volume:true});
    puffs.update(.2);
    assert.equal(shader.uniforms.puffAge.value,.2);
  } finally {puffs.dispose();}
});
