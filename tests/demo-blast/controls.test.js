import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudSettings} from '../../bench/demo-blast/cloud-settings.js';
import {mountCloudControls} from '../../bench/demo-blast/controls.js';
import {createBlastScale} from '../../bench/demo-blast/blast-scale.js';

function panel() {
  const controls=[];
  const gui={addFolder:()=>gui,close:()=>gui,controllersRecursive:()=>controls,
    add(object,key,min,max){
      const c={object,key,min,max,label:key,name(label){this.label=label;return this;},
        onFinishChange(fn){this.finish=fn;return this;},updateDisplay(){}};
      controls.push(c);return c;
    }};
  return {gui,controls};
}

test('all 74 authoring controls preserve approved defaults within their ranges for both yields',()=>{
  for(const yieldKt of [1,20]) {
    const scale=createBlastScale(yieldKt),settings=createCloudSettings(scale),before=structuredClone(settings);
    const {gui,controls}=panel();
    mountCloudControls(gui,{settings,scale,restart:()=>assert.fail('mount must not restart')});
    const numeric=controls.filter(c=>c.min!==undefined);
    assert.equal(numeric.length,74);
    for(const c of numeric)assert.ok(c.object[c.key]>=c.min&&c.object[c.key]<=c.max,c.label);
    assert.deepEqual(settings,before);
  }
});

test('authoring edits normalize ranges and restoring defaults preserves existing array bindings',()=>{
  const scale=createBlastScale(20),settings=createCloudSettings(scale),defaults=structuredClone(settings);
  const {gui,controls}=panel();let restarts=0;
  mountCloudControls(gui,{settings,scale,restart:()=>restarts++});
  const min=controls.find(c=>c.label==='Inner width min · ref m');
  const reset=controls.find(c=>c.label==='Restore approved cloud defaults');
  min.object[min.key]=30;min.finish();assert.equal(restarts,1);
  assert.ok(settings.groundDust.width[0]<=settings.groundDust.width[1]);
  reset.object[reset.key]();assert.equal(restarts,2);assert.deepEqual(settings,defaults);
  assert.equal(min.object,settings.groundDust.width,'reset must not disconnect array controllers');
  min.object[min.key]=20;min.finish();assert.equal(settings.groundDust.width[0],20);
});
