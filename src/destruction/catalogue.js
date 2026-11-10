// Pure selection: placement, supports and physics remain the blueprint's responsibility.
export function validateCatalogue(data){
 if(data?.schema!=='glider.structures.catalogue'||data.version!==1||!Array.isArray(data.assets))throw Error('Invalid structure catalogue');
 const ids=new Set(),keys=new Set();
 for(const a of data.assets){
  if(!a||typeof a.id!=='string'||!/^[a-z0-9_]+$/.test(a.id)||ids.has(a.id)||typeof a.type!=='string'||!a.type||typeof a.materialId!=='string'||!a.materialId||!Array.isArray(a.sizeMm)||a.sizeMm.length!==3||!a.sizeMm.every(n=>Number.isInteger(n)&&n>0)||!Number.isInteger(a.variant)||a.variant<0)throw Error('Invalid or duplicate catalogue part');
  for(const key of ['model','definition'])if(typeof a[key]!=='string'||!a[key]||a[key].includes('..')||a[key].startsWith('/')||a[key].includes('\\'))throw Error('Invalid catalogue asset path');
  const key=JSON.stringify([a.type,a.materialId,a.sizeMm,a.variant]);if(keys.has(key))throw Error('Duplicate catalogue selection key');keys.add(key);ids.add(a.id);
 }
 return data;
}
function hash(text){let n=2166136261;for(let i=0;i<text.length;i++){n^=text.charCodeAt(i);n=Math.imul(n,16777619);}return n>>>0;}
export function resolvePart(catalogue,{type,materialId,sizeMm,seed=0,placementId='',variant}={}){
 validateCatalogue(catalogue);
 if(!Array.isArray(sizeMm)||sizeMm.length!==3||!sizeMm.every(n=>Number.isInteger(n)&&n>0)||!Number.isSafeInteger(seed)||typeof placementId!=='string'||variant!=null&&(!Number.isInteger(variant)||variant<0))throw Error('Invalid part request');
 const candidates=catalogue.assets.filter(a=>a.type===type&&a.materialId===materialId&&a.sizeMm.every((n,i)=>n===sizeMm[i])&&(variant==null||a.variant===variant)).sort((a,b)=>a.variant-b.variant||(a.id<b.id?-1:a.id>b.id?1:0));
 if(!candidates.length)throw Error(`No structure part for ${type}/${materialId}/${sizeMm.join('x')}`);
 return candidates[hash(JSON.stringify([seed,placementId]))%candidates.length];
}
