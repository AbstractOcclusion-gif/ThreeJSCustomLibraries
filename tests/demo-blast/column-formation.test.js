import test from 'node:test';
import assert from 'node:assert/strict';
import {columnFormation,columnSourceHeight} from '../../bench/demo-blast/fire-look.js';

test('a source billow climbs with the forming stem without shrinking its vertical scale',()=>{
  const head=46,radius=24,join=columnFormation(0,head,radius).join;
  let previous=-Infinity;
  for(let age=2;age<=23;age+=.25) {
    const travel=columnSourceHeight(0,age,head,radius);
    const displayedHeight=join-5-travel;
    assert.ok(displayedHeight>previous,'the same source feature moves upward');
    previous=displayedHeight;
    // Lower-stem samples translate by the same amount; no compressed tiling.
    assert.ok(Math.abs(columnSourceHeight(5,age,head,radius)-travel-5)<1e-12);
  }
});

test('column transport leaves the cap and mature cloud mapping unchanged',()=>{
  for(const head of [14,46,82])for(const radius of [13,24,40]) {
    const {join}=columnFormation(0,head,radius);
    for(const age of [0,2,5,9])assert.equal(columnSourceHeight(join+3,age,head,radius),join+3);
    for(const age of [24,36,180])for(const y of [0,5,12,35,80])
      assert.equal(columnSourceHeight(y,age,head,radius),y);
  }
});
