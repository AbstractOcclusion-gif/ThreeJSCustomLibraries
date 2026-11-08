import {Vector3} from 'three';
// Host raycast(start,end) returns nearest hit distance, or Infinity. Five probes
// approximate camera clearance; this is not an exact physics shape sweep.
export function createCameraCollision({raycast,radius=.35,skin=.15,release=4,hold=.15}={}){
 const direction=new Vector3(),right=new Vector3(),up=new Vector3(),start=new Vector3(),end=new Vector3(),offset=new Vector3(),worldUp=new Vector3(0,1,0);
 let arm=null,blockedFor=0;
 const resolve=(target,desired,out=new Vector3(),dt=0)=>{
  direction.subVectors(desired,target);const length=direction.length();if(length<1e-5)return out.copy(desired);direction.divideScalar(length);right.crossVectors(direction,worldUp);if(right.lengthSq()<1e-6)right.set(1,0,0);else right.normalize();up.crossVectors(right,direction).normalize();let allowed=length;
  for(const [x,y]of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){offset.copy(right).multiplyScalar(x*radius).addScaledVector(up,y*radius);start.copy(target).add(offset);end.copy(desired).add(offset);const hit=raycast(start,end);if(Number.isFinite(hit))allowed=Math.min(allowed,Math.max(.05,hit-skin));}
  // Retract immediately for safety. Hold the short arm through brief ray misses,
  // then ease outward; never feed this correction back into a follow rig.
  if(arm===null||dt<=0){arm=allowed;blockedFor=allowed<length?hold:0;}
  else if(allowed<=arm+1e-5&&allowed<length){arm=allowed;blockedFor=hold;}
  else{const wait=Math.min(blockedFor,dt);blockedFor-=wait;arm+=(allowed-arm)*(1-Math.exp(-Math.max(0,dt-wait)*release));}
  return out.copy(target).addScaledVector(direction,Math.min(allowed,arm));
 };
 resolve.reset=()=>{arm=null;blockedFor=0;};return resolve;
}
