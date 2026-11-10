import {Vector3,Quaternion} from 'three';
// Bounded render-state recorder. Local transforms are replayed, never physics.
// One frame record: per object position 3 + quaternion 4 + scale 3 + visible 1; per camera position 3 + quaternion 4 + fov 1;
// then the shared look-at target 3.
const OBJECT_FLOATS=11,CAMERA_FLOATS=8,TARGET_FLOATS=3;
const MAX_CAMERAS=8,DEFAULT_FOV=55,SPEED_RANGE=[.1,2];   // degrees; playback speed multiplier
export function createReplay({fps=20,seconds=20,maxObjects=1024,cameraIds=['recorded']}={}){
 const ids=[...new Set(['recorded',...cameraIds])];if(ids.length>MAX_CAMERAS)throw Error('Replay camera budget exceeded');let selectedCamera='recorded';
 const capacity=Math.max(2,Math.ceil(fps*seconds)),q0=new Quaternion(),q1=new Quaternion();let objects=[],storage=null,stride=0,count=0,head=0,last=-Infinity,saved=null,savedCamera=null,active=false,playing=false,cursor=0,speed=1;
 const times=new Float64Array(capacity),pose={position:new Vector3(),quaternion:new Quaternion(),fov:DEFAULT_FOV,target:new Vector3()};
 const physical=i=>(head-count+i+capacity)%capacity;
 const time=i=>times[physical(i)];
 function write(dst,start){let k=start;for(const o of objects){o.position.toArray(dst,k);k+=3;o.quaternion.toArray(dst,k);k+=4;o.scale.toArray(dst,k);k+=3;dst[k++]=o.visible?1:0;}}
 function restore(src){let k=0;for(const o of objects){o.position.fromArray(src,k);k+=3;o.quaternion.fromArray(src,k);k+=4;o.scale.fromArray(src,k);k+=3;o.visible=!!src[k++];o.updateMatrix();}}
 function apply(){if(!count)return null;let left=0;while(left<count-2&&time(left+1)<=cursor)left++;const right=Math.min(count-1,left+1),a=physical(left)*stride,b=physical(right)*stride,t=time(right)>time(left)?Math.max(0,Math.min(1,(cursor-time(left))/(time(right)-time(left)))):0;
  let k=0;for(const o of objects){for(let c=0;c<3;c++)o.position.setComponent(c,storage[a+k+c]+(storage[b+k+c]-storage[a+k+c])*t);k+=3;q0.fromArray(storage,a+k);q1.fromArray(storage,b+k);o.quaternion.slerpQuaternions(q0,q1,t);k+=4;for(let c=0;c<3;c++)o.scale.setComponent(c,storage[a+k+c]+(storage[b+k+c]-storage[a+k+c])*t);k+=3;o.visible=!!storage[(t>=1?b:a)+k++];o.updateMatrix();}
  k+=ids.indexOf(selectedCamera)*CAMERA_FLOATS;
  for(let c=0;c<3;c++)pose.position.setComponent(c,storage[a+k+c]+(storage[b+k+c]-storage[a+k+c])*t);k+=3;q0.fromArray(storage,a+k);q1.fromArray(storage,b+k);pose.quaternion.slerpQuaternions(q0,q1,t);k+=4;pose.fov=storage[a+k]+(storage[b+k]-storage[a+k])*t;k=objects.length*OBJECT_FLOATS+ids.length*CAMERA_FLOATS;for(let c=0;c<3;c++)pose.target.setComponent(c,storage[a+k+c]+(storage[b+k+c]-storage[a+k+c])*t);return pose;
 }
 const api={
  bind(next){if(active)throw Error('End replay before rebinding');const unique=[...new Set(next)];if(unique.length>maxObjects)throw Error('Replay object budget exceeded: '+unique.length+' > '+maxObjects);objects=unique;stride=objects.length*OBJECT_FLOATS+ids.length*CAMERA_FLOATS+TARGET_FLOATS;storage=new Float32Array(capacity*stride);count=head=0;last=-Infinity;},
  clear(){if(active)throw Error('End replay before clearing');objects=[];storage=null;count=head=0;last=-Infinity;},
  capture(t,camera,target,cameras={}){if(active||!storage||t-last<1/fps-1e-6)return;const start=head*stride;write(storage,start);let k=start+objects.length*OBJECT_FLOATS;for(const id of ids){const view=id==='recorded'?camera:cameras[id];if(!view)throw Error('Missing replay camera '+id);view.position.toArray(storage,k);k+=3;view.quaternion.toArray(storage,k);k+=4;storage[k++]=view.fov;}target.toArray(storage,k);times[head]=t;head=(head+1)%capacity;count=Math.min(capacity,count+1);last=t;},
  begin(camera){if(active||count<2)return false;saved=new Float32Array(objects.length*OBJECT_FLOATS);write(saved,0);savedCamera={position:camera.position.clone(),quaternion:camera.quaternion.clone(),fov:camera.fov};active=playing=true;selectedCamera='recorded';cursor=time(0);apply();return true;},
  end(camera){if(!active)return;restore(saved);camera.position.copy(savedCamera.position);camera.quaternion.copy(savedCamera.quaternion);camera.fov=savedCamera.fov;camera.updateProjectionMatrix();saved=savedCamera=null;active=playing=false;},
  seek(seconds){if(!active)return null;cursor=Math.max(time(0),Math.min(time(count-1),time(0)+seconds));return apply();},
  update(dt){if(!active)return null;if(playing){cursor=Math.min(time(count-1),cursor+Math.max(0,dt)*speed);if(cursor>=time(count-1))playing=false;}return apply();},
  selectCamera(id){if(!ids.includes(id))throw Error('Unknown replay camera '+id);selectedCamera=id;return active?apply():null;},get cameraIds(){return [...ids];},get selectedCamera(){return selectedCamera;},
  setPlaying(value){if(active&&value&&cursor>=time(count-1))cursor=time(0);playing=!!value;},setSpeed(value){speed=Math.max(SPEED_RANGE[0],Math.min(SPEED_RANGE[1],Number(value)||1));},
  get active(){return active;},get playing(){return playing;},get duration(){return count>1?time(count-1)-time(0):0;},get position(){return count?cursor-time(0):0;},get frames(){return count;},get bytes(){return storage?.byteLength??0;},get objectCount(){return objects.length;},
 };
 return api;
}
