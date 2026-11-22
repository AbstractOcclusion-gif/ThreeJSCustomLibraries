import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Scene,Texture,TextureLoader,Vector3} from 'three';
import {cloudFadeState} from '../../bench/demo-blast/timing.js';
import {createCloudSettings} from '../../bench/demo-blast/cloud-settings.js';
import {createBlastScale} from '../../bench/demo-blast/blast-scale.js';
import {createMushroomCloud} from '../../bench/demo-blast/cloud.js';
import {BLAST_QUALITY} from '../../bench/demo-blast/quality.js';
import {FIRE_LOOK} from '../../bench/demo-blast/fire-look.js';

test('column holds longer, then column, skirt and cloud fade in order for both yields',()=>{
  for(const yieldKt of [1,20]) {
    const scale=createBlastScale(yieldKt),s=createCloudSettings(scale);
    const at=t=>cloudFadeState(t,s.lifecycle,s.visibility,scale.seconds);
    assert.equal(at(55).column,1,'old ground-settling cutoff no longer removes the column');
    assert.equal(at(80).column,.5);assert.equal(at(80).skirt,1);
    assert.equal(at(100).column,0);assert.equal(at(100).skirt,1);
    assert.equal(at(120).skirt,.5);assert.equal(at(120).cloud,1);
    assert.equal(at(140).skirt,0);assert.equal(at(140).cloud,1);
    const end=at(0);
    assert.equal(at(end.cloudStart).cloud,1);assert.equal(at(end.cloudEnd).cloud,0);
    assert.ok(Math.abs(end.cloudEnd*scale.seconds-s.visibility.visibleSeconds)<1e-9,'retain the existing cloud lifetime');
    const shortened=cloudFadeState(140,s.lifecycle,{fadeStart:1,visibleSeconds:2},scale.seconds);
    assert.equal(shortened.cloud,1,'custom lifetimes cannot fade the cloud ahead of the skirt');
  }
});

test('early skirt ignores the head-detail gate and actual late sprites follow staged fades',async()=>{
  const original=TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync=async()=>{const t=new Texture();t.image={width:64,height:64};return t;};
  const scale=createBlastScale(1),settings=createCloudSettings(scale),scene=new Scene();let cloud;
  settings.blend.detailStart=30;settings.blend.detailEnd=40;
  try {
    cloud=await createMushroomCloud(scene,{scale,size:scale.length,settings,quality:BLAST_QUALITY.low,
      fireLook:{...FIRE_LOOK,cloudMotion:'shared'}});
    cloud.start(new Vector3());let age=0;
    const advance=target=>{while(age<target-1e-8){const dt=Math.min(1/30,target-age);cloud.update(dt);age+=dt;}};
    const visible=kind=>scene.children.filter(o=>o.isSprite&&o.visible&&o.material.opacity>.01&&o.userData.cloudFlowTag?.kind===kind);
    const camera=new PerspectiveCamera();camera.position.set(150,60,220).multiplyScalar(scale.length);
    advance(2.5);cloud.sort(camera);
    assert.ok(visible('skirt').length,'early skirt survives the render pass before the old reveal gate');
    advance(8);
    assert.ok(visible('skirt').length,'skirt appears before the head detail reveal');
    assert.equal(visible('head').length,0,'head still obeys its own detail gate');
    advance(80);
    const u=cloud.shadowField.uniforms;
    assert.ok(Math.abs(u.columnOpacity.value-.5)<1e-10);assert.equal(u.headFadeEnvelope.value,1);
    cloud.sort(camera);assert.ok(visible('skirt').length);
    assert.ok(visible('ground').length,'ground billows remain after the old second-55 cutoff');
    advance(100);cloud.sort(camera);
    assert.ok(u.columnOpacity.value<1e-10);assert.ok(visible('skirt').length,'skirt outlives the column');
    advance(120);cloud.sort(camera);
    assert.ok(Math.abs(cloud.diagnostics.late.skirtOpacity-.5)<1e-10);
    const skirt=visible('skirt')[0];assert.ok(skirt);
    const unfaded=skirt.userData.fullOpacity*skirt.userData.heatFade;
    assert.ok(Math.abs(skirt.material.opacity/unfaded-.5)<1e-9,'actual sprite alpha follows the skirt clock');
    advance(140.1);cloud.sort(camera);
    assert.equal(visible('skirt').length,0);assert.ok(visible('head').length,'head remains after skirt disappears');
    assert.equal(visible('ground').length,0,'ground settles independently without removing the head');
    assert.equal(u.cloudOpacity.value,1);
  } finally {cloud?.dispose();TextureLoader.prototype.loadAsync=original;}
});
