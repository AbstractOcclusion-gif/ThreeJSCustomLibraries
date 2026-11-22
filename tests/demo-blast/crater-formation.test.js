import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainField} from '../../src/terrain/index.js';
import {createCraterFormation,CRATER_FORMATION} from '../../bench/demo-blast/crater-formation.js';

test('crater stages are frame independent, bounded, and do not accumulate extra centre depth',()=>{
  const run=times=>{
    const calls=[];
    const formation=createCraterFormation({radius:54,depth:4.6},stage=>{calls.push(stage);return true;});
    for(const time of times)formation.advance(time);
    assert.ok(formation.complete);assert.equal(calls.length,CRATER_FORMATION.stages);
    assert.equal(calls.at(-1).radius,54);
    assert.ok(Math.abs(calls.reduce((sum,s)=>sum+s.depth,0)-4.6)<1e-12);
    assert.equal(calls.filter(s=>s.last).length,1);
    assert.equal(formation.advance(10),false);
    formation.reset();assert.equal(formation.complete,false);
    assert.equal(formation.advance(0),false);
    return calls;
  };
  assert.deepEqual(run(Array.from({length:121},(_,i)=>i/60)),run([0,2]));
});

test('terrain bowl grows outward and centre depth stays within the configured final depth',()=>{
  const field=createTerrainField({origin:[-180,-180],size:[360,360],resolution:[129,129],heights:new Float32Array(129*129)});
  const formation=createCraterFormation({radius:54,depth:4.6},({radius,depth})=>field.crater(0,0,radius,depth));
  try{
    formation.advance(.8);
    assert.ok(field.heightAt(0,0)<0&&field.heightAt(0,0)>-4.6);
    assert.ok(field.heightAt(40,0)>=0);
    formation.advance(2);field.flushDeformation();
    assert.ok(Math.abs(field.heightAt(0,0)+4.6)<.00002);
    assert.ok(field.heightAt(40,0)<0);
    const finalHeight=field.heightAt(0,0);
    formation.advance(10);assert.equal(field.heightAt(0,0),finalHeight);
    field.resetDeformation();formation.reset();assert.equal(field.heightAt(0,0),0);
  }finally{field.dispose();}
});
