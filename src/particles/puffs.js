import * as T from 'three';
import {createPuffMaterial} from './puff-material.js';
// Billboard puffs (dust, soft dust, smoke): a fixed sprite pool with per-sprite gravity, growth and fade.
// Sprite sheets are white channel masks tinted per particle. With `assets` (a base URL) the named files below are
// loaded from it; without it every preset uses the bundled soft mask. `sheets: {name: {url, cols, rows}}` adds or overrides.
const SHEETS={dust:{file:'fx-dust.png',cols:2,rows:2},'dust-soft':{file:'fx/hcfx-dust-soft.png',cols:1,rows:1},smoke:{file:'fx/hcfx-smoke.png',cols:2,rows:2}};
const DEFAULTS={pool:192};
const BUILTIN_MASK = new URL('../../assets/particles/soft-mask.svg', import.meta.url).href;
const BUILTIN_SHEETS = Object.fromEntries(
 Object.keys(SHEETS).map(name => [name, {url: BUILTIN_MASK, cols: 1, rows: 1}])
);
export async function createPuffs(scene,options={}){
 const {pool,assets,loadTexture=url=>new T.TextureLoader().loadAsync(url)}={...DEFAULTS,...options};
 if(!Number.isInteger(pool)||pool<1||pool>2048)throw Error('Puff pool must be 1..2048');
 const sheets = {...(assets === undefined ? BUILTIN_SHEETS : SHEETS), ...options.sheets};
 const frames=Object.create(null),animated=Object.create(null),owned=[];
 const loaded=await Promise.allSettled(Object.entries(sheets).map(async([name,{url,file,cols=1,rows=1,animate=false,heat=false,billow=false}])=>{
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1 || cols * rows > 256) {
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
 for(let i=0;i<pool;i++){const look=createPuffMaterial(frames.dust[0],hasAnimation);const sprite=new T.Sprite(look.material);sprite.visible=false;scene.add(sprite);puffs.push({...look,sprite,active:false,age:0,life:1,v:new T.Vector3()});}
 let disposed=false;
 // opts: gravity (m/s^2 down, negative rises), grow (scale gain over life), opacity (peak).
 function emit(name,position,velocity,size,life,color,index=0,opts={}){
  if(disposed||!frames[name]||options.isRelevant&&!options.isRelevant(position))return false;const p=puffs.find(p=>!p.active);if(!p)return false;
  p.active=true;p.age=0;p.life=life;p.size=size;p.gravity=opts.gravity??(name==='dust'?1:0);p.grow=opts.grow??.8;p.peak=opts.opacity??(name==='dust'?.45:.8);p.v.set(velocity[0],velocity[1],velocity[2]);
  p.aspect=opts.aspect??1;p.fadeIn=opts.fadeIn??0;
  const animation=animated[name];
  p.tiles.set(animation?.cols??1,animation?.rows??1);
  p.frame.value=0;p.heat.value=animation?.heat?1:0;p.billow.value=animation?.billow?1:0;
  p.sprite.position.copy(position);p.material.map=frames[name][index%frames[name].length];p.material.color.setHex(color);p.material.opacity=p.fadeIn>0?0:p.peak;p.material.rotation=opts.rotation??Math.random()*6.28;p.material.blending=opts.blending??T.NormalBlending;
  p.sprite.scale.set(size*p.aspect,size,1);p.sprite.visible=true;return true;
 }
 return{
  emit,
  // Mortar powder uses the existing masks: a brief burst and a restrained,
  // slower residual cloud. Landing puffs are deliberately smaller and fewer.
  mortar(position,size,{landing=false}={}){
   const count=landing?2:5;
   for(let i=0;i<count;i++){const a=i/count*Math.PI*2+Math.random()*.4;emit('dust',position,[Math.cos(a)*size*.65,landing?.25:.55,Math.sin(a)*size*.65],size*(.65+Math.random()*.35),landing?.65:1,0xc7bba2,i%4,{gravity:.35,grow:1,opacity:landing?.18:.25});}
   emit('dust-soft',position,[0,.12,0],size*1.15,landing?1.1:2.6,0xc7bba2,0,{gravity:0,grow:1.1,opacity:landing?.12:.16});
  },
  // Concrete-coloured dust ring at an impact point; size in metres.
  dust(position,size,color=0xbfb6a8){for(let i=0;i<6;i++){const a=i/6*Math.PI*2;emit('dust',position,[Math.cos(a)*size*.8,1.2,Math.sin(a)*size*.8],size*(.7+Math.random()*.6),.9,color,i%4);}emit('dust-soft',position,[0,.6,0],size*1.6,1.2,color,0,{gravity:-.2,grow:1.2,opacity:.5});},
  // Slow rising smoke/dust cloud for a crushed panel; size in metres.
  smoke(position,size,color=0xd8d2c8){for(let i=0;i<4;i++){const a=i/4*Math.PI*2+Math.random();emit('smoke',position,[Math.cos(a)*size*.4,.6+Math.random()*.8,Math.sin(a)*size*.4],size*(.7+Math.random()*.4),1.4+Math.random()*.6,color,i%4,{gravity:-.4,grow:.8,opacity:.35});}},
  tick(dt){if(disposed)return;for(const p of puffs){if(!p.active)continue;p.age+=dt;const t=p.age/p.life;if(t>=1||options.isRelevant&&!options.isRelevant(p.sprite.position)){p.active=false;p.sprite.visible=false;continue;}p.sprite.position.addScaledVector(p.v,dt);p.v.y-=dt*p.gravity;
   const fadeIn=p.fadeIn>0?Math.min(1,p.age/p.fadeIn):1;
   const scale=p.size*(1+t*p.grow);
   p.frame.value=t*(p.tiles.x*p.tiles.y-1);
   p.material.opacity=(1-t)*p.peak*fadeIn;p.sprite.scale.set(scale*p.aspect,scale,1);
  }},
  get active(){return puffs.reduce((n,p)=>n+(p.active?1:0),0);},
  clear(){for(const p of puffs){p.active=false;p.sprite.visible=false;}},
  dispose(){if(disposed)return;disposed=true;for(const p of puffs){scene.remove(p.sprite);p.material.dispose();}for(const t of owned)t.dispose();},
 };
}
