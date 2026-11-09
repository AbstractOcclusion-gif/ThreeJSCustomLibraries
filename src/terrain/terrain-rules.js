import {valueNoise} from './terrain-noise.js';
const number=(label,min,max,step)=>({label,min,max,step});
export const TERRAIN_PAINT_DEFAULTS=Object.freeze({
 rockSlope:1,wallRock:1.15,snowLine:150,snowJitter:10,mudBelow:3.5,mudFromRunout:true,
 slopeBlend:.25,wallBlend:.18,snowBlend:12,mudBlend:1.4,patchScale:18,patchStrength:.18,curvatureInfluence:.2,
});
export const TERRAIN_PAINT_FIELDS={
 rockSlope:number('Rock slope threshold · rise/run',.2,3,.05),slopeBlend:number('Slope transition softness',.02,1,.01),
 wallRock:number('Rock at valley sides · relative width',.5,2,.05),wallBlend:number('Valley-edge softness',.02,.8,.02),
 snowLine:number('Snow altitude · m',-20,300,1),snowBlend:number('Snow-line transition · m',1,60,1),snowJitter:number('Snow-line breakup · m',0,40,1),
 mudBelow:number('Mud basin altitude · m',-20,30,.5),mudBlend:number('Mud transition · m',.1,10,.1),
 patchScale:number('Natural patch size · m',3,100,1),patchStrength:number('Patch variation',0,.8,.01),curvatureInfluence:number('Ridge / basin influence',0,1,.05),
};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const TERRAIN_LAYERS=Object.freeze(['grass','rock','snow','mud']);
export function validateTerrainPaint(values){
 for(const [key,value]of Object.entries(values)){
  if(key==='mudFromRunout'){if(typeof value!=='boolean')throw Error('Invalid mudFromRunout');continue;}
  const s=TERRAIN_PAINT_FIELDS[key];if(!s||!Number.isFinite(value)||value<s.min||value>s.max)throw Error('Invalid terrain paint setting: '+key);
 }
 return values;
}
export function createTerrainRules(seed,settings={}){
 const config={...TERRAIN_PAINT_DEFAULTS,...settings};validateTerrainPaint(config);
 const local=valueNoise(seed+3),patch=valueNoise(seed+37);
 return{config,configure(values){validateTerrainPaint(values);Object.assign(config,values);},
  weights({x,z,height,slope,wall=0,curvature=0,runout=false}){
   const p=config,n=local(x/8,z/8),large=(patch(x/p.patchScale,z/p.patchScale)+.5*patch(x/p.patchScale*2.13+7,z/p.patchScale*2.13-3))/1.5;
   const ridge=Math.max(0,-curvature)*p.curvatureInfluence;
   const exposed=slope-.2*n+p.patchStrength*large+ridge;
   const rock=Math.max(smooth(p.rockSlope-p.slopeBlend,p.rockSlope+p.slopeBlend,exposed),smooth(p.wallRock-p.wallBlend,p.wallRock+p.wallBlend,wall-.15*n));
   const snow=smooth(p.snowLine-p.snowBlend,p.snowLine+p.snowBlend,height-p.snowJitter*n);
   const basin=p.mudBelow-height+.8*n+Math.max(0,curvature)*p.curvatureInfluence;
   const mud=(!p.mudFromRunout||runout)?smooth(-p.mudBlend,p.mudBlend,basin):0;
   const soil=1-rock,remaining=soil*(1-snow);
   return[remaining*(1-mud),rock,soil*snow,remaining*mud];
  },
 };
}
export const dominantTerrainLayer=weights=>TERRAIN_LAYERS[weights.indexOf(Math.max(...weights))];
