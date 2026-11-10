import * as C from 'cannon-es';

// Construction bounds, before mortar inset. Only upright, orthogonal walls can
// share these course bearings; their authored unit colliders remain unchanged.
function worldBounds(row, unit) {
 const q=new C.Quaternion(...(row.quaternion??[0,0,0,1]));q.normalize();
 const axes=[new C.Vec3(1,0,0),new C.Vec3(0,1,0),new C.Vec3(0,0,1)].map(v=>q.vmult(v));
 if(Math.abs(axes[1].y-1)>1e-6||axes.some(v=>Math.max(Math.abs(v.x),Math.abs(v.y),Math.abs(v.z))<1-1e-6))throw Error('Corner bearings require upright orthogonal wall poses');
 const points=[];
 for(const x of [0,1])for(const y of [0,1])for(const z of [0,1])points.push(q.vmult(new C.Vec3(...[x,y,z].map((end,i)=>unit.bounds[end][i]*(row.assetScale?.[i]??1)))).vadd(new C.Vec3(...row.position)).toArray());
 return [0,1].map(end=>[0,1,2].map(axis=>Math[end?'max':'min'](...points.map(p=>p[axis]))));
}
const bears=(upper,lower)=>Math.abs(upper[0][1]-lower[1][1])<1e-5&&lower[0][1]<upper[0][1]-1e-6&&[0,2].every(a=>Math.min(upper[1][a],lower[1][a])-Math.max(upper[0][a],lower[0][a])>1e-6);

// Assembly data owns cross-panel links. Asset-local neighbours/supports keep
// their existing meaning and IDs; no baked asset needs to reference a house.
export function linkMasonryCorners(rows, assets, panelIds) {
 const get=id=>assets instanceof Map?assets.get(id):assets[id];
 const walls=panelIds.map(panelId=>({panelId,row:rows[panelId],units:get(rows[panelId].assetId).masonry.units}));
 const units=walls.flatMap(w=>w.units.map(u=>({panelId:w.panelId,id:u.id,bounds:worldBounds(w.row,u)})));
 for(const w of walls)w.row.masonrySupports=[];
 for(const upper of units)for(const lower of units)if(upper.panelId!==lower.panelId&&bears(upper.bounds,lower.bounds))rows[upper.panelId].masonrySupports.push({unitId:upper.id,panelId:lower.panelId,supportId:lower.id});
}

function cornerRecords(panels) {
 const linked=panels.filter(p=>p.row.masonrySupports!=null);
 const records=[],lookup=new Map(),key=(p,id)=>`${p}:${id}`;
 for(const p of linked){
  if(!['running_bond','coursed_stone'].includes(p.asset?.masonry?.pattern)||!Array.isArray(p.row.masonrySupports))throw Error('Invalid masonry corner panel');
  for(const u of p.asset.masonry.units){const r={panel:p,unit:u,key:key(p.id,u.id),bounds:worldBounds(p.row,u),supports:u.supports.map(id=>key(p.id,id))};records.push(r);lookup.set(r.key,r);}
 }
 for(const p of linked)for(const edge of p.row.masonrySupports){
  const upper=lookup.get(key(p.id,edge.unitId)),lower=lookup.get(key(edge.panelId,edge.supportId));
  if(!upper||!lower||upper.panel===lower.panel||!bears(upper.bounds,lower.bounds))throw Error('Invalid masonry corner bearing');
  upper.supports.push(lower.key);
 }
 records.sort((a,b)=>a.bounds[0][1]-b.bounds[0][1]);
 return {linked,records,key};
}

export function validateMasonryCornerRows(rows, assets) {
 const get=id=>assets instanceof Map?assets.get(id):assets[id];
 cornerRecords(rows.map((row,id)=>({row,id,asset:get(row.assetId)})));
}

export function connectMasonryCorners(panels) {
 const {linked,records,key}=cornerRecords(panels);
 if(!linked.length)return;
 function grounded(){
  const states=new Map(linked.map(p=>[p,p.masonrySupportState()])),result=new Set();
  for(const r of records){const state=states.get(r.panel);if(!state.released.has(r.unit.id)&&(r.unit.foundation&&state.foundationAvailable||r.supports.some(id=>result.has(id))))result.add(r.key);}
  return result;
 }
 for(const p of linked)p.setMasonryGrounding(()=>{const result=grounded();return new Set(p.asset.masonry.units.filter(u=>result.has(key(p.id,u.id))).map(u=>u.id));});
}
