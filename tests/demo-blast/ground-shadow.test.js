import test from 'node:test';
import assert from 'node:assert/strict';
import {Color,FogExp2,MeshStandardMaterial,Scene,ShaderLib,Vector3,Vector4} from 'three';
import {createFireball} from '../../bench/demo-blast/fireball.js';
import {createBlastGroundShadow} from '../../bench/demo-blast/ground-shadow.js';
import {FIRE_LOOK} from '../../bench/demo-blast/fire-look.js';

test('gas follows the same live fog and environment tint as the puff scene',()=>{
  const scene=new Scene();scene.fog=new FogExp2(0xaabbbb,.00012);
  const environment={light:new Color(.8,.7,.6)};
  const flow={extent:new Vector3(120,216,120),texture:null,head:{height:40,radius:25}};
  const fire=createFireball(scene,{...FIRE_LOOK},null,flow,environment,40);
  try {
    fire.update(0,8,new Vector3(),1);
    const u=fire.shadowField.uniforms;
    assert.equal(u.airDensity.value,scene.fog.density);
    assert.ok(u.airTint.value.equals(scene.fog.color));
    assert.ok(u.sceneTint.value.equals(environment.light));
    environment.light.setRGB(.2,.3,.4);scene.fog.density=.0003;
    fire.update(0,180,new Vector3(),1);
    assert.equal(u.airDensity.value,.0003);
    assert.ok(u.sceneTint.value.equals(environment.light));
    scene.fog=null;fire.update(0,180,new Vector3(),1);
    assert.equal(u.airDensity.value,0);
  }finally{fire.dispose();}
});

test('ground projection shares the live gas field, changes sun only, and restores renderer state',()=>{
  const previous={name:'previous'},receiver=new MeshStandardMaterial(),look={...FIRE_LOOK};
  let current=previous,draws=0,projection;
  const renderer={autoClear:false,getRenderTarget:()=>current,setRenderTarget:t=>{current=t;},
    render:scene=>{draws++;projection=scene.children[0].material;}};
  const fire=createFireball(new Scene(),look,null,{extent:new Vector3(120,216,120),texture:null,head:{height:20,radius:13}});
  const original=receiver.onBeforeCompile;
  const shadow=createBlastGroundShadow(renderer,fire.shadowField,receiver,new Vector4(-200,-200,400,400),look,32);
  try{
    const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
    receiver.onBeforeCompile(shader);
    assert.match(shader.fragmentShader,/directLight.color\*=mix/);
    shadow.render();assert.equal(draws,0);assert.equal(shader.uniforms.blastShadowStrength.value,0);
    fire.update(0,3,new Vector3(0,4,0),1);
    shadow.render();assert.equal(draws,1);
    assert.equal(projection.uniforms.gas,fire.shadowField.uniforms.gas);
    assert.equal(projection.uniforms.warp,fire.shadowField.uniforms.warp);
    assert.equal(projection.uniforms.coreDensity,fire.shadowField.uniforms.coreDensity);
    assert.equal(projection.uniforms.coreDensity.value,2.5);
    look.coreDensity=1;fire.update(0,3,new Vector3(0,4,0),1);
    assert.equal(projection.uniforms.coreDensity.value,1);
    assert.equal(current,previous);assert.equal(renderer.autoClear,false);
    renderer.render=()=>{throw Error('render failed');};
    assert.throws(()=>shadow.render(),/render failed/);
    assert.equal(current,previous);assert.equal(renderer.autoClear,false);
    fire.clear();shadow.render();assert.equal(shader.uniforms.blastShadowStrength.value,0);
    shadow.dispose();assert.equal(receiver.onBeforeCompile,original);
  }finally{fire.dispose();receiver.dispose();}
});
