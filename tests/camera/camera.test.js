import test from 'node:test';
import assert from 'node:assert/strict';
import {Object3D,PerspectiveCamera,Vector3,Quaternion} from 'three';
import {createReplay} from '../../src/camera/replay.js';
import {createCameraDirector,createFollowRig} from '../../src/camera/director.js';
import {createCameraCollision} from '../../src/camera/collision.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
test('replay interpolates local transforms and restores live object/camera state exactly',()=>{
 const o=new Object3D(),camera=new PerspectiveCamera(55),replay=createReplay({fps:2,seconds:3});replay.bind([o]);camera.position.x=2;replay.capture(0,camera,new Vector3());o.position.x=10;o.quaternion.setFromAxisAngle(new Vector3(0,1,0),Math.PI);o.visible=false;camera.position.x=12;replay.capture(1,camera,new Vector3(10,0,0));
 o.position.x=20;camera.position.x=30;assert.ok(replay.begin(camera));const pose=replay.seek(.5);near(o.position.x,5);near(pose.position.x,7);near(pose.target.x,5);near(o.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2)),0);assert.equal(o.visible,true);replay.seek(1);assert.equal(o.visible,false);replay.end(camera);near(o.position.x,20);near(camera.position.x,30);assert.equal(o.visible,false);
});
test('ring buffer keeps only its bounded recent window and throttles capture rate',()=>{
 const r=createReplay({fps:2,seconds:2}),o=new Object3D(),c=new PerspectiveCamera();r.bind([o]);for(let i=0;i<20;i++){o.position.x=i;r.capture(i*.5,c,new Vector3());}const bytes=r.bytes;assert.equal(r.frames,4);near(r.duration,1.5);r.capture(9.51,c,new Vector3());assert.equal(r.frames,4);assert.equal(r.bytes,bytes);r.begin(c);r.seek(0);near(o.position.x,16);r.end(c);
});
test('replay does not record while active, scrubs while paused, and can restart after ending',()=>{
 const r=createReplay({fps:2,seconds:3}),o=new Object3D(),c=new PerspectiveCamera();r.bind([o]);r.capture(0,c,new Vector3());o.position.y=10;r.capture(1,c,new Vector3());r.begin(c);r.capture(2,c,new Vector3());assert.equal(r.frames,2);r.setPlaying(false);r.seek(.25);near(r.update(10).position.x,0);near(o.position.y,2.5);r.setPlaying(true);r.update(2);assert.equal(r.playing,false);r.setPlaying(true);near(r.position,0);r.end(c);
});
test('replay refuses excess objects and rebinding during playback',()=>{
 const r=createReplay({maxObjects:1}),a=new Object3D(),b=new Object3D(),c=new PerspectiveCamera();assert.throws(()=>r.bind([a,b]),/budget/);r.bind([a,a]);assert.equal(r.objectCount,1);r.capture(0,c,new Vector3());r.capture(1,c,new Vector3());r.begin(c);assert.throws(()=>r.bind([b]),/End replay/);r.end(c);r.clear();assert.equal(r.frames,0);assert.equal(r.bytes,0);
});
test('director blends camera poses without modifying rig output or subject data',()=>{
 const c=new PerspectiveCamera(),d=createCameraDirector(c),a=new PerspectiveCamera(40),b=new PerspectiveCamera(60),target=new Vector3(1,2,3);a.position.x=0;b.position.x=10;d.register('a',()=>a).register('b',()=>b);d.update(0,{target});d.select('b',{duration:1});d.update(.5,{target});near(c.position.x,5);near(c.fov,50);d.update(.5,{target});near(c.position.x,10);near(b.position.x,10);assert.deepEqual(target.toArray(),[1,2,3]);assert.throws(()=>d.select('missing'));
});
test('bullet time expires in real time, restores shot and retains host manual slow scale',()=>{
 const c=new PerspectiveCamera(),d=createCameraDirector(c);d.register('auto',createFollowRig()).register('orbit',createFollowRig({offset:[10,5,0]}));d.setSlow(.5);d.bullet({duration:1,scale:.1});const entering=d.tick(.25);assert.ok(entering>.1&&entering<1);near(d.tick(.15),.1);d.update(.25,{target:new Vector3()});assert.equal(d.selected,'auto');assert.equal(d.bulletActive,true);near(d.tick(.8),.5);assert.equal(d.bulletActive,false);d.reset();near(d.timeScale,.5);
});
test('slow-motion transitions ease both directions and can reverse without a jump',()=>{
 const d=createCameraDirector(new PerspectiveCamera());d.setSlow(.2);near(d.tick(.175),.6);near(d.tick(.175),.2);d.setSlow(1);near(d.tick(.175),.6);d.setSlow(.2);const reverse=d.tick(.01);assert.ok(reverse<.6&&reverse>.59);near(d.tick(.35),.2);d.setSlow(1);near(d.tick(.35),1);
});
test('time easing is independent of frame subdivision',()=>{
 const a=createCameraDirector(new PerspectiveCamera()),b=createCameraDirector(new PerspectiveCamera());a.setSlow(.25);b.setSlow(.25);const expected=a.tick(.2);for(let i=0;i<4;i++)b.tick(.05);near(b.timeScale,expected);
});
test('collision probes shorten the camera arm with clearance without mutating the subject',()=>{
 let probes=0;const target=new Vector3(0,1,0),desired=new Vector3(0,1,10),resolve=createCameraCollision({skin:.2,raycast:()=>{probes++;return 4;}});const result=resolve(target,desired);near(result.z,3.8);assert.equal(probes,5);assert.deepEqual(target.toArray(),[0,1,0]);near(desired.z,10);
});
test('collision supports no hit, vertical arms and in-place output without NaNs',()=>{
 const resolve=createCameraCollision({raycast:()=>Infinity}),target=new Vector3(),desired=new Vector3(0,10,0);resolve(target,desired,desired);assert.deepEqual(desired.toArray(),[0,10,0]);resolve(target,target,desired);assert.deepEqual(desired.toArray(),[0,0,0]);
});
test('collision correction runs after optional shake and camera blending',()=>{
 const c=new PerspectiveCamera(),d=createCameraDirector(c),pose=new PerspectiveCamera();pose.position.set(0,2,20);d.register('x',()=>pose);let calls=0;d.setCollision((t,p,out)=>{calls++;out.z=3;return out;});d.shake({strength:.2});d.update(.05,{target:new Vector3()});assert.equal(calls,1);near(c.position.z,3);assert.ok(Number.isFinite(c.position.x));
});

test('obstacle ray misses hold the short arm, then release smoothly without feedback',()=>{
 let hit=4;const resolve=createCameraCollision({skin:.2,hold:.15,release:4,raycast:()=>hit}),target=new Vector3(),desired=new Vector3(0,0,10),out=new Vector3();
 resolve(target,desired,out,.016);near(out.z,3.8);
 for(let i=0;i<8;i++){hit=i%2?4:Infinity;resolve(target,desired,out,.016);near(out.z,3.8);}
 hit=Infinity;for(let i=0;i<10;i++)resolve(target,desired,out,.016);const before=out.z;assert.ok(before>=3.8&&before<10);resolve(target,desired,out,.016);assert.ok(out.z>=before&&out.z-before<.5);
 hit=2;resolve(target,desired,out,.016);near(out.z,1.8);near(desired.z,10);resolve.reset();hit=Infinity;resolve(target,desired,out,.016);near(out.z,10);
});

test('simultaneous recorded angles share time, objects and ring bounds; switching and seeking restore live state',()=>{
 const r=createReplay({fps:2,seconds:2,cameraIds:['side','behind','orbit']}),o=new Object3D(),live=new PerspectiveCamera(55),views={side:new PerspectiveCamera(40),behind:new PerspectiveCamera(60),orbit:new PerspectiveCamera(70)};
 r.bind([o]);const bytes=r.bytes;for(let i=0;i<6;i++){o.position.x=i;live.position.x=i;for(const [n,id]of ['side','behind','orbit'].entries()){views[id].position.x=100*(n+1)+i;views[id].quaternion.setFromAxisAngle(new Vector3(0,1,0),i*.1);}r.capture(i*.5,live,new Vector3(i,2,3),views);}
 o.position.x=99;live.position.x=999;assert.ok(r.begin(live));r.setPlaying(false);r.seek(.25);const cursor=r.position;near(o.position.x,2.5);
 for(const [n,id]of ['side','behind','orbit'].entries()){const pose=r.selectCamera(id);near(pose.position.x,100*(n+1)+2.5);near(pose.fov,views[id].fov);near(pose.target.x,2.5);near(r.position,cursor);near(o.position.x,2.5);near(pose.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.25)),0);}
 r.seek(1);near(r.update(0).position.x,304);near(r.selectCamera('recorded').position.x,4);assert.equal(r.frames,4);assert.equal(r.bytes,bytes);assert.equal(bytes,4*(11+4*8+3)*4);assert.throws(()=>r.selectCamera('missing'),/Unknown/);r.end(live);near(o.position.x,99);near(live.position.x,999);
});
