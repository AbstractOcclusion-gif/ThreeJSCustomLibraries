import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Scene,Vector3} from 'three';
import {createFireball} from '../../bench/demo-blast/fireball.js';
import {FIRE_LOOK} from '../../bench/demo-blast/fire-look.js';

test('head parcels fade into shell placement without transparent parcels moving boundaries',()=>{
  const scene=new Scene(),camera=new PerspectiveCamera(48,1.4,.4,5000);
  const fire=createFireball(scene,{...FIRE_LOOK},null,
    {extent:new Vector3(120,216,120),texture:null,head:{height:40,radius:26}},null,40);
  try{
    fire.update(0,5,new Vector3(),1);
    camera.position.set(135,52,218);camera.lookAt(0,68,0);
    const read=()=>scene.children.filter(o=>o.isMesh).map(o=>[o.userData.shell.x,o.userData.shell.y]);
    fire.sort(camera);const empty=read();
    const near=empty[0][0],span=empty.at(-1)[1]-near;
    const distances=Array.from({length:100},(_,i)=>near+span*(.45+i/1000));
    fire.sort(camera,distances,distances.map(()=>0));
    assert.deepEqual(read(),empty);
    fire.sort(camera,distances,distances.map(()=>.0001));
    assert.ok(read().every((shell,i)=>Math.abs(shell[0]-empty[i][0])<span*.000001));
    let previous=read();
    for(let opacity=.01;opacity<=1.001;opacity+=.01){
      fire.sort(camera,distances,distances.map(()=>opacity));
      const current=read();
      for(let i=0;i<current.length;i++){
        assert.ok(current[i][1]>=current[i][0]);
        if(i)assert.equal(current[i][0],current[i-1][1]);
        assert.ok(Math.abs(current[i][0]-previous[i][0])<span*.06);
      }
      previous=current;
    }
    const shader=scene.children.find(o=>o.isMesh).material.fragmentShader;
    assert.ok(shader.includes('gasBillow(baseQ,'));
    assert.ok(shader.includes('float headBottom=headHeight-max(13.,headRadius)'));
    assert.ok(shader.includes('mix(displacement,gasNoiseWarp(baseDomain),detailBelow)*joinGain'));
    assert.ok(shader.includes('-.5)*joinDetailGain,0.,1.)'));
    assert.ok(!shader.includes('age*.13*mix(-1.,1.,belowHead)'));
    assert.ok(!shader.includes('domain+=earlyHead*'));
    assert.ok(!shader.includes('q+=earlyHead*'));
    assert.match(shader,/cellStart\+\.5\*rayStep/);
    assert.doesNotMatch(shader,/enter\+\(float\(i\)\+\.5\)\*stepSize/);
  }finally{fire.dispose();}
});
