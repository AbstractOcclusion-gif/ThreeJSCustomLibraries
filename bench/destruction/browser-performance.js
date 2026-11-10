// Opt-in browser measurements. No simulation ownership and no dependency on Three.
export function summarize(values){
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
 return{count:values.length,mean:values.reduce((n,v)=>n+v,0)/values.length,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)};
}

export function createGpuTimer(gl){
 const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 let active=null,disjoint=0,dropped=0;const pending=[];
 function clear(){if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(active);active=null;}for(const q of pending)gl.deleteQuery(q);pending.length=0;}
 return{supported:!!ext,
  begin(){if(!ext||active||pending.length>=16)return false;active=gl.createQuery();if(!active)return false;gl.beginQuery(ext.TIME_ELAPSED_EXT,active);return true;},
  end(){if(!active)return;gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null;},
  poll(){if(!ext)return[];if(gl.getParameter(ext.GPU_DISJOINT_EXT)){disjoint++;dropped+=pending.length;clear();return[];}const values=[];while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const q=pending.shift(),ns=gl.getQueryParameter(q,gl.QUERY_RESULT);gl.deleteQuery(q);if(Number.isFinite(ns)&&ns>=0)values.push(ns/1e6);}return values;},
  reset(){clear();disjoint=dropped=0;},dispose:clear,
  get pending(){return pending.length;},get disjoint(){return disjoint;},get dropped(){return dropped;}
 };
}

export function createBrowserPerformance({renderer,readState=()=>({})}){
 if(new URLSearchParams(location.search).get('perf')!=='1')return null;
 const gl=renderer.getContext(),timer=createGpuTimer(gl),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const panel=document.createElement('section');panel.setAttribute('aria-label','Browser performance measurement');
 panel.style.cssText='position:fixed;right:12px;bottom:12px;z-index:10000;background:#101c24ee;color:#eef4ef;border:1px solid #627b85;padding:10px;max-width:370px;font:12px/1.45 system-ui;max-height:48vh;overflow:auto';
 const title=document.createElement('strong');title.textContent='Browser CPU / GPU · 10 second sample';
 const label=document.createElement('input');label.setAttribute('aria-label','Performance run label');label.value='intact';label.style.width='110px';
 const start=document.createElement('button');start.textContent='Measure 10 s';
 const save=document.createElement('button');save.textContent='Save measurement JSON';save.disabled=true;
 const output=document.createElement('pre');output.style.cssText='white-space:pre-wrap;margin:8px 0 0';output.textContent=timer.supported?'GPU timer available. Warm scene, then measure.':'GPU timer unavailable; CPU/FPS only.';
 panel.append(title,document.createElement('br'),label,start,save,output);document.body.append(panel);
 let running=false,finishing=false,disposed=false,started=0,ended=0,previous=null,cpuStart=0,renderStart=0,frameNumber=0,lastUI=0,initial,report=null,runLabel='';
 let frames=[],main=[],render=[],gpu=[],worker={steps:0,ms:0,simSeconds:0};
 const snapshot=()=>({viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,renderPixelRatio:renderer.getPixelRatio()},drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,...readState()});
 function finish(){
  const frame=summarize(frames),seconds=(ended-started)/1000;
  report={version:1,label:runLabel,url:location.href,userAgent:navigator.userAgent,hardwareRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),seconds,
   fps:frame?1000/frame.mean:null,frameMs:frame,framesOver16_7ms:frames.filter(v=>v>1000/60).length,
   mainThreadMs:summarize(main),renderSubmissionMs:summarize(render),gpuMs:timer.disjoint?null:summarize(gpu),gpuStatus:!timer.supported?'unsupported':timer.disjoint?'disjoint':gpu.length?'measured':'no samples',gpuDisjointEvents:timer.disjoint,
   physics:{steps:worker.steps,msPerStep:worker.steps?worker.ms/worker.steps:0,simSeconds:worker.simSeconds,simulationPercent:100*worker.simSeconds/seconds},start:initial,end:snapshot()};
  const fmt=v=>v==null?'n/a':v.toFixed(2);
  output.textContent=runLabel+'\n'+fmt(report.fps)+' FPS · p95 frame '+fmt(frame?.p95)+' ms\nFrame CPU p95 '+fmt(report.mainThreadMs?.p95)+' ms · render '+fmt(report.renderSubmissionMs?.p95)+' ms\nGPU p95 '+fmt(report.gpuMs?.p95)+' ms ('+report.gpuStatus+')\nSimulation '+fmt(report.physics.simulationPercent)+'% · '+report.end.drawCalls+' draws\nOver 16.7 ms: '+report.framesOver16_7ms+'/'+frames.length;
  finishing=false;start.disabled=false;save.disabled=false;
 }
 start.onclick=()=>{timer.reset();frames=[];main=[];render=[];gpu=[];worker={steps:0,ms:0,simSeconds:0};previous=null;frameNumber=0;report=null;initial=snapshot();runLabel=label.value.trim()||'run';started=performance.now();running=true;finishing=false;start.disabled=true;save.disabled=true;output.textContent='Measuring '+runLabel+'…';};
 save.onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='structure-perf-'+runLabel.replace(/[^a-z0-9._-]/gi,'-')+'-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const cancelOnHide=()=>{if(document.hidden&&(running||finishing)){running=finishing=false;report=null;timer.reset();start.disabled=false;save.disabled=true;output.textContent='Measurement cancelled: tab hidden.';}};
 document.addEventListener('visibilitychange',cancelOnHide);
 return{
  beginFrame(now){if(disposed)return;gpu.push(...timer.poll());if(finishing&&(timer.pending===0||now-ended>2000))finish();if(!running)return;if(document.hidden){running=false;finishing=false;timer.reset();start.disabled=false;output.textContent='Measurement cancelled: tab hidden.';return;}cpuStart=performance.now();if(previous!=null)frames.push(now-previous);previous=now;frameNumber++;},
  beforeRender(){if(!running)return;renderStart=performance.now();if(frameNumber%4===0)timer.begin();},
  afterRender(now){if(!running)return;timer.end();const at=performance.now();render.push(at-renderStart);main.push(at-cpuStart);if(now-started>=10000){running=false;finishing=true;ended=now;output.textContent='Finishing GPU samples…';}else if(now-lastUI>500){lastUI=now;output.textContent='Measuring '+runLabel+'… '+((now-started)/1000).toFixed(1)+' / 10 s';}},
  observeWorker(stats){if(running){worker.steps+=stats.steps??0;worker.ms+=stats.physicsMs??0;worker.simSeconds+=stats.simDelta??0;}},
  dispose(){if(disposed)return;disposed=true;document.removeEventListener('visibilitychange',cancelOnHide);timer.dispose();panel.remove();},get report(){return report;}
 };
}
