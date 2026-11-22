import {Color, Matrix4, Mesh, PlaneGeometry, PointLight, ShaderMaterial, Vector2, Vector3, Vector4} from 'three';
import {PLUME_MOTION_GLSL, plumeOffset, puffRollPhase} from './plume-motion.js';
import {CLOUD_TINT, DUST_TINT} from './palette.js';
import {BURNING, CLOUD_BILLOWS, EARLY_HEAD, FIRE_LOOK, INNER_LIGHT, ignitionScale, VISIBLE_HEAT_GLSL} from './fire-look.js';
import {BLAST_FIELD_GLSL} from './volume-field.js';
import {BALL_SCATTER_GLSL} from './light-scatter.js';

const EXTINCTION = .34; // per reference metre at unit density; flame is as opaque as smoke
const COLUMN_DETAIL = Object.freeze({scale:.7, octave:1});
const glsl = value => value.toFixed(3);

// The same temperature/density slice renders the hot gas and the cooling smoke.
// Integrate Beer-Lambert absorption and emission through its axisymmetric 3D volume.
export function createFireball(scene, look, noiseVolume, flow, environment, steps = 64) {
  const extent=flow.extent;
  const bounds=extent.clone();
  const sliceCount = 8;
  const QUAD = Object.freeze({
    outside: 1.2,   // eye beyond this many bounding radii: a quad fitted to the volume's cone
    nearPlanes: 4,  // otherwise a screen-filling quad this many near-plane distances ahead
    cover: 1.1,     // margin on either quad
  });
  const PARCELS_PER_SHELL = 2; // fewer parcels inside the gas than this per shell: even shells
  const axis = new Vector3(), centre = new Vector3(), eye = new Vector3(), local = new Vector3();
  // The burning ball, in reference metres from the origin, for the host's puffs.
  const fire = {centre: new Vector3(), radius: flow.head.radius, intensity: 0};
  const edges = new Float64Array(sliceCount + 1), inside = [];
  const uniforms={
    gas:{value:flow.texture},noiseVolume:{value:noiseVolume},age:{value:0},glow:{value:look.glow},
    origin:{value:new Vector3()},extent:{value:extent.clone()},worldScale:{value:1},
    sun:{value:environment?.sun?.direction??new Vector3(.5,.8,.2).normalize()},
    cloudTint:{value:new Color(CLOUD_TINT[0]).lerp(new Color(CLOUD_TINT[1]),1/3)},
    dustTint:{value:new Color(DUST_TINT[0])},
    sceneTint:{value:new Color(1,1,1)},
    airTint:{value:new Color()},airDensity:{value:0},
    headHeight:{value:14},
    columnOpacity:{value:1},cloudOpacity:{value:1},
    shell:{value:new Vector2()},shellSteps:{value:1},
    opacity:{value:look.density},fireLight:{value:0},headRadius:{value:flow.head.radius},
    fireColor:{value:new Color(INNER_LIGHT.color)},projection:{value:new Matrix4()},
    bounds:{value:bounds},warp:{value:new Vector4(14,8,14,1)},drift:{value:new Vector2()},
    shapeAge:{value:0},heatScale:{value:1},densityScale:{value:1},
    condensate:{value:0},
    billowWidth:{value:CLOUD_BILLOWS.width},
    ignition:{value:1},
    selfShadow:{value:look.selfShadow??FIRE_LOOK.selfShadow},
    lightScatter:{value:look.lightScatter??FIRE_LOOK.lightScatter},
    coreDensity:{value:look.coreDensity??2.5},
  };
  const radius = Math.hypot(extent.x, extent.y / 2, extent.z);
  const geometry=new PlaneGeometry(radius*2,radius*2);
  const material=new ShaderMaterial({
    defines: {BLAST_STEPS: steps, EXTINCTION: glsl(EXTINCTION), SCATTER: glsl(INNER_LIGHT.scatter)},
    uniforms,transparent:true,depthWrite:false,
    vertexShader:`
      varying vec3 worldPoint;
      void main(){
        worldPoint=(modelMatrix*vec4(position,1.)).xyz;
        gl_Position=projectionMatrix*viewMatrix*vec4(worldPoint,1.);
      }
    `,
    fragmentShader:`
      uniform sampler2D gas;
      uniform highp sampler3D noiseVolume;
      uniform vec3 origin,extent,bounds,sun,cloudTint,dustTint,sceneTint,airTint;
      uniform float airDensity;
      uniform vec4 warp;
      uniform vec2 drift;
      uniform float shapeAge,heatScale,densityScale,condensate;
      uniform float billowWidth;
      uniform float ignition;
      uniform float selfShadow;
      uniform float lightScatter;
      uniform float worldScale,age,glow,headHeight,columnOpacity,cloudOpacity;
      uniform vec2 shell;
      uniform int shellSteps;
      uniform float opacity,fireLight,headRadius;
      uniform vec3 fireColor;
      uniform mat4 projection;
      varying vec3 worldPoint;
      ${PLUME_MOTION_GLSL}
      ${BLAST_FIELD_GLSL}
      ${BALL_SCATTER_GLSL}
      ${VISIBLE_HEAT_GLSL}
      vec3 gasNoiseWarp(vec3 q){
        return vec3(texture(noiseVolume,q).r,texture(noiseVolume,q+.38).r,texture(noiseVolume,q+.61).r)-.5;
      }
      float gasBillow(vec3 q,float octave){
        return texture(noiseVolume,q*octave+gasNoiseWarp(q)*.36).r;
      }
      void main(){
        vec3 eye=(cameraPosition-origin)/worldScale;
        vec3 ray=normalize(worldPoint-cameraPosition);
        vec3 minimum=vec3(-bounds.x,0.,-bounds.z),maximum=bounds;
        vec3 a=(minimum-eye)/ray,b=(maximum-eye)/ray;
        vec3 lo=min(a,b),hi=max(a,b);
        float enter=max(max(lo.x,lo.y),lo.z);
        float leave=min(min(hi.x,hi.y),hi.z);
        // One ray lattice for every shell: sorting boundaries cannot move
        // density samples or make the gas shimmer as detail parcels fade in.
        float rayStart=max(0.,enter);
        float rayStep=(leave-rayStart)/float(BLAST_STEPS);
        if(rayStep<=0.)discard;
        // Shells are ranges of distance from the eye: ray is unit length, so the
        // march parameter is that distance and turning the camera changes nothing.
        enter=max(enter,shell.x);
        leave=min(leave,shell.y);
        if(enter>=leave)discard;
        // The shared quad sits in front of the volume. Depth-test each shell where
        // its gas begins, so terrain and buildings in front of that still hide it.
        vec4 clip=projection*viewMatrix*vec4(cameraPosition+ray*enter*worldScale,1.);
        gl_FragDepth=clamp(clip.z/clip.w*.5+.5,0.,1.);
        float transmittance=1.;
        vec3 color=vec3(0.);
        vec2 fireDrift=plumeOffset(headHeight,shapeAge,headHeight);
        vec3 fire=vec3(fireDrift.x,headHeight,fireDrift.y);
        int firstSample=max(0,int(floor((enter-rayStart)/rayStep)));
        for(int i=0;i<BLAST_STEPS;i++){
          int sampleIndex=firstSample+i;
          if(sampleIndex>=BLAST_STEPS)break;
          float cellStart=rayStart+float(sampleIndex)*rayStep;
          if(cellStart>=leave)break;
          float stepSize=min(cellStart+rayStep,leave)-max(cellStart,enter);
          if(stepSize<=0.)continue;
          vec3 p=eye+ray*(cellStart+.5*rayStep);
          vec3 local=referencePoint(p);
          float belowHead=1.-smoothstep(headHeight*.52,headHeight*.86,local.y);
          // Detail belongs to the entire head, not a fraction of its altitude.
          // Keep density/fade ownership on the established belowHead mask.
          float headBottom=headHeight-max(13.,headRadius);
          float detailHead=smoothstep(headBottom-headRadius*.15,headBottom+headRadius*.25,local.y);
          float detailBelow=1.-detailHead;
          // Independent patterns lose variance under an ordinary crossfade.
          // Keep the overlap's billow contrast instead of creating a smooth belt.
          float joinGain=inversesqrt((1.-detailBelow)*(1.-detailBelow)+detailBelow*detailBelow);
          float joinDetailGain=joinGain*(1.+.12*4.*detailBelow*(1.-detailBelow));
          // Head noise describes broad billows, not the smaller grain inside
          // each puff. Column billows are coarser without widening the field.
          float skirtScale=.92/(billowWidth*.027);
          float earlyTurbulence=1.-smoothstep(${glsl(EARLY_HEAD.fadeStart)},${glsl(EARLY_HEAD.fadeEnd)},shapeAge);
          float earlyHead=(1.-belowHead)*earlyTurbulence;
          // Blend sampled patterns, not their coordinates: varying frequency
          // and opposite scroll within coordinates compressed this join.
          vec3 domain=local*.027*skirtScale*.7+vec3(0.,age*.1,0.);
          vec3 columnLocal=vec3(local.x,columnSourceHeight(local.y,shapeAge,headHeight,headRadius),local.z);
          vec3 baseDomain=columnLocal*.027*skirtScale*${glsl(COLUMN_DETAIL.scale)}-vec3(0.,age*.1,0.);
          vec3 displacement=gasNoiseWarp(detailBelow>=1.?baseDomain:domain);
          if(detailBelow>0.&&detailBelow<1.)displacement=clamp(mix(displacement,gasNoiseWarp(baseDomain),detailBelow)*joinGain,vec3(-.5),vec3(.5));
          vec3 values=referenceField(local+displacement*mix(8.,${glsl(EARLY_HEAD.warp)},earlyHead));
          values.r*=heatScale;
          if(values.g<.002&&values.r<.015)continue;
          vec3 q=local*.027*skirtScale*.7+vec3(0.,age*.13,0.);
          vec3 baseQ=columnLocal*.027*skirtScale*${glsl(COLUMN_DETAIL.scale)}-vec3(0.,age*.13,0.);
          float n=detailBelow>=1.?gasBillow(baseQ,${glsl(COLUMN_DETAIL.octave)}):gasBillow(q,1.);
          if(detailBelow>0.&&detailBelow<1.)n=clamp(.5+(mix(n,gasBillow(baseQ,${glsl(COLUMN_DETAIL.octave)}),detailBelow)-.5)*joinDetailGain,0.,1.);
          float density=max(0.,values.g*(.42+n*1.2)-.003)*densityScale;
          density+=max(0.,values.g*(.42+n*1.2)-.003)*condensate*(1.-belowHead);
          float column=smoothstep(4.,16.,local.y)*belowHead;
          density*=1.+column*.55;
          density*=mix(cloudOpacity,columnOpacity,belowHead);
          vec2 heatOffset=local.xz-plumeOffset(local.y,shapeAge,headHeight);
          float heat=visibleHeat(values.r,shapeAge,length(heatOffset),local.y,headHeight,headRadius)*(.65+n*.62);
          float burning=smoothstep(${glsl(BURNING.from)},${glsl(BURNING.to)},heat);
          float alpha=1.-exp(-density*opacity*EXTINCTION*stepSize/ignition);
          // Short sunward density integration through this evolving gas field.
          float shadow=field(p+sun*3.*warp.w).g
            +field(p+sun*9.*warp.w).g+field(p+sun*18.*warp.w).g;
          shadow*=(densityScale+condensate)*warp.w*.9;
          float lighting=cloudLightResponse(1.31,shadow,dot(ray,sun),selfShadow,lightScatter);
          float definition=mix(.65,1.25,smoothstep(.25,.75,n));
          lighting*=mix(definition,mix(.55,1.35,smoothstep(.25,.75,n)),detailHead);
          float groundBlend=1.-smoothstep(3.,24.,local.y);
          // Gas and parcels share the cloud palette through the mantle; a
          // separate pale head tint previously exposed the layer boundary.
          vec3 tint=cloudTint;
          tint=mix(tint,dustTint,groundBlend);
          vec3 smoke=tint*sceneTint*lighting;
          if(fireLight>.001){
            // The ball lights its own smoke: inverse-square from the head centre,
            // dimmed by the smoke halfway there.
            vec3 toFire=fire-local;
            float reach=length(toFire);
            float veil=referenceField(local+toFire*.5).g*densityScale;
            smoke+=tint*fireColor*fireLight/(1.+reach*reach/(headRadius*headRadius))
              *exp(-veil*opacity*EXTINCTION*SCATTER*reach);
          }
          vec3 hot=mix(vec3(1.8,.025,.001),vec3(6.6,1.2,.05),smoothstep(.3,1.05,heat));
          hot=mix(hot,vec3(10.,3.,.2),smoothstep(1.1,1.85,heat));
          smoke+=vec3(.48,.075,.008)*glow*smoothstep(.05,.4,heat);
          // Emission cools away within an already present, absorbing smoke body.
          // No separate surface needs to replace the fire as the heat declines.
          vec3 source=smoke+hot*glow*burning;
          // Sprite puffs already receive scene FogExp2. Fog each gas sample at
          // its actual distance, never at the camera-facing proxy quad.
          float airDistance=length(p-eye)*worldScale;
          float air=1.-exp(-airDensity*airDensity*airDistance*airDistance);
          source=mix(source,airTint,air);
          color+=transmittance*alpha*source;
          transmittance*=1.-alpha;
          if(transmittance<.015)break;
        }
        float alpha=1.-transmittance;
        if(alpha<.003)discard;
        gl_FragColor=vec4(color/max(alpha,.001),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  // Each shell is a range of distance from the eye with its own sort distance, so
  // the host's eye-distance sort interleaves puffs with the gas. All shells share
  // one quad; userData.sortDistance tells the sort where the shell's gas is.
  let sizeNow = 1, visible = false;
  const slices = Array.from({length:sliceCount}, () => {
    const mesh = new Mesh(geometry,material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.userData.shell = new Vector2();
    mesh.userData.steps = 1;
    mesh.userData.sortDistance = 0;
    mesh.onBeforeRender = () => {
      uniforms.shell.value.copy(mesh.userData.shell);
      uniforms.shellSteps.value = mesh.userData.steps;
      material.uniformsNeedUpdate = true;
    };
    scene.add(mesh);
    return mesh;
  });
  const light=new PointLight(0xff6a25,0);
  scene.add(light);
  return {
    shadowField:{uniforms,get active(){return visible;}},
    // parcelDistances: eye distances (m) of the host's visible puffs. Shell edges are
    // placed between equal groups of them, so the gas is cut finely where the
    // puffs are and a puff changing side only ever crosses a thin shell.
    sort(camera, parcelDistances = [], parcelOpacities = []) {
      camera.updateMatrixWorld();
      camera.getWorldPosition(eye);
      uniforms.projection.value.copy(camera.projectionMatrix);
      centre.copy(uniforms.origin.value);centre.y += bounds.y/2*sizeNow;
      const reach = sizeNow*Math.hypot(bounds.x,bounds.y/2,bounds.z);
      const distance = eye.distanceTo(centre);
      // Nearest and farthest points of the gas box itself: a shell lying outside
      // it would spend its share of the samples on nothing.
      local.copy(eye).sub(uniforms.origin.value).divideScalar(sizeNow);
      const outside = Math.hypot(Math.max(0,Math.abs(local.x)-bounds.x),
        Math.max(0,-local.y,local.y-bounds.y),Math.max(0,Math.abs(local.z)-bounds.z));
      const near = Math.max(camera.near, outside*sizeNow);
      const far = sizeNow*Math.hypot(Math.abs(local.x)+bounds.x,
        Math.max(Math.abs(local.y),Math.abs(local.y-bounds.y)),Math.abs(local.z)+bounds.z);
      const span = far-near;
      let half;
      if (distance > reach*QUAD.outside) {
        // Tangent cone of the bounding sphere, cut where the sphere begins.
        const ahead = distance-reach;
        axis.copy(centre).sub(eye).divideScalar(distance);
        half = ahead*reach/Math.sqrt(distance*distance-reach*reach);
        slices[0].position.copy(eye).addScaledVector(axis,ahead);
        slices[0].lookAt(eye);
      } else {
        // Inside or close: a plane behind the eye cannot rasterize, so fill the view.
        const ahead = camera.near*QUAD.nearPlanes;
        camera.getWorldDirection(axis);
        half = ahead*Math.tan(camera.fov*Math.PI/360)*Math.max(1,camera.aspect);
        slices[0].position.copy(eye).addScaledVector(axis,ahead);
        slices[0].quaternion.copy(camera.quaternion);
      }
      inside.length = 0;
      let totalOpacity=0;
      for(let i=0;i<parcelDistances.length;i++) {
        const d=parcelDistances[i],weight=Math.max(0,Math.min(1,parcelOpacities[i]??1));
        if(d>near&&d<far&&weight>0){inside.push({distance:d,weight});totalOpacity+=weight;}
      }
      edges[0] = near;edges[sliceCount] = far;
      if (inside.length) {
        inside.sort((a,b) => a.distance-b.distance);
        let cumulative=0;
        for(const parcel of inside){parcel.centre=cumulative+parcel.weight*.5;cumulative+=parcel.weight;}
        const fraction=Math.min(1,totalOpacity/(sliceCount*PARCELS_PER_SHELL));
        const adaptive=fraction*fraction*(3-2*fraction);
        for (let k=1;k<sliceCount;k++) {
          const sample=k*totalOpacity/sliceCount;
          let j=0;
          while(j<inside.length-1&&inside[j+1].centre<sample)j++;
          const next=Math.min(inside.length-1,j+1),a=inside[j],b=inside[next];
          const share=Math.max(0,Math.min(1,(sample-a.centre)/Math.max(1e-8,b.centre-a.centre)));
          const quantile=a.distance+(b.distance-a.distance)*share;
          const even=near+span*k/sliceCount;
          edges[k]=even+(quantile-even)*adaptive;
        }
      } else for (let k=1;k<sliceCount;k++) edges[k] = near+span*k/sliceCount;
      slices.forEach((mesh,i) => {
        const from = edges[i], to = edges[i+1];
        mesh.userData.shell.set(from/sizeNow,to/sizeNow);
        // Samples follow thickness, keeping one step length across uneven shells.
        mesh.userData.steps = Math.max(1,Math.min(steps,Math.round(steps*(to-from)/span)));
        mesh.userData.sortDistance = (from+to)/2;
        mesh.position.copy(slices[0].position);
        mesh.quaternion.copy(slices[0].quaternion);
        mesh.scale.setScalar(half*QUAD.cover/radius);
        mesh.visible = visible && span > 0;
        mesh.updateMatrixWorld();
      });
    },
    update(dt,time,origin,size,{columnOpacity=1,cloudOpacity=1,late=null,shapeAge=time,billowWidth=CLOUD_BILLOWS.width*(1+CLOUD_BILLOWS.grow)}={}){
      visible=columnOpacity>0||cloudOpacity>0;
      sizeNow=size;
      uniforms.columnOpacity.value=columnOpacity;uniforms.cloudOpacity.value=cloudOpacity;
      uniforms.origin.value.copy(origin);uniforms.worldScale.value=size;
      uniforms.age.value=puffRollPhase(time,look.rollMotion)/.65;uniforms.glow.value=look.glow;
      const warm=1-Math.max(0,Math.min(1,(time-8)/14));
      const burn=(Math.exp(-time*INNER_LIGHT.decay)+.38*warm*warm)*(late?.heat??1);
      const head=flow.head.height, drift=plumeOffset(head,shapeAge,head), spread=late?.expansion??1;
      fire.centre.set(drift[0],head,drift[1]);
      fire.radius=flow.head.radius;fire.intensity=look.light*burn;
      uniforms.opacity.value=look.density;uniforms.fireLight.value=fire.intensity;
      uniforms.selfShadow.value=look.selfShadow??FIRE_LOOK.selfShadow;
      if(environment?.light) uniforms.sceneTint.value.copy(environment.light);
      uniforms.airDensity.value=scene.fog?.isFogExp2?scene.fog.density:0;
      if(scene.fog) uniforms.airTint.value.copy(scene.fog.color);
      uniforms.lightScatter.value=look.lightScatter??FIRE_LOOK.lightScatter;
      uniforms.coreDensity.value=look.coreDensity??2.5;
      uniforms.headRadius.value=fire.radius;
      // .027*.7*.92/(width*.7*.027) = .92/width, the puff's
      // .46 noise scale over a sphere of diameter width.
      uniforms.billowWidth.value=billowWidth*.7;
      uniforms.shapeAge.value=shapeAge;
      uniforms.heatScale.value=late?.heat??1;uniforms.densityScale.value=late?.density??1;
      uniforms.condensate.value=(late?.liquidExtinction??0)*size/.34;
      uniforms.warp.value.set(late?.referenceHeight??14,late?.referenceJoin??8,late?.head??14,late?.expansion??1);
      uniforms.drift.value.set(late?.wind[0]??0,late?.wind[1]??0);
      if(late){
        bounds.set(extent.x*late.expansion+Math.abs(late.wind[0]),
          late.head+Math.min(extent.y-late.referenceHeight,flow.head.radius*2+12)*late.expansion,
          extent.z*late.expansion+Math.abs(late.wind[1]));
      }else bounds.copy(extent);
      const expansion=ignitionScale(time);
      uniforms.ignition.value=expansion;
      bounds.multiplyScalar(expansion);
      uniforms.headHeight.value=flow.head.height;
      // The scene light sits in the ball, where the late map has carried it.
      light.position.set(drift[0]*spread+(late?.wind[0]??0),late?.head??head,drift[1]*spread+(late?.wind[1]??0))
        .multiplyScalar(size*expansion).add(origin);
      light.distance=285*size*expansion;light.intensity=155000*burn*look.glow*size*size*expansion*expansion;
    },
    get fire(){return fire;},
    clear(){visible=false;slices.forEach(mesh=>{mesh.visible=false;});light.intensity=0;fire.intensity=0;},
    dispose(){scene.remove(...slices,light);geometry.dispose();material.dispose();light.dispose();},
  };
}
