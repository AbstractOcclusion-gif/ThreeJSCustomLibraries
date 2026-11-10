import {SAPBroadphase} from 'cannon-es';

// Reject connected bodies before allocating candidate pairs. World still runs
// its normal constraint filter. Rebuild each pass so release is immediate.
export class ConnectedSAPBroadphase extends SAPBroadphase{
 collisionPairs(world,a,b){
  const n=world.bodies.length;
  this.connectedSize=n<=2048?n:0;
  if(this.connectedSize){
   if(!this.connected||this.connected.length<n*n)this.connected=new Uint8Array(n*n);
   this.connected.fill(0,0,n*n);
   for(const c of world.constraints){
    if(c.collideConnected)continue;
    const x=c.bodyA,y=c.bodyB;
    if(world.bodies[x.index]!==x||world.bodies[y.index]!==y)continue;
    this.connected[x.index*n+y.index]=this.connected[y.index*n+x.index]=1;
   }
  }
  super.collisionPairs(world,a,b);
 }
 needBroadphaseCollision(a,b){
  return super.needBroadphaseCollision(a,b)&&!(this.connectedSize&&this.connected[a.index*this.connectedSize+b.index]);
 }
}
