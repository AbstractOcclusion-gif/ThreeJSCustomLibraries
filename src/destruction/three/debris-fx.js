import * as T from 'three';
import {createChips} from '../../particles/chips.js';
import {createPuffs} from '../../particles/puffs.js';
export {createChips,createPuffs};
// Mass-driven debris burst tuning: chips per kilogram with bounds, chip size by mass, pop strength by speed.
const BURST={perKg:.25,min:4,max:40,sizeRefKg:60,gMin:4,gMax:30,gPerSpeed:2};
const LANDING_CELL_METERS = .6;
const COLOURS={slab:0x9a9a9a,wall:0xb8b0a4,window:0xbfe3ee,default:0x9a9a9a};
// Debris effects for the structure library: chips (instanced), dust and smoke puffs (sprites). The host
// feeds it simulation events; it never touches physics. Textures load from the stunt FX assets.
export async function createDebrisFX(scene,{chips:chipOptions={},puffs:puffOptions={},colours={},isRelevant=()=>true,maxChips=384,maxEvents=8}={}){
 const chips=createChips(scene,{...chipOptions,isRelevant}),pools=new Map();let ground=null,disposed=false,accepted=0;
 const poolFor=kind=>pools.get(kind)??chips;
 let puffs;try{puffs=await createPuffs(scene,{pool:64,...puffOptions,isRelevant});}catch(error){chips.dispose();throw error;}
 const palette={...COLOURS,...colours},position=new T.Vector3(),velocity=new T.Vector3();
 const at=point=>position.set(point[0],point[1],point[2]);
 const activeChips=()=>chips.active+[...pools.values()].reduce((sum,pool)=>sum+pool.active,0);
 const emitChips=(kind,style,g,v)=>poolFor(kind).emit(position,{...style,chips:Math.min(style.chips??6,Math.max(0,maxChips-activeChips()))},g,v);
 const admit=point=>{if(disposed||accepted>=maxEvents||!point)return false;at(point);if(!isRelevant(position))return false;accepted++;return true;};
 return{
  chips,puffs,
  registerChips(kind,options){if(disposed||pools.has(kind))return;pools.set(kind,createChips(scene,{...chipOptions,...options,isRelevant}));if(ground)pools.get(kind).setGround(ground);},
  // A physical component below the chip threshold left the simulation: throw its mass as chips.
  chipsBurst({point,mass,velocity:v=[0,0,0],kind}){if(!admit(point))return 0;velocity.set(...(v??[0,0,0]));const speed=velocity.length(),g=Math.min(BURST.gMax,BURST.gMin+speed*BURST.gPerSpeed);
   return emitChips(kind,{color:pools.has(kind)?0xffffff:palette[kind]??palette.default,size:Math.cbrt(Math.max(.1,mass/BURST.sizeRefKg)),chips:Math.min(BURST.max,Math.max(BURST.min,mass*BURST.perKg))},g,velocity);},
  // A measured collision: dust proportional to the energy (J).
  impact({point,energy=0,kind,velocity:v}){if(!admit(point))return;
   if(kind==='brick'){puffs.mortar(position,Math.min(1.25,.4+Math.sqrt(Math.max(0,energy))*.003));velocity.set(...(v??[0,0,0])).clampLength(0,4);emitChips(kind,{color:pools.has(kind)?0xffffff:palette[kind]??0xb76740,size:1,chips:Math.min(24,12+Math.floor(Math.sqrt(Math.max(0,energy))*.03))},8,velocity);}
   else puffs.dust(position,Math.min(4,.6+Math.sqrt(Math.max(0,energy))*.01));},
  landing({point,energy=0,kind}){if(kind!=='brick'||!admit(point))return;puffs.mortar(position,Math.min(.65,.15+Math.sqrt(Math.max(0,energy))*.007),{landing:true});},
  // A crushed panel: a slow dust cloud proportional to the panel mass (kg) plus a small chip spray.
  fracture({point,mass=0,velocity:v=[0,0,0],kind}){if(!admit(point))return;velocity.set(...(v??[0,0,0]));if(kind==='brick'){puffs.mortar(position,.35,{landing:true});return;}puffs.smoke(position,Math.min(3,.6+Math.sqrt(Math.max(0,mass))*.03));emitChips(kind,{color:pools.has(kind)?0xffffff:palette[kind]??palette.default,size:.8,chips:2},8,velocity);},
  handle(events){
   // Prefer primary hits over landings during a large release. A fracture from
   // the same panel/step must not create a second cloud at the chunk centre.
   const hits=new Set(events.filter(e=>e.type==='floor:impact'&&e.kind==='brick').map(e=>`${e.panelId}:${e.time}`)),cells=new Set();
   const ordered=[...events.filter(e=>e.type!=='floor:landing'),...events.filter(e=>e.type==='floor:landing')];
   for (const event of ordered) {
    if (!event.point) continue;
    switch (event.type) {
     case 'floor:chips':
      this.chipsBurst(event);
      break;
     case 'floor:impact':
      this.impact(event);
      break;
     case 'floor:fractured':
      if (event.kind !== 'brick' || !hits.has(`${event.panelId}:${event.time}`)) this.fracture(event);
      break;
     case 'floor:landing': {
      const cell = event.point.map(coordinate => Math.floor(coordinate / LANDING_CELL_METERS)).join(':');
      if (cells.has(cell)) break;
      cells.add(cell);
      this.landing(event);
      break;
     }
    }
   }
  },
  tick(dt){accepted=0;chips.tick(dt);for(const pool of pools.values())pool.tick(dt);puffs.tick(dt); },
  get activeChips(){return activeChips();},
  setGround(fn){ground=fn;chips.setGround(fn);for(const pool of pools.values())pool.setGround(fn); },
  clear(){accepted=0;chips.clear();for(const pool of pools.values())pool.clear();puffs.clear();},
  dispose(){if(disposed)return;disposed=true;chips.dispose();for(const pool of pools.values())pool.dispose();puffs.dispose();pools.clear();},
 };
}
