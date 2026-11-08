export const MATERIAL_PROFILES=Object.freeze({
 steel:Object.freeze({thickness:.3,massPerMetre:1,connectionForce:18000,impactEnergy:900}),
 steelBrace:Object.freeze({thickness:.13,massPerMetre:1,connectionForce:18000,impactEnergy:900}),
 steelDiagonal:Object.freeze({thickness:.2,massPerMetre:1,connectionForce:18000,impactEnergy:900}),
 floorBeam:Object.freeze({thickness:.3,massPerMetre:5,connectionForce:18000,impactEnergy:900}),
});
export function validateStructure(d){
 const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 if(d?.version!==1||!Array.isArray(d.nodes)||!d.nodes.length||!Array.isArray(d.members)||!d.members.length)throw Error('Invalid structure definition');
 for(const n of d.nodes)if(!vector(n.position))throw Error('Invalid node position');
 for(const m of d.members){
  if(![m.a,m.b].every(i=>Number.isInteger(i)&&d.nodes[i])||m.a===m.b)throw Error('Invalid member endpoints');
  if(Math.hypot(...d.nodes[m.a].position.map((v,i)=>v-d.nodes[m.b].position[i]))<=.45)throw Error('Members must be longer than 0.45 m');
  const p={...MATERIAL_PROFILES[m.profile??'steel'],...m.properties};
  if(!['thickness','massPerMetre','connectionForce','impactEnergy'].every(k=>Number.isFinite(p[k])&&p[k]>0))throw Error('Invalid member profile');
  for(const b of m.boxes??[])if(!vector(b.halfExtents)||!b.halfExtents.every(v=>v>0)||!vector(b.offset)||!Number.isFinite(b.mass??0)||(b.mass??0)<0)throw Error('Invalid member box');
 }
 for(const c of d.rigidConnections??[])if(![c.a,c.b].every(i=>Number.isInteger(i)&&d.members[i])||c.a===c.b)throw Error('Invalid rigid connection');
 return d;
}
export function createPrattBridgeDefinition(){
 const span=48,width=9.5,deckY=10,height=5.3,panels=4,nodes=[],members=[],rigidConnections=[],lower=[[],[]],upper=[[],[]];
 const node=(x,y,z,anchor=false)=>{nodes.push({position:[x,y,z],anchor});return nodes.length-1;};
 const member=(a,b,type)=>{members.push({a,b,type,profile:type==='floor'?'floorBeam':type==='brace'?'steelBrace':type==='diagonal'?'steelDiagonal':'steel'});return members.length-1;};
 for(let s=0;s<2;s++)for(let i=0;i<=panels;i++){lower[s][i]=node(i*12-span/2,deckY,(s-.5)*width,i===0||i===panels);if(i>0&&i<panels)upper[s][i]=node(i*12-span/2,deckY+height,(s-.5)*width);}
 for(let s=0;s<2;s++){
  for(let i=0;i<panels;i++)member(lower[s][i],lower[s][i+1],'chord');
  for(let i=1;i<panels-1;i++)member(upper[s][i],upper[s][i+1],'chord');
  for(let i=1;i<panels;i++)member(lower[s][i],upper[s][i],'vertical');
  member(lower[s][0],upper[s][1],'endpost');member(upper[s][panels-1],lower[s][panels],'endpost');
  for(let i=1;i<panels-1;i++){member(upper[s][i],lower[s][i+1],'diagonal');member(lower[s][i],upper[s][i+1],'diagonal');}
 }
 for(let i=0;i<=panels;i++){const m=members[member(lower[0][i],lower[1][i],'floor')];if(i<panels){m.deck=true;m.boxes=[{halfExtents:[5.95,width/2,.09],offset:[6,0,-.35],mass:25}];}}
 for(let i=0;i<panels;i++){member(lower[0][i],lower[1][i+1],'brace');member(lower[1][i],lower[0][i+1],'brace');}
 members.forEach((m,a)=>{if(m.type==='vertical'){const b=members.findIndex(f=>f.type==='floor'&&(f.a===m.a||f.b===m.a));rigidConnections.push({a,b});}});
 return {version:1,name:'Pratt pony truss',metadata:{span,width,deckY,height},nodes,members,rigidConnections};
}
