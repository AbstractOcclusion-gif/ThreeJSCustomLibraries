// Adapted from WebAquarium ocean/rain.js: camera-centred instanced quads and
// wrapped shader motion. Water-height, ocean composite and GPU-timer imports removed.
const DEFAULTS=Object.freeze({count:512,radius:24,height:26,floorHeight:0});   // drops per type; m around the camera; m tall
const MAX_COUNT=6000,RENDER_ORDER=10,MIN_AMOUNT=.001;   // drops per type; drawn after the scene's transparent surfaces
// Fall speed (m/s), opacity and colour per type; the wind carries windShare of its speed. Colour x (night + day x daylight).
const FALL=Object.freeze({rain:{speed:22,opacity:.4,color:[.55,.65,.75]},snow:{speed:1.5,opacity:.7,color:[.85,.9,1]},windShare:.3,night:.08,day:.92});
export function validatePrecipitation({count=DEFAULTS.count,radius=DEFAULTS.radius,height=DEFAULTS.height,floorHeight=DEFAULTS.floorHeight}={}){
 if(!Number.isInteger(count)||count<1||count>MAX_COUNT)throw Error(`Precipitation count must be 1..${MAX_COUNT} per type`);
 if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(height)||height<=0||!Number.isFinite(floorHeight))throw Error('Precipitation needs positive radius/height and a finite floorHeight');
}
export function createPrecipitation({THREE,group,count=DEFAULTS.count,radius=DEFAULTS.radius,height=DEFAULTS.height,floorHeight=DEFAULTS.floorHeight}={}){
 validatePrecipitation({count,radius,height,floorHeight});
 const seeds=new Float32Array(count*3);for(let i=0;i<seeds.length;i++)seeds[i]=Math.random();
 const parts=[];
 let disposed = false;
 for(const snow of [false,true]){
  const geometry=new THREE.InstancedBufferGeometry();geometry.setIndex([0,1,2,0,2,3]);geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0],3));geometry.setAttribute('iSeed',new THREE.InstancedBufferAttribute(seeds,3));
  const uniforms={uCenter:{value:new THREE.Vector3()},uOffset:{value:new THREE.Vector3()},uVelocity:{value:new THREE.Vector3()},uExtent:{value:new THREE.Vector3(radius*2,height,radius*2)},uSnow:{value:snow?1:0},uFloor:{value:floorHeight},uTime:{value:0},uColor:{value:new THREE.Color()},uOpacity:{value:snow?FALL.snow.opacity:FALL.rain.opacity}};
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthTest:true,depthWrite:false,side:THREE.DoubleSide,
   vertexShader:`attribute vec3 iSeed;uniform vec3 uCenter,uOffset,uVelocity,uExtent;uniform float uSnow,uFloor,uTime;varying vec2 vUv;
    void main(){vec3 p=uCenter+mod(iSeed*uExtent+uOffset,uExtent)-uExtent*vec3(.5,.2,.5);vUv=position.xy+.5;
     if(p.y<uFloor){gl_Position=vec4(0,0,2,1);return;}
     vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);vec3 up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
     if(uSnow>.5){p.x+=sin(uTime+iSeed.x*30.0)*.6;p+=right*position.x*.075+up*position.y*.075;}
     else p+=normalize(uVelocity)*position.y*.7+right*position.x*.018;
     gl_Position=projectionMatrix*viewMatrix*vec4(p,1);}`,
   fragmentShader:`uniform vec3 uColor;uniform float uSnow,uOpacity;varying vec2 vUv;void main(){float a;
    if(uSnow>.5){float r=length(vUv-.5)*2.0;if(r>1.0)discard;a=1.0-smoothstep(.4,1.0,r);}
    else a=sin(vUv.y*3.14159265)*(1.0-abs(vUv.x-.5)*2.0);
    gl_FragColor=vec4(uColor,a*uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=RENDER_ORDER;group.add(mesh);parts.push({snow,mesh,geometry,material,uniforms});
 }
 // update(dt, environment, position): the shared contract (core/environment.js) gives rain, snow, wind and daylight.
 // The former update(dt, weather, day, position) is still accepted.
 return{update(dt,source,second,third){
  if (disposed) return;
  const legacy=third!==undefined,position=legacy?third:second,daylight=legacy?second.daylight:source.daylight;
  const angle=legacy?THREE.MathUtils.degToRad(source.windHeading):0,windX=legacy?Math.cos(angle)*source.wind:source.wind.x,windZ=legacy?Math.sin(angle)*source.wind:source.wind.z;
  for(const p of parts){const amount=THREE.MathUtils.clamp(p.snow?source.snow:source.rain,0,1),u=p.uniforms;p.mesh.visible=amount>MIN_AMOUNT;p.geometry.instanceCount=Math.round(count*amount);if(!p.mesh.visible)continue;
   u.uCenter.value.copy(position);u.uVelocity.value.set(windX*FALL.windShare,p.snow?-FALL.snow.speed:-FALL.rain.speed,windZ*FALL.windShare);u.uOffset.value.addScaledVector(u.uVelocity.value,dt);const o=u.uOffset.value;o.x%=radius*2;o.y%=height;o.z%=radius*2;u.uTime.value+=dt;
   u.uColor.value.setRGB(...(p.snow?FALL.snow:FALL.rain).color).multiplyScalar(FALL.night+FALL.day*daylight);
  }
 },dispose(){if (disposed) return;disposed=true;for(const p of parts){group.remove(p.mesh);p.geometry.dispose();p.material.dispose();}},get instanceCount(){return disposed?0:parts.reduce((sum,p)=>sum+(p.mesh.visible?p.geometry.instanceCount:0),0);}};
}
