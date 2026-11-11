import * as T from 'three';
import {POSE} from '../../src/destruction/pose-layout.js';

const PACKET_INTERVAL = {initial: 1 / 60, min: 1 / 240, max: .2};
const QUATERNION_TOLERANCE = 1e-6;
const MAX_ADVANCE_SECONDS = .25;
const FALLBACK_FIXED_STEP = 1 / 240;
const SLEEPING_POLL_SECONDS = 1 / 30;
const BACKLOG_TOLERANCE_SECONDS = 1e-12;
const SLOW_MOTION_SCALE = .2;

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
  const now = performance.now();
  const interval = lastStateAt
   ? T.MathUtils.clamp((now - lastStateAt) / 1000, PACKET_INTERVAL.min, PACKET_INTERVAL.max)
   : PACKET_INTERVAL.initial;
  lastStateAt = now;
  stats = state.stats;
  // Topology arrives before poses. Replace obsolete body mirrors on every
  // revision so a later split cannot animate stale compound memberships.
  for(const p of state.fractures){const panel=system.floors.panels[p.id];if((p.revision??1)<=panel.revision)continue;const old=panel.groups??(panel.broken?panel.fragments:[{body:panel.body}]);panel.broken=p.broken??true;panel.revision=p.revision??1;if(p.frozen)panel.frozen=p.frozen;system.floors.revision++;panel.fragments=p.fragments.map(group);if(p.groups)panel.groups=p.groups.map(group);if(panel.asset?.masonry)panel.body=panel.groups[0]?.body??null;const live=new Set((panel.groups??panel.fragments).map(g=>g.body.id));for(const g of old)if(!live.has(g.body.id))forget(g.body.id);}
  const nextShots=new Set(state.shots.map(s=>s.body.id));for(const id of shotIds)if(!nextShots.has(id))forget(id);shotIds=nextShots;for(const shot of state.shots)body(shot.body);
  const poses = new Float32Array(state.buffer);
  for (let index = 0; index < state.count; index++) {
   const offset = index * POSE.STRIDE;
   const mirror = bodies.get(poses[offset + POSE.ID]);
   if (!mirror) continue;
   mirror.sleepState = poses[offset + POSE.SLEEP];
   const x = poses[offset + POSE.X], y = poses[offset + POSE.Y], z = poses[offset + POSE.Z];
   const qx = poses[offset + POSE.QX], qy = poses[offset + POSE.QY];
   const qz = poses[offset + POSE.QZ], qw = poses[offset + POSE.QW];
   const samePosition = mirror.to.x === x && mirror.to.y === y && mirror.to.z === z;
   const sameRotation = Math.abs(mirror.toQ.x - qx) <= QUATERNION_TOLERANCE
    && Math.abs(mirror.toQ.y - qy) <= QUATERNION_TOLERANCE
    && Math.abs(mirror.toQ.z - qz) <= QUATERNION_TOLERANCE
    && Math.abs(mirror.toQ.w - qw) <= QUATERNION_TOLERANCE;
   if (samePosition && sameRotation) continue;
   // Worker packets can arrive between rendered frames. Advance this body's
   // previous interpolation first; unrelated debris must not restart it.
   sample(mirror, now);
   mirror.from.copy(mirror.position);
   mirror.fromQ.copy(mirror.quaternion);
   mirror.to.set(x, y, z);
   mirror.toQ.set(qx, qy, qz, qw).normalize();
   mirror.interpolationStart = now;
   mirror.interpolationDuration = interval * 1000;
   interpolating.add(mirror);
  }
  let h=0;for(const m of system.members){m.broken=0;for(const hinge of m.hinges){const flag=state.hinges[h++];hinge.broken=!!(flag&1);hinge.yielded=!!(flag&2);if(hinge.broken)m.broken++;}}
  Object.assign(system,{broken:stats.broken,yielded:stats.yielded,totalMass:stats.totalMass,permanentRotation:stats.permanentRotation});system.floors.broken=stats.floorBreaks;system.sleeping=false;recycled=state.buffer;
  onState?.({stats,energy:state.energy,events:state.events??[],shots:state.shots.map(s=>({...s,body:body(s.body)}))});
 }
 function flush(){
  if(disposed||busy||paused||!system)return;const fixedStep=stats.fixedStep??FALLBACK_FIXED_STEP,owed=stats.backlog??0;
  if(!commands.length&&(pendingSeconds+owed+BACKLOG_TOLERANCE_SECONDS<fixedStep||(stats.awake===0&&owed<fixedStep&&pendingSeconds<SLEEPING_POLL_SECONDS)))return;
  busy=true;const seconds=Math.min(pendingSeconds,MAX_ADVANCE_SECONDS),message={type:'advance',seconds,commands:commands.splice(0),buffer:recycled};pendingSeconds=Math.max(0,pendingSeconds-seconds);recycled=null;worker.postMessage(message,message.buffer?[message.buffer]:[]);
 }
 worker.onmessage=({data})=>{if(disposed)return;if(data.type==='error'){busy=true;onError?.(data.message);return;}if(data.type==='ready'){initialise(data.model);receive(data.state);busy=false;onReady?.(system,data.model);flush();}else if(data.type==='state'){receive(data.state);busy=false;flush();}};
 worker.onerror=event=>{if(!disposed){busy=true;onError?.(event.message||'Physics worker failed');}};
 worker.postMessage({type:'init',options});
 return{
  advance(seconds,slow=false){if(disposed||paused||!system)return;pendingSeconds+=Math.max(0,Math.min(MAX_ADVANCE_SECONDS,seconds))*(slow ? SLOW_MOTION_SCALE : 1);flush();},
  setPaused(value){paused=!!value;if(paused)pendingSeconds=0;else flush();},
  command(command){if(!disposed)commands.push(command);},
  update(now=performance.now()){if(!system)return;let complete=true;for(const b of interpolating)if(sample(b,now)<1)complete=false;system.sleeping=!!stats.sleeping&&complete;},
  get stats(){return{...stats,backlog:(stats.backlog??0)+pendingSeconds};},get system(){return system;},
  dispose(){if(disposed)return;disposed=true;worker.onmessage=null;worker.onerror=null;worker.terminate();bodies.clear();interpolating.clear();commands.length=0;recycled=null;system=null;stats={};}
 };
}
