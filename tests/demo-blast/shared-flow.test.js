import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Scene,ShaderLib,Texture,TextureLoader,Vector3} from 'three';
import {createPlumeFlow} from '../../bench/demo-blast/plume-flow.js';
import {FIRE_LOOK} from '../../bench/demo-blast/fire-look.js';
import {BLAST_QUALITY} from '../../bench/demo-blast/quality.js';
import {plumeOffset} from '../../bench/demo-blast/plume-motion.js';
import {createMushroomCloud} from '../../bench/demo-blast/cloud.js';
import {createBlastScale} from '../../bench/demo-blast/blast-scale.js';

test('shared head uses gas velocity while skirt retains its established collar guidance',()=>{
  const results=[];
  for(const overrides of [{},{riseSpeed:1.3},{drag:3},{headFriction:1.5},{viscosity:0}]) {
    const settings={...FIRE_LOOK,...overrides,cloudMotion:'shared',sharedMotion:{headRoundness:.35}};
    const flow=createPlumeFlow(new Vector3(),1,settings,BLAST_QUALITY.low.fluid);
    try {
      flow.ignite();
      for(let i=0;i<8*60;i++)flow.update(1/60);
      const samples=[];
      for(const [radius,height] of [[4,25],[10,35],[20,40]]) {
        const offset=plumeOffset(height,8,flow.head.height);
        const point=[radius+offset[0],height,offset[1]];
        const gas=flow.sample(new Vector3(),...point);
        const head=flow.sample(new Vector3(),...point,{kind:'head'});
        assert.ok(head.distanceTo(gas)<1e-12,'head cannot substitute authored circulation');
        const tag={kind:'skirt',radiusShare:.92};
        const skirt=flow.sample(new Vector3(),...point,tag).clone();
        settings.cloudMotion='accepted';
        const acceptedSkirt=flow.sample(new Vector3(),...point,tag);
        assert.ok(Math.abs(skirt.y*.65-acceptedSkirt.y)<1e-12,'same capped collar guidance without the extra ascent slowdown');
        settings.cloudMotion='shared';
        assert.ok(gas.toArray().every(Number.isFinite));samples.push(...gas.toArray());
      }
      results.push(samples);
    } finally {flow.dispose();}
  }
  for(let i=1;i<results.length;i++)assert.ok(results[i].some((v,j)=>Math.abs(v-results[0][j])>1e-5),
    'each live physics modifier changes the common velocity');
});

test('head shape support reuses circulation without changing the solved gas field',()=>{
  const settings={...FIRE_LOOK,cloudMotion:'shared',sharedMotion:{headRoundness:0}};
  const flow=createPlumeFlow(new Vector3(),1,settings,BLAST_QUALITY.low.fluid);
  try {
    flow.ignite();for(let i=0;i<30*60;i++)flow.update(1/60);
    const offset=plumeOffset(flow.head.height,30,flow.head.height);
    const point=[offset[0]+1,flow.head.height,offset[1]];
    const gas=flow.sample(new Vector3(),...point);
    assert.ok(flow.sample(new Vector3(),...point,{kind:'head'}).distanceTo(gas)<1e-12);
    const data=flow.texture.image.data.slice(),clock=flow.diagnostics.time;
    settings.sharedMotion.headRoundness=.35;
    assert.ok(flow.sample(new Vector3(),...point,{kind:'head'}).distanceTo(gas)>.01);
    assert.deepEqual(flow.texture.image.data,data,'shape support does not rewrite smoke or heat');
    assert.equal(flow.diagnostics.time,clock);
    assert.ok(flow.sample(new Vector3(),...point).distanceTo(gas)<1e-12,'untagged gas advection is unchanged');
  } finally {flow.dispose();}
});

test('accepted motion remains the default and can be recovered after shared sampling',()=>{
  const settings={...FIRE_LOOK},flow=createPlumeFlow(new Vector3(),1,settings);
  const tag={kind:'head',stationary:true};
  try {
    const accepted=flow.sample(new Vector3(),.5,14,0,tag).clone();
    assert.ok(accepted.y>0,'accepted authored circulation remains available');
    settings.cloudMotion='shared';
    const shared=flow.sample(new Vector3(),.5,14,0,tag);
    assert.ok(shared.length()<1e-12,'an unignited gas cannot invent circulation');
    settings.cloudMotion='accepted';
    assert.ok(flow.sample(new Vector3(),.5,14,0,tag).distanceTo(accepted)<1e-12);
  } finally {flow.dispose();}
});

test('shared-flow clouds reach bulk handoff and reset for both yields and rise settings',async()=>{
  const original=TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync=async()=>{
    const texture=new Texture();texture.image={width:64,height:64};return texture;
  };
  try {
    for(const yieldKt of [1,20])for(const riseSpeed of [.65,1.3]) {
      const scale=createBlastScale(yieldKt),scene=new Scene();
      const cloud=await createMushroomCloud(scene,{size:scale.length,scale,quality:BLAST_QUALITY.low,
        fireLook:{...FIRE_LOOK,riseSpeed,cloudMotion:'shared'}});
      try {
        cloud.start(new Vector3());
        for(let i=0;i<37*30;i++)cloud.update(1/30);
        const late=cloud.diagnostics.late;
        assert.ok(late,`${yieldKt} kt / ${riseSpeed}: bulk model started`);
        assert.ok(Number.isFinite(late.height)&&Number.isFinite(late.velocity));
        const u=cloud.shadowField.uniforms,h=u.headHeight.value,r=u.headRadius.value;
        const collar=scene.children.filter(o=>o.isSprite&&o.visible&&o.userData.cloudFlowTag?.kind==='skirt');
        const radiusAt=o=>{
          const y=o.position.y/scale.length,offset=plumeOffset(y,37,h);
          return Math.hypot(o.position.x/scale.length-offset[0],o.position.z/scale.length-offset[1]);
        };
        const upper=collar.filter(o=>o.userData.cloudFlowTag.layer===0);
        const lower=collar.filter(o=>o.userData.cloudFlowTag.layer===1);
        assert.ok(upper.length&&lower.length,'both ends of the cone survive');
        const mean=(list,value)=>list.reduce((sum,o)=>sum+value(o),0)/list.length;
        assert.ok(mean(lower,radiusAt)>mean(upper,radiusAt),'skirt flares toward its lower rim');
        assert.ok(mean(upper,o=>o.position.y)>mean(lower,o=>o.position.y),'upper rim stays above the lower rim');
        assert.ok(mean(lower,radiusAt)<r*.92,'new lower ring stays inside the former outer ring target');
        assert.ok(collar.every(o=>o.position.y/scale.length<h),'skirt remains below the head centre');
        assert.ok(cloud.sampleSkirtEdge(new Vector3()),'fragments can still find the new outer skirt tiers');
        const camera=new PerspectiveCamera();camera.position.set(150,60,220).multiplyScalar(scale.length);
        cloud.sort(camera);
        for(const kind of ['head','skirt']) {
          const sprites=scene.children.filter(o=>o.isSprite&&o.visible&&o.userData.cloudFlowTag?.kind===kind);
          assert.ok(sprites.length>0,`${kind} parcels survived handoff`);
          assert.ok(sprites.every(o=>o.position.toArray().every(Number.isFinite)));
          const shader={uniforms:{},fragmentShader:ShaderLib.sprite.fragmentShader};
          sprites[0].material.onBeforeCompile(shader);
          const puffFrequency=.92*shader.uniforms.groundDetailScale.value/sprites[0].scale.y;
          const gasFrequency=.644/(u.billowWidth.value*scale.length*u.warp.value.w);
          assert.ok(Math.abs(puffFrequency-gasFrequency)<1e-9,'larger billows retain the common gas/puff frequency');
        }
        cloud.clear();assert.equal(cloud.active,0);assert.equal(cloud.diagnostics.late,null);
        cloud.start(new Vector3());cloud.update(.1);assert.ok(cloud.diagnostics.time>0);
      } finally {cloud.dispose();}
    }
  } finally {TextureLoader.prototype.loadAsync=original;}
});

test('switching motion mode enlarges head envelopes without changing accepted or ground sizes',async()=>{
  const original=TextureLoader.prototype.loadAsync;
  TextureLoader.prototype.loadAsync=async()=>{const t=new Texture();t.image={width:64,height:64};return t;};
  const scene=new Scene(),fireLook={...FIRE_LOOK,cloudMotion:'accepted'};let cloud;
  try {
    cloud=await createMushroomCloud(scene,{quality:BLAST_QUALITY.low,fireLook});
    const widths=()=>Object.fromEntries(['head','ground'].map(kind=>[kind,scene.children
      .filter(o=>o.isSprite&&o.visible&&o.userData.cloudFlowTag?.kind===kind).map(o=>o.scale.y)]));
    const run=()=>{cloud.start(new Vector3());for(let i=0;i<120;i++)cloud.update(1/60);return widths();};
    const before=run();fireLook.cloudMotion='shared';const shared=run();
    assert.ok(before.head.length>0&&before.ground.length>0);
    before.head.forEach((width,i)=>assert.ok(Math.abs(shared.head[i]/width-1.5)<1e-12));
    assert.deepEqual(shared.ground,before.ground);
    fireLook.cloudMotion='accepted';assert.deepEqual(run(),before,'switching back exactly recovers authored sizes');
  } finally {cloud?.dispose();TextureLoader.prototype.loadAsync=original;}
});
