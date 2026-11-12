import {valueNoise} from '../core/value-noise.js';
const number=(label,min,max,step)=>({label,min,max,step});
export const TERRAIN_PAINT_DEFAULTS=Object.freeze({
 rockSlope:1,wallRock:1.15,snowLine:150,snowJitter:10,mudBelow:3.5,mudFromRunout:true,
 slopeBlend:.25,wallBlend:.18,snowBlend:12,mudBlend:1.4,patchScale:18,patchStrength:.18,curvatureInfluence:.2,forestCover:0,sandBelow:-20,sandBlend:.6,
});
export const TERRAIN_PAINT_FIELDS={
 rockSlope:number('Rock slope threshold · rise/run',.2,3,.05),slopeBlend:number('Slope transition softness',.02,1,.01),
 wallRock:number('Rock at valley sides · relative width',.5,2,.05),wallBlend:number('Valley-edge softness',.02,.8,.02),
 snowLine:number('Snow altitude · m',-20,300,1),snowBlend:number('Snow-line transition · m',1,60,1),snowJitter:number('Snow-line breakup · m',0,40,1),
 mudBelow:number('Mud basin altitude · m',-20,30,.5),mudBlend:number('Mud transition · m',.1,10,.1),
 patchScale:number('Natural patch size · m',3,100,1),patchStrength:number('Patch variation',0,.8,.01),curvatureInfluence:number('Ridge / basin influence',0,1,.05),
 forestCover:number('Forest floor coverage',0,1,.01),
 sandBelow:number('Sand below altitude · m',-20,300,.1),sandBlend:number('Sand transition · m',.05,10,.05),
};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const TERRAIN_LAYERS=Object.freeze(['grass','rock','snow','mud','forest']);
export function validateTerrainPaint(values){
 for(const [key,value]of Object.entries(values)){
  if(key==='mudFromRunout'){if(typeof value!=='boolean')throw Error('Invalid mudFromRunout');continue;}
  const s=TERRAIN_PAINT_FIELDS[key];if(!s||!Number.isFinite(value)||value<s.min||value>s.max)throw Error('Invalid terrain paint setting: '+key);
 }
 return values;
}
// Noise behind the layers: a local break-up field (cells `scale` m) and two-octave patches (second octave `octave` x finer,
// offset, weighted `weight`, the sum divided by `norm`). Seeds are offsets from the terrain seed.
const NOISE=Object.freeze({local:{seed:3,scale:8},patch:{seed:37,octave:2.13,offset:[7,-3],weight:.5,norm:1.5}});
// How much the local break-up moves each boundary: exposed slope, valley wall, mud basin, sand line (m).
const BREAKUP=Object.freeze({slope:.2,wall:.15,basin:.8,sand:.5});
// Forest floor: smoothstep edges over (patch x patchGain + (coverage - .5) x coverGain + .5).
const FOREST=Object.freeze({edges:[.35,.65],patchGain:.38,coverGain:1.8});
export function createTerrainRules(seed,settings={}){
 const config={...TERRAIN_PAINT_DEFAULTS,...settings};validateTerrainPaint(config);
 const local=valueNoise(seed+NOISE.local.seed),patch=valueNoise(seed+NOISE.patch.seed);
 // Local break-up n, large patches and the rock weight at a sample: shared by the layers and the sand.
 function exposure({x,z,slope,wall=0,curvature=0}){
  const p=config,L=NOISE.local,P=NOISE.patch,n=local(x/L.scale,z/L.scale),large=(patch(x/p.patchScale,z/p.patchScale)+P.weight*patch(x/p.patchScale*P.octave+P.offset[0],z/p.patchScale*P.octave+P.offset[1]))/P.norm;
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
  weights(sample){
   const p=config,{height,curvature=0,runout=false}=sample,{n,large,rock}=exposure(sample);
   const snow=smooth(p.snowLine-p.snowBlend,p.snowLine+p.snowBlend,height-p.snowJitter*n);
   const basin=p.mudBelow-height+BREAKUP.basin*n+Math.max(0,curvature)*p.curvatureInfluence;
   const mud=(!p.mudFromRunout||runout)?smooth(-p.mudBlend,p.mudBlend,basin):0;
   const soil=1-rock,remaining=soil*(1-snow);
   const dry=remaining*(1-mud);
   if (!p.forestCover) return [dry,rock,soil*snow,remaining*mud];
   const forest=smooth(...FOREST.edges,large*FOREST.patchGain+(p.forestCover-.5)*FOREST.coverGain+.5);
   return [dry*(1-forest),rock,soil*snow,remaining*mud,dry*forest];
  },
 };
}
export const dominantTerrainLayer=weights=>TERRAIN_LAYERS[weights.indexOf(Math.max(...weights))];
