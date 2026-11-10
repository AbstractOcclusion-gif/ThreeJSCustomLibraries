import {validateStructure} from './definitions.js';

export const STEEL_SHAPES=Object.freeze(['cylinder','pyramid','twist']);

// Geometry only. Existing assemblies own steel sections, moment connections,
// fracture and sleep; the selected host driver owns integration and contacts.
export function createSteelShapeDefinition({form='cylinder',levels=6,sides=form==='pyramid'?4:8,radius=8,storeyHeight=4,twist=60,bracing=true}={}){
 if(!STEEL_SHAPES.includes(form))throw Error('Unknown steel shape');
 if(!Number.isInteger(levels)||levels<1||levels>30)throw Error('Choose 1 to 30 levels');
 if(!Number.isInteger(sides)||sides<4||sides>16)throw Error('Choose 4 to 16 sides');
 if(!Number.isFinite(radius)||radius<3||radius>30||!Number.isFinite(storeyHeight)||storeyHeight<2||storeyHeight>6)throw Error('Radius must be 3–30 m and level height 2–6 m');
 if(!Number.isFinite(twist)||Math.abs(twist)>120||typeof bracing!=='boolean')throw Error('Invalid twist or bracing');
 const nodes=[],members=[],rings=[],pairs=new Set(),masses=Array(levels).fill(0);
 for(let level=0;level<=levels;level++){
  const apex=form==='pyramid'&&level===levels,count=apex?1:sides,r=form==='pyramid'?radius*(1-level/levels):radius,rotation=form==='twist'?twist*Math.PI/180*level/levels:0;
  const ring=[];
  for(let i=0;i<count;i++){const angle=2*Math.PI*i/sides+Math.PI/4+rotation;ring.push(nodes.length);nodes.push({position:apex?[0,level*storeyHeight,0]:[r*Math.cos(angle),level*storeyHeight,r*Math.sin(angle)],anchor:level===0});}
  rings.push(ring);
 }
 function add(a,b,type,storey){
  const key=[a,b].sort((x,y)=>x-y).join(':');if(pairs.has(key))return;
  const length=Math.hypot(...nodes[a].position.map((x,i)=>x-nodes[b].position[i]));
  // The established brace collider insets .4 m at either end. Reject a crowded
  // tip rather than silently omitting its braces or creating zero-size colliders.
  if(length<(type==='brace'?.9:.6))throw Error('Beams too short near the tip: use fewer levels/sides or a larger radius');
  pairs.add(key);members.push({a,b,type,profile:'steel',storey,loadAbove:levels-storey+1});masses[storey-1]+=length*(type==='brace'?12:35);
 }
 for(let level=1;level<=levels;level++){
  const low=rings[level-1],high=rings[level];
  for(let i=0;i<sides;i++){
   add(low[i],high.length===1?high[0]:high[i],'column',level);
   if(high.length===1)continue;
   add(high[i],high[(i+1)%sides],'beam',level);
   if(bracing)add(low[i],high[(i+(level%2?1:sides-1))%sides],'brace',level);
  }
 }
 // Same tributary-storey capacity convention as the existing building sample.
 const tributaryMass=Math.max(...masses.map((mass,i)=>mass+rings[i+1].length*120))/sides;
 for(const m of members)if(m.type==='column')m.tributaryMass=tributaryMass;
 const names={cylinder:'Cylindrical steel tower',pyramid:'Steel pyramid',twist:'Twisted steel tower'},xs=nodes.map(n=>n.position[0]),zs=nodes.map(n=>n.position[2]);
 return validateStructure({version:1,name:names[form],nodes,members,floors:[],metadata:{heavy:true,stories:levels,height:levels*storeyHeight,span:Math.max(...xs)-Math.min(...xs),width:Math.max(...zs)-Math.min(...zs),deckY:0,steelShape:true,shape:{form,levels,sides,radius,storeyHeight,twist:form==='twist'?twist:0,bracing},beamCount:members.length}});
}
