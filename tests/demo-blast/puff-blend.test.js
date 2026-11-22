import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,ShaderLib,Sprite,Texture} from 'three';
import {createPuffMaterial} from '../../src/particles/puff-material.js';
import {installBlastPuffBlend} from '../../bench/demo-blast/puff-blend.js';
import {puffRollPhase,puffRollRate} from '../../bench/demo-blast/plume-motion.js';

test('blast puff hook feathers only skirt tops and eases cloud rolling, including pool reuse',()=>{
  const {material}=createPuffMaterial(new Texture(),false,{});
  try {
    const look=installBlastPuffBlend(new Sprite(material));
    const shader={uniforms:{},fragmentShader:ShaderLib.sprite.fragmentShader};
    material.onBeforeCompile(shader);
    assert.ok(shader.fragmentShader.includes('mix(blastRollPhase(puffAge),cloudRollPhase,cloudRollClock)'));
    assert.ok(shader.fragmentShader.includes('smoothstep(0.,.9,(toWorld*q).y)'));
    assert.ok(shader.fragmentShader.includes('upperShare*(.65+.35*smoothstep(.25,.75,coarse))'));
    assert.ok(shader.fragmentShader.includes('skirtUpperBlend*.8*smoothstep(.12,.82,chord)'));
    assert.ok(!shader.fragmentShader.includes('smoothstep(.5, .95, vMapUv.y)'));
    assert.doesNotMatch(shader.fragmentShader,/light = mix\(light, 1.0, skirtUpperBlend/);
    assert.match(shader.fragmentShader,/for\(int j=0;j<3;j\+\+\)/);
    assert.equal(shader.uniforms.puffSelfShadow.value,.55);
    assert.ok(shader.fragmentShader.includes('mix(1.0, 2.0, blastRoll) * groundOpticalDepth'));
    assert.ok(shader.fragmentShader.includes('cloudLightResponse(light,opticalDepth*.7,dot(puffViewRay,puffSun)'));
    look.setTag({kind:'skirt'});
    look.setClock(12,10);
    assert.equal(shader.uniforms.cloudRollPhase.value,puffRollPhase(12)-puffRollPhase(10));
    assert.equal(shader.uniforms.cloudRollClock.value,1);
    assert.equal(shader.uniforms.headDriftDirection.value,-1);
    assert.equal(shader.uniforms.cloudLightCoverage.value,1);
    assert.equal(shader.uniforms.headRollGain.value,1.2);
    assert.equal(shader.uniforms.skirtUpperBlend.value,1);
    assert.equal(shader.uniforms.blastRoll.value,1);
    look.setTag({kind:'head'});
    assert.equal(shader.uniforms.cloudRollClock.value,0,'pool reuse clears the previous clock');
    assert.equal(shader.uniforms.groundDetailScale.value,1);
    assert.equal(shader.uniforms.groundOpticalDepth.value,1);
    assert.equal(shader.uniforms.headDriftDirection.value,-1);
    assert.equal(shader.uniforms.cloudLightCoverage.value,1);
    assert.equal(shader.uniforms.headRollGain.value,-1.6);
    assert.equal(shader.uniforms.skirtUpperBlend.value,0);
    assert.equal(shader.uniforms.blastRoll.value,1);
    look.setTag({kind:'ground'});
    assert.equal(shader.uniforms.groundDetailScale.value,1.6);
    assert.equal(shader.uniforms.groundOpticalDepth.value,1.6);
    assert.equal(shader.uniforms.headDriftDirection.value,1);
    assert.equal(shader.uniforms.cloudLightCoverage.value,1);
    assert.equal(shader.uniforms.headRollGain.value,1);
    assert.equal(shader.uniforms.skirtUpperBlend.value,0);
    assert.equal(shader.uniforms.blastRoll.value,0);
    look.setTag({kind:'ground',base:true});
    assert.equal(shader.uniforms.groundDetailScale.value,1.25);
    assert.equal(shader.uniforms.groundOpticalDepth.value,1.6);
    look.setTag({kind:'head'});
    assert.equal(shader.uniforms.groundDetailScale.value,1);
  } finally {material.map.dispose();material.dispose();}
});

test('puff scattering follows the eye-to-puff ray and ignores camera turns in place',()=>{
  const texture=new Texture(),{material}=createPuffMaterial(texture,false,{});
  const sprite=new Sprite(material),camera=new PerspectiveCamera();
  try{
    installBlastPuffBlend(sprite);
    const shader={uniforms:{},fragmentShader:ShaderLib.sprite.fragmentShader};
    material.onBeforeCompile(shader);
    sprite.position.set(10,30,4);camera.position.set(80,60,100);
    sprite.onBeforeRender(null,null,camera);
    const initial=shader.uniforms.puffViewRay.value.clone();
    camera.lookAt(-100,200,0);camera.updateMatrixWorld();
    sprite.onBeforeRender(null,null,camera);
    assert.ok(initial.distanceTo(shader.uniforms.puffViewRay.value)<1e-12);
    camera.position.x=-80;sprite.onBeforeRender(null,null,camera);
    assert.ok(initial.distanceTo(shader.uniforms.puffViewRay.value)>.1);
    assert.ok(shader.fragmentShader.includes('cloudLightResponse(light,opticalDepth*.7,dot(puffViewRay,puffSun)'));
  }finally{material.dispose();texture.dispose();}
});

test('rolling starts strong, eases to gentle motion, and never reverses phase',()=>{
  assert.equal(puffRollRate(0),2.5);
  assert.ok(puffRollRate(60)>.24&&puffRollRate(60)<.26);
  let phase=0;
  for(let age=.1;age<180;age+=.1) {
    const next=puffRollPhase(age);
    assert.ok(next>phase);
    assert.ok(Math.abs((next-phase)/.1/.65-puffRollRate(age-.05))<.001);
    phase=next;
  }
});
