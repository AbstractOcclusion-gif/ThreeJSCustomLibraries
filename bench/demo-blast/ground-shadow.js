import {LinearFilter,Mesh,OrthographicCamera,PlaneGeometry,Scene,ShaderMaterial,WebGLRenderTarget} from 'three';
import {addLightSlot} from '../../src/core/light-slots.js';
import {PLUME_MOTION_GLSL} from './plume-motion.js';
import {BLAST_FIELD_GLSL} from './volume-field.js';

// Low-resolution transmittance projection of the actual gas, along sunlight.
// Ground height is the blast's plane; terrain relief and separate puffs are not
// marched. The established light slot attenuates sun only, preserving ambient.
export function createBlastGroundShadow(renderer,source,receiver,groundBounds,look,resolution=192) {
  const target=new WebGLRenderTarget(resolution,resolution,{depthBuffer:false,minFilter:LinearFilter,magFilter:LinearFilter});
  const active={value:0},strength={value:0};
  const uniforms={...source.uniforms,groundBounds:{value:groundBounds},shadowActive:active};
  const material=new ShaderMaterial({uniforms,depthTest:false,depthWrite:false,toneMapped:false,
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`
      varying vec2 vUv;
      uniform sampler2D gas;
      uniform vec3 origin,extent,bounds,sun;
      uniform vec4 warp,groundBounds;
      uniform vec2 drift;
      uniform float ignition,shapeAge,headHeight,headRadius,worldScale,densityScale,condensate;
      uniform float opacity,columnOpacity,cloudOpacity,shadowActive;
      ${PLUME_MOTION_GLSL}
      ${BLAST_FIELD_GLSL}
      void main(){
        float transmission=1.;
        if(shadowActive>0. && sun.y>.03){
          vec2 xz=groundBounds.xy+vUv*groundBounds.zw;
          vec3 eye=vec3((xz.x-origin.x)/worldScale,.1,(xz.y-origin.z)/worldScale);
          vec3 a=(vec3(-bounds.x,0.,-bounds.z)-eye)/sun,b=(bounds-eye)/sun;
          vec3 lo=min(a,b),hi=max(a,b);
          float enter=max(0.,max(max(lo.x,lo.y),lo.z));
          float leave=min(min(hi.x,hi.y),hi.z);
          if(leave>enter){
            float stepSize=(leave-enter)/24.;
            float depth=0.;
            for(int i=0;i<24;i++){
              vec3 p=eye+sun*(enter+(float(i)+.5)*stepSize);
              vec3 local=referencePoint(p);
              float below=1.-smoothstep(headHeight*.52,headHeight*.86,local.y);
              float density=referenceField(local).g;
              density*=densityScale+condensate*(1.-below);
              depth+=density*mix(cloudOpacity,columnOpacity,below)*stepSize/ignition;
            }
            transmission=exp(-depth*opacity*.34);
          }
        }
        gl_FragColor=vec4(vec3(transmission),1.);
      }`});
  const scene=new Scene(),camera=new OrthographicCamera();
  const quad=new Mesh(new PlaneGeometry(2,2),material);quad.frustumCulled=false;scene.add(quad);
  const detach=addLightSlot(receiver,{key:'blast-ground-shadow',worldPosition:true,
    uniforms:{blastShadowMap:{value:target.texture},blastShadowBounds:{value:groundBounds},blastShadowSun:source.uniforms.sun,blastShadowStrength:strength},
    declarations:'uniform sampler2D blastShadowMap; uniform vec4 blastShadowBounds; uniform vec3 blastShadowSun; uniform float blastShadowStrength;',
    directional:`
      if(directLight.visible && dot(directLight.direction,transformDirection(blastShadowSun,viewMatrix))>.9999){
        vec2 uv=(vLightWorld.xz-blastShadowBounds.xy)/blastShadowBounds.zw;
        if(all(greaterThanEqual(uv,vec2(0.))) && all(lessThanEqual(uv,vec2(1.))))
          directLight.color*=mix(1.,texture2D(blastShadowMap,uv).r,blastShadowStrength);
      }`});
  return {
    render(){
      strength.value=look.groundShadow??.7;
      active.value=source.active&&strength.value>0?1:0;
      if(!active.value){strength.value=0;return;}
      const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear;
      try{renderer.autoClear=true;renderer.setRenderTarget(target);renderer.render(scene,camera);}
      finally{renderer.setRenderTarget(previous);renderer.autoClear=autoClear;}
    },
    dispose(){detach();target.dispose();quad.geometry.dispose();material.dispose();},
  };
}
