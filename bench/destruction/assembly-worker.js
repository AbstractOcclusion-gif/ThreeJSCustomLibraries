import {createAssemblySimulation} from '../../src/destruction/assembly-simulation.js';
import {createJoltClusterDriver} from '../../src/destruction/jolt-clusters.js';
import {createJoltDriver} from '../../src/destruction/jolt-driver.js';
let simulation,joltModule;
// The multithreaded npm build is the only SIMD build. Its job threads cannot call
// owner-side JS contact closures. Worker-local listeners are possible, but the
// live fracture graph is not worker-safe; keep zero job workers here. It needs
// SharedArrayBuffer, so a page without cross-origin isolation loads the plain build.
function loadJolt(simd){joltModule??=(simd?import('jolt-physics/wasm-multithread'):import('jolt-physics')).then(async module=>module.default());return joltModule;}
async function driverFor(backend,options){if(backend!=='jolt'&&backend!=='jolt-bars')return null;const simd=self.crossOriginIsolated===true&&options.simd!==false,J=await loadJolt(simd),native=simd?{workerThreads:0}:{};if(backend==='jolt'&&options.scene==='cable'&&options.cable?.setup==='transmission')return createJoltClusterDriver(J,{native:{...native,settleFreeze:false},dynamicFrame:0,label:(simd?' SIMD':'')+' transmission'});return backend==='jolt-bars'?createJoltDriver(J,{...native,...(options.scene==='cable'?{settleFreeze:false}:{})}):createJoltClusterDriver(J,{native,dynamicFrame:options.frame??2,label:(simd?' SIMD':'')+(options.frame?(options.definition?.metadata?.wholeWalls?' grounded house':' dynamic frame'):'')});}
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){simulation?.dispose();const driver=await driverFor(data.options.backend,data.options);try{simulation=createAssemblySimulation({...data.options,driver});}catch(error){driver?.dispose();simulation=null;throw error;}const state=simulation.snapshot(undefined,{delta:true});self.postMessage({type:'ready',model:simulation.describe(),state},[state.buffer]);}
  else if(data.type==='advance'&&simulation){for(const command of data.commands)simulation.command(command);simulation.advance(data.seconds);const state=simulation.snapshot(data.buffer,{delta:true});self.postMessage({type:'state',state},[state.buffer]);}
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
