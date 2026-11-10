// WebAquarium ocean/surface.js sky roughness and scene reflection.
export const REFLECTION_GLSL = `
uniform float uReflectionMode, uReflectionMix, uReflectionSteps; uniform sampler2D tPlanarReflection; uniform mat4 uPlanarMatrix;
    vec3 roughSky(vec3 d,float roughness){
      vec3 center=sky(d,0.0);float radius=roughness*roughness*.25;
      if(radius<.0005)return center;
      vec3 x=normalize(cross(abs(d.y)>.99?vec3(1,0,0):vec3(0,1,0),d))*radius;
      vec3 y=normalize(cross(d,x))*radius;
      return (center*2.0+sky(normalize(d+x),0.0)+sky(normalize(d-x),0.0)
        +sky(normalize(d+y),0.0)+sky(normalize(d-y),0.0))/6.0;
    }
    vec3 roughScreen(sampler2D image,vec2 uv,float roughness){
      float radius=roughness*roughness*.015;vec3 center=texture2D(image,uv).rgb;
      if(radius<.00005)return center;
      vec2 dx=vec2(radius,0),dy=vec2(0,radius);
      return (center*2.0+texture2D(image,clamp(uv+dx,.001,.999)).rgb+texture2D(image,clamp(uv-dx,.001,.999)).rgb
        +texture2D(image,clamp(uv+dy,.001,.999)).rgb+texture2D(image,clamp(uv-dy,.001,.999)).rgb)/6.0;
    }
    vec3 reflectedScene(vec3 wp,vec3 n,vec3 ray,float fragDist,float roughness,vec3 skyRadiance){
      if(uReflectionMix<=0.0)return skyRadiance;
      if(uReflectionMode>.5 && uReflectionMode<1.5){
        vec4 q=uPlanarMatrix*vec4(wp.x,0.0,wp.z,1.0);
        vec2 uv=q.xy/max(q.w,.0001)+n.xz*(.8/max(fragDist,1.0));
        if(q.w>0.0 && all(greaterThan(uv,vec2(0.0))) && all(lessThan(uv,vec2(1.0)))){
          vec2 edge=smoothstep(vec2(0.0),vec2(.08),uv)*(1.0-smoothstep(vec2(.92),vec2(1.0),uv));
          return mix(skyRadiance,roughScreen(tPlanarReflection,uv,roughness),edge.x*edge.y*uReflectionMix);
        }
      }
#ifdef OCEAN_REFLECTION_SSR
      else if(uReflectionMode>1.5){
        vec3 origin=wp+n*.15;
        float previous=-1.0;
        for(int i=0;i<32;i++){
          if(float(i)>=uReflectionSteps)break;
          float fraction=float(i)/max(1.0,uReflectionSteps-1.0);
          float t=.5+fraction*fraction*288.0;
          vec3 p=origin+ray*t;vec4 clip=uOceanVP*vec4(p,1.0);
          if(clip.w<=0.0)break;
          vec2 uv=clip.xy/clip.w*.5+.5;
          if(any(lessThan(uv,vec2(.001))) || any(greaterThan(uv,vec2(.999))))break;
          float delta=distance(p,cameraPosition)-sceneDistance(uv);
          if(previous<0.0 && delta>=0.0 && delta<2.0+t*.05 && t>1.0){
            vec2 edge=smoothstep(vec2(0),vec2(.1),uv)*(1.0-smoothstep(vec2(.9),vec2(1),uv));
            return mix(skyRadiance,roughScreen(tOceanScene,uv,roughness),edge.x*edge.y*uReflectionMix);
          }
          previous=delta;
        }
      }
#endif
      return skyRadiance;
    }
`;
