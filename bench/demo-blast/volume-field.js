// One coordinate/density lookup shared by the gas view and ground projection.
import {EARLY_HEAD,COLUMN_FORMATION_GLSL} from './fire-look.js';
export const BLAST_FIELD_GLSL = `
  uniform float coreDensity;
  ${COLUMN_FORMATION_GLSL}
  vec3 referencePoint(vec3 p){
    p/=ignition;
    float join=warp.z+(warp.y-warp.x)*warp.w;
    float anchor=min(12.,warp.y*.5);
    float y=p.y<=anchor?p.y:p.y<join?anchor+(p.y-anchor)*(warp.y-anchor)/(join-anchor):warp.x+(p.y-warp.z)/warp.w;
    float share=clamp(y/warp.y,0.,1.);
    return vec3((p.x-drift.x*share)/mix(1.,warp.w,share),y,
      (p.z-drift.y*share)/mix(1.,warp.w,share));
  }
  vec3 referenceField(vec3 p){
    p.xz-=plumeOffset(p.y,shapeAge,headHeight);
    // Low-frequency outward billows break the early sphere. An inverse lookup
    // moves density outward; all added deformation vanishes at fadeEnd.
    float early=(1.-smoothstep(${EARLY_HEAD.fadeStart}.0,${EARLY_HEAD.fadeEnd}.0,shapeAge))
      *smoothstep(headHeight*.52,headHeight*.86,p.y);
    vec3 fromHead=vec3(p.x,p.y-headHeight,p.z);
    float reach=length(fromHead);
    // Optical density only: preserve the noisy field and leave the outer
    // billows/soft silhouette beyond .8 head radii exactly as before.
    // Wider quintic falloff avoids a visible density shoulder; both slope and
    // curvature vanish at the full-density centre and unchanged outer region.
    float coreBlend=clamp((reach/max(13.,headRadius)-.12)/.68,0.,1.);
    float coreFalloff=coreBlend*coreBlend*coreBlend*(coreBlend*(coreBlend*6.-15.)+10.);
    float core=(1.-coreFalloff)*smoothstep(headHeight*.52,headHeight*.86,p.y);
    vec3 direction=fromHead/max(.001,reach);
    float lobes=.5+.25*sin(direction.x*5.+direction.z*3.+shapeAge*1.3)
      +.25*sin(direction.y*6.-direction.z*4.-shapeAge*.9);
    float edge=smoothstep(.25,.85,reach/max(13.,headRadius));
    p-=direction*(max(13.,headRadius)*${EARLY_HEAD.outward.toFixed(3)}*early*edge*lobes);
    float r=length(p.xz);
    if(r>extent.x||p.y<0.||p.y>extent.y)return vec3(0.);
    vec3 values=texture2D(gas,vec2(r/extent.x,p.y/extent.y)).rgb;
    if(shapeAge<24.) {
      float sourceY=columnSourceHeight(p.y,shapeAge,headHeight,headRadius);
      if(sourceY>p.y) {
        vec3 carried=texture2D(gas,vec2(r/extent.x,sourceY/extent.y)).rgb;
        // Keep the original radial envelope; moving source smoke must not
        // import the broad cap's width into the narrow stem.
        carried.g=min(carried.g,values.g*1.5);
        float moving=1.-smoothstep(22.,24.,shapeAge);
        values=mix(values,carried,moving);
      }
    }
    values.g*=mix(1.,coreDensity,core);
    values*=columnFormation(p.y,shapeAge,headHeight,headRadius);
    return values;
  }
  vec3 field(vec3 p){return referenceField(referencePoint(p));}
`;
