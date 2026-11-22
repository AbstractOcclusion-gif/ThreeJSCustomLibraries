import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Scene,Texture,TextureLoader,Vector3} from 'three';
import {createMushroomCloud} from '../../bench/demo-blast/cloud.js';
import {BLAST_QUALITY} from '../../bench/demo-blast/quality.js';

test('outer ring builds, holds its footprint, then settles; reset releases its held pose',async()=>{
  const original=TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync=async()=>{const t=new Texture();t.image={width:64,height:64};return t;};
  const scene=new Scene(),camera=new PerspectiveCamera();camera.position.set(135,52,218);
  let cloud;
  try{
    cloud=await createMushroomCloud(scene,{quality:BLAST_QUALITY.low});cloud.start(new Vector3());
    const advance=(from,to)=>{for(let time=from;time<to-.001;time+=.05){cloud.update(.05);cloud.sort(camera);}};
    advance(0,2);
    const ring=scene.children.find(o=>o.isSprite&&o.userData.cloudFlowTag?.kind==='ground'&&!o.userData.cloudFlowTag.base);
    assert.ok(ring);const small=ring.scale.y;
    advance(2,8);assert.ok(ring.scale.y>small);
    advance(8,13);assert.ok(ring.userData.ringRest);
    const x=ring.position.x,z=ring.position.z,width=ring.scale.x,height=ring.scale.y,y=ring.position.y;
    advance(13,16);
    assert.equal(ring.position.x,x);assert.equal(ring.position.z,z);assert.equal(ring.scale.x,width);
    advance(16,30);
    assert.ok(ring.position.y<y);assert.ok(ring.scale.y<height);
    cloud.start(new Vector3());advance(0,2);
    for(const sprite of scene.children.filter(o=>o.isSprite&&o.visible))assert.equal(sprite.userData.ringRest,undefined);
  }finally{cloud?.dispose();TextureLoader.prototype.loadAsync=original;}
});
