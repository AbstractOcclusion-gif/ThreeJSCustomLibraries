import {Body,Equation,GSSolver,Vec3} from 'cannon-es';
const inactive=body=>body.type===Body.STATIC||body.sleepState===Body.SLEEPING;

// Cannon excludes sleeping contacts in broadphase, but still submits every
// user joint to GSSolver. Resting joints have no active degrees of freedom.
// Test here, after narrowphase wake-up, so a struck island is solved immediately.
export class ActiveBodySolver extends GSSolver{
 addEquation(equation){
  if(inactive(equation.bi)&&inactive(equation.bj)){equation.multiplier=0;return;}
  super.addEquation(equation);
 }
}

// GSSolver computes each Jacobian once before iteration. Its inertia-weighted
// rotational vectors are therefore invariant across all iterations of a solve.
// Keep the stock kernel, scalar operation order, bounds and custom equations.
export class CachedInertiaSolver extends ActiveBodySolver{
 constructor(){super();this.records=new WeakMap();}
 solve(dt,world){
  const patched=[];
  try{
  for(const equation of this.equations){
   if(Object.hasOwn(equation,'addToWlambda')||equation.addToWlambda!==Equation.prototype.addToWlambda||equation.computeGWlambda!==Equation.prototype.computeGWlambda)continue;
   let r=this.records.get(equation);
   if(!r){r={a:new Vec3(),b:new Vec3(),ready:false};r.apply=function(delta){
    const a=this.bi,b=this.bj;
    if(!r.ready){a.invInertiaWorldSolve.vmult(this.jacobianElementA.rotational,r.a);b.invInertiaWorldSolve.vmult(this.jacobianElementB.rotational,r.b);r.ready=true;}
    a.vlambda.addScaledVector(a.invMassSolve*delta,this.jacobianElementA.spatial,a.vlambda);
    b.vlambda.addScaledVector(b.invMassSolve*delta,this.jacobianElementB.spatial,b.vlambda);
    a.wlambda.addScaledVector(delta,r.a,a.wlambda);b.wlambda.addScaledVector(delta,r.b,b.wlambda);
   };this.records.set(equation,r);}
   r.ready=false;
   equation.addToWlambda=r.apply;patched.push(equation);
  }
  return super.solve(dt,world);
  }finally{for(const equation of patched)delete equation.addToWlambda;}
 }
}
