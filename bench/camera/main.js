import * as T from 'three';
import {createCameraDirector,createFollowRig,createOrbitRig} from '../../src/camera/director.js';
import {createReplay} from '../../src/camera/replay.js';
import {createCameraPost} from '../../src/camera/post.js';
import {createCameraCollision} from '../../src/camera/collision.js';
import {createCameraPanel} from '../../src/camera/panel.js';
import '../../src/camera/panel.css';
import '../ui-demo.js';
import {bindResize} from '../kit/page.js';
const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;document.body.append(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#a7c3c9');scene.add(new T.HemisphereLight(0xffffff,0x617451,2));const sun=new T.DirectionalLight(0xffe6c2,2.5);sun.position.set(6,12,8);scene.add(sun);
const camera=new T.PerspectiveCamera(55,innerWidth/innerHeight,.1,300);camera.position.set(12,8,-14);
const subject=new T.Mesh(new T.SphereGeometry(.85,16,12),new T.MeshStandardMaterial({color:0xff761a,roughness:.5}));scene.add(subject);
const floor=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0x91ac75,roughness:1}));floor.rotation.x=-Math.PI/2;scene.add(floor);
const wall=new T.Mesh(new T.BoxGeometry(1,6,14),new T.MeshStandardMaterial({color:0x829398,roughness:.9}));wall.position.set(-5,3,0);scene.add(wall);
const grid=new T.GridHelper(80,40,0x78926e,0x78926e);grid.position.y=.01;scene.add(grid);
const director=createCameraDirector(camera),replay=createReplay({cameraIds:['recorded','side','behind','orbit']}),post=createCameraPost(renderer),target=new T.Vector3(),ray=new T.Raycaster(),direction=new T.Vector3();let time=0,replayPose=null,previous='auto';
director.register('auto',createFollowRig()).register('side',createFollowRig({offset:[18,6,0]})).register('behind',createFollowRig({offset:[0,4,-14]})).register('orbit',createOrbitRig()).register('recorded',()=>replayPose);
const raycast=(a,b)=>{direction.subVectors(b,a);ray.set(a,direction.normalize());ray.far=a.distanceTo(b);const hit=ray.intersectObject(wall)[0];return hit?.distance??Infinity;};
const collide=createCameraCollision({raycast});
const recordRigs={side:createFollowRig({offset:[18,6,0]}),behind:createFollowRig({offset:[0,4,-14]}),orbit:createOrbitRig()},recordCameras={},clearance=Object.fromEntries(Object.keys(recordRigs).map(id=>[id,createCameraCollision({raycast})]));
director.setCollision((a,b,out,dt)=>{if(replay.active&&director.selected==='recorded')return out.copy(b);collide(a,b,out,dt);out.y=Math.max(.4,out.y);return out;});
replay.bind([subject]);
const panel=createCameraPanel({director,replay,post,shots:['auto','side','behind','orbit','recorded'],floating:true,
 onReplay(){if(!replay.begin(camera))return;previous=director.selected;replayPose=replay.seek(0);director.reset();director.select('recorded',{duration:0});},
 onExit(){replay.end(camera);director.reset();director.select(previous,{duration:0});},onSeek:p=>replayPose=p});panel.root.open=true;
const clock=new T.Clock();renderer.setAnimationLoop(()=>{const dt=Math.min(.05,clock.getDelta());if(document.hidden)return;
 if(replay.active){replayPose=replay.update(dt*director.tick(dt));director.update(dt,{target:replayPose.target});}
 else{time+=dt*director.tick(dt);subject.position.set(Math.sin(time*.5)*8,1+Math.abs(Math.sin(time*1.3))*3,Math.cos(time*.5)*8);subject.rotation.y=time;target.copy(subject.position);director.update(dt,{target});for(const [id,rig]of Object.entries(recordRigs)){const pose=rig({dt,data:{target}}),out=recordCameras[id]??=camera.clone();out.copy(pose);clearance[id](target,pose.position,out.position,dt);out.position.y=Math.max(.4,out.position.y);out.lookAt(target);}replay.capture(time,camera,target,recordCameras);}
 scene.updateMatrixWorld(true);post.render(scene,camera,dt);panel.update();
});
const unbindResize=bindResize(renderer,camera);
addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);unbindResize();panel.dispose();if(replay.active)replay.end(camera);replay.clear();post.dispose();const geometries=new Set(),materials=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();scene.clear();sun.dispose();renderer.dispose();},{once:true});
