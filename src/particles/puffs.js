import * as T from 'three';
import {createPuffMaterial} from './puff-material.js';
// Billboard puffs (dust, soft dust, smoke): a fixed sprite pool with per-sprite gravity, growth and fade.
// Sprite sheets are white channel masks tinted per particle. With `assets` (a base URL) the named files below are
// loaded from it; without it every preset uses the bundled soft mask. `sheets: {name: {url, cols, rows}}` adds or overrides.
const SHEETS={dust:{file:'fx-dust.png',cols:2,rows:2},'dust-soft':{file:'fx/hcfx-dust-soft.png',cols:1,rows:1},smoke:{file:'fx/hcfx-smoke.png',cols:2,rows:2}};
// windResponse: share of the environment wind speed a puff drifts at (scaled per emission by opts.wind).
const DEFAULTS={pool:192,windResponse:.3};
const WIND_RAMP=.5;   // seconds before a new puff is carried at full drift, so it does not pop off its emitter
const LIMITS=Object.freeze({pool:2048,sheetFrames:256});
// What emit() uses when a call leaves an option out. The 'dust' mask falls and is fainter; the others hang in the air.
const EMIT_DEFAULTS=Object.freeze({gravity:0,dustGravity:1,grow:.8,opacity:.8,dustOpacity:.45});
const RING_FRAMES=4;   // the ring puffs cycle through the first frames of their sheet
// Presets: `ring` throws `count` puffs outward (outward: m/s per metre of size; up: m/s; jitter: random angle, radians;
// scale: share of size; life: seconds), then `cloud` leaves one soft puff. A pair is a [min, max] range. Options left out
// fall back to EMIT_DEFAULTS.
const MORTAR_RING=Object.freeze({count:5,jitter:.4,outward:.65,up:.55,scale:[.65,1],life:1,gravity:.35,grow:1,opacity:.25});
const MORTAR_CLOUD=Object.freeze({up:.12,scale:1.15,life:2.6,gravity:0,grow:1.1,opacity:.16});
const PRESETS=Object.freeze({
 mortar:{color:0xc7bba2,ring:MORTAR_RING,cloud:MORTAR_CLOUD},
 mortarLanding:{color:0xc7bba2,ring:{...MORTAR_RING,count:2,up:.25,life:.65,opacity:.18},cloud:{...MORTAR_CLOUD,life:1.1,opacity:.12}},
 dust:{color:0xbfb6a8,ring:{count:6,jitter:0,outward:.8,up:1.2,scale:[.7,1.3],life:.9},cloud:{up:.6,scale:1.6,life:1.2,gravity:-.2,grow:1.2,opacity:.5}},
 smoke:{color:0xd8d2c8,ring:{mask:'smoke',count:4,jitter:1,outward:.4,up:[.6,1.4],scale:[.7,1.1],life:[1.4,2],gravity:-.4,grow:.8,opacity:.35}},
});
const pick=value=>Array.isArray(value)?value[0]+Math.random()*(value[1]-value[0]):value;
const BUILTIN_MASK = new URL('../../assets/particles/soft-mask.svg', import.meta.url).href;
const BUILTIN_SHEETS = Object.fromEntries(
 Object.keys(SHEETS).map(name => [name, {url: BUILTIN_MASK, cols: 1, rows: 1}])
);
export async function createPuffs(scene,options={}){
 const {pool,windResponse,assets,loadTexture=url=>new T.TextureLoader().loadAsync(url)}={...DEFAULTS,...options};
 if(!Number.isFinite(windResponse)||windResponse<0)throw Error('Puff windResponse must be non-negative');
 if(!Number.isInteger(pool)||pool<1||pool>LIMITS.pool)throw Error(`Puff pool must be 1..${LIMITS.pool}`);
 const sheets = {...(assets === undefined ? BUILTIN_SHEETS : SHEETS), ...options.sheets};
 const frames=Object.create(null),animated=Object.create(null),owned=[];
 const loaded=await Promise.allSettled(Object.entries(sheets).map(async([name,{url,file,cols=1,rows=1,animate=false,heat=false,billow=false}])=>{
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1 || cols * rows > LIMITS.sheetFrames) {
   throw new Error(`Invalid sprite sheet grid: ${name}`);
  }
  const sheet=await loadTexture(url ?? assets+file);sheet.colorSpace=T.SRGBColorSpace;owned.push(sheet);
  if(animate && cols*rows>1){
   // Use base-level filtering so atlas neighbors cannot bleed through the mip chain.
   sheet.generateMipmaps=false;sheet.minFilter=T.LinearFilter;sheet.needsUpdate=true;
   animated[name]={cols,rows,heat,billow};
   frames[name]=[sheet];
   return;
  }
  frames[name]=Array.from({length:cols*rows},(_,i)=>{const t=sheet.clone();t.repeat.set(1/cols,1/rows);t.offset.set((i%cols)/cols,(rows-1-Math.floor(i/cols))/rows);t.needsUpdate=true;owned.push(t);return t;});}));
 const failure=loaded.find(result=>result.status==='rejected');if(failure){for(const texture of owned)texture.dispose();throw failure.reason;}
 const puffs=[];const hasAnimation=Object.keys(animated).length>0;
 for(let i=0;i<pool;i++){const look=createPuffMaterial(frames.dust[0],hasAnimation);const sprite=new T.Sprite(look.material);sprite.visible=false;scene.add(sprite);puffs.push({...look,sprite,active:false,age:0,life:1,v:new T.Vector3(),base:new T.Color()});}
 // Optional core/environment.js contract, held by reference: wind drifts the puffs, light tints the lit ones. null = neither.
 let disposed=false,environment=options.environment??null;
 // opts: gravity (m/s^2 down, negative rises), grow (scale gain over life), opacity (peak), wind (drift scale, default 1),
 // lit (follows environment.light; default: everything except glowing puffs - heat sheets and additive blending).
 function emit(name,position,velocity,size,life,color,index=0,opts={}){
  if(disposed||!frames[name]||options.isRelevant&&!options.isRelevant(position))return false;const p=puffs.find(p=>!p.active);if(!p)return false;
  p.active=true;p.age=0;p.life=life;p.size=size;p.gravity=opts.gravity??(name==='dust'?EMIT_DEFAULTS.dustGravity:EMIT_DEFAULTS.gravity);p.grow=opts.grow??EMIT_DEFAULTS.grow;p.peak=opts.opacity??(name==='dust'?EMIT_DEFAULTS.dustOpacity:EMIT_DEFAULTS.opacity);p.v.set(velocity[0],velocity[1],velocity[2]);
  p.aspect=opts.aspect??1;p.fadeIn=opts.fadeIn??0;
  const animation=animated[name];
  p.tiles.set(animation?.cols??1,animation?.rows??1);
  p.frame.value=0;p.heat.value=animation?.heat?1:0;p.billow.value=animation?.billow?1:0;
  p.sprite.position.copy(position);p.material.map=frames[name][index%frames[name].length];p.material.opacity=p.fadeIn>0?0:p.peak;p.material.rotation=opts.rotation??Math.random()*Math.PI*2;p.material.blending=opts.blending??T.NormalBlending;
  p.wind=opts.wind??1;p.lit=opts.lit??!(animation?.heat||p.material.blending===T.AdditiveBlending);
  p.base.setHex(color);p.material.color.copy(p.base);if(environment&&p.lit)p.material.color.multiply(environment.light);
  p.sprite.scale.set(size*p.aspect,size,1);p.sprite.visible=true;return true;
 }
 function burst(position,size,color,{ring,cloud}){
  for(let i=0;i<ring.count;i++){
   const angle=i/ring.count*Math.PI*2+Math.random()*ring.jitter,outward=size*ring.outward;
   emit(ring.mask??'dust',position,[Math.cos(angle)*outward,pick(ring.up),Math.sin(angle)*outward],size*pick(ring.scale),pick(ring.life),color,i%RING_FRAMES,{gravity:ring.gravity,grow:ring.grow,opacity:ring.opacity});
  }
  if(cloud)emit('dust-soft',position,[0,cloud.up,0],size*cloud.scale,cloud.life,color,0,{gravity:cloud.gravity,grow:cloud.grow,opacity:cloud.opacity});
 }
 const api={
  emit,
  setEnvironment(next){environment=next??null;},
  // Mortar powder: a brief burst and a restrained, slower residual cloud; a landing is smaller and has fewer puffs.
  mortar(position,size,{landing=false}={}){burst(position,size,PRESETS.mortar.color,landing?PRESETS.mortarLanding:PRESETS.mortar);},
  // Concrete-coloured dust ring at an impact point; size in metres.
  dust(position,size,color=PRESETS.dust.color){burst(position,size,color,PRESETS.dust);},
  // Slow rising smoke/dust cloud for a crushed panel; size in metres.
  smoke(position,size,color=PRESETS.smoke.color){burst(position,size,color,PRESETS.smoke);},
  update(dt){if(disposed)return;const drift=environment?windResponse:0;for(const p of puffs){if(!p.active)continue;p.age+=dt;const t=p.age/p.life;if(t>=1||options.isRelevant&&!options.isRelevant(p.sprite.position)){p.active=false;p.sprite.visible=false;continue;}p.sprite.position.addScaledVector(p.v,dt);p.v.y-=dt*p.gravity;
   if(drift>0){const carried=drift*p.wind*Math.min(1,p.age/WIND_RAMP)*dt;p.sprite.position.x+=environment.wind.x*carried;p.sprite.position.z+=environment.wind.z*carried;}
   if(environment&&p.lit)p.material.color.copy(p.base).multiply(environment.light);
   const fadeIn=p.fadeIn>0?Math.min(1,p.age/p.fadeIn):1;
   const scale=p.size*(1+t*p.grow);
   p.frame.value=t*(p.tiles.x*p.tiles.y-1);
   p.material.opacity=(1-t)*p.peak*fadeIn;p.sprite.scale.set(scale*p.aspect,scale,1);
  }},
  get active(){return puffs.reduce((n,p)=>n+(p.active?1:0),0);},
  clear(){for(const p of puffs){p.active=false;p.sprite.visible=false;}},
  dispose(){if(disposed)return;disposed=true;for(const p of puffs){scene.remove(p.sprite);p.material.dispose();}for(const t of owned)t.dispose();},
 };
 api.tick=api.update;   // former name, kept for existing callers
 return api;
}
