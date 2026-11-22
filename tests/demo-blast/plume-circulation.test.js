import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,Texture,Vector3} from 'three';
import {createPlumeFlow} from '../../bench/demo-blast/plume-flow.js';
import {FIRE_LOOK,ignitionScale} from '../../bench/demo-blast/fire-look.js';
import {plumeOffset} from '../../bench/demo-blast/plume-motion.js';
import {createPuffs} from '../../src/particles/puffs.js';

test('column bend remains small and leaves its base and cap anchored',()=>{
  const head=80,time=20;
  assert.deepEqual(plumeOffset(0,time,head),[0,0]);
  // A head below the sample disables the added stem bend; compare the same
  // base drift to isolate its contribution without duplicating its formula.
  assert.deepEqual(plumeOffset(head,time,head),plumeOffset(head,time,14));
  const bent=plumeOffset(22,time,head),base=plumeOffset(22,time,14);
  const displacement=Math.hypot(bent[0]-base[0],bent[1]-base[1]);
  assert.ok(displacement>.1&&displacement<2);
});

test('head circulation rises centrally, spreads at the top, and descends at the rim',()=>{
  const flow=createPlumeFlow(new Vector3(),1,{...FIRE_LOOK});
  const out=new Vector3(),tag={kind:'head',stationary:true};
  try{
    flow.sample(out,.5,14,0,tag);assert.ok(out.y>0);
    flow.sample(out,6,24,0,tag);assert.ok(out.x>0);
    flow.sample(out,12,14,0,tag);assert.ok(out.y<0);
    const position=new Vector3(6,14,0);
    for(let i=0;i<2400;i++){
      flow.sample(out,position.x,position.y,position.z,tag);
      position.addScaledVector(out,1/60);
      assert.ok(position.distanceTo(new Vector3(0,14,0))<18);
    }
  }finally{flow.dispose();}
});

test('head friction reduces circulation without reversing the central rise',()=>{
  const slow=createPlumeFlow(new Vector3(),1,{...FIRE_LOOK,headFriction:1});
  const fast=createPlumeFlow(new Vector3(),1,{...FIRE_LOOK,headFriction:0});
  const a=new Vector3(),b=new Vector3(),tag={kind:'head',stationary:true};
  try{
    slow.sample(a,.5,14,0,tag);fast.sample(b,.5,14,0,tag);
    assert.ok(a.y>0&&a.y<b.y);
  }finally{slow.dispose();fast.dispose();}
});

test('eased growth decelerates, preserves the size endpoint, and reports emission identity',async()=>{
  const scene=new Scene(),tag={kind:'head'};let emitted;
  const pool=await createPuffs(scene,{pool:1,onEmit:(sprite,info)=>{emitted={sprite,info};},
    loadTexture:async()=>{const texture=new Texture();texture.image={width:64,height:64};return texture;}});
  try{
    pool.emit('dust-soft',new Vector3(),[0,0,0],10,10,0xffffff,0,{grow:1,growthEase:4.5,flowTag:tag});
    assert.equal(emitted.sprite,scene.children[0]);assert.equal(emitted.info.flowTag,tag);
    const widths=[scene.children[0].scale.y];
    for(let i=0;i<3;i++){pool.update(2.5);widths.push(scene.children[0].scale.y);}
    assert.ok(widths[1]-widths[0]>widths[2]-widths[1]);
    assert.ok(widths[2]-widths[1]>widths[3]-widths[2]);
    pool.update(2.499);assert.ok(Math.abs(scene.children[0].scale.y-20)<.001);
    assert.equal(ignitionScale(0),.04);assert.ok(ignitionScale(.65)<.5);assert.equal(ignitionScale(1.4),1);
  }finally{pool.dispose();}
});
