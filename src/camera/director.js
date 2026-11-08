import {PerspectiveCamera,Vector3,Quaternion} from 'three';
// Owns the output camera and shot timing. Never advances a host simulation.
export function createCameraDirector(camera,{timeTransition=.35}={}){
 const rigs=new Map(),from={position:new Vector3(),quaternion:new Quaternion(),fov:camera.fov};
 let selected=null,transition=0,elapsed=0,manualScale=1,bulletLeft=0,bulletScale=.2,bulletShot=null,bulletFov=45,shakeLeft=0,shakeStrength=0,shakeDuration=1,clock=0,collision=null,cinematic=false;
 const capture=()=>{from.position.copy(camera.position);from.quaternion.copy(camera.quaternion);from.fov=camera.fov;};
 let currentScale=1,scaleTarget=1,scaleFrom=1,scaleElapsed=0;
 return{
  camera,register(id,rig){rigs.set(id,rig);if(selected===null)selected=id;return this;},
  select(id,{duration=.4}={}){if(!rigs.has(id))throw Error('Unknown camera: '+id);capture();selected=id;transition=Math.max(0,duration);elapsed=0;},
  setSlow(scale=1){manualScale=Math.max(.02,Math.min(1,scale));},
  bullet({duration=2,scale=.2,shot='orbit',fov=45}={}){if(bulletLeft<=0)capture();bulletLeft=Math.max(0,duration);bulletScale=Math.max(.02,Math.min(1,scale));bulletShot=rigs.has(shot)?shot:null;bulletFov=fov;elapsed=0;transition=.3;},
  setCollision(resolver){collision=resolver;},setCinematic(value){cinematic=!!value;},get cinematic(){return cinematic;},
  shake({strength=.15,duration=.25}={}){shakeLeft=shakeDuration=Math.max(.01,duration);shakeStrength=Math.max(0,Math.min(1,strength));},
  tick(dt){dt=Math.max(0,dt);const was=bulletLeft>0;bulletLeft=Math.max(0,bulletLeft-dt);if(was&&!bulletLeft){capture();elapsed=0;transition=.4;}const target=Math.min(manualScale,bulletLeft>0?bulletScale:1);
   if(target!==scaleTarget){scaleFrom=currentScale;scaleTarget=target;scaleElapsed=0;}scaleElapsed+=dt;let t=timeTransition>0?Math.min(1,scaleElapsed/timeTransition):1;t=t*t*(3-2*t);currentScale=scaleFrom+(scaleTarget-scaleFrom)*t;return currentScale;},
  update(dt,data){const id=bulletLeft>0&&bulletShot?bulletShot:selected,rig=rigs.get(id);if(!rig)return;
   const pose=rig({dt,data,camera});if(!pose)return;elapsed+=Math.max(0,dt);let a=transition?Math.min(1,elapsed/transition):1;a=a*a*(3-2*a);
   camera.position.lerpVectors(from.position,pose.position,a);camera.quaternion.slerpQuaternions(from.quaternion,pose.quaternion,a);camera.fov=from.fov+((bulletLeft>0?bulletFov:pose.fov??camera.fov)-from.fov)*a;
   clock+=dt;if(shakeLeft>0){shakeLeft=Math.max(0,shakeLeft-dt);const strength=shakeStrength*shakeLeft/shakeDuration;camera.position.x+=Math.sin(clock*87)*strength;camera.position.y+=Math.sin(clock*113)*strength;}
   if(collision&&data?.target)collision(data.target,camera.position,camera.position,dt);
   camera.updateProjectionMatrix();camera.updateMatrixWorld();
  },
  reset(){bulletLeft=0;bulletShot=null;shakeLeft=0;transition=0;elapsed=0;currentScale=scaleTarget=scaleFrom=manualScale;scaleElapsed=0;capture();collision?.reset?.();for(const rig of rigs.values())rig.reset?.();},
  get selected(){return selected;},get timeScale(){return currentScale;},get bulletActive(){return bulletLeft>0;},
 };
}
export function createOrbitRig({radius=12,height=5,speed=.35}={}){
 const pose=new PerspectiveCamera(),target=new Vector3();let angle=0;
 const rig=({dt,data})=>{angle+=dt*speed;target.copy(data.target);const d=data.distance??1;pose.position.set(target.x+Math.cos(angle)*radius*d,target.y+height*d,target.z+Math.sin(angle)*radius*d);pose.lookAt(target);pose.fov=55;return pose;};rig.reset=()=>angle=0;return rig;
}
export function createFollowRig({offset=[8,5,-10],lookAhead=[0,0,0],smoothing=5,fov=55}={}){
 const pose=new PerspectiveCamera(),desired=new Vector3(),look=new Vector3();let initialized=false;
 const rig=({dt,data})=>{desired.fromArray(offset).multiplyScalar(data.distance??1).add(data.target);if(!initialized)pose.position.copy(desired);else pose.position.lerp(desired,1-Math.exp(-dt*smoothing));look.copy(data.target).add(new Vector3(...lookAhead));pose.lookAt(look);pose.fov=fov;initialized=true;return pose;};rig.reset=()=>initialized=false;return rig;
}
