import {fbm, valueNoise} from '../core/value-noise.js';
const number=(label,min,max,step)=>({label,min,max,step});
export const TERRAIN_PAINT_DEFAULTS=Object.freeze({
 rockSlope:1,wallRock:1.15,snowLine:150,snowJitter:10,mudBelow:3.5,mudFromRunout:true,
 slopeBlend:.25,wallBlend:.18,snowBlend:12,mudBlend:1.4,patchScale:18,patchStrength:.18,curvatureInfluence:.2,forestCover:0,woodlandSize:240,forestSlope:.7,treeLine:300,treeBlend:10,sandBelow:-20,sandBlend:.6,
 hollowRange:2.5,scree:.6,bareSoil:.5,snowShade:12,sunHeading:150,
});
export const TERRAIN_PAINT_FIELDS={
 rockSlope:number('Rock slope threshold · rise/run',.2,3,.05),slopeBlend:number('Slope transition softness',.02,1,.01),
 wallRock:number('Rock at valley sides · relative width',.5,2,.05),wallBlend:number('Valley-edge softness',.02,.8,.02),
 snowLine:number('Snow altitude · m',-20,300,1),snowBlend:number('Snow-line transition · m',1,60,1),snowJitter:number('Snow-line breakup · m',0,40,1),
 mudBelow:number('Mud basin altitude · m',-20,30,.5),mudBlend:number('Mud transition · m',.1,10,.1),
 patchScale:number('Natural patch size · m',3,100,1),patchStrength:number('Patch variation',0,.8,.01),curvatureInfluence:number('Ridge / basin influence',0,1,.05),
 forestCover:number('Forest floor coverage',0,1,.01),woodlandSize:number('Woodland size · m',20,3000,5),
 forestSlope:number('Forest up to slope · rise/run',.1,3,.05),treeLine:number('Tree line · m',-20,300,1),treeBlend:number('Tree-line transition · m',1,60,1),
 sandBelow:number('Sand below altitude · m',-20,300,.1),sandBlend:number('Sand transition · m',.05,10,.05),
 hollowRange:number('Hollow depth for full wetness · m',.2,30,.1),scree:number('Scree below rock',0,1,.01),bareSoil:number('Bare soil on dry ground',0,1,.01),
 snowShade:number('Snow line drop in shade · m',0,80,1),sunHeading:number('Sun heading · °',0,360,5),
};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const TERRAIN_LAYERS=Object.freeze(['grass','rock','snow','mud','forest']);
// The roles a palette set can play (createTerrainWorld): the layers, then scree (rock debris below steep rock) and
// soil (bare earth on dry ground). paint() returns one weight per role, in this order.
export const TERRAIN_PALETTE_ROLES=Object.freeze([...TERRAIN_LAYERS,'scree','soil']);
// Distances the terrain signals of a paint sample are measured over, in metres: `slope` is the rise/run between points
// this far either side, `hollow` how far the ground lies below the mean of four points this far away (negative on a
// ridge). Fixed sizes, so the same ground paints the same whatever the mesh that asks.
export const PAINT_REACH=Object.freeze({slope:2,hollow:24});
export function validateTerrainPaint(values){
 for(const [key,value]of Object.entries(values)){
  if(key==='mudFromRunout'){if(typeof value!=='boolean')throw Error('Invalid mudFromRunout');continue;}
  const s=TERRAIN_PAINT_FIELDS[key];if(!s||!Number.isFinite(value)||value<s.min||value>s.max)throw Error('Invalid terrain paint setting: '+key);
 }
 return values;
}
// Noise behind the layers, all fractal so a boundary wanders at several sizes at once instead of forming blobs of one
// size: a local break-up field (largest cells `scale` m), the patches (largest cells the patch size) and the moisture
// that decides where low ground turns to mud (largest cells `scale` x the patch size). `norm` brings each back to
// about -1..1. Seeds are offsets from the terrain seed.
const NOISE=Object.freeze({
 local:{seed:3,scale:8,fractal:{octaves:3,lacunarity:2.3},norm:1.14},
 patch:{seed:37,fractal:{octaves:5,lacunarity:2.17},norm:1.03},
 woodland:{seed:71,fractal:{octaves:4,lacunarity:2.2},norm:1.07},
 moisture:{seed:59,scale:2.6,fractal:{octaves:4,lacunarity:2.1},norm:1.07},
});
// How much the local break-up moves each boundary: exposed slope, valley wall, mud basin, sand line (m).
const BREAKUP=Object.freeze({slope:.2,wall:.15,basin:.8,sand:.5});
// Forest floor lies in woodlands: large areas (woodland noise x woodGain + (coverage - .5) x coverGain + .5, through
// woodEdges) that the coverage widens. Inside one, patches (patch x patchGain + local break-up x ragged + .5, through
// patchEdges) thin the floor down to `clearing` of its weight, so grass shows through in clearings. The floor stops
// over slopeBlend (rise/run) around the forest slope, and at the tree line.
const FOREST=Object.freeze({woodEdges:[.34,.66],woodGain:.75,coverGain:1.06,patchEdges:[.2,.8],patchGain:.6,ragged:.16,clearing:.35,slopeBlend:.15});
// Mud needs wet, flat ground: moisture moves the mud line by up to `moisture` x the mud transition, and mud thins out
// between the two slopes (rise/run). However low the ground, mud only forms where the place is wet (from wet[0],
// fully at wet[1]).
const MUD=Object.freeze({moisture:2.2,slope:[.12,.4],wet:[.38,.6]});
// Moisture (0 dry .. 1 wet): `hollow` share from how far the ground sits in a hollow, `noise` share from the moisture
// noise, plus up to `low` below the mud altitude, fading in over `lowRange` x the mud transition above it.
const MOISTURE=Object.freeze({hollow:.55,noise:.45,low:.3,lowRange:6});
// Scree lies on the slopes just under the rock threshold (from..to, as shares of it). A ridge standing `ridge` x the
// hollow range above its surroundings counts as that much steeper. Bare soil shows where moisture falls from
// soil[0] to soil[1], broken by the local noise x soilRagged. Hollows hold snow and ridges lose it: the line moves
// by up to snowHollow m. Woodland prefers moist ground by woodMoisture.
const CLIMATE=Object.freeze({scree:[.5,.9],ridge:.2,soil:[.42,.2],soilRagged:.12,snowHollow:8,woodMoisture:.5,shadeFull:.5});
const DEGREES=Math.PI/180;
export function createTerrainRules(seed,settings={}){
 const config={...TERRAIN_PAINT_DEFAULTS,...settings};validateTerrainPaint(config);
 const local=valueNoise(seed+NOISE.local.seed),patch=valueNoise(seed+NOISE.patch.seed),moisture=valueNoise(seed+NOISE.moisture.seed),woodland=valueNoise(seed+NOISE.woodland.seed);
 // Local break-up n, large patches and the rock weight at a sample: shared by the layers and the sand.
 function exposure({x,z,slope,wall=0,curvature=0}){
  const p=config,L=NOISE.local,P=NOISE.patch,n=fbm(local,x/L.scale,z/L.scale,L.fractal)*L.norm,large=fbm(patch,x/p.patchScale,z/p.patchScale,P.fractal)*P.norm;
  const ridge=Math.max(0,-curvature)*p.curvatureInfluence;
  const exposed=slope-BREAKUP.slope*n+p.patchStrength*large+ridge;
  const rock=Math.max(smooth(p.rockSlope-p.slopeBlend,p.rockSlope+p.slopeBlend,exposed),smooth(p.wallRock-p.wallBlend,p.wallRock+p.wallBlend,wall-BREAKUP.wall*n));
  return{n,large,rock};
 }
 return{config,configure(values){validateTerrainPaint(values);Object.assign(config,values);},
  // Sand lies below the sand altitude wherever the ground is not rock; it covers the other layers there (0..1).
  sand(sample){
   const p=config,{n,rock}=exposure(sample);
   return smooth(-p.sandBlend,p.sandBlend,p.sandBelow-sample.height+BREAKUP.sand*n)*(1-rock);
  },
  // Layer weights in TERRAIN_LAYERS order (four, or five with forest cover). Takes the terrain signals of paint().
  weights(sample){
   const {roles}=paint(sample,false);
   return config.forestCover?roles.slice(0,TERRAIN_LAYERS.length):roles.slice(0,TERRAIN_LAYERS.length-1);
  },
  // Everything the ground shows at a sample {x, z, height, slope, hollow?, dx?, dz?, curvature?}: `roles`, one weight per
  // TERRAIN_PALETTE_ROLES summing to 1, and `moisture` (0 dry .. 1 wet). dx and dz are the ground slopes along +X and
  // +Z, for the shaded side; hollow and slope are measured over PAINT_REACH.
  paint:sample=>paint(sample,true),
 };
 function paint(sample,extras){
   const p=config,{x,z,height,slope,hollow=0,dx=0,dz=0,curvature=0,runout=false}=sample,M=NOISE.moisture,C=CLIMATE;
   // A ridge is as exposed as steeper ground.
   const ridge=Math.max(0,-hollow)/p.hollowRange*C.ridge;
   const {n,large,rock}=exposure({...sample,slope:slope+ridge});
   const wetNoise=fbm(moisture,x/(p.patchScale*M.scale),z/(p.patchScale*M.scale),M.fractal)*M.norm;
   const low=Math.max(0,Math.min(1,(p.mudBelow-height)/(p.mudBlend*MOISTURE.lowRange)+1));
   // The mud line itself moves with the wetness of the place; the low ground then adds to the moisture.
   const hollowness=smooth(-p.hollowRange,p.hollowRange,hollow);   // 0 on a ridge, .5 on even ground, 1 in a hollow
   const place=MOISTURE.hollow*hollowness+MOISTURE.noise*(wetNoise*.5+.5);
   const wet=Math.max(0,Math.min(1,place+MOISTURE.low*low));
   // The sun stands at the sun heading: ground rising toward it faces away and keeps its snow lower down.
   const heading=p.sunHeading*DEGREES,shade=smooth(0,C.shadeFull,dx*Math.cos(heading)+dz*Math.sin(heading));
   const snow=smooth(p.snowLine-p.snowBlend,p.snowLine+p.snowBlend,height-p.snowJitter*n+p.snowShade*shade+C.snowHollow*(hollowness*2-1));
   const ground=(1-rock)*(1-snow);
   const scree=extras?ground*p.scree*smooth(p.rockSlope*C.scree[0],p.rockSlope*C.scree[1],slope+ridge-BREAKUP.slope*n):0;
   const soft=ground-scree;
   const basin=p.mudBelow-height+BREAKUP.basin*n+Math.max(0,curvature)*p.curvatureInfluence+MUD.moisture*p.mudBlend*(place*2-1);
   const mud=(!p.mudFromRunout||runout)?soft*smooth(-p.mudBlend,p.mudBlend,basin)*(1-smooth(...MUD.slope,slope))*(extras?smooth(...MUD.wet,place):1):0;
   const dry=soft-mud;
   const soil=extras?dry*p.bareSoil*smooth(C.soil[0],C.soil[1],wet+C.soilRagged*n):0;
   const green=dry-soil;
   let forest=0;
   if(p.forestCover){
    const W=NOISE.woodland,F=FOREST;
    const wood=smooth(...F.woodEdges,fbm(woodland,x/p.woodlandSize,z/p.woodlandSize,W.fractal)*W.norm*F.woodGain+n*F.ragged*.5+(wet-.5)*C.woodMoisture+(p.forestCover-.5)*F.coverGain+.5);
    const patches=F.clearing+(1-F.clearing)*smooth(...F.patchEdges,large*F.patchGain+n*F.ragged+.5);
    forest=green*wood*patches*(1-smooth(p.forestSlope-F.slopeBlend,p.forestSlope+F.slopeBlend,slope))*(1-smooth(p.treeLine-p.treeBlend,p.treeLine+p.treeBlend,height+p.snowJitter*n));
   }
   return{roles:[green-forest,rock,(1-rock)*snow,mud,forest,scree,soil],moisture:wet};
 }
}
export const dominantTerrainLayer=weights=>TERRAIN_LAYERS[weights.indexOf(Math.max(...weights))];
