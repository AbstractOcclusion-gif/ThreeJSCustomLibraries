import * as T from 'three';

export function createThreeBendableView({member,scene}){
 const round=member.profile.section==='round',geometry=round?new T.CylinderGeometry(1,1,1,20):new T.BoxGeometry(1,1,1),materials=[],roots=[];if(round)geometry.rotateZ(-Math.PI/2);
 for(const s of member.segments){const group=new T.Group(),material=new T.MeshStandardMaterial({color:0x67b1bd,metalness:round?.05:.6,roughness:round?.85:.4});materials.push(material);
  if(round){const mesh=new T.Mesh(geometry,material);mesh.scale.set(s.length,member.profile.height/2,member.profile.width/2);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}
  else for(const [size,y]of [[[s.length*.99,member.profile.height*.18,member.profile.width*1.7],member.profile.height*.41],[[s.length*.99,member.profile.height*.18,member.profile.width*1.7],-member.profile.height*.41],[[s.length*.99,member.profile.height*.82,member.profile.width*.22],0]]){
   const mesh=new T.Mesh(geometry,material);mesh.scale.set(...size);mesh.position.y=y;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
  }scene.add(group);roots.push(group);
 }
 let disposed=false;
 const view={roots,update(){if(disposed)return;for(let i=0;i<roots.length;i++){const group=roots[i],body=member.segments[i].body;group.position.copy(body.position);group.quaternion.copy(body.quaternion);const adjacent=member.hinges.filter(h=>h.a===body||h.b===body);materials[i].color.setHex(adjacent.some(h=>h.broken)?0xe16b55:adjacent.some(h=>h.yielded)?0xe8b965:round?member.profile.color??0x93744c:0x67b1bd);}},dispose(){if(disposed)return;disposed=true;for(const root of roots)scene.remove(root);for(const material of materials)material.dispose();geometry.dispose();}};view.update();return view;
}
