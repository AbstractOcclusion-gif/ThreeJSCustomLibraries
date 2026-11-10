import * as T from 'three';

// Render-only mirrors: no Cannon world, constraints, damage, or sleep decisions.
export function createAssemblyClient({options,onReady,onState,onError,worker=new Worker(new URL('./assembly-worker.js',import.meta.url),{type:'module'})}){
 const bodies=new Map(),interpolating=new Set(),commands=[];let system,disposed=false,busy=true,paused=false,pendingSeconds=0,recycled=null,lastStateAt=0,stats={},shotIds=new Set();
 const body=data=>{if(!bodies.has(data.id)){const position=new T.Vector3(...data.position),quaternion=new T.Quaternion(...data.quaternion);bodies.set(data.id,{id:data.id,mass:data.mass,position,quaternion,from:position.clone(),to:position.clone(),fromQ:quaternion.clone(),toQ:quaternion.clone()});}return bodies.get(data.id);};
 const forget=id=>{const old=bodies.get(id);if(old)interpolating.delete(old);bodies.delete(id);};
 const group=data=>({...data,body:body(data.body)});
 const sample=(b,now)=>{if(!interpolating.has(b))return 1;const alpha=b.interpolationStart==null?1:Math.min(1,Math.max(0,(now-b.interpolationStart)/b.interpolationDuration));b.position.lerpVectors(b.from,b.to,alpha);b.quaternion.slerpQuaternions(b.fromQ,b.toQ,alpha);if(alpha>=1)interpolating.delete(b);return alpha;};
 function initialise(model){system={payloads:(model.payloads??[]).map(p=>({...p,body:body(p.body)})),hardware:(model.hardware??[]).map(h=>({...h,body:body(h.body)})),cableBudget:model.cableBudget,cables:(model.cables??[]).map(c=>({...c,links:c.links.map(l=>({...l,body:body(l.body)}))})),definition:model.definition,members:model.members.map(m=>({...m,segments:m.segments.map(s=>({...s,body:body(s.body)})),hinges:m.hinges.map(h=>({...h,a:body(h.a),b:body(h.b),broken:false,yielded:false})),broken:0})),floors:{panels:model.panels.map(p=>({...p,body:p.body?body(p.body):null,broken:p.broken??false,revision:p.revision??0,groups:p.groups?.map(group),fragments:[]})),broken:0,revision:0},sleeping:false};}
 function receive(state){
  for(let i=0;i<(state.cables??[]).length;i++){Object.assign(system.cables[i],state.cables[i]);for(const id of state.cables[i].removedBodyIds??[])forget(id);}
  const now=performance.now(),interval=lastStateAt?Math.min(.2,Math.max(1/240,(now-lastStateAt)/1000)):1/60;lastStateAt=now;stats=state.stats;
  // Topology arrives before poses. Replace obsolete body mirrors on every
  // revision so a later split cannot animate stale compound memberships.
  for(const p of state.fractures){const panel=system.floors.panels[p.id];if((p.revision??1)<=panel.revision)continue;const old=panel.groups??(panel.broken?panel.fragments:[{body:panel.body}]);panel.broken=p.broken??true;panel.revision=p.revision??1;if(p.frozen)panel.frozen=p.frozen;system.floors.revision++;panel.fragments=p.fragments.map(group);if(p.groups)panel.groups=p.groups.map(group);if(panel.asset?.masonry)panel.body=panel.groups[0]?.body??null;const live=new Set((panel.groups??panel.fragments).map(g=>g.body.id));for(const g of old)if(!live.has(g.body.id))forget(g.body.id);}
  const nextShots=new Set(state.shots.map(s=>s.body.id));for(const id of shotIds)if(!nextShots.has(id))forget(id);shotIds=nextShots;for(const shot of state.shots)body(shot.body);
  const poses=new Float32Array(state.buffer);for(let i=0;i<state.count;i++){const o=i*9,b=bodies.get(poses[o]);if(!b)continue;b.sleepState=poses[o+1];if(b.to.x===poses[o+2]&&b.to.y===poses[o+3]&&b.to.z===poses[o+4]&&Math.abs(b.toQ.x-poses[o+5])<=1e-6&&Math.abs(b.toQ.y-poses[o+6])<=1e-6&&Math.abs(b.toQ.z-poses[o+7])<=1e-6&&Math.abs(b.toQ.w-poses[o+8])<=1e-6)continue;
   // Worker packets can arrive between rendered frames. Advance this body's
   // previous interpolation first; unrelated debris must not restart it.
   sample(b,now);b.from.copy(b.position);b.fromQ.copy(b.quaternion);b.to.set(poses[o+2],poses[o+3],poses[o+4]);b.toQ.set(poses[o+5],poses[o+6],poses[o+7],poses[o+8]).normalize();b.interpolationStart=now;b.interpolationDuration=interval*1000;interpolating.add(b);
  }
  let h=0;for(const m of system.members){m.broken=0;for(const hinge of m.hinges){const flag=state.hinges[h++];hinge.broken=!!(flag&1);hinge.yielded=!!(flag&2);if(hinge.broken)m.broken++;}}
  Object.assign(system,{broken:stats.broken,yielded:stats.yielded,totalMass:stats.totalMass,permanentRotation:stats.permanentRotation});system.floors.broken=stats.floorBreaks;system.sleeping=false;recycled=state.buffer;
  onState?.({stats,energy:state.energy,events:state.events??[],shots:state.shots.map(s=>({...s,body:body(s.body)}))});
 }
 function flush(){
  if(disposed||busy||paused||!system)return;const fixedStep=stats.fixedStep??1/240,owed=stats.backlog??0;
  if(!commands.length&&(pendingSeconds+owed+1e-12<fixedStep||(stats.awake===0&&owed<fixedStep&&pendingSeconds<1/30)))return;
  busy=true;const seconds=Math.min(pendingSeconds,.25),message={type:'advance',seconds,commands:commands.splice(0),buffer:recycled};pendingSeconds=Math.max(0,pendingSeconds-seconds);recycled=null;worker.postMessage(message,message.buffer?[message.buffer]:[]);
 }
 worker.onmessage=({data})=>{if(disposed)return;if(data.type==='error'){busy=true;onError?.(data.message);return;}if(data.type==='ready'){initialise(data.model);receive(data.state);busy=false;onReady?.(system,data.model);flush();}else if(data.type==='state'){receive(data.state);busy=false;flush();}};
 worker.onerror=event=>{if(!disposed){busy=true;onError?.(event.message||'Physics worker failed');}};
 worker.postMessage({type:'init',options});
 return{
  advance(seconds,slow=false){if(disposed||paused||!system)return;pendingSeconds+=Math.max(0,Math.min(.25,seconds))*(slow?.2:1);flush();},
  setPaused(value){paused=!!value;if(paused)pendingSeconds=0;else flush();},
  command(command){if(!disposed)commands.push(command);},
  update(now=performance.now()){if(!system)return;let complete=true;for(const b of interpolating)if(sample(b,now)<1)complete=false;system.sleeping=!!stats.sleeping&&complete;},
  get stats(){return{...stats,backlog:(stats.backlog??0)+pendingSeconds};},get system(){return system;},
  dispose(){if(disposed)return;disposed=true;worker.onmessage=null;worker.onerror=null;worker.terminate();bodies.clear();interpolating.clear();commands.length=0;recycled=null;system=null;stats={};}
 };
}
