import {Mesh} from 'three';
import {cloneBiome, createTerrainField, createTerrainMaterial, createTerrainWorld} from '../../src/terrain/index.js';
import {createTerrainCollider} from '../../src/terrain/physics.js';
import {loadTerrainPalette} from '../terrain/textures.js';
import {BLAST_CRATER} from './blast-scale.js';
import {createCraterFormation} from './crater-formation.js';

const TERRAIN = {span: 480, resolution: 257, seed: 11};

// The field owns the land and the collider adapter maps its edited samples to Jolt.
export async function createBlastGround({scene, renderer, physics, driver, scale}) {
  const {resolution, seed} = TERRAIN;
  const span = scale?.terrainSpan ?? TERRAIN.span, crater = scale?.crater ?? BLAST_CRATER;
  const half = span / 2, cell = span / (resolution - 1);
  const world = createTerrainWorld({seed, biomes: [cloneBiome('desert')]});
  const heights = Float32Array.from({length: resolution ** 2}, (_, i) =>
    world.heightAt((i % resolution) * cell - half, Math.floor(i / resolution) * cell - half, cell));
  const {textures} = await loadTerrainPalette(renderer, world.palette);
  const field = createTerrainField({
    origin: [-half, -half], size: [span, span], resolution: [resolution, resolution], heights, seed,
    paintAt: world.paintAt, paletteSize: world.palette.size,
  });
  const material = createTerrainMaterial({}, {
    field,
    palette: {...world.palette, means: textures.means},
    layerArray: textures.layerArray,
    layerDetailArray: textures.layerDetailArray,
    detailNormal: textures.detail,
  });
  const mesh = new Mesh(field.geometry, material);
  scene.add(mesh);
  const collider = createTerrainCollider(field);
  const [shape] = collider.shapes;
  const onHeight = (x, z, value) => shape.setHeightValueAtIndex(z, x, value);
  physics.addBody(collider);
  let deformed = false,emitCraterDebris=false,craterX=0,craterZ=0;
  const formation=createCraterFormation(crater,({radius,depth,last})=>{
    emitCraterDebris=last;
    try{
      const result=field.crater(craterX,craterZ,radius,depth,onHeight);
      deformed=Boolean(result)||deformed;
      return result;
    }finally{emitCraterDebris=false;}
  });
  return {
    field, material,
    get emitCraterDebris(){return emitCraterDebris;},
    advanceCrater(x,z,time) {
      craterX=x;craterZ=z;
      if(!formation.advance(time/(scale?.seconds??1)))return;
      field.flushDeformation();
      driver.reshape(collider);
    },
    reset() {
      formation.reset();emitCraterDebris=false;
      if (!deformed) return;
      field.resetDeformation(onHeight);
      driver.reshape(collider);
      deformed = false;
    },
    dispose() {
      physics.removeBody(collider);
      scene.remove(mesh);
      field.dispose();
      material.dispose();
      for (const texture of [textures.layerArray, textures.layerDetailArray, textures.detail, textures.rock]) texture.dispose();
    },
  };
}
