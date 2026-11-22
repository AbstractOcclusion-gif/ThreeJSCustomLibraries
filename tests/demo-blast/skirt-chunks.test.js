import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Scene,Texture} from 'three';
import {createSkirtChunks,SKIRT_CHUNKS} from '../../bench/demo-blast/skirt-chunks.js';

test('skirt fragments descend slowly, follow smoke, stay bounded, and restart without stale instances',async()=>{
  const scene=new Scene(),matrix=new Matrix4();
  const chunks=await createSkirtChunks(scene,{heightAt:()=>0,loadTexture:async()=>{
    const texture=new Texture();texture.image={width:64,height:64};return texture;
  }});
  const sample=(out,index)=>{out.set(index*5,100,0);return true;};
  try{
    for(let i=0;i<8;i++)chunks.update(0,10+i,sample);
    assert.equal(chunks.active,SKIRT_CHUNKS.count);
    const pieces=scene.children.filter(o=>o.isBatchedMesh);
    assert.equal(pieces.length,4);
    pieces[0].getMatrixAt(0,matrix);const initialY=matrix.elements[13];
    for(let i=0;i<120;i++)chunks.update(1/60,20,null);
    pieces[0].getMatrixAt(0,matrix);
    const descent=initialY-matrix.elements[13];
    assert.ok(descent>0&&descent<3,`slow descent: ${descent}`);
    const smoke=scene.children.filter(o=>o.isSprite&&o.visible);
    assert.ok(smoke.length>0&&smoke.length<=SKIRT_CHUNKS.trailPool);
    chunks.clear();assert.equal(chunks.active,0);
    assert.ok(scene.children.filter(o=>o.isSprite).every(o=>!o.visible));
    chunks.update(0,10,sample);assert.equal(chunks.active,1);
    pieces[0].getMatrixAt(0,matrix);assert.equal(matrix.elements[13],100);
  }finally{chunks.dispose();}
  assert.equal(scene.children.length,0);
});
