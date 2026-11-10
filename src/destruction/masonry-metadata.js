// Optional v2 extension: physical unit identities survive merged cluster rendering.
export function readMasonryMetadata(input,asset){
 const m=input.masonry;if(m==null)return undefined;
 const fail=message=>{throw Error('Invalid masonry: '+message);};
 const vec=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
 if(m.version!==1||!['running_bond','coursed_stone','rubble_stone'].includes(m.pattern)||!Array.isArray(m.units)||!Array.isArray(m.clusters))fail('header');
 const rubble=m.pattern==='rubble_stone',height=u=>(u.bounds[0][1]+u.bounds[1][1])/2;
 if(rubble&&(asset.material!=='stone_rubble'||!vec(m.settings?.unitSizeM)||!m.settings.unitSizeM.every(n=>n>0)||!Number.isFinite(m.settings.irregularity)||m.settings.irregularity<0||m.settings.irregularity>1))fail('fieldstone dimensions/irregularity');
 if(m.pattern==='coursed_stone'&&(asset.material!=='stone_dressed'||!vec(m.settings?.unitSizeM)||!m.settings.unitSizeM.every(n=>n>0)||!Number.isFinite(m.settings.lengthVariation)||m.settings.lengthVariation<0||m.settings.lengthVariation>.6))fail('coursed stone dimensions/variation');
 const pieces=new Map(asset.pieces.map(p=>[p.id,p])),units=new Map(),clusters=new Map(),renderIds=new Set(),nodes=new Set(asset.intact.nodes);
 for(const c of m.clusters){if(typeof c.id!=='string'||clusters.has(c.id)||typeof c.node!=='string'||nodes.has(c.node)||!Array.isArray(c.unitIds)||!c.unitIds.length||new Set(c.unitIds).size!==c.unitIds.length||!Array.isArray(c.neighbours))fail('cluster');clusters.set(c.id,c);nodes.add(c.node);}
 for(const u of m.units){
  if(!pieces.has(u.id)||units.has(u.id)||!clusters.has(u.clusterId)||!Number.isInteger(u.renderId)||u.renderId<0||renderIds.has(u.renderId)||!Array.isArray(u.bounds)||u.bounds.length!==2||!u.bounds.every(vec)||!u.bounds[0].every((n,i)=>n<u.bounds[1][i])||!Array.isArray(u.supports)||!Array.isArray(u.neighbours)||typeof u.foundation!=='boolean')fail('unit');
  if(pieces.get(u.id).node!==clusters.get(u.clusterId).node)fail('render node');
  if(u.miniParent!==clusters.get(u.clusterId).miniParent)fail('unit mini-cluster attachment');
  if(!Number.isInteger(u.renderVertices)||u.renderVertices<3||u.renderVertices%3)fail('render vertex budget');
  if(rubble&&(!Array.isArray(u.outline)||u.outline.length<3||u.outline.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p.some((n,k)=>n<u.bounds[0][k]-1e-5||n>u.bounds[1][k]+1e-5))))fail('fieldstone outline');
  renderIds.add(u.renderId);units.set(u.id,u);
 }
 if(units.size!==pieces.size)fail('unit coverage');
 for(const u of units.values()){
  if(new Set(u.supports).size!==u.supports.length||new Set(u.neighbours).size!==u.neighbours.length)fail('duplicate interface');
  for(const id of u.neighbours)if(id===u.id||!units.has(id)||!units.get(id).neighbours.includes(u.id))fail('neighbour');
  for(const id of u.supports){const below=units.get(id);if(!below||!u.neighbours.includes(id))fail('downward support');
   if(rubble){const joint=input.bonds.find(b=>b.a===id&&b.b===u.id||b.b===id&&b.a===u.id);if(height(below)>=height(u)-1e-6||!joint||Math.abs(joint.normal[1])<=1e-5||!sharedEdge(u.outline,below.outline))fail('fieldstone downward joint');}
   else if(Math.abs(below.bounds[1][1]-u.bounds[0][1])>1e-5||below.bounds[0][1]>=u.bounds[0][1]||[0,2].some(k=>Math.min(below.bounds[1][k],u.bounds[1][k])-Math.max(below.bounds[0][k],u.bounds[0][k])<=1e-6))fail('downward support');}
  if(rubble)for(const id of u.neighbours)if(!sharedEdge(u.outline,units.get(id).outline))fail('fieldstone shared joint');
 }
 const assigned=new Set();
 for(const c of clusters.values()){
  for(const id of c.unitIds){if(!units.has(id)||units.get(id).clusterId!==c.id||assigned.has(id))fail('cluster membership');assigned.add(id);}
  for(const id of c.neighbours)if(!clusters.has(id)||id===c.id||!clusters.get(id).neighbours.includes(c.id))fail('cluster adjacency');
  if(c.miniParent!=null&&(!clusters.has(c.miniParent)||!c.neighbours.includes(c.miniParent)||c.miniParent===c.id||!Number.isFinite(c.releaseDelay)||c.releaseDelay<0||c.releaseDelay>1||c.unitIds.length>3))fail('mini-cluster attachment');
  const seen=new Set(),pending=[c.unitIds[0]];while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);pending.push(...units.get(id).neighbours.filter(n=>!seen.has(n)&&units.get(n).clusterId===c.id));}
  if(seen.size!==c.unitIds.length)fail('disconnected cluster');
 }
 if(assigned.size!==units.size||![...units.values()].some(u=>u.foundation))fail('coverage/foundation');
 if(m.facade){const f=m.facade;if(![1,2,3].includes(f.version)||typeof f.node!=='string'||!f.node||nodes.has(f.node)||f.materialId!=='render'||f.faces!=='front'||!Number.isFinite(f.thicknessM)||f.thicknessM<.002||f.thicknessM>.05||!Number.isInteger(f.revealBorder)||f.revealBorder<0||f.revealBorder>2)fail('facade');
  if(f.version>=2){
   if(!Number.isFinite(f.shardSizeM)||f.shardSizeM<.12||f.shardSizeM>.8)fail('facade sheet');
   if(f.version===3&&(!Array.isArray(f.variants)||!f.variants.length||f.variants.length>9||!f.variants.some(v=>v.node===f.node)))fail('facade webs');
   const webIds=new Set(),webNodes=new Set(nodes);
   for(const pattern of f.version===3?f.variants:[f]){
   if(f.version===3){if(typeof pattern.id!=='string'||webIds.has(pattern.id)||typeof pattern.node!=='string'||!pattern.node||webNodes.has(pattern.node)||!Array.isArray(pattern.origin)||pattern.origin.length!==2||!pattern.origin.every(Number.isFinite))fail('facade web');webIds.add(pattern.id);webNodes.add(pattern.node);}
   if(!Array.isArray(pattern.patches)||!pattern.patches.length||pattern.patches.length>4096)fail('facade sheet');
   const patches=new Map(),renderIds=new Set(),covered=new Set();
   for(const p of pattern.patches){
    if(typeof p.id!=='string'||!p.id||patches.has(p.id)||!Number.isInteger(p.renderId)||p.renderId<0||renderIds.has(p.renderId)||!Array.isArray(p.outline)||p.outline.length<3||p.outline.some(v=>!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite))||!Array.isArray(p.unitIds)||!p.unitIds.length||new Set(p.unitIds).size!==p.unitIds.length||p.unitIds.some(id=>!units.has(id))||!Array.isArray(p.neighbours)||new Set(p.neighbours).size!==p.neighbours.length||!Number.isFinite(p.areaM2)||p.areaM2<=0)fail('facade patch');
    const area=Math.abs(p.outline.reduce((sum,a,i)=>{const b=p.outline[(i+1)%p.outline.length];return sum+a[0]*b[1]-a[1]*b[0];},0))/2;
    if(Math.abs(area-p.areaM2)>Math.max(1e-8,area*1e-5))fail('facade patch area');
    patches.set(p.id,p);renderIds.add(p.renderId);for(const id of p.unitIds)covered.add(id);
   }
   for(const p of patches.values())for(const id of p.neighbours)if(id===p.id||!patches.has(id)||!patches.get(id).neighbours.includes(p.id)||!sharedEdge(p.outline,patches.get(id).outline))fail('facade patch joint');
   if(covered.size!==units.size)fail('facade patch coverage');
   }
  }
 }
 return structuredClone(m);
}

function sharedEdge(a,b){
 for(let i=0;i<a.length;i++){
  const p=a[i],q=a[(i+1)%a.length],dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);if(length<1e-7)continue;
  for(let j=0;j<b.length;j++){
   const r=b[j],s=b[(j+1)%b.length];if([r,s].some(v=>Math.abs(dx*(v[1]-p[1])-dy*(v[0]-p[0]))/length>2e-6))continue;
   const t=v=>((v[0]-p[0])*dx+(v[1]-p[1])*dy)/length,x=t(r),y=t(s);
   if(Math.min(length,Math.max(x,y))-Math.max(0,Math.min(x,y))>1e-5)return true;
  }
 }
 return false;
}
