// Glider library adaptation: no application imports; renderer and uniforms injected.
// atmosphere/cloud-weather-map.js -- the dynamic sky's cloud weather map (from OceanPlayTest, 14 Oct 2026; shared since 16 Oct).
// Spatial coverage/type/top map following the inspected EnviroWeatherMap path.
import * as THREE from 'three';
import {createRenderScope} from '../../core/render-state.js';
export function createCloudWeatherMap(renderer,uniforms){
  const target=new THREE.WebGLRenderTarget(256,256,{type:THREE.HalfFloatType,depthBuffer:false,wrapS:THREE.RepeatWrapping,wrapT:THREE.RepeatWrapping});
  const material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:`varying vec2 vUv;
      vec2 hashCell(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*1031.317);}
      float worley(vec2 p,float frequency){p*=frequency;vec2 cell=floor(p),f=fract(p);float nearest=4.0;
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 o=vec2(float(x),float(y));
          vec2 jitter=hashCell(mod(cell+o,frequency));vec2 d=o+jitter-f;nearest=min(nearest,dot(d,d));}
        return clamp(1.0-sqrt(nearest),0.0,1.0);}
      void main(){float a=worley(vUv,6.0),b=worley(vUv,12.0),coverage=mix(a,b,.25);
        float type=clamp(pow(mix(a,b,.5),.5),0.0,1.0),top=pow(a*b,.75);
        gl_FragColor=vec4(coverage,top,type,sqrt(top));}`});
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);scene.add(quad);
  try{createRenderScope(renderer,{clearColor:false,scissorOff:false})(()=>{renderer.setRenderTarget(target);renderer.render(scene,camera);});}catch(error){target.dispose();throw error;}
  finally{quad.geometry.dispose();material.dispose();}
  uniforms.tCloudWeather.value=target.texture;return target;
}
