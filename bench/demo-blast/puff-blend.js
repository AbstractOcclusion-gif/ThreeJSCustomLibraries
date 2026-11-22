// Demo-only treatment layered over the particle tool's existing material.
import {PUFF_ROLL_GLSL,puffRollPhase} from './plume-motion.js';
import {BALL_SCATTER_GLSL} from './light-scatter.js';
import {Vector3} from 'three';
import {FIRE_LOOK} from './fire-look.js';
export function installBlastPuffBlend(sprite,puffSelfShadow={value:FIRE_LOOK.selfShadow},puffLightScatter={value:FIRE_LOOK.lightScatter},rollMotion) {
  const material=sprite.material;
  const skirtUpperBlend={value:0},blastRoll={value:0},headRollGain={value:1};
  const cloudLightCoverage={value:0};
  const skirtHeat={value:0};
  const cloudRollClock={value:0},cloudRollPhase={value:0};
  const headDriftDirection={value:1};
  const groundDetailScale={value:1},groundOpticalDepth={value:1};
  const puffViewRay={value:new Vector3(0,0,-1)},eye=new Vector3(),world=new Vector3();
  const beforeRender=sprite.onBeforeRender;
  sprite.onBeforeRender=function(renderer,scene,camera,...rest){
    beforeRender.call(this,renderer,scene,camera,...rest);
    this.getWorldPosition(world);camera.getWorldPosition(eye);
    puffViewRay.value.subVectors(world,eye).normalize();
  };
  const compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey;
  material.customProgramCacheKey=()=>`${cacheKey.call(material)}-blast-upper-blend-v18`;
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer);
    Object.assign(shader.uniforms,{cloudRollClock,cloudRollPhase,skirtHeat,skirtUpperBlend,blastRoll,puffSelfShadow,headRollGain,puffLightScatter,cloudLightCoverage,headDriftDirection,puffViewRay,groundDetailScale,groundOpticalDepth});
    shader.fragmentShader=`uniform vec3 puffViewRay;\nuniform float skirtHeat,skirtUpperBlend,blastRoll,puffSelfShadow,headRollGain,puffLightScatter,cloudLightCoverage,headDriftDirection,groundDetailScale,groundOpticalDepth;\n${BALL_SCATTER_GLSL}\n${PUFF_ROLL_GLSL}\n${shader.fragmentShader}`
      .replace('float angle = puffAge * .65;', 'float angle = mix(puffAge * .65, blastRollPhase(puffAge), blastRoll) * headRollGain;')
      .replace('float alpha = (1.0 - exp(-density * chord * .7)) * edge;',
        'float alpha = (1.0 - exp(-density * chord * .7 * mix(1.0, 2.0, blastRoll) * groundOpticalDepth)) * edge;')
      .replace('vec3 coord = p * .46 + offset;', 'vec3 coord = p * .46 * groundDetailScale + offset;')
      .replace('float grain = texture(puffNoise, face * .46 + offset).r;', `
        float faceAngle=mix(puffAge*.65,blastRollPhase(puffAge),blastRoll)*headRollGain;
        float faceStrength=length(puffRollAxis);
        vec3 faceAxis=puffRollAxis/max(faceStrength,.0001);
        vec3 rolledFace=face*cos(faceAngle)+cross(faceAxis,face)*sin(faceAngle)
          +faceAxis*dot(faceAxis,face)*(1.-cos(faceAngle));
        vec3 grainFace=mix(face,rolledFace,min(1.,faceStrength));
        float grain=texture(puffNoise,grainFace*.46*groundDetailScale+offset).r;
      `)
      .replace('density += smoothstep(.02, .44, body + (coarse - .53) * .85 + (detail - .5) * .24);', `
        // Feather in physical world-up, before rolling the texture lookup.
        // Screen UV feathering rotated the join when the camera tilted.
        float upperShare=smoothstep(0.,.9,(toWorld*q).y);
        density += smoothstep(.02,.44,body+(coarse-.53)*.85+(detail-.5)*.24)
          // Retain billow fingers through the upper overlap instead of
          // uniformly washing the entire junction into a smooth belt.
          *(1.-skirtUpperBlend*.7*upperShare*(.65+.35*smoothstep(.25,.75,coarse)));
      `)
      .replace('vec3 offset = vec3(puffSeed, -puffAge * .05, puffSeed * .33);',
        'vec3 offset = vec3(puffSeed, -mix(puffAge, blastRollPhase(puffAge)/.65, blastRoll) * .05 * headDriftDirection, puffSeed * .33);')
      .replace('return vec4(vec3(light), alpha);', `
        float opticalDepth=0.;
        if(puffSelfShadow>0.) {
          float angle=mix(puffAge*.65,blastRollPhase(puffAge),blastRoll)*headRollGain;
          float strength=length(puffRollAxis);
          vec3 axis=puffRollAxis/max(strength,.0001);
          for(int j=0;j<3;j++) {
            vec3 probe=face+puffSun*(.18+float(j)*.35);
            vec3 rolled=probe*cos(angle)+cross(axis,probe)*sin(angle)
              +axis*dot(axis,probe)*(1.-cos(angle));
            vec3 coord=mix(probe,rolled,min(1.,strength))*.46*groundDetailScale+offset;
            float coarse=texture(puffNoise,coord).r;
            opticalDepth+=smoothstep(.02,.44,1.-length(probe)+(coarse-.53)*.85);
          }
        }
        light=cloudLightResponse(light,opticalDepth*.7,dot(puffViewRay,puffSun),puffSelfShadow,puffLightScatter*cloudLightCoverage);
        // The cap reads as noisy billows; whole-sphere face shading made skirt
        // envelopes read as much larger lobes despite equal texture frequency.
        // Reuse the same-scale grain and the gas's definition curve inside
        // the existing silhouette. Leave the thin perimeter shading intact.
        float skirtDefinition=mix(.55,1.35,smoothstep(.25,.75,grain));
        float skirtLight=cloudLightResponse(1.31,opticalDepth*.7,dot(puffViewRay,puffSun),puffSelfShadow,puffLightScatter*cloudLightCoverage)*skirtDefinition;
        light=mix(light,skirtLight,skirtUpperBlend*.8*smoothstep(.12,.82,chord));
        // Emission stays inside the existing absorbing billow; no extra sprite.
        float ember=skirtHeat*smoothstep(.22,.72,grain);
        vec3 flame=mix(vec3(4.,.35,.015),vec3(12.,4.,.4),smoothstep(.35,.9,ember));
        return vec4(vec3(light)+flame*ember, alpha);
      `);
    shader.fragmentShader=`uniform float cloudRollClock,cloudRollPhase;\n${shader.fragmentShader}`
      .replaceAll('blastRollPhase(puffAge)','mix(blastRollPhase(puffAge),cloudRollPhase,cloudRollClock)');
  };
  return {
    setDetailScale(scale){groundDetailScale.value=scale;},
    setHeat(heat){skirtHeat.value=heat;},
    setClock(age,birthAge){
      cloudRollClock.value=1;
      cloudRollPhase.value=puffRollPhase(age,rollMotion)-puffRollPhase(birthAge,rollMotion);
    },
    setTag(tag) {
      cloudRollClock.value=0;cloudRollPhase.value=0;
      skirtHeat.value=0;
      skirtUpperBlend.value=tag?.kind==='skirt'?1:0;
      blastRoll.value=tag?.kind==='head'||tag?.kind==='skirt'?1:0;
      headRollGain.value=tag?.kind==='head'?(rollMotion?.headGain??-1.6):tag?.kind==='skirt'?(rollMotion?.skirtGain??1.2):1;
      cloudLightCoverage.value=['head','skirt','ground'].includes(tag?.kind)?1:0;
      headDriftDirection.value=tag?.kind==='head'||tag?.kind==='skirt'?-1:1;
      groundDetailScale.value=tag?.kind==='ground'?(tag.base?1.25:1.6):1;
      groundOpticalDepth.value=tag?.kind==='ground'?1.6:1;
    },
  };
}
