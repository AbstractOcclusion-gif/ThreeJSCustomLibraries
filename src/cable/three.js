import * as T from 'three';
import {CABLE_BUDGET} from './cable.js';

const DEFAULT_ROUGHNESS=.8,POSE_FLOATS=7;   // per link: position 3 + quaternion 4
// Tangent by central difference TANGENT_PROBE either side; the frame's up switches to +Z where the tangent is this close to vertical.
const TANGENT_PROBE=.0001,VERTICAL_COS=.95;
// One bounded mesh for every surviving section. Never interpolate across cuts.
export function createThreeCableView({cable,scene,subdivisions=CABLE_BUDGET.subdivisions,cullDistance=CABLE_BUDGET.cullDistance}){
 if(!Number.isFinite(cullDistance)||cullDistance<1)throw Error('Invalid cable view distance');
 if(!Number.isInteger(subdivisions)||subdivisions<CABLE_BUDGET.segments||subdivisions>CABLE_BUDGET.subdivisions)throw Error('Cable view needs 24–96 visual subdivisions');
 const sides=CABLE_BUDGET.radialSides,capacity=(CABLE_BUDGET.subdivisions+CABLE_BUDGET.segments)*sides,geometry=new T.BufferGeometry(),positions=new Float32Array(capacity*3),normals=new Float32Array(capacity*3),indices=new Uint16Array(CABLE_BUDGET.subdivisions*sides*6);
 geometry.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('normal',new T.BufferAttribute(normals,3).setUsage(T.DynamicDrawUsage));geometry.setIndex(new T.BufferAttribute(indices,1).setUsage(T.DynamicDrawUsage));
 const material=new T.MeshStandardMaterial({color:cable.profile.color,metalness:cable.profile.metalness??0,roughness:cable.profile.roughness??DEFAULT_ROUGHNESS,side:T.DoubleSide}),mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);let disposed=false;
 const poses=new Float64Array(cable.links.length*POSE_FLOATS).fill(NaN),curves=[],whole=[{first:0,last:cable.links.length-1}],p=new T.Vector3(),t=new T.Vector3(),t0=new T.Vector3(),t1=new T.Vector3(),u=new T.Vector3(),n=new T.Vector3(),b=new T.Vector3(),normal=new T.Vector3(),v=new T.Vector3();
 const cos=Array.from({length:sides},(_,j)=>Math.cos(j/sides*Math.PI*2)),sin=Array.from({length:sides},(_,j)=>Math.sin(j/sides*Math.PI*2));
 const tip=(out,l,sign)=>out.set(sign*l.length/2,0,0).applyQuaternion(l.body.quaternion).add(l.body.position);
 function update(camera){
  if(disposed)return;let vertex=0,index=0;const sections=cable.sections??whole;
  mesh.visible=!camera||cable.links.some(l=>camera.position.distanceToSquared(l.body.position)<cullDistance*cullDistance);if(!mesh.visible)return;
  let topology=curves.length!==sections.length;
  if(!topology)for(let i=0;i<sections.length;i++)if(curves[i].first!==sections[i].first||curves[i].last!==sections[i].last){topology=true;break;}
  let moved=topology;
  for(let i=0;i<cable.links.length;i++){const body=cable.links[i].body,o=i*POSE_FLOATS,p=body.position,q=body.quaternion;if(poses[o]!==p.x||poses[o+1]!==p.y||poses[o+2]!==p.z||poses[o+3]!==q.x||poses[o+4]!==q.y||poses[o+5]!==q.z||poses[o+6]!==q.w)moved=true;poses[o]=p.x;poses[o+1]=p.y;poses[o+2]=p.z;poses[o+3]=q.x;poses[o+4]=q.y;poses[o+5]=q.z;poses[o+6]=q.w;}
  if(!moved)return;
  if(topology){
   curves.length=0;let remainingSteps=subdivisions,remainingLength=0;
   for(const {first,last}of sections)for(let i=first;i<=last;i++)remainingLength+=cable.links[i].length;
   for(let k=0;k<sections.length;k++){const {first,last}=sections[k];let length=0;for(let i=first;i<=last;i++)length+=cable.links[i].length;
    const points=Array.from({length:last-first+3},()=>new T.Vector3()),steps=Math.max(1,Math.min(remainingSteps-(sections.length-k-1),Math.round(remainingSteps*length/remainingLength)));
    curves.push({first,last,points,steps,curve:new T.CatmullRomCurve3(points,false,'centripetal')});remainingSteps-=steps;remainingLength-=length;
   }
  }
  for(const {first,last,points,steps,curve}of curves){
   tip(points[0],cable.links[first],-1);for(let j=first;j<=last;j++)points[j-first+1].copy(cable.links[j].body.position);tip(points.at(-1),cable.links[last],1);const base=vertex;
   for(let i=0;i<=steps;i++){
    const time=i/steps;curve.getPoint(time,p);curve.getPoint(Math.max(0,time-TANGENT_PROBE),t0);curve.getPoint(Math.min(1,time+TANGENT_PROBE),t1);t.copy(t1).sub(t0).normalize();u.set(0,1,0);if(Math.abs(t.dot(u))>VERTICAL_COS)u.set(0,0,1);n.crossVectors(t,u).normalize();b.crossVectors(t,n).normalize();
    for(let j=0;j<sides;j++){normal.copy(n).multiplyScalar(cos[j]).addScaledVector(b,sin[j]);v.copy(p).addScaledVector(normal,cable.profile.radius);v.toArray(positions,vertex*3);normal.toArray(normals,vertex*3);vertex++;}
    if(i<steps)for(let j=0;j<sides;j++){const a=base+i*sides+j,b=base+i*sides+(j+1)%sides,c=a+sides,d=b+sides;if(topology){indices[index]=a;indices[index+1]=c;indices[index+2]=b;indices[index+3]=b;indices[index+4]=c;indices[index+5]=d;}index+=6;}
   }
  }
  geometry.attributes.position.needsUpdate=true;geometry.attributes.normal.needsUpdate=true;if(topology)geometry.index.needsUpdate=true;geometry.setDrawRange(0,index);geometry.computeBoundingSphere();
 }
 update();return{roots:[mesh],update,get vertexCount(){return geometry.drawRange.count;},dispose(){if(disposed)return;disposed=true;scene.remove(mesh);geometry.dispose();material.dispose();}};
}
