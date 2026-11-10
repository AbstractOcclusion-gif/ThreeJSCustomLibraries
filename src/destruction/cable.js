export * from '../cable/cable.js';

export function createCablePolesDefinition({span=10}={}){
 if(!(Number.isFinite(span)&&span>=4&&span<=16))throw Error('Cable lab span must be 4–16 m');
 return{version:1,name:'Two poles · slack cable',nodes:[{position:[-span/2,0,0],anchor:true},{position:[-span/2,6,0]},{position:[span/2,0,0],anchor:true},{position:[span/2,6,0]}],members:[0,2].map(a=>({a,b:a+1,type:'column',profile:'steel',bendable:{segments:2,response:'elastoplastic',massPerMetre:12,width:.2,height:.2,section:'round',color:0x93744c,stiffness:35000,yieldMoment:6500,breakForce:18000,fractureRotation:1.1,dampingRatio:.9,collisionInset:.02}})),floors:[],metadata:{span,width:2,height:6,heavy:true,hubMass:2,heavyStep:1/120}};
}
