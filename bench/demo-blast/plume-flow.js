import {DataTexture, FloatType, LinearFilter, RGBAFormat, Vector3} from 'three';
import {createFixedStep} from '../../src/core/fixed-step.js';
import {plumeOffset, skirtHeightShare, puffRollRate} from './plume-motion.js';

const DT = 1 / 40;
const GRAVITY = 9.81, AMBIENT = 293;
const HEAT_SCALE = 1700; // kelvin above ambient stored as 1 in the gas texture
const ATMOSPHERE = Object.freeze({lowerLapse: 1.3, upperLapse: 8, transition: 24});

// Axisymmetric, staggered finite-volume projection. Face areas scale with radius.
// Units are metres, seconds and temperature above ambient in kelvin.
// This is an incompressible buoyant plume model after the initial expansion.
export function createPlumeFlow(origin, size, settings, quality = {columns: 40, rows: 72, cell: 3, pressureIterations: 65}) {
  const {columns: W, rows: H, cell: CELL, pressureIterations: PRESSURE_ITERATIONS} = quality;
  const COUNT = W * H;
  const sampledVelocity = [0, 0];
  const make = () => new Float32Array(COUNT);
  let heat = make(), fuel = make(), smoke = make(), nextHeat = make(), nextFuel = make(), nextSmoke = make();
  let u = new Float32Array((W + 1) * H), v = new Float32Array(W * (H + 1));
  let nextU = u.slice(), nextV = v.slice(), p = make(), nextP = make();
  const divergence = make(), data = new Float32Array(COUNT * 4);
  const texture = new DataTexture(data, W, H, RGBAFormat, FloatType);
  texture.minFilter = texture.magFilter = LinearFilter;
  const clock = createFixedStep({step: DT, maxSteps: 3});
  const head = {height: 14, radius: 13};
  const measuredHead = {...head};
  let worldTime = 0, groundFeed = 1;
  let headRise = 0;
  function headDrag(r,y) {
    const radius=Math.max(13,head.radius), z=(y-head.height)/radius;
    const weight=Math.max(0,1-z*z-r*r/(radius*radius*1.96));
    return Math.exp(-(settings.headFriction??.3)*weight*DT);
  }
  let time = 0, beforeProjection = 0, afterProjection = 0, active = false;

  function sample(a, width, height, x, y) {
    x = Math.max(0, Math.min(width - 1.001, x));
    y = Math.max(0, Math.min(height - 1.001, y));
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, k = j * width + i;
    return (a[k] * (1-fx) + a[k+1] * fx) * (1-fy) + (a[k+width] * (1-fx) + a[k+width+1] * fx) * fy;
  }
  function velocity(r, y) {
    sampledVelocity[0] = sample(u,W+1,H,r/CELL,y/CELL-.5);
    sampledVelocity[1] = sample(v,W,H+1,r/CELL-.5,y/CELL);
    return sampledVelocity;
  }
  function measure() {
    let total = 0;
    for (let j=0;j<H;j++) for (let i=0;i<W;i++) {
      const k=j*W+i;
      const d=((i+1)*u[j*(W+1)+i+1]-i*u[j*(W+1)+i])/((i+.5)*CELL) +
        (v[(j+1)*W+i]-v[j*W+i])/CELL;
      divergence[k]=d;
      total+=d*d;
    }
    return Math.sqrt(total/COUNT);
  }
  function upload() {
    // Locate the broadest concentration of smoke above the ground reservoir.
    const firstHeadRow = Math.floor(12 / CELL);
    let peak = 0, peakRow = firstHeadRow;
    for (let j = firstHeadRow; j < H; j++) {
      let mass = 0;
      for (let i = 0; i < W; i++) mass += smoke[j * W + i] * (i + .5);
      if (mass > peak) { peak = mass; peakRow = j; }
    }
    if (peak > .001) {
      measuredHead.height = (peakRow + .5) * CELL;
      let reach = 0;
      for (let i = 0; i < W; i++) {
        if (smoke[peakRow * W + i] > .09) reach = (i + .5) * CELL;
      }
      measuredHead.radius = Math.max(13, reach);
    }
    for (let k=0;k<COUNT;k++) {
      data[k*4]=heat[k]/HEAT_SCALE;
      data[k*4+1]=smoke[k];
      data[k*4+2]=fuel[k];
      data[k*4+3]=1;
    }
    texture.needsUpdate=true;
  }
  function step() {
    time+=DT;
    const viscosity=settings.viscosity * 8, diffusion=viscosity*DT/(CELL*CELL);
    const drag=Math.exp(-settings.drag*.025*DT);
    for (let j=0;j<H;j++) for (let i=1;i<=W;i++) {
      const k=j*(W+1)+i,r=i*CELL,y=(j+.5)*CELL;
      const [ur,vy]=velocity(r,y);
      const left=u[k-1],right=u[j*(W+1)+Math.min(W,i+1)];
      const low=u[Math.max(0,j-1)*(W+1)+i],high=u[Math.min(H-1,j+1)*(W+1)+i];
      nextU[k]=(sample(u,W+1,H,(r-ur*DT)/CELL,(y-vy*DT)/CELL-.5) +
        diffusion*(left+right+low+high-4*u[k]+(right-left)/(2*i)-u[k]/(i*i)))*drag*headDrag(r,y);
    }
    for (let j=1;j<=H;j++) for (let i=0;i<W;i++) {
      const k=j*W+i,r=(i+.5)*CELL,y=j*CELL;
      const [ur,vy]=velocity(r,y);
      const left=v[j*W+Math.max(0,i-1)],right=v[j*W+Math.min(W-1,i+1)];
      const low=v[k-W],high=v[Math.min(H,j+1)*W+i];
      const temperature=sample(heat,W,H,i,j-.5);
      const rise=settings.riseSpeed??1;
      const buoyancy=GRAVITY*rise*rise*temperature/(AMBIENT+Math.max(0,temperature));
      nextV[k]=(sample(v,W,H+1,(r-ur*DT)/CELL-.5,(y-vy*DT)/CELL) +
        buoyancy*DT+diffusion*(left+right+low+high-4*v[k]+(right-left)/(2*(i+.5))))*drag*headDrag(r,y);
    }
    [u,nextU]=[nextU,u]; [v,nextV]=[nextV,v];
    beforeProjection=measure(); p.fill(0);
    for (let n=0;n<PRESSURE_ITERATIONS;n++) {
      for (let j=0;j<H;j++) for (let i=0;i<W;i++) {
        const k=j*W+i,minus=i/(i+.5),plus=(i+1)/(i+.5);
        let sum=0,diagonal=0;
        if(i>0){sum+=minus*p[k-1];diagonal+=minus;}
        diagonal+=plus;if(i<W-1)sum+=plus*p[k+1];
        if(j>0){sum+=p[k-W];diagonal++;}
        diagonal++;if(j<H-1)sum+=p[k+W];
        // A finite early expansion source adds volume while the ignition is hot.
        // After this source ends the solve is divergence-free.
        const expansion=time<1.5?1.7*Math.max(0,heat[k]/HEAT_SCALE-.18)*(1-time/1.5):0;
        nextP[k]=(sum-(divergence[k]-expansion)*CELL*CELL)/diagonal;
      }
      [p,nextP]=[nextP,p];
    }
    for(let j=0;j<H;j++)for(let i=1;i<=W;i++)
      u[j*(W+1)+i]-=((i<W?p[j*W+i]:0)-p[j*W+i-1])/CELL;
    for(let j=1;j<=H;j++)for(let i=0;i<W;i++)
      v[j*W+i]-=((j<H?p[j*W+i]:0)-p[(j-1)*W+i])/CELL;
    afterProjection=measure();
    for(let j=0;j<H;j++)for(let i=0;i<W;i++){
      const k=j*W+i,r=(i+.5)*CELL,y=(j+.5)*CELL,[ur,vy]=velocity(r,y);
      const x0=(r-ur*DT)/CELL-.5,y0=(y-vy*DT)/CELL-.5;
      const t=sample(heat,W,H,x0,y0),f=sample(fuel,W,H,x0,y0);
      const burned=t>450?f*(1-Math.exp(-1.1*DT)):0;
      // Potential temperature anomaly in a stable layer. Upward displacement cools
      // a parcel relative to the environment, downward displacement warms it.
      const layer=Math.max(0,Math.min(1,(y-settings.ceiling)/ATMOSPHERE.transition));
      const blend=layer*layer*(3-2*layer);
      const lapse=ATMOSPHERE.lowerLapse+(ATMOSPHERE.upperLapse-ATMOSPHERE.lowerLapse)*blend;
      nextHeat[k]=Math.max(-190,t*Math.exp(-.065*DT)+burned*550-vy*lapse*DT);
      nextFuel[k]=f-burned;
      const surfaceDust=j<2?Math.max(0,vy-.35)*.18*DT*Math.exp(-time/12)*groundFeed:0;
      nextSmoke[k]=sample(smoke,W,H,x0,y0)*Math.exp(-.009*DT)+burned*.55+surfaceDust;
    }
    [heat,nextHeat]=[nextHeat,heat];[fuel,nextFuel]=[nextFuel,fuel];[smoke,nextSmoke]=[nextSmoke,smoke];
  }
  function reset(){
    clock.reset();time=0;worldTime=0;groundFeed=1;headRise=0;active=false;
    head.height = measuredHead.height = 14;
    head.radius = measuredHead.radius = 13;
    for(const a of [u,v,nextU,nextV,heat,fuel,smoke,nextHeat,nextFuel,nextSmoke,p,nextP])a.fill(0);
    upload();
  }
  function ignite(){
    reset();active=true;
    for(let j=0;j<H;j++)for(let i=0;i<W;i++){
      const r=(i+.5)*CELL,y=(j+.5)*CELL,k=j*W+i;
      const bubble=Math.max(0,1-Math.hypot(r/13,(y-14)/13));
      const stem=Math.exp(-r*r/64)*Math.max(0,1-y/38);
      heat[k]=3200*Math.sqrt(bubble)+35*stem;
      fuel[k]=.55*bubble*settings.fuel;
      smoke[k]=2.7*Math.sqrt(bubble)+stem*2.6;
    }
    upload();
  }
  reset();
  return {
    texture,head,extent:new Vector3(W*CELL,H*CELL,W*CELL),
    update(dt) {
      if (!active) return;
      worldTime += dt;
      if (clock.advance(dt * .8, step)) upload();
      // Filter cell-sized measurement changes at frame rate before the skirt follows.
      const follow = 1 - Math.exp(-dt / 1.1);
      const rise=(measuredHead.height-head.height)*follow;
      head.height += rise;
      if(dt>0) headRise += (rise/dt-headRise)*(1-Math.exp(-dt/.6));
      head.radius += (measuredHead.radius-head.radius)*(1-Math.exp(-dt/4.5));
    },
    reset, ignite,
    setGroundFeed(amount) { groundFeed=Math.max(0,Math.min(1,amount)); },
    dispose(){texture.dispose();},
    get diagnostics(){return {time,beforeProjection,afterProjection,headRise};},
    get riseSpeed(){return headRise;},
    rollAxis(out,x,y,z){
      const height=(y-origin.y)/size;
      const offset=plumeOffset(height,worldTime,head.height);
      const dx=(x-origin.x)/size-offset[0],dz=(z-origin.z)/size-offset[1];
      const radius=Math.hypot(dx,dz);
      if(radius<.5)return out.set(0,0,0);
      return out.set(-dz/radius,0,dx/radius);
    },
    // Normalised heat at a world point, the value the gas shader reads there.
    heatAt(x,y,z){
      const height=(y-origin.y)/size;
      const offset=plumeOffset(height,worldTime,head.height);
      const r=Math.hypot((x-origin.x)/size-offset[0],(z-origin.z)/size-offset[1]);
      if(r>=W*CELL||height<0||height>=H*CELL)return 0;
      return sample(heat,W,H,r/CELL-.5,height/CELL-.5)/HEAT_SCALE;
    },
    sample(out,x,y,z,tag){
      const height=(y-origin.y)/size;
      const offset=plumeOffset(height,worldTime,head.height);
      const dx=(x-origin.x)/size-offset[0],dz=(z-origin.z)/size-offset[1];
      const r=Math.hypot(dx,dz);
      if(r>=W*CELL||height<0||height>=H*CELL)return out.set(0,0,0);
      const concentration=sample(smoke,W,H,r/CELL-.5,height/CELL-.5);
      // Shared head tracers use the grid that advects smoke. Density must not
      // apply a second slowdown. The skirt's collar constraint is handled below.
      const shared=settings.cloudMotion==='shared';
      const carried=shared?1:Math.min(1,concentration/.18);
      const [ur,vy]=velocity(r,height);
      // The skirt is an authored collar, not a passive interior tracer. Reuse
      // its established guidance while the head continues sharing gas advection.
      const skirt=tag==='skirt'||tag?.kind==='skirt';
      // A collar follows the measured lower flank of the head. This is visual
      // entrainment guidance for the skirt parcels, separate from the solved flow.
      const heightShare=skirtHeightShare(r/Math.max(13,head.radius));
      const follow=1.1+.7*Math.max(0,Math.min(1,1-r/Math.max(13,head.radius)));
      const riseLimit=3+3*(heightShare-.6)/.34;
      let vertical=skirt?Math.max(-1,Math.min(riseLimit,(head.height*heightShare-height)*follow)):vy*.8*carried;
      let outward=skirt?(head.radius*(tag?.radiusShare??.78)-r)*.5:ur*.8*carried;
      // Vertical skirt friction: retain the ring's radial reach and puff shape,
      // but let its lower mantle trail beneath the ascending head.
      if(skirt) vertical*=.65;
      if(!shared&&tag?.kind==='head') {
        // Divergence-free spherical circulation: centre up, top out, edge down.
        // This guides the detail parcels; the grid still owns the gas dynamics.
        const radius=Math.max(13,head.radius), z=height-head.height;
        const rr=r/radius, zz=z/radius, distance=Math.hypot(rr,zz);
        const strength=radius*.12*puffRollRate(worldTime,settings.rollMotion)/(1+(settings.headFriction??.3));
        const envelope=Math.exp(-Math.max(0,distance-1)*4);
        const confinement=Math.max(0,distance-1)*1.2;
        outward=1.5*strength*rr*zz*envelope-r*confinement;
        vertical=(tag.stationary?0:headRise)+1.5*strength*(1-2*rr*rr-zz*zz)*envelope-z*confinement;
      }
      const radial=r>0?outward/r:0;
      // Transport through the same moving coordinate frame used by the volume.
      const future=plumeOffset(height+vertical*.02,worldTime+(tag?.stationary?0:.02),head.height);
      return out.set(
        (dx*radial+(future[0]-offset[0])/.02)*size,
        vertical*size,
        (dz*radial+(future[1]-offset[1])/.02)*size
      );
    },
  };
}
