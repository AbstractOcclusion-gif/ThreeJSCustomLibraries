// Adapted from WebAquarium ocean/rain.js: camera-centred instanced quads and
// wrapped shader motion. Water-height, ocean composite and GPU-timer imports removed.
export function validatePrecipitation({count=512,radius=24,height=26,floorHeight=0}={}){
 if(!Number.isInteger(count)||count<1||count>6000)throw Error('Precipitation count must be 1..6000 per type');
 if(!Number.isFinite(radius)||radius<=0||!Number.isFinite(height)||height<=0||!Number.isFinite(floorHeight))throw Error('Precipitation needs positive radius/height and a finite floorHeight');
}
export function createPrecipitation({THREE,group,count=512,radius=24,height=26,floorHeight=0}={}){
 validatePrecipitation({count,radius,height,floorHeight});
 const seeds=new Float32Array(count*3);for(let i=0;i<seeds.length;i++)seeds[i]=Math.random();
 const parts=[];
 let disposed = false;
 for(const snow of [false,true]){
  const geometry=new THREE.InstancedBufferGeometry();geometry.setIndex([0,1,2,0,2,3]);geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0],3));geometry.setAttribute('iSeed',new THREE.InstancedBufferAttribute(seeds,3));
  const uniforms={uCenter:{value:new THREE.Vector3()},uOffset:{value:new THREE.Vector3()},uVelocity:{value:new THREE.Vector3()},uExtent:{value:new THREE.Vector3(radius*2,height,radius*2)},uSnow:{value:snow?1:0},uFloor:{value:floorHeight},uTime:{value:0},uColor:{value:new THREE.Color()},uOpacity:{value:snow?.7:.4}};
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
  const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=10;group.add(mesh);parts.push({snow,mesh,geometry,material,uniforms});
 }
 return{update(dt,weather,day,position){
  if (disposed) return;
  const angle=weather.windHeading*Math.PI/180;
  for(const p of parts){const amount=Math.max(0,Math.min(1,p.snow?weather.snow:weather.rain)),u=p.uniforms;p.mesh.visible=amount>.001;p.geometry.instanceCount=Math.round(count*amount);if(!p.mesh.visible)continue;
   u.uCenter.value.copy(position);u.uVelocity.value.set(Math.cos(angle)*weather.wind*.3,p.snow?-1.5:-22,Math.sin(angle)*weather.wind*.3);u.uOffset.value.addScaledVector(u.uVelocity.value,dt);const o=u.uOffset.value;o.x%=radius*2;o.y%=height;o.z%=radius*2;u.uTime.value+=dt;
   u.uColor.value.setRGB(p.snow?.85:.55,p.snow?.9:.65,p.snow?1:.75).multiplyScalar(.08+.92*day.daylight);
  }
 },dispose(){if (disposed) return;disposed=true;for(const p of parts){group.remove(p.mesh);p.geometry.dispose();p.material.dispose();}},get instanceCount(){return disposed?0:parts.reduce((sum,p)=>sum+(p.mesh.visible?p.geometry.instanceCount:0),0);}};
}
