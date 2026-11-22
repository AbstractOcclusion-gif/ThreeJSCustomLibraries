import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Scene, ShaderLib, Texture, TextureLoader, Vector3} from 'three';
import {createMushroomCloud} from '../../bench/demo-blast/cloud.js';
import {createBlastScale} from '../../bench/demo-blast/blast-scale.js';
import {BLAST_QUALITY} from '../../bench/demo-blast/quality.js';

test('late cloud keeps solving and moving parcels after feed ends; reset clears it', async () => {
  const original=TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync=async()=>{
    const texture=new Texture();texture.image={width:64,height:64};return texture;
  };
  const scene=new Scene();let cloud;
  try {
    cloud=await createMushroomCloud(scene,{quality:BLAST_QUALITY.low,scale:createBlastScale(1)});
    cloud.start(new Vector3());
    for(let i=0;i<80*40;i++) cloud.update(1/40);
    assert.ok(cloud.diagnostics.late,'bulk ascent started');
    const before=cloud.diagnostics.time;
    const gasBefore=cloud.shadowField.uniforms.gas.value.image.data.slice();
    const rollBefore=cloud.shadowField.uniforms.age.value;
    const sprite=scene.children.find(object=>object.isSprite&&object.visible&&object.userData.cloudFlowTag?.kind==='head');
    assert.ok(sprite,'head detail remains alive');
    const position=sprite.position.clone();
    for(let i=0;i<40;i++) cloud.update(1/40);
    assert.ok(Math.abs(cloud.diagnostics.time-before-.8)<.026,'fluid keeps its normal rate after handoff');
    assert.ok(sprite.position.distanceTo(position)>.001,'local parcel advection continues');
    const gasAfter=cloud.shadowField.uniforms.gas.value.image.data;
    let beforeMass=0,afterMass=0;
    for(let i=1;i<gasAfter.length;i+=4){beforeMass+=gasBefore[i];afterMass+=gasAfter[i];}
    let redistribution=0;
    for(let i=1;i<gasAfter.length;i+=4)redistribution+=Math.abs(gasBefore[i]/beforeMass-gasAfter[i]/afterMass);
    assert.ok(redistribution>1e-5,'gas redistributes after column shutdown, beyond uniform fading');
    assert.ok(cloud.shadowField.uniforms.age.value>rollBefore,'gas texture animation continues');
    const camera=new PerspectiveCamera();camera.position.set(150,60,220);cloud.sort(camera);
    const gas=scene.children.find(object=>object.isMesh);
    const uniforms=gas.material.uniforms;
    const gasFrequency=.644/(uniforms.billowWidth.value*uniforms.worldScale.value*uniforms.warp.value.w);
    for(const kind of ['head','skirt']){
      const puff=scene.children.find(o=>o.isSprite&&o.visible&&o.userData.cloudFlowTag?.kind===kind);
      assert.ok(puff);
      const shader={uniforms:{},fragmentShader:ShaderLib.sprite.fragmentShader};
      puff.material.onBeforeCompile(shader);
      const puffFrequency=.92*shader.uniforms.groundDetailScale.value/puff.scale.y;
      assert.ok(Math.abs(puffFrequency-gasFrequency)<1e-9,`${kind} and gas keep the same world billow frequency after expansion`);
      assert.ok(shader.fragmentShader.includes('grainFace*.46*groundDetailScale'));
    }
    assert.equal(gas.material.uniforms.columnOpacity.value,0);
    assert.equal(gas.material.uniforms.warp.value.x,gas.material.uniforms.headHeight.value,
      'evolving local head is anchored to the bulk ascent');
    for(let i=0;i<640;i++) cloud.update(.25);
    assert.ok(scene.children.some(object=>object.isSprite&&object.visible&&object.userData.cloudFlowTag?.kind==='head'),
      'head billows survive beyond their old expiry while the cloud remains visible');
    cloud.clear();
    assert.equal(cloud.active,0);assert.equal(cloud.diagnostics.time,0);
    assert.equal(cloud.diagnostics.late,null);
    cloud.start(new Vector3());cloud.update(.1);
    assert.ok(cloud.diagnostics.time>0);assert.equal(cloud.diagnostics.late,null);
  } finally {cloud?.dispose();TextureLoader.prototype.loadAsync=original;}
});
