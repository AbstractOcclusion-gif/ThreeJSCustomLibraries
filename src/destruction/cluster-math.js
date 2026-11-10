import * as C from 'cannon-es';
export function inertiaWorld(body){const axes=[new C.Vec3(1,0,0),new C.Vec3(0,1,0),new C.Vec3(0,0,1)].map(v=>body.quaternion.vmult(v).toArray()),local=body.inertia.toArray(),out=Array(9).fill(0);for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let a=0;a<3;a++){if(body._massTensor){for(let b=0;b<3;b++)out[i*3+j]+=body._massTensor[a*3+b]*axes[a][i]*axes[b][j];}else out[i*3+j]+=local[a]*axes[a][i]*axes[a][j];}return out;}
export function massProperties(parts){
 const mass=parts.reduce((sum,b)=>sum+b.mass,0),position=new C.Vec3(),velocity=new C.Vec3();for(const b of parts){position.vadd(b.position.scale(mass?b.mass/mass:1/parts.length),position);if(mass)velocity.vadd(b.velocity.scale(b.mass/mass),velocity);}
 const tensor=Array(9).fill(0),momentum=new C.Vec3();for(const b of parts){if(!b.mass)continue;const r=b.position.vsub(position),v=b.velocity.vsub(velocity),i=inertiaWorld(b),rv=r.toArray(),r2=r.lengthSquared();for(let a=0;a<3;a++)for(let c=0;c<3;c++)tensor[a*3+c]+=i[a*3+c]+b.mass*((a===c?r2:0)-rv[a]*rv[c]);momentum.vadd(new C.Mat3(i).vmult(b.angularVelocity).vadd(r.cross(v.scale(b.mass))),momentum);}
 let angularVelocity=new C.Vec3();if(mass)angularVelocity=new C.Mat3(tensor).solve(momentum);return{mass,position,velocity,angularVelocity,tensor};
}
function solve(matrix,rhs){const n=rhs.length,a=matrix.map((r,i)=>[...r,rhs[i]]);for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;[a[c],a[p]]=[a[p],a[c]];const d=a[c][c];if(Math.abs(d)<1e-14)throw Error('Singular load transfer');for(let j=c;j<=n;j++)a[c][j]/=d;for(let r=0;r<n;r++)if(r!==c){const f=a[r][c];for(let j=c;j<=n;j++)a[r][j]-=f*a[c][j];}}return a.map(r=>r[n]);}
// Thin, symmetric I section matching the authored line mass and outer envelope.
// Web/flange ratio is an explicit sample assumption, not a catalogue section.
export function sectionProperties({width,height,massPerMetre,section,density:materialDensity},density=materialDensity??7850){
 if(section==='rectangle'){
  if(!(width>0&&height>0&&density>0))throw Error('Invalid rectangular section');
  const a=Math.max(width,height),b=Math.min(width,height);
  return{area:width*height,iy:height*width**3/12,iz:width*height**3/12,torsion:a*b**3*(1/3-.21*b/a*(1-b**4/(12*a**4)))};
 }
 const area=massPerMetre/density,B=2*width+.6*height,flange=2*area/(B+Math.sqrt(B*B-4*1.2*area)),web=.6*flange,inner=height-2*flange;
 if(!(area>0&&flange>0&&inner>0&&web<width))throw Error('Invalid I section mass/envelope');
 return{area,iy:(2*flange*width**3+inner*web**3)/12,iz:(width*height**3-(width-web)*inner**3)/12,torsion:(2*width*flange**3+inner*web**3)/3};
}
// Condensed interface stiffness. Axial EA/L, transverse 12EI/L^3 and angular
// EI/L weights share the physical interface wrench without inventing impulses.
export function distributeWrench(links,force,moment,centre){
 const H=Array.from({length:6},()=>Array(6).fill(0)),rows=[];
 for(const link of links){const b=link.body,p=link.profile??{width:.35,height:.55,massPerMetre:35},L=link.length??4,{area,iy,iz,torsion}=sectionProperties(p),A=link.area??area,E=p.E??2e11,G=p.G??7.7e10,axes=[new C.Vec3(1,0,0),new C.Vec3(0,1,0),new C.Vec3(0,0,1)].map(v=>b.quaternion.vmult(v).toArray()),k=[E*A/L,12*E*iz/L**3,12*E*iy/L**3],kr=[G*torsion/L,E*iy/L,E*iz/L],K=Array.from({length:3},()=>Array(3).fill(0)),R=Array.from({length:3},()=>Array(3).fill(0));for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let a=0;a<3;a++){K[i][j]+=k[a]*axes[a][i]*axes[a][j];R[i][j]+=kr[a]*axes[a][i]*axes[a][j];}
  const r=link.point.vsub(centre),B=[[1,0,0],[0,1,0],[0,0,1],[0,-r.z,r.y],[r.z,0,-r.x],[-r.y,r.x,0]];for(let i=0;i<6;i++)for(let j=0;j<6;j++)for(let a=0;a<3;a++)for(let c=0;c<3;c++)H[i][j]+=B[i][a]*K[a][c]*B[j][c];for(let i=0;i<3;i++)for(let j=0;j<3;j++)H[i+3][j+3]+=R[i][j];rows.push({K,R,B});
 }
 const q=solve(H,[...force.toArray(),...moment.toArray()]);return rows.map(({K,R,B})=>{const u=[0,1,2].map(a=>B.reduce((sum,row,i)=>sum+row[a]*q[i],0)),f=K.map(row=>row.reduce((sum,v,i)=>sum+v*u[i],0)),m=R.map(row=>row.reduce((sum,v,i)=>sum+v*q[i+3],0));return{force:new C.Vec3(...f),moment:new C.Vec3(...m)};});
}
