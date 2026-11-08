import * as T from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
// The stock normal override includes transparent meshes. Exclude effects/sky
// during that render only, and restore visibility even if rendering throws.
class OpaqueGTAOPass extends GTAOPass{
 _renderOverride(renderer,material,target,color,alpha){
  const hidden=[],previous=this.scene.overrideMaterial;
  this.scene.traverse(o=>{if(!o.isMesh||!o.visible)return;const materials=Array.isArray(o.material)?o.material:[o.material];if(materials.every(m=>m.transparent||m.depthWrite===false)){hidden.push(o);o.visible=false;}});
  try{super._renderOverride(renderer,material,target,color,alpha);}finally{for(const o of hidden)o.visible=true;this.scene.overrideMaterial=previous;}
 }
}
// Adapted from WebAquarium src/ocean/post.js: HDR output, post-tone-map
// contrast/saturation and UnrealBloomPass. No aquarium/water/depth dependencies.
export function createCameraPost(renderer){
 const settings={enabled:false,ao:false,aoStrength:.7,aoRadius:.65,bloom:.18,bloomThreshold:1,bloomRadius:.3,exposure:1,contrast:1,saturation:1,vignette:.1,toneMap:'ACES'};
 let composer=null,renderPass=null,bloom=null,ao=null,output=null,width=0,height=0;
 function disposeAO(){if(!ao)return;composer.removePass(ao);ao.dispose();/* These two materials are not disposed by the installed GTAOPass. */ao.gtaoMaterial.dispose();ao.blendMaterial.dispose();ao=null;}
 function init(){
  if(composer)return;const target=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:true});composer=new EffectComposer(renderer,target);renderPass=new RenderPass(null,null);composer.addPass(renderPass);
  bloom=new UnrealBloomPass(new T.Vector2(1,1),.18,.3,1);composer.addPass(bloom);
  output=new ShaderPass({uniforms:{tDiffuse:{value:null},uMode:{value:3},uExposure:{value:1},uContrast:{value:1},uSaturation:{value:1},uVignette:{value:0},toneMappingExposure:{value:1}},
   vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
   fragmentShader:`uniform sampler2D tDiffuse;uniform int uMode;uniform float uExposure,uContrast,uSaturation,uVignette;varying vec2 vUv;
   #include <tonemapping_pars_fragment>
   vec3 NeutralTM(vec3 c){const float K=.76,D=.15;float x=min(c.r,min(c.g,c.b));c-=x<.08?x-6.25*x*x:.04;float pk=max(c.r,max(c.g,c.b));if(pk<K)return c;float d=1.0-K,np=1.0-d*d/(pk+d-K);c*=np/pk;return mix(c,vec3(np),1.0-1.0/(D*(pk-np)+1.0));}
   void main(){vec3 c=max(texture2D(tDiffuse,vUv).rgb,vec3(0.0))*uExposure;
    if(uMode==1)c=AgXToneMapping(c);else if(uMode==2)c=NeutralTM(c);else if(uMode==3)c=ACESFilmicToneMapping(c);else if(uMode==4)c=ReinhardToneMapping(c);
    c=max(.18*pow(max(c/.18,vec3(0.0)),vec3(uContrast)),vec3(0.0));c=max(mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,uSaturation),vec3(0.0));
    c*=mix(1.0,1.0-smoothstep(.2,.75,length(vUv-.5)),uVignette);gl_FragColor=vec4(c,1.0);
    #include <colorspace_fragment>
   }`});output.material.toneMapped=false;composer.addPass(output);
 }
 return{settings,
  render(scene,camera,dt=0){if(!settings.enabled){renderer.render(scene,camera);return;}init();
   const size=renderer.getSize(new T.Vector2()),ratio=renderer.getPixelRatio();const w=Math.round(size.x*ratio),h=Math.round(size.y*ratio);
   if(w!==width||h!==height){width=w;height=h;composer.setPixelRatio(ratio);composer.setSize(size.x,size.y);}
   renderPass.scene=scene;renderPass.camera=camera;
   if(settings.ao){if(!ao){ao=new OpaqueGTAOPass(scene,camera,w,h,undefined,{radius:settings.aoRadius,samples:8},{samples:8});composer.insertPass(ao,1);}ao.scene=scene;ao.camera=camera;ao.blendIntensity=settings.aoStrength;ao.updateGtaoMaterial({radius:settings.aoRadius});
    const perspective=camera.isPerspectiveCamera?1:0;if(ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA!==perspective){ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA=perspective;ao.gtaoMaterial.needsUpdate=true;}
   }else disposeAO();
   bloom.enabled=settings.bloom>0;bloom.strength=settings.bloom;bloom.threshold=settings.bloomThreshold;bloom.radius=settings.bloomRadius;
   const u=output.uniforms;u.uMode.value={None:0,AgX:1,Neutral:2,ACES:3,Reinhard:4}[settings.toneMap]??3;u.uExposure.value=renderer.toneMappingExposure*settings.exposure;u.uContrast.value=settings.contrast;u.uSaturation.value=settings.saturation;u.uVignette.value=settings.vignette;
   composer.render(dt);
  },
  dispose(){if(!composer)return;disposeAO();bloom.dispose();output.dispose();renderPass.dispose();composer.dispose();composer=null;},
 };
}
