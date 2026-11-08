import * as T from 'three';
// options.geometry is borrowed; its owner disposes it after this pool. groundOffset
// overrides the unit-geometry ground offset for thin custom fragments.
// Small debris chips thrown out at impacts and fractures: one InstancedMesh (one draw call), fixed pool,
// ballistic pop with gravity, bounce on a host ground height (setGround), roll and slow down, then shrink out.
// No physics bodies. Ported from stunt/cart/shards.js; the stunt cart keeps its own tuned copy for now.
const DEFAULTS={pool:384,gravity:9.82,life:[1.4,2.2],bounce:.25,minBounceSpeed:1.2,baseSize:[.14,.3]};
const ROLL={slope:.7,drag:2.2,spin:1.6},SINK=.25;   // downhill pull share, speed loss per s, roll spin per m/s
// Forward spray: part of each burst follows the source velocity, inheriting some of its speed.
const FORWARD={share:[.3,.55],inherit:[.3,.7],spread:.6,pop:[1.4,2.2],maxSpeed:14};
const COUNT={min:6,max:34,perG:.8,fromG:4},SPEED={base:1.2,perG:.05};
export function createChips(scene,options={}){
 const {pool,gravity,life,bounce,minBounceSpeed,baseSize}={...DEFAULTS,...options};
 if(!Number.isInteger(pool)||pool<1||pool>4096)throw Error('Chip pool must be 1..4096');
 const geometry=options.geometry??new T.TetrahedronGeometry(1,0),ownsGeometry=!options.geometry,material=options.material??new T.MeshStandardMaterial({roughness:.9,flatShading:true}),ownsMaterial=!options.material;
 const authored=!!options.authored,mesh=authored?new T.BatchedMesh(pool,pool*512,pool*1536,material):new T.InstancedMesh(geometry,material,pool);if(!authored){mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.count=0;}mesh.frustumCulled=false;
 mesh.castShadow=mesh.receiveShadow=true;   // without a contact shadow, resting chips read as floating
 if(!authored){mesh.setColorAt(0,new T.Color());mesh.instanceColor.setUsage(T.DynamicDrawUsage);}scene.add(mesh);
 const chips=Array.from({length:pool},()=>({active:false,p:new T.Vector3(),v:new T.Vector3(),q:new T.Quaternion(),spin:new T.Vector3(),scale:new T.Vector3(),age:0,life:1,ground:0,color:new T.Color()}));
 const m=new T.Matrix4(),dq=new T.Quaternion(),e=new T.Euler(),s=new T.Vector3(),base=new T.Color();
 // Ground height lookup (x,z)->y|null; null (or no lookup) = the emit height is the floor.
 let groundAt=null,disposed=false;
 const floorAt=(chip,x,z)=>groundAt?.(x,z)??chip.ground;
 function retire(chip){chip.active=false;if(authored&&chip.slot!=null){mesh.deleteInstance(chip.slot);mesh.deleteGeometry(chip.geometryId);chip.slot=null;}}

 return{
  // Exact authored fragments borrow their material; BatchedMesh copies geometry.
  emitPiece(source,position,quaternion,velocity){
   if(disposed||!authored)return false;
   const chip=chips.find(c=>!c.active)??chips.reduce((a,b)=>a.age>b.age?a:b);retire(chip);
   mesh.optimize();chip.geometryId=mesh.addGeometry(source);chip.slot=mesh.addInstance(chip.geometryId);
   chip.active=true;chip.age=0;chip.life=life[0]+Math.random()*(life[1]-life[0]);chip.ground=0;
   chip.p.copy(position);chip.q.copy(quaternion);chip.v.copy(velocity??new T.Vector3());chip.scale.set(1,1,1);chip.color.setHex(0xffffff);
   chip.spin.set((Math.random()-.5)*3,(Math.random()-.5)*3,(Math.random()-.5)*3);
   m.compose(chip.p,chip.q,chip.scale);mesh.setMatrixAt(chip.slot,m);return true;
  },
  // style: { color, size?, count?, chips? }; g: shock strength (chip count and pop speed); velocity: source velocity (optional).
  // count scales the strength-derived chip count; chips sets an exact count instead.
  emit(position,style,g,velocity){
   if(disposed||authored||!style)return 0;base.setHex(style.color);
   const vx=velocity?.x??0,vz=velocity?.z??0,travel=Math.hypot(vx,vz),heading=Math.atan2(vz,vx),forwardShare=travel>1?FORWARD.share[0]+Math.random()*(FORWARD.share[1]-FORWARD.share[0]):0;
   const n=Math.round(style.chips??Math.min(COUNT.max,Math.max(COUNT.min,(g-COUNT.fromG)*COUNT.perG))*(style.count??1)),speed=SPEED.base+g*SPEED.perG;
   let k=0;
   for(let i=0;k<n&&i<pool;i++){const chip=chips[i];if(chip.active)continue;k++;
    chip.active=true;chip.age=0;chip.life=life[0]+Math.random()*(life[1]-life[0]);chip.ground=position.y-.1;
    chip.p.set(position.x,position.y+.05,position.z);
    if(Math.random()<forwardShare){
     const a=heading+(Math.random()-.5)*2*FORWARD.spread,out=Math.min(FORWARD.maxSpeed,travel*(FORWARD.inherit[0]+Math.random()*(FORWARD.inherit[1]-FORWARD.inherit[0])));
     chip.v.set(Math.cos(a)*out,speed*(.5+Math.random()*.8)*(FORWARD.pop[0]+Math.random()*(FORWARD.pop[1]-FORWARD.pop[0])),Math.sin(a)*out);
    }else{const a=Math.random()*Math.PI*2,up=.5+Math.random()*.8,out=speed*(.4+Math.random()*.8);chip.v.set(Math.cos(a)*out,speed*up,Math.sin(a)*out);}
    if(velocity)chip.v.addScaledVector(velocity,.5);
    chip.q.setFromEuler(e.set(Math.random()*6.3,Math.random()*6.3,Math.random()*6.3));chip.spin.set((Math.random()-.5)*20,(Math.random()-.5)*20,(Math.random()-.5)*20);
    const size=(baseSize[0]+Math.random()*(baseSize[1]-baseSize[0]))*(style.size??1);chip.scale.set(size*(.6+Math.random()*.8),size*(.4+Math.random()*.6),size*(.6+Math.random()*.8));
    chip.color.copy(base).multiplyScalar(.8+Math.random()*.35);
   }
   return k;
  },
  tick(dt){
   if(disposed)return;let count=0;
   for(const chip of chips){
    if(!chip.active)continue;chip.age+=dt;if(chip.age>=chip.life||options.isRelevant&&!options.isRelevant(chip.p)){retire(chip);continue;}
    chip.v.y-=gravity*dt;chip.p.addScaledVector(chip.v,dt);
    const rest=floorAt(chip,chip.p.x,chip.p.z)+chip.scale.y*(options.groundOffset??SINK);
    if(chip.p.y<=rest){
     chip.p.y=rest;chip.v.y=chip.v.y<-minBounceSpeed?-chip.v.y*bounce:0;
     const h=.25,gx=(floorAt(chip,chip.p.x+h,chip.p.z)-floorAt(chip,chip.p.x-h,chip.p.z))/(2*h),gz=(floorAt(chip,chip.p.x,chip.p.z+h)-floorAt(chip,chip.p.x,chip.p.z-h))/(2*h);
     chip.v.x-=gravity*ROLL.slope*gx*dt;chip.v.z-=gravity*ROLL.slope*gz*dt;const keep=Math.exp(-ROLL.drag*dt);chip.v.x*=keep;chip.v.z*=keep;
     const r=Math.max(.02,chip.scale.y);chip.spin.set(chip.v.z/r*ROLL.spin,chip.spin.y*keep,-chip.v.x/r*ROLL.spin);
    }
    dq.setFromEuler(e.set(chip.spin.x*dt,chip.spin.y*dt,chip.spin.z*dt));chip.q.multiply(dq);
    const fade=Math.min(1,(chip.life-chip.age)/.3);s.copy(chip.scale).multiplyScalar(fade);
    m.compose(chip.p,chip.q,s);mesh.setMatrixAt(authored?chip.slot:count,m);mesh.setColorAt(authored?chip.slot:count,chip.color);count++;
   }
   if(!authored){mesh.count=count;if(count){mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;}}
  },
  get active(){return chips.reduce((n,chip)=>n+(chip.active?1:0),0);},
  clear(){for(const chip of chips)retire(chip);if(!authored)mesh.count=0;},
  setGround(fn){groundAt=fn;},
  dispose(){if(disposed)return;disposed=true;scene.remove(mesh);if(ownsGeometry)geometry.dispose();if(ownsMaterial)material.dispose();mesh.dispose();},
 };
}
