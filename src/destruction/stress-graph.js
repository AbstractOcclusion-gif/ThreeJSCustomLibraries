import * as C from 'cannon-es';

const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const dot=(a,b)=>{let value=0;for(let i=0;i<a.length;i++)value+=a[i]*b[i];return value;};
const zeros=()=>new Float64Array(12);

// Linear, fixed-connection Euler-Bernoulli space frame. Each joint has three
// translations and three rotations. Units: metres, N, Nm, Pa, m^2 and m^4.
// This is a structural damage model; it does not integrate physical bodies.
export function createStressGraph({nodes,members}){
 if(!Array.isArray(nodes)||!nodes.length||nodes.some(n=>!vec(n.position)||!Number.isFinite(n.mass??0)||(n.mass??0)<0))throw Error('Invalid stress nodes');
 if(!Array.isArray(members))throw Error('Invalid stress members');
 const edges=members.map((m,id)=>{
  if(!Number.isInteger(m.a)||!Number.isInteger(m.b)||m.a===m.b||!nodes[m.a]||!nodes[m.b]||!['area','iy','iz'].every(k=>Number.isFinite(m[k])&&m[k]>0)||!Number.isFinite(m.torsion)||m.torsion<0)throw Error('Invalid stress member');
  const delta=new C.Vec3(...nodes[m.b].position).vsub(new C.Vec3(...nodes[m.a].position)),L=delta.length();if(L<1e-6)throw Error('Zero length stress member');
  const q=new C.Quaternion().setFromVectors(new C.Vec3(1,0,0),delta.scale(1/L)),axes=m.axes??[new C.Vec3(1,0,0),new C.Vec3(0,1,0),new C.Vec3(0,0,1)].map(v=>q.vmult(v).toArray());
  if(axes.length!==3||axes.some(a=>!vec(a))||axes.some((a,i)=>axes.some((b,j)=>Math.abs(dot(a,b)-(i===j?1:0))>1e-6)))throw Error('Invalid stress axes');
  const E=m.E??2e11,G=m.G??7.7e10;if(!(E>0&&G>0&&Number.isFinite(E)&&Number.isFinite(G)))throw Error('Invalid stress modulus');
  const k=Array.from({length:12},zeros),add=(ids,block)=>{for(let i=0;i<ids.length;i++)for(let j=0;j<ids.length;j++)k[ids[i]][ids[j]]+=block[i][j];};
  const pair=value=>[[value,-value],[-value,value]];add([0,6],pair(E*m.area/L));add([3,9],pair(G*m.torsion/L));
  function bend(ids,EI,sign){const a=12*EI/L**3,b=sign*6*EI/L**2,c=4*EI/L,d=2*EI/L;add(ids,[[a,b,-a,b],[b,c,-b,d],[-a,-b,a,-b],[b,d,-b,c]]);}
  bend([1,5,7,11],E*m.iz,1);bend([2,4,8,10],E*m.iy,-1);
  const K=Array.from({length:12},zeros);for(let i=0;i<12;i++)for(let j=0;j<12;j++){const bi=i-i%3,bj=j-j%3;for(let a=0;a<3;a++)for(let b=0;b<3;b++)K[i][j]+=axes[a][i%3]*k[bi+a][bj+b]*axes[b][j%3];}
  const mass=m.mass??(m.massPerMetre??0)*L;if(!Number.isFinite(mass)||mass<0||Object.values(m.capacity??{}).some(v=>!(v>0)))throw Error('Invalid stress mass/capacity');return{...m,id,L,axes,k,K,active:m.active!==false,mass,scale:1};
 });
 // Work buffers never escape solve(). Returned displacements, reactions and
 // end forces remain independently owned by each result.
 const applied=nodes.map(()=>new Float64Array(6)),localLoads=edges.map(zeros),loadsByMember=edges.map(()=>[]),local=zeros(),elastic=zeros(),equivalent=zeros(),zeroMoment=[0,0,0],loadRecords=[];
 const weights=edges.map(()=>({signature:new Float64Array(14).fill(NaN),load:zeros(),q:new Float64Array(3)}));
 let topology=0,cached=null,solves=0;
 function layout(){
  if(cached?.topology===topology)return cached;
  const parent=nodes.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};for(const e of edges)if(e.active)parent[find(e.a)]=find(e.b);
  const roots=new Set(nodes.flatMap((n,i)=>n.anchor?[find(i)]:[])),supported=nodes.map((_,i)=>roots.has(find(i))),map=nodes.map(()=>-1);let size=0;for(let i=0;i<nodes.length;i++)if(supported[i]&&!nodes[i].anchor){map[i]=size;size+=6;}
  const included=edges.filter(e=>e.active&&supported[e.a]),first=Int32Array.from({length:size},(_,i)=>i),dofs=e=>Array.from({length:12},(_,i)=>map[i<6?e.a:e.b]<0?-1:map[i<6?e.a:e.b]+i%6);
  for(const e of included){const ds=dofs(e);for(const i of ds)if(i>=0)for(const j of ds)if(j>=0&&j<i)first[i]=Math.min(first[i],j);}
  const offsets=new Int32Array(size+1);for(let i=0;i<size;i++)offsets[i+1]=offsets[i]+i-first[i]+1;
  const A=new Float64Array(offsets[size]),at=(i,j)=>offsets[i]+j-first[i];for(const e of included){const ds=dofs(e);for(let a=0;a<12;a++)if(ds[a]>=0)for(let b=0;b<12;b++)if(ds[b]>=0&&ds[a]>=ds[b])A[at(ds[a],ds[b])]+=e.K[a][b];}
  // Skyline LDL^T: retain only the lower row profile and its fill. No dense
  // (6N)^2 matrix, artificial ground springs or diagonal regularization.
  // Flat row offsets (row i, column j lives at rowStart[i]+j) and a per-row work
  // vector w[k]=L[i][k]*D[k] keep the inner loop free of closures and one multiply.
  const D=new Float64Array(size),L=new Float64Array(A),rowStart=new Int32Array(size),w=new Float64Array(size);for(let i=0;i<size;i++)rowStart[i]=offsets[i]-first[i];
  const scale=new Float64Array(size);for(let i=0;i<size;i++)scale[i]=A[rowStart[i]+i];let singular=-1;
  for(let i=0;i<size;i++){
   const ri=rowStart[i],fi=first[i];
   for(let j=fi;j<i;j++){const rj=rowStart[j];let value=L[ri+j];for(let k=first[j]>fi?first[j]:fi;k<j;k++)value-=w[k]*L[rj+k];const l=value/D[j];L[ri+j]=l;w[j]=l*D[j];}
   let d=L[ri+i];for(let k=fi;k<i;k++)d-=L[ri+k]*w[k];if(!Number.isFinite(d)||d<=Math.max(1e-12,scale[i]*1e-11)){singular=i;break;}D[i]=d;
  }
  cached={topology,supported,map,included,size,first,offsets,at,rowStart,L,D,singular,storage:A.length,solution:new Float64Array(size)};return cached;
 }
 function pointLoad(e,t,f,m,p){
  const L=e.L,t2=t*t,t3=t2*t,H0=1-3*t2+2*t3,H1=L*(t-2*t2+t3),H2=3*t2-2*t3,H3=L*(-t2+t3),dH0=(-6*t+6*t2)/L,dH1=1-4*t+3*t2,dH2=(6*t-6*t2)/L,dH3=-2*t+3*t2;
  p.fill(0);p[0]=(1-t)*f[0];p[6]=t*f[0];
  p[1]=H0*f[1]+dH0*m[2];p[5]=H1*f[1]+dH1*m[2];p[7]=H2*f[1]+dH2*m[2];p[11]=H3*f[1]+dH3*m[2];
  p[2]=H0*f[2]-dH0*m[1];p[4]=-(H1*f[2]-dH1*m[1]);p[8]=H2*f[2]-dH2*m[1];p[10]=-(H3*f[2]-dH3*m[1]);p[3]=(1-t)*m[0];p[9]=t*m[0];
 }
 function weightFor(e,gravity){
  const weight=weights[e.id],signature=weight.signature;let changed=signature[0]!==e.mass||signature[13]!==e.L;
  for(let i=0;i<3;i++){if(signature[i+1]!==gravity[i])changed=true;for(let j=0;j<3;j++)if(signature[4+i*3+j]!==e.axes[i][j])changed=true;}
  if(changed){
   signature[0]=e.mass;signature[13]=e.L;for(let i=0;i<3;i++){signature[i+1]=gravity[i];for(let j=0;j<3;j++)signature[4+i*3+j]=e.axes[i][j];weight.q[i]=dot(e.axes[i],gravity)*e.mass/e.L;}
   // Retain the existing two-point quadrature and arithmetic order. This cache
   // contains only member self-weight, independent of support topology.
   weight.load.fill(0);const force=gravity.map(g=>g*e.mass/2),f=e.axes.map(a=>dot(a,force));
   for(const t of [.5-.5/Math.sqrt(3),.5+.5/Math.sqrt(3)]){pointLoad(e,t,f,zeroMoment,equivalent);for(let i=0;i<12;i++)weight.load[i]+=equivalent[i];}
  }
  return weight;
 }
 function solve({gravity=[0,-9.82,0],nodalLoads=[],memberLoads=[]}={}){
  if(!vec(gravity))throw Error('Invalid graph gravity');const start=performance.now(),s=layout();solves++;
  if(s.singular>=0)return{status:'mechanism',singularDof:s.singular,supported:s.supported,solves,ms:performance.now()-start,storage:s.storage};
  for(let i=0;i<nodes.length;i++){const p=applied[i];p.fill(0);if(s.supported[i])for(let j=0;j<3;j++)p[j]=gravity[j]*(nodes[i].mass??0);}
  for(let i=0;i<edges.length;i++){localLoads[i].fill(0);loadsByMember[i].length=0;}
  for(const e of s.included)localLoads[e.id].set(weightFor(e,gravity).load);
  let recordCount=0;for(const load of memberLoads){const e=edges[load.member];if(!e||!e.active||!s.supported[e.a])continue;const moment=load.moment??zeroMoment;if(!vec(load.force)||!(load.t>=0&&load.t<=1)||!vec(moment))throw Error('Invalid member load');
   let record=loadRecords[recordCount++];if(!record){record={t:0,f:new Float64Array(3),m:new Float64Array(3)};loadRecords.push(record);}record.t=load.t;for(let i=0;i<3;i++){record.f[i]=dot(e.axes[i],load.force);record.m[i]=dot(e.axes[i],moment);}
   pointLoad(e,load.t,record.f,record.m,equivalent);for(let i=0;i<12;i++)localLoads[e.id][i]+=equivalent[i];if(load.member===e.id)loadsByMember[e.id].push(record);
  }
  for(const load of nodalLoads){const moment=load.moment??zeroMoment;if(!nodes[load.node]||!vec(load.force)||!vec(moment))throw Error('Invalid node load');if(!s.supported[load.node])continue;for(let i=0;i<6;i++)applied[load.node][i]+=i<3?load.force[i]:moment[i-3];}
  for(const e of s.included){const p=localLoads[e.id];for(let end=0;end<2;end++)for(let block=0;block<2;block++)for(let i=0;i<3;i++)for(let a=0;a<3;a++)applied[end?e.b:e.a][block*3+i]+=e.axes[a][i]*p[end*6+block*3+a];}
  const u=s.solution;for(let n=0;n<nodes.length;n++)if(s.map[n]>=0)for(let a=0;a<6;a++)u[s.map[n]+a]=applied[n][a];
  {const L=s.L,first=s.first,rowStart=s.rowStart,D=s.D,n=s.size;for(let i=0;i<n;i++){const ri=rowStart[i];let x=u[i];for(let j=first[i];j<i;j++)x-=L[ri+j]*u[j];u[i]=x;}for(let i=0;i<n;i++)u[i]/=D[i];for(let i=n-1;i>=0;i--){const ri=rowStart[i],ui=u[i];for(let j=first[i];j<i;j++)u[j]-=L[ri+j]*ui;}}
  const displacements=nodes.map((_,n)=>s.map[n]<0?new Float64Array(6):u.slice(s.map[n],s.map[n]+6)),reactions=applied.map(p=>Float64Array.from(p,x=>-x)),demands=[];
  for(const e of s.included){local.fill(0);for(let end=0;end<2;end++)for(let block=0;block<2;block++)for(let a=0;a<3;a++)for(let i=0;i<3;i++)local[end*6+block*3+a]+=e.axes[a][i]*displacements[end?e.b:e.a][block*3+i];const endForces=new Array(12);for(let i=0;i<12;i++){elastic[i]=dot(e.k[i],local);endForces[i]=elastic[i]-localLoads[e.id][i];}
   for(let end=0;end<2;end++)for(let block=0;block<2;block++)for(let i=0;i<3;i++)for(let a=0;a<3;a++)reactions[end?e.b:e.a][block*3+i]+=e.axes[a][i]*elastic[end*6+block*3+a];
   // Evaluate end and interior sections; loads inside the span can produce a
   // larger bending moment than either end (e.g. a supported loaded floor beam).
   const axial=Math.max(Math.abs(endForces[0]),Math.abs(endForces[6])),shear=Math.max(Math.hypot(endForces[1],endForces[2]),Math.hypot(endForces[7],endForces[8])),torsion=Math.max(Math.abs(endForces[3]),Math.abs(endForces[9]));
   let bendingY=Math.max(Math.abs(endForces[4]),Math.abs(endForces[10])),bendingZ=Math.max(Math.abs(endForces[5]),Math.abs(endForces[11]));
   const loads=loadsByMember[e.id],q=weights[e.id].q;loads.sort((a,b)=>a.t-b.t);
   // Merge the three fixed sections with load positions. Prefix resultants
   // replace the quadratic scan; strict < retains the original jump convention
   // for coincident point forces and couples. Equivalent nodal loads above
   // retain their original accumulation order.
   let quarter=0,atLoad=0,consumed=0,fy=0,fz=0,tfy=0,tfz=0,myLoad=0,mzLoad=0;
   for(let at=0;at<3+loads.length;at++){
    const t=quarter<3&&(atLoad===loads.length||(quarter+1)*.25<=loads[atLoad].t)?++quarter*.25:loads[atLoad++].t;
    while(consumed<loads.length&&loads[consumed].t<t){const l=loads[consumed++];fy+=l.f[1];fz+=l.f[2];tfy+=l.t*l.f[1];tfz+=l.t*l.f[2];myLoad+=l.m[1];mzLoad+=l.m[2];}
    const x=t*e.L,my=-endForces[4]-x*endForces[2]-q[2]*x*x/2-e.L*(t*fz-tfz)-myLoad,mz=-endForces[5]+x*endForces[1]+q[1]*x*x/2+e.L*(t*fy-tfy)-mzLoad;
    bendingY=Math.max(bendingY,Math.abs(my));bendingZ=Math.max(bendingZ,Math.abs(mz));
   }
   const c=e.capacity??{},ratio=(value,key)=>value/(c[key]??Infinity),compression=Math.max(0,endForces[0],-endForces[6]),tension=Math.max(0,-endForces[0],endForces[6]),axialRatio=Math.max(compression/(c.compression??c.axial??Infinity),tension/(c.tension??c.axial??Infinity)),utilisation=axialRatio+Math.hypot(ratio(bendingY,'bendingY'),ratio(bendingZ,'bendingZ')),uMax=Math.max(utilisation,ratio(shear,'shear'),ratio(torsion,'torsion'));
   demands.push({member:e.id,axial,shear,torsion,bendingY,bendingZ,utilisation:uMax,endForces});
  }
  return{status:'stable',supported:s.supported,displacements,reactions,demands,solves,ms:performance.now()-start,storage:s.storage};
 }
 return{nodes,edges,solve,
 // Uniform stiffness scale on one member (a yielded member keeps carrying load at a fraction of its
 // elastic stiffness). Scales local and global matrices together so demands stay consistent.
 setStiffnessScale(id,scale){const e=edges[id];if(!e)throw Error('Unknown stress member');if(!(Number.isFinite(scale)&&scale>0))throw Error('Stiffness scale must be positive');if(scale===e.scale)return;const f=scale/e.scale;for(let i=0;i<12;i++)for(let j=0;j<12;j++){e.k[i][j]*=f;e.K[i][j]*=f;}e.scale=scale;topology++;},
 setActive(id,active){if(!edges[id])throw Error('Unknown stress member');if(edges[id].active!==!!active){edges[id].active=!!active;topology++;}},get topologyRevision(){return topology;},get supported(){return layout().supported;},get solves(){return solves;}};
}
