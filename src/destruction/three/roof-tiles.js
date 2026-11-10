import * as T from 'three';
import {createChips} from '../../particles/chips.js';
import {uploadInstanceAttribute} from './chunks.js';
import {prepareSurfaceCoordinates} from './surface-detail.js';

// Built-in canal tile (metres) and the hand-laid look: each tile laps the one
// below it, sits slightly askew and carries its own fired-clay tint.
const TILE={halfWidth:.145,rise:.075,thickness:.012,length:.39};
const LAY={lapPitch:.06,lift:.012,yaw:.04,roll:.025,offset:.006};
const TINT={light:[.8,1.08],warmth:.06,weatheredShare:.1,weathered:[.58,.74]};
function seeded(seed){let a=(seed+1)*0x9E3779B9>>>0;return()=>{a=a+0x6D2B79F5>>>0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// Covering follows stable roof-piece identities. It adds no bodies or joints;
// roof panel mass already includes the nominal covering load.
// uvRect=[u0,v0,u1,v1] maps the built-in tile onto one atlas tile of a borrowed material.
export function createRoofTilesView({system,scene,geometry:borrowedGeometry=null,material:borrowedMaterial=null,color=0xb35d37,uvRect=null}){
 const tiles=(system.floors?.panels??[]).flatMap(panel=>(panel.row.roofTiles??[]).map(tile=>({panel,...tile,released:false})));
 if(!tiles.length)return{roots:[],update(){},tick(){},pick(){return null;},dispose(){},get active(){return 0;}};
 const section=new T.Shape();section.moveTo(-TILE.halfWidth,0);section.quadraticCurveTo(0,TILE.rise,TILE.halfWidth,0);section.lineTo(TILE.halfWidth,-TILE.thickness);section.quadraticCurveTo(0,TILE.rise-TILE.thickness,-TILE.halfWidth,-TILE.thickness);section.closePath();
 const geometry=borrowedGeometry??new T.ExtrudeGeometry(section,{depth:TILE.length,bevelEnabled:false,curveSegments:5});if(!borrowedGeometry)geometry.translate(0,0,-TILE.length/2);
 if(uvRect&&!borrowedGeometry){const at=geometry.attributes.position,uv=geometry.attributes.uv;for(let i=0;i<at.count;i++)uv.setXY(i,uvRect[0]+(at.getX(i)+TILE.halfWidth)/(2*TILE.halfWidth)*(uvRect[2]-uvRect[0]),uvRect[1]+(at.getZ(i)+TILE.length/2)/TILE.length*(uvRect[3]-uvRect[1]));
  // The realistic surface shader tiles its detail from authored metres, like the GLB parts.
  prepareSurfaceCoordinates(geometry,new T.Matrix4());}
 const material=borrowedMaterial??new T.MeshStandardMaterial({color:0xffffff,roughness:.9}),mesh=new T.InstancedMesh(geometry,material,tiles.length),picks=[],point=new T.Vector3(),velocity=new T.Vector3(),dummy=new T.Object3D(),colour=new T.Color(color);
 mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);scene.add(mesh);
 const particles=createChips(scene,{geometry,material,pool:tiles.length,life:[7,11],baseSize:[.9,1.1],groundOffset:.015,bounce:.15});particles.setGround(()=>0);
 let disposed=false,pendingEmission=false;const ownerCache=new Map(),panels=[...new Set(tiles.map(t=>t.panel))],groupPoses=new WeakMap();for(let i=0;i<tiles.length;i++)mesh.setColorAt(i,colour);
 // A borrowed geometry keeps the caller's exact placement; only the built-in canal tile is laid.
 const euler=new T.Euler(),slope=new T.Vector3(),laid=borrowedGeometry?0:1;
 for(const [index,tile] of tiles.entries()){
  const random=seeded(index),weathered=random()<TINT.weatheredShare,light=weathered?TINT.weathered[0]+random()*(TINT.weathered[1]-TINT.weathered[0]):TINT.light[0]+random()*(TINT.light[1]-TINT.light[0]),warm=(random()-.5)*2*TINT.warmth;
  tile.tint=colour.clone().multiply(new T.Color(light*(1+warm),light,light*(1-warm)*(weathered?1.06:1)));tile.tintHex=tile.tint.getHex();
  tile.local=[tile.position[0]+laid*(random()-.5)*2*LAY.offset,tile.position[1]+laid*LAY.lift,tile.position[2]+laid*(random()-.5)*2*LAY.offset];
  tile.yaw=laid*(random()-.5)*2*LAY.yaw;tile.roll=laid*(random()-.5)*2*LAY.roll;
 }
 function update(){
  if(disposed)return;
  let changed=pendingEmission;
  for(const panel of panels){const cached=ownerCache.get(panel);if(!cached||cached.groups!==panel.groups||cached.revision!==(panel.revision??system.floors.revision)||cached.broken!==panel.broken)changed=true;
   for(const group of panel.groups??[]){let pose=groupPoses.get(group);const p=group.body.position,q=group.body.quaternion;if(!pose){pose=new Float64Array(8).fill(NaN);groupPoses.set(group,pose);}const detached=group.detached?1:0;if(pose[0]!==p.x||pose[1]!==p.y||pose[2]!==p.z||pose[3]!==q.x||pose[4]!==q.y||pose[5]!==q.z||pose[6]!==q.w||pose[7]!==detached)changed=true;pose[0]=p.x;pose[1]=p.y;pose[2]=p.z;pose[3]=q.x;pose[4]=q.y;pose[5]=q.z;pose[6]=q.w;pose[7]=detached;}
  }
  if(!changed){for(const tile of tiles)tile.elapsed=0;return;}pendingEmission=false;
  const owners=new Map();for(const tile of tiles)if(!owners.has(tile.panel)){const panel=tile.panel,revision=panel.revision??system.floors.revision;let cache=ownerCache.get(panel);if(!cache||cache.revision!==revision||cache.groups!==panel.groups){const map=new Map();for(const group of panel.groups??[])for(const id of group.pieceIds)map.set(id,group);cache={map,revision,groups:panel.groups};ownerCache.set(panel,cache);}cache.broken=panel.broken;owners.set(panel,cache.map);}
  let count=0,min=Infinity,max=-1;
  for(const tile of tiles){
   if(tile.released)continue;const group=owners.get(tile.panel).get(tile.pieceId);
   if(!group){tile.released=true;continue;}
   const body=group.body,p=body.position,q=body.quaternion,pose=tile.pose??(tile.pose=new Float64Array(7).fill(NaN)),same=tile.revision===(tile.panel.revision??system.floors.revision)&&tile.group===group&&pose[0]===p.x&&pose[1]===p.y&&pose[2]===p.z&&pose[3]===q.x&&pose[4]===q.y&&pose[5]===q.z&&pose[6]===q.w;
   if(same&&tile.slot===count&&!(tile.panel.broken&&group.detached)){tile.elapsed=0;picks[count++]=tile.pick;continue;}
   tile.group=group;tile.revision=tile.panel.revision??system.floors.revision;pose[0]=p.x;pose[1]=p.y;pose[2]=p.z;pose[3]=q.x;pose[4]=q.y;pose[5]=q.z;pose[6]=q.w;
   const centre=group.assetCentre??[0,0,0];point.set(tile.local[0]-centre[0],tile.local[1]-centre[1],tile.local[2]-centre[2]).applyQuaternion(group.body.quaternion).add(group.body.position);
   if(tile.panel.broken&&group.detached){
    velocity.set(0,0,0);if(group.body.velocity)velocity.copy(group.body.velocity);
    // The browser mirrors contain poses only. Derive a bounded launch velocity
    // from observed tile displacement when a live native velocity is unavailable.
    else if(tile.previous&&tile.elapsed>0)velocity.copy(point).sub(tile.previous).multiplyScalar(1/tile.elapsed).clampLength(0,20);
    if(particles.emit(point,{color:tile.tintHex,chips:1},2,velocity)===1)tile.released=true;
    if(tile.released)continue;pendingEmission=true;
   }
   tile.previous??=new T.Vector3();tile.previous.copy(point);tile.elapsed=0;
   // Fixed the first time the tile is laid: its length runs down the slope (whichever
   // panel axis climbs more) and its up-slope end tucks under the next tile.
   if(!tile.lay){
    const alongZ=slope.set(0,0,1).applyQuaternion(group.body.quaternion).y,alongX=slope.set(1,0,0).applyQuaternion(group.body.quaternion).y,turned=laid&&Math.abs(alongX)>Math.abs(alongZ);
    tile.lay=new T.Quaternion().setFromEuler(euler.set(laid*((turned?alongX:alongZ)>=0?1:-1)*LAY.lapPitch,(turned?Math.PI/2:0)+tile.yaw,tile.roll,'YXZ'));
   }
   dummy.position.copy(point);dummy.quaternion.copy(group.body.quaternion).multiply(tile.lay);dummy.scale.set(1,1,1);dummy.updateMatrix();mesh.setMatrixAt(count,dummy.matrix);mesh.setColorAt(count,tile.tint);mesh.instanceColor.needsUpdate=true;min=Math.min(min,count);max=count;tile.slot=count;tile.pick={panel:tile.panel,panelId:tile.panel.id,body:group.body,pieceId:tile.pieceId};picks[count++]=tile.pick;
  }
  if(mesh.count!==count||max>=min){mesh.boundingSphere=null;mesh.boundingBox=null;}mesh.count=count;picks.length=count;uploadInstanceAttribute(mesh.instanceMatrix,min,max,16);
 }
 return{roots:[mesh],update,tick(dt){if(disposed)return;for(const tile of tiles)tile.elapsed=(tile.elapsed??0)+dt;particles.tick(dt);},get active(){return particles.active;},pick(hit){return hit?.object===mesh?picks[hit.instanceId]??null:null;},dispose(){if(disposed)return;disposed=true;ownerCache.clear();particles.dispose();scene.remove(mesh);mesh.dispose();if(!borrowedGeometry)geometry.dispose();if(!borrowedMaterial)material.dispose();}};
}
