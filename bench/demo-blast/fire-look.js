export const FIRE_LOOK = Object.freeze({fuel: 1, drag: .85, headFriction: .3, viscosity: .14, glow: 1.95, ceiling: 92, riseSpeed: .65, density: 3.8, coreDensity:2.5, light: 1.5, selfShadow:.55,groundShadow:.7,lightScatter:.35});
// Normalised heat over which the gas turns from smoke to flame. The cloud's
// puffs fade out over the same range: where it burns, the gas volume draws alone.
export const BURNING = Object.freeze({from: .08, to: 1.05});
// Skirt-derived billow reference, shared by the head parcels and column detail.
export const CLOUD_BILLOWS = Object.freeze({width:14,variation:.18,grow:.55,rimShare:.58,birthScale:1.25});
// Ignition shares the mature displacement and roll: no separate turbulence burst.
export const EARLY_HEAD = Object.freeze({warp:8,outward:0,fadeStart:3,fadeEnd:12});
// Presentation heat only: never feeds buoyancy, fuel or smoke transport.
// The lower mantle stays incandescent after the crown starts cooling.
export const FIERY_PHASE = Object.freeze({fadeStart:8,fadeEnd:22,body:.38,mantle:.55});
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
// Visible dust climbs from the ground into a separately rolling thermal.
// Presentation only; the established mature simulation is untouched.
export function columnFormation(age,headHeight,headRadius) {
  const join=Math.max(8,headHeight-Math.max(13,headRadius)*.65);
  const progress=smooth(1.5,10,age);
  return {join,tip:join*progress,connected:smooth(8,12,age)};
}
// Inverse transport: positive lookup offset puts each source billow lower at
// first; as the offset falls, that same billow climbs toward the skirt.
// Translation preserves billow size, unlike stretching texture coordinates.
export function columnSourceHeight(y,age,headHeight,headRadius) {
  const {join}=columnFormation(age,headHeight,headRadius);
  return y+join*(1-smooth(1.5,24,age))*(1-smooth(join-4,join+2,y));
}
export const COLUMN_FORMATION_GLSL=`
  float columnSourceHeight(float y,float time,float head,float radius) {
    float join=max(8.,head-max(13.,radius)*.65);
    float travel=join*(1.-smoothstep(1.5,24.,time));
    return y+travel*(1.-smoothstep(join-4.,join+2.,y));
  }
  float columnFormation(float y,float time,float head,float radius) {
    float join=max(8.,head-max(13.,radius)*.65);
    float tip=join*smoothstep(1.5,10.,time);
    float cap=smoothstep(join-2.,join+2.,y);
    float stem=(1.-smoothstep(tip-2.,tip+2.,y))*smoothstep(1.5,3.,time);
    return mix(max(cap,stem),1.,smoothstep(8.,12.,time));
  }
`;
export function visibleHeat(heat,age,radius,y,headHeight,headRadius) {
  const life=1-smooth(FIERY_PHASE.fadeStart,FIERY_PHASE.fadeEnd,age);
  const r=Math.max(13,headRadius),h=y/headHeight;
  const cloud=smooth(.36,.62,h);
  const base=Math.exp(-(((y-headHeight+r*.48)/(r*.55))**2));
  const rim=smooth(.3,.8,radius/r);
  const body=1-smooth(.8,1.45,Math.hypot(radius/r,(y-headHeight)/r));
  return heat+life*cloud*(FIERY_PHASE.body*body+FIERY_PHASE.mantle*base*(.4+.6*rim));
}
export const VISIBLE_HEAT_GLSL=`
  float visibleHeat(float heat,float time,float radius,float y,float head,float headR) {
    float life=1.-smoothstep(${FIERY_PHASE.fadeStart}.0,${FIERY_PHASE.fadeEnd}.0,time);
    float r=max(13.,headR),cloud=smoothstep(.36,.62,y/head);
    float base=exp(-pow((y-head+r*.48)/(r*.55),2.));
    float rim=smoothstep(.3,.8,radius/r);
    float body=1.-smoothstep(.8,1.45,length(vec2(radius,y-head)/r));
    return heat+life*cloud*(${FIERY_PHASE.body}*body+${FIERY_PHASE.mantle}*base*(.4+.6*rim));
  }
`;
// Short presentation expansion, in the plume's reference seconds.
export function ignitionScale(age) {
  const t=Math.max(0,Math.min(1,age/1.4));
  return .04+.96*t*t*(3-2*t);
}
// The fire's own light, on the smoke around it and on the scene. decay: per reference
// second; scatter: share of the smoke's extinction the light suffers on its way;
// albedo: reflectance of the sprites, whose tint belongs to the particle pool.
export const INNER_LIGHT = Object.freeze({color: 0xff6a25, decay: .27, scatter: .5, albedo: .5});
