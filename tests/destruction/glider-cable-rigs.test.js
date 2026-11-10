import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'jolt-physics';
import * as T from 'three';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
import {createAssemblySimulation} from '../../src/destruction/assembly-simulation.js';
import {createCableRigDefinition} from '../../src/destruction/cable-rigs.js';
import {createThreeCableRigView} from '../../src/destruction/three/cable-rigs.js';
import {createAssemblyClient} from '../../bench/destruction/assembly-client.js';
import {Worker} from 'node:worker_threads';
const J=await init();
function fixture(setup,options={}){const s=createAssemblySimulation({scene:'cable',driver:createJoltDriver(J,{settleFreeze:false}),cable:{setup,...options}});return{s,rig:s.cableRig,advance(seconds){for(let i=0;i<Math.round(seconds*120);i++)s.advance(1/120);},dispose(){s.dispose();s.dispose();assert.equal(s.world.bodies.length,0);assert.equal(s.world.constraints.length,0);}};}

test('three utility phases have spaced insulators attached to authored crossarm members',()=>{
 const d=createCableRigDefinition({setup:'triple'});assert.equal(d.members.length,6);assert.equal(d.metadata.cableMounts.length,2);for(const end of d.metadata.cableMounts){assert.deepEqual(end.map(m=>m.point[2]),[-1.2,0,1.2]);assert.ok(end.every(m=>d.members[m.member].type==='beam'));assert.ok(end.every(m=>m.point[1]===6.3));}
});

for(const setup of ['triple','tower'])test(setup+' shares structural supports, settles under all three cable loads and stays within budgets',()=>{
 const f=fixture(setup);try{f.advance(10);assert.equal(f.s.cables.length,3);assert.equal(f.rig.hardware.length,6);assert.equal(f.s.system.broken,0);assert.ok(f.s.cables.every(c=>c.sleeping&&c.attachments.every(Boolean)&&c.snapshot().sections.length===1));assert.ok(f.s.cables.every(c=>c.snapshot().maxGap<.01));assert.ok(f.s.world.bodies.length<=192);assert.ok(f.s.world.constraints.length<=384);assert.equal(f.s.snapshot().stats.awake,0);}finally{f.dispose();}
});

test('cutting selected phase publishes that cable ID and leaves neighbouring phases intact',()=>{
 const f=fixture('triple');try{f.advance(2);f.s.command({type:'cableCut',cable:1});const state=f.s.snapshot();assert.deepEqual(state.cables.map(c=>c.sections.length),[1,2,1]);assert.ok(state.events.some(e=>e.type==='cable:broken'&&e.cableId===1));f.advance(10);assert.ok(f.s.cables[0].attachments.every(Boolean));assert.ok(f.s.cables[2].attachments.every(Boolean));}finally{f.dispose();}
});

test('pole failure releases all three fixings without introducing world anchors',()=>{
 const f=fixture('triple');try{f.advance(2);f.s.command({type:'cablePoleFailure'});assert.ok(f.s.cables.every(c=>c.attachments[0]===null));assert.ok(f.s.cables.every(c=>c.attachments[1]));f.advance(20);assert.ok(f.s.cables.every(c=>c.links[0].body.position.y<1));assert.ok(f.s.cables.every(c=>c.attachments.every(a=>!a||!a.owned)));}finally{f.dispose();}
});

test('tower uses existing destructible frame joints; losing all base legs releases every tower fixing',()=>{
 const f=fixture('tower');try{f.advance(2);const base=f.s.system.members.filter(m=>m.type==='column'&&f.s.system.definition.nodes[m.row.a].anchor);assert.equal(base.length,5,'Four tower legs plus the remote pole');for(let i=0;i<4;i++){f.s.command({type:'cablePoleFailure'});f.advance(.1);}assert.ok(f.s.cables.every(c=>c.attachments[0]===null));assert.ok(base.slice(0,4).every(m=>m.broken>0));f.advance(20);assert.ok(f.s.world.bodies.every(b=>Number.isFinite(b.position.lengthSquared())));assert.ok(f.s.world.bodies.length<=192);}finally{f.dispose();}
});

test('hanging load is carried by a body attachment, can swing and is transferred as one render mirror',()=>{
 const f=fixture('suspended'),worker={postMessage(){},terminate(){}},client=createAssemblyClient({options:{},worker});try{f.advance(10);const c=f.s.cables[0],load=f.rig.payloads[0];assert.equal(c.links.length,8);assert.equal(c.attachments[1].body,load.body);assert.ok(load.body.position.y>1.5);assert.ok(c.sleeping);assert.ok(c.snapshot().maxGap<.015);assert.ok(c.snapshot().tension>100);worker.onmessage({data:{type:'ready',model:structuredClone(f.s.describe()),state:f.s.snapshot()}});assert.equal(client.system.payloads[0].body.id,load.body.id);f.s.command({type:'cableLoadImpulse'});f.advance(.5);assert.ok(load.body.position.x>.1);worker.onmessage({data:{type:'state',state:f.s.snapshot()}});client.update(performance.now()+1000);assert.ok(client.system.payloads[0].body.position.x>.1);}finally{client.dispose();f.dispose();}
});

test('weak suspension snaps while a heavy load on a strong rope can instead damage its supporting frame',()=>{
 for(const [loadMass,breakStrength,frameFailure]of [[25,100,false],[500,50000,true]]){const f=fixture('suspended',{loadMass,breakStrength});try{f.advance(15);const c=f.s.cables[0];assert.ok(f.rig.payloads[0].body.position.y<.6);if(frameFailure){assert.ok(f.s.system.broken>0);assert.equal(c.snapshot().sections.length,1);assert.equal(c.attachments[0],null);}else assert.ok(c.snapshot().sections.length>1||c.attachments.some(a=>!a));}finally{f.dispose();}}
});

test('moving the pull handle takes up slack and pulls a dynamic floor load through tension',()=>{
 const f=fixture('pull');try{f.advance(3);const load=f.rig.payloads[0].body,start=load.position.x,c=f.s.cables[0];f.s.command({type:'cableDrive'});f.advance(12);assert.ok(load.position.x<start-.5);assert.equal(c.attachments[1].body,load);assert.equal(c.attachments[0].kind,'driven');assert.ok(c.sleeping);assert.equal(c.snapshot().sections.length,1);assert.ok(c.snapshot().peakTension>50);assert.ok(c.snapshot().maxGap<.15);}finally{f.dispose();}
});

test('insulator/payload views borrow shared worker mirrors, bound draw calls and dispose their resources',()=>{
 for(const setup of ['triple','suspended']){const f=fixture(setup),worker={postMessage(){},terminate(){}},client=createAssemblyClient({options:{},worker}),scene=new T.Scene();let view;try{worker.onmessage({data:{type:'ready',model:structuredClone(f.s.describe()),state:f.s.snapshot()}});view=createThreeCableRigView({system:client.system,scene});assert.equal(view.roots.length,2);const mesh=view.roots[0];assert.equal(mesh.count,setup==='triple'?24:1);assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));let disposed=0;mesh.geometry.addEventListener('dispose',()=>disposed++);view.dispose();view.dispose();assert.equal(disposed,1);assert.equal(scene.children.length,0);}finally{view?.dispose();client.dispose();f.dispose();}}
});

test('largest tower plus 24-link phases, driven fixing and four pendulums remain bounded',()=>{
 const f=fixture('tower',{segments:24});try{for(let i=0;i<6;i++)f.s.command({type:'fire',target:[0,5,0],mode:'pendulum',mass:35,speed:12});f.s.command({type:'cableDrive'});assert.equal(f.s.snapshot().shots.length,4);assert.ok(f.s.world.bodies.length<=192);assert.ok(f.s.world.constraints.length<=384);f.advance(.1);}finally{f.dispose();}
});

test('driven pull fixture is visibly marked at its explicit worker attachment point',()=>{
 const f=fixture('pull'),worker={postMessage(){},terminate(){}},client=createAssemblyClient({options:{},worker}),scene=new T.Scene();let view;try{worker.onmessage({data:{type:'ready',model:structuredClone(f.s.describe()),state:f.s.snapshot()}});view=createThreeCableRigView({system:client.system,scene});const handles=view.roots.find(m=>m.geometry.type==='SphereGeometry');assert.equal(handles.count,0);f.s.command({type:'cableDrive'});f.advance(.5);worker.onmessage({data:{type:'state',state:f.s.snapshot()}});client.update(performance.now()+1000);view.update();assert.equal(handles.count,1);const matrix=new T.Matrix4();handles.getMatrixAt(0,matrix);const position=new T.Vector3().setFromMatrixPosition(matrix),point=client.system.cables[0].attachments[0].point;assert.ok(position.distanceTo(new T.Vector3(...point))<1e-5);}finally{view?.dispose();client.dispose();f.dispose();}
});

test('actual worker can reinitialize between every rig and transfer its new mirrors and cable IDs',async()=>{
 const url=new URL('../../bench/destruction/assembly-worker.js',import.meta.url).href,worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(`import {parentPort} from 'node:worker_threads';globalThis.self=globalThis;self.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);await import(${JSON.stringify(url)});parentPort.on('message',data=>self.onmessage({data}));`)),{type:'module'});
 const request=message=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Rig worker timeout')),15000),error=e=>{clearTimeout(timeout);reject(e);};worker.once('error',error);worker.once('message',m=>{clearTimeout(timeout);worker.removeListener('error',error);m.type==='error'?reject(Error(m.message)):resolve(m);});worker.postMessage(message);});
 try{for(const setup of ['triple','suspended','tower','pull']){const ready=await request({type:'init',options:{scene:'cable',backend:'jolt-bars',cable:{setup}}});assert.equal(ready.type,'ready');assert.equal(ready.model.cables.length,['triple','tower'].includes(setup)?3:1);assert.equal(ready.model.payloads.length,['suspended','pull'].includes(setup)?1:0);const command=setup==='triple'?{type:'cableCut',cable:1}:setup==='pull'?{type:'cableDrive'}:{type:'cableLoadImpulse'},reply=await request({type:'advance',seconds:.1,commands:[command]});assert.equal(reply.type,'state');assert.ok(reply.state.buffer.byteLength>0);if(setup==='triple'){assert.equal(reply.state.cables[1].sections.length,2);assert.ok(reply.state.events.some(e=>e.cableId===1));}if(setup==='pull')assert.equal(reply.state.cables[0].attachments[0].kind,'driven');}}finally{await worker.terminate();}
});
