import * as T from 'three';

export function createThreeStructureView({system,scene}){
 const geometry=new T.BoxGeometry(1,1,1),roots=[],debris=[],materials=[],baseColors={chord:0x67b1bd,vertical:0x67b1bd,endpost:0xd6a15e,diagonal:0xc2ccd1,brace:0x65818e,floor:0x476673,bar:0x67b1bd};
 const timber=new T.MeshStandardMaterial({color:0x77614a,roughness:.95});materials.push(timber);
 function box(group,size,position,material){const mesh=new T.Mesh(geometry,material);mesh.scale.set(...size);mesh.position.set(...position);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}
 function steel(group,m,length,material){
  if(['chord','vertical','endpost','floor','bar'].includes(m.type)){
   box(group,[m.thickness,length,m.thickness*.25],[0,0,0],material);
   for(const sign of [-1,1])box(group,[m.thickness*1.7,length,m.thickness*.2],[0,0,sign*m.thickness*.5],material);
  }else box(group,[m.thickness,length,m.thickness],[0,0,0],material);
 }
 for(const m of system.members){const group=new T.Group(),color=new T.Color(baseColors[m.type]??baseColors.bar),material=new T.MeshStandardMaterial({color,metalness:.55,roughness:.45});materials.push(material);group.userData={id:m.id,steel:material,baseColor:color};steel(group,m,m.length-.45,material);
  // Generic attached box shapes; deck boards visually subdivide the slab collider.
  for(const shape of system.definition.members[m.id].boxes??[]){const [x,y,z]=shape.halfExtents,[ox,oy,oz]=shape.offset;const count=m.deck?24:1;for(let i=0;i<count;i++)box(group,[x*2/count*.96,y*2,z*2],[ox-x+(i+.5)*x*2/count,oy,oz],timber);}
  roots.push(group);scene.add(group);
 }
 let disposed=false;
 function update({hover=null}={}){if(disposed)return;
  for(const m of system.members){const group=roots[m.id];group.position.copy(m.body.position);group.quaternion.copy(m.body.quaternion);group.userData.steel.color.copy(group.userData.baseColor).lerp(new T.Color(0xf25438),m.failed?1:Math.min(1,m.load)*.8);group.userData.steel.emissive.setHex(group===hover?0x664422:0);
   if(m.fragments&&!group.userData.fractureDrawn){group.userData.fractureDrawn=true;group.visible=false;for(const f of m.fragments){const view=new T.Group();view.userData.body=f.body;steel(view,m,f.length,group.userData.steel);scene.add(view);debris.push(view);}}
  }
  for(const view of debris){view.position.copy(view.userData.body.position);view.quaternion.copy(view.userData.body.quaternion);}
 }
 update();
 return{members:roots,update,dispose(){if(disposed)return;disposed=true;for(const root of [...roots,...debris])scene.remove(root);for(const m of materials)m.dispose();geometry.dispose();}};
}
