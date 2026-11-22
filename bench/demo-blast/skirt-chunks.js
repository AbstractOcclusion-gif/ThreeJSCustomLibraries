import {Matrix4,MeshStandardMaterial,Quaternion,TetrahedronGeometry,Vector3} from 'three';
import {createChips,createParticlePrefab,createPuffs} from '../../src/particles/index.js';
import {PREFAB_SHEETS} from '../../src/particles/prefabs.js';

export const SKIRT_CHUNKS=Object.freeze({count:4,trailPool:64,life:18,gravity:.16,spacing:.9,end:28});

// A bounded composition of the existing chip trajectory and smoke prefab.
// One-slot chip pools expose an unambiguous public BatchedMesh matrix (slot 0)
// for following each fragment; the shared smoke pool is advanced only once.
export async function createSkirtChunks(scene,{environment,size=1,seconds=1,heightAt,loadTexture}={}) {
  const smoke=await createPuffs(scene,{environment,pool:SKIRT_CHUNKS.trailPool,
    sheets:{plume:PREFAB_SHEETS.plume},...(loadTexture&&{loadTexture})});
  const geometry=new TetrahedronGeometry(.85*size,0);
  const material=new MeshStandardMaterial({color:0x635747,roughness:1,flatShading:true});
  const matrix=new Matrix4(),position=new Vector3(),velocity=new Vector3(),orientation=new Quaternion();
  const followers=[];
  // Prefabs emit their existing recipe into one pool; this host owns its clock.
  const emitterPool={emit:(...args)=>smoke.emit(...args),update(){},clear(){},dispose(){},setEnvironment(){}};
  for(let i=0;i<SKIRT_CHUNKS.count;i++) {
    let mesh;
    const proxy={add(object){mesh=object;scene.add(object);},remove(object){scene.remove(object);}};
    const chips=createChips(proxy,{pool:1,authored:true,geometry,material,
      gravity:SKIRT_CHUNKS.gravity*size/(seconds*seconds),life:[SKIRT_CHUNKS.life*seconds,SKIRT_CHUNKS.life*seconds],bounce:0});
    chips.setGround(heightAt);
    const trail=await createParticlePrefab(scene,'smoke',{size:size*.65,opacity:.85,makePuffs:async()=>emitterPool});
    trail.stop();followers.push({chips,mesh,trail});
  }
  let emitted=0,nextEmission=0;
  return {
    update(dt,referenceAge,sampleEdge) {
      if(sampleEdge&&emitted<followers.length&&referenceAge<SKIRT_CHUNKS.end&&referenceAge>=nextEmission&&sampleEdge(position,emitted)) {
        const follower=followers[emitted],angle=emitted*2.399963;
        velocity.set(Math.cos(angle)*.7*size/seconds,-.35*size/seconds,Math.sin(angle)*.7*size/seconds);
        follower.chips.emitPiece(geometry,position,orientation,velocity);
        follower.trail.position.copy(position);follower.trail.start();
        emitted++;nextEmission=referenceAge+SKIRT_CHUNKS.spacing;
      }
      for(const follower of followers) {
        follower.chips.update(dt);
        if(follower.chips.active){
          follower.mesh.getMatrixAt(0,matrix);
          follower.trail.position.setFromMatrixPosition(matrix);
        }else follower.trail.stop();
        follower.trail.update(dt);
      }
      smoke.update(dt);
    },
    get active(){return followers.reduce((n,f)=>n+f.chips.active,0);},
    clear(){emitted=0;nextEmission=0;for(const f of followers){f.chips.clear();f.trail.stop();f.trail.clear();}smoke.clear();},
    dispose(){for(const f of followers){f.trail.dispose();f.chips.dispose();}smoke.dispose();geometry.dispose();material.dispose();},
  };
}
