import {validateStructure} from './definitions.js';

export const TRANSMISSION_BUDGET=Object.freeze({cables:6,bodies:512,constraints:2048,drawCalls:32,cullDistance:220,retentionDistance:300});
export const TRANSMISSION_REFERENCE=Object.freeze({url:'https://www.nationalgrid.com/document/569231/download',height:56.6,baseWidth:13,crossarmHalfWidths:[8.4,10.4,7]});

// Dimensioned silhouette from National Grid's median suspension-tower sheet.
// Internal tiers, steel sections and capacities are game adaptations. All major
// diagonals and arm chords are real members in the established destruction model.
export function createTransmissionTowerDefinition({span=60}={}){
 if(!Number.isFinite(span)||span<40||span>100)throw Error('Transmission span must be 40–100 m');
 const nodes=[],members=[],rings=[],mounts=[[],[]],pairs=new Set();
 const addNode=(position,anchor=false)=>{nodes.push({position,anchor});return nodes.length-1;};
 const add=(a,b,type='brace')=>{
  const key=[a,b].sort((x,y)=>x-y).join(':');if(pairs.has(key))return members.findIndex(m=>m.a===a&&m.b===b||m.a===b&&m.b===a);pairs.add(key);
  const leg=type==='column',arm=type==='beam';
  members.push({a,b,type,storey:Math.max(1,Math.ceil(Math.max(nodes[a].position[1],nodes[b].position[1])/6)),profile:'steel',bendable:{segments:1,response:'brittle',width:leg?.45:arm?.24:.16,height:leg?.55:arm?.3:.2,massPerMetre:leg?80:arm?20:12,stiffness:1e6,yieldMoment:leg?2e6:arm?1e6:2e5,breakForce:leg?2e6:arm?6e5:4e5,fractureRotation:.12,collisionInset:.15,nativeSteps:[32,8],color:leg?0x8b969f:0xa2abb1}});return members.length-1;
 };
 // Widths are square plan dimensions. The three arm tiers use the sheet's
 // measured overall arm widths, while tier elevations are explicitly adapted.
 const tiers=[[0,13],[8,10.4],[16,7.8],[24,5.6],[31,4.2],[34,3.8],[40,3.2],[43,2.9],[49,2.6],[52,2.2],[56.6,.9]];
 for(const [y,width]of tiers)rings.push([[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>addNode([x*width/2,y,z*width/2],y===0)));
 for(let tier=1;tier<rings.length;tier++){
  const low=rings[tier-1],high=rings[tier];for(let face=0;face<4;face++){const next=(face+1)%4;add(low[face],high[face],'column');add(high[face],high[next],'beam');add(low[face],high[next]);add(low[next],high[face]);}
 }
 // Each arm is a 3D triangular truss with two real tip nodes and a crossbar.
 for(const [y,extent]of [[31,8.4],[40,10.4],[49,7]])for(const side of [-1,1]){
  const tier=tiers.findIndex(t=>t[0]===y),base=rings[tier],upper=rings[tier+1],indices=side<0?[0,1]:[3,2],tips=[addNode([-.5,y,side*extent]),addNode([.5,y,side*extent])];
  for(let i=0;i<2;i++){add(base[indices[i]],tips[i],'beam');add(upper[indices[i]],tips[i],'brace');}add(base[indices[0]],tips[1]);add(base[indices[1]],tips[0]);const tipMember=add(tips[0],tips[1],'beam');
  mounts[0].push({member:tipMember,point:[0,y,side*extent],hangingLength:2.8,insulator:true});mounts[1].push({fixed:true,point:[span,y-2.8,side*extent]});
 }
 return validateStructure({version:1,name:'56.6 m transmission tower · six conductors',nodes,members,floors:[],metadata:{heavy:true,heavyStep:1/120,hubMass:20,stories:10,height:56.6,span,width:20.8,cableSetup:'transmission',cableMounts:mounts,cableTowerBaseNodes:rings[0],reference:TRANSMISSION_REFERENCE,footingSize:[2.4,.6,2.4]}});
}
