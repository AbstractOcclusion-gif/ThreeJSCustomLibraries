import {setupMobileControls} from './mobile-controls.js';
import {bindSceneTap} from './scene-tap.js';
import {createBrowserPerformance} from './browser-performance.js';
import * as T from 'three';
import * as C from 'cannon-es';
import {CATALOGUE_HOUSES,resolveCatalogueHouse,createCatalogueHouseDefinition} from '../../src/destruction/catalogue-houses.js';
import {createThreeBendableStructureView} from '../../src/destruction/three/assemblies.js';
import {resolveStairFlight,createStairFlightDefinition} from '../../src/destruction/stairs.js';
import {createAssemblyClient} from './assembly-client.js';
import {housePhysicsOptions} from './house-options.js';
import {createRoofTilesView} from '../../src/destruction/three/roof-tiles.js';
import {structureAtlasRect} from '../../src/destruction/three/atlas.js';
import {createStructureDebrisBindings} from '../../src/destruction/three/debris.js';
import {STRUCTURE_MATERIALS} from '../../src/destruction/material-profiles.js';
import {resolveFarmhouseBay} from '../../src/destruction/farmhouse-blueprint.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {loadPartLibrary} from '../../src/destruction/three/part-library.js';
import {createThreeFracturedChunkView} from '../../src/destruction/three/chunks.js';
import {createBreakableFloors} from '../../src/destruction/floors.js';
import {createDebrisFX} from '../../src/destruction/three/debris-fx.js';

const $=id=>document.getElementById(id),renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.shadowMap.enabled=true;document.body.prepend(renderer.domElement);
setupMobileControls($('part-controls'),$('toggle-controls'));
const scene=new T.Scene();scene.background=new T.Color('#15212a');scene.add(new T.HemisphereLight(0xe4f0ff,0x665848,2));const light=new T.DirectionalLight(0xffffff,3);light.position.set(5,9,6);scene.add(light);
renderer.shadowMap.type=T.PCFSoftShadowMap;light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-9,right:9,top:9,bottom:-9,near:.1,far:40});light.shadow.normalBias=.015;
const camera=new T.PerspectiveCamera(45,1,.03,200),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
const ground=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0x34434a,roughness:1}));ground.rotation.x=-Math.PI/2;scene.add(ground);const grid=new T.GridHelper(30,30,0x69777e,0x49575e);grid.position.y=.001;scene.add(grid);
ground.receiveShadow=true;
const supportGeometry=new T.BoxGeometry(.18,.5,.18),supportMaterial=new T.MeshStandardMaterial({color:0x82929b}),sphere=new T.SphereGeometry(.13,16,12),metal=new T.MeshStandardMaterial({color:0xdda95d,metalness:.6,roughness:.3});
let fx=null,debrisBindings=null,currentResources=[];
const fxFrustum=new T.Frustum(),fxMatrix=new T.Matrix4(),fxBounds=new T.Sphere(new T.Vector3(),3);
function relevantFX(point){const playerY=Number($('playerY').value)||0;if(point.y>playerY+15||point.y<playerY-25||camera.position.distanceToSquared(point)>30*30)return false;fxBounds.center.copy(point);return fxFrustum.intersectsSphere(fxBounds);}
const debrisColours=Object.fromEntries(Object.entries(STRUCTURE_MATERIALS).map(([id,profile])=>[id,new T.Color().setRGB(...profile.atlas.interior).getHex()]));
createDebrisFX(scene,{colours:debrisColours,isRelevant:relevantFX}).then(effects=>{if(disposed){effects.dispose();return;}fx=effects;fx.setGround(()=>0);debrisBindings=createStructureDebrisBindings(fx);for(const resource of currentResources)debrisBindings.register(resource);}).catch(error=>console.warn('Debris effects unavailable:',error));
let client=null,tileView=null,library,world,floors,view,rows=[],supports=[],supportBodies=[],shots=[],build=0,accumulator=0,selectedEntry,disposed=false;
const browserPerf=createBrowserPerformance({renderer,readState:()=>({selection:{house:new URLSearchParams(location.search).get('house'),backend:new URLSearchParams(location.search).get('backend'),surfaces:$('surfaces').checked},backend:client?.stats.backend,simTime:client?.stats.time,solverBodies:client?.stats.solverBodies,awake:client?.stats.awake,broken:client?.stats.broken,floorBreaks:client?.stats.floorBreaks,backlog:client?.stats.backlog})});
addEventListener('pagehide',()=>{if(disposed)return;browserPerf?.dispose();disposed=true;build++;clear();fx?.dispose();debrisBindings?.dispose();library?.dispose();controls.dispose();renderer.setAnimationLoop(null);light.shadow.dispose();renderer.dispose();for(const resource of [supportGeometry,supportMaterial,sphere,metal,ground.geometry,ground.material,grid.geometry,grid.material])resource.dispose();});
function facadeReveal({point,areaM2,thicknessM}){fx?.chipsBurst({point,mass:Math.min(8,areaM2*thicknessM*STRUCTURE_MATERIALS.render.densityKgM3),kind:'render'});}
function clear(){client?.dispose();client=null;tileView?.dispose();tileView=null;view?.dispose();floors?.dispose?.();for(const mesh of supports)scene.remove(mesh);for(const shot of shots)scene.remove(shot.mesh);supports=[];supportBodies=[];shots=[];currentResources=[];fx?.clear();world=null;view=null;floors=null;}
async function rebuild(){
 const revision=++build;clear();$('facadeControl').hidden=true;$('descent').hidden=true;$('status').textContent='Preparing authored part…';
 try{
  if($('part').value==='__stairs__'){await rebuildStairs(revision);return;}
  if($('part').value.startsWith('__house__')){await rebuildHouse($('part').value.slice(9),revision);return;}
  const seed=Number($('seed').value),bay=$('part').value==='__bay__';
  const instances=bay?resolveFarmhouseBay(library.catalogue,seed):[{entry:library.resolve({...JSON.parse($('part').value),seed,placementId:'specimen'}),foundation:true}];
  const resources=await Promise.all(instances.map(i=>library.load(i.entry)));if(revision!==build||disposed)return;
  currentResources=resources;for(const resource of resources)debrisBindings?.register(resource);
  selectedEntry=instances[0].entry;
  world=new C.World({gravity:new C.Vec3(0,-9.82,0),allowSleep:true});world.solver.iterations=30;world.broadphase=new C.SAPBroadphase(world);Object.assign(world.defaultContactMaterial,{friction:.6,restitution:.03});
  const groundBody=new C.Body({mass:0,shape:new C.Plane()});groundBody.quaternion.setFromEuler(-Math.PI/2,0,0);world.addBody(groundBody);
  const members=[],assets={};rows=[];
  for(const [index,instance]of instances.entries()){
   const asset=resources[index].asset,size=asset.part.sizeM,position=instance.position??[0,size[1]/2+(asset.masonry?0:.8),0],quaternion=instance.quaternion??[0,0,0,1],rotation=new C.Quaternion(...quaternion);
   assets[asset.assetId]=asset;
   const points=asset.intact.colliders.flatMap(c=>c.vertices.map(v=>v.map((n,i)=>n+c.position[i]))),bottom=Math.min(...points.map(p=>p[1])),low=points.filter(p=>Math.abs(p[1]-bottom)<1e-5).sort((a,b)=>a[0]-b[0]||a[2]-b[2]),ends=[low[0],low[low.length-1]],bearings=[];
   const start=new C.Vec3(...ends[0]),axis=new C.Vec3(...ends[1]).vsub(start),third=low.reduce((best,p)=>new C.Vec3(...p).vsub(start).cross(axis).lengthSquared()>new C.Vec3(...best).vsub(start).cross(axis).lengthSquared()?p:best,low[0]);
   if(new C.Vec3(...third).vsub(start).cross(axis).lengthSquared()>1e-10)ends.push(third);
   if(instance.foundation&&!asset.masonry)for(const local of ends){
    const point=rotation.vmult(new C.Vec3(...local)).vadd(new C.Vec3(...position)).toArray(),body=new C.Body({mass:0,position:new C.Vec3(...point)});body.addShape(new C.Box(new C.Vec3(.09,.25,.09)),new C.Vec3(0,-.25,0));world.addBody(body);supportBodies.push(body);
    const mesh=new T.Mesh(supportGeometry,supportMaterial);mesh.position.set(point[0],point[1]-.25,point[2]);scene.add(mesh);supports.push(mesh);bearings.push({member:members.length,point});members.push({segments:[{body}],hinges:[],broken:0});
   }
   rows.push({assetId:asset.assetId,kind:asset.material,position,quaternion,halfExtents:size.map(n=>n/2),mass:asset.massKg,breakEnergy:asset.breakEnergyJ,breakForce:Math.max(10000,asset.massKg*100),bearingTolerance:.0001,bearings,neighbours:instance.neighbours??[]});
  }
  $('facadeControl').hidden=!resources.some(r=>r.asset.masonry?.facade);
  const masonry=resources.some(r=>r.asset.masonry),renderAssets=new Map(resources.map(resource=>[resource.asset.assetId,resource]));
  if(masonry){
   world=null;
   const rounded=resources[0].asset.material==='stone_rubble',stone=rounded||resources[0].asset.material==='stone_dressed',materialLabel=rounded?'rounded stone':stone?'stone':'brick',unitLabel=stone?'stones':'bricks';
   const definition={version:1,name:rounded?'Rounded stone specimen':stone?'Stone block specimen':'Brick specimen',metadata:{},nodes:[],members:[],floors:rows};
   client=createAssemblyClient({options:{scene:'masonry',definition,assets,backend:'cannon',collisionLOD:'detailed'},
    onReady:system=>{if(revision!==build)return;floors=system.floors;view=createThreeFracturedChunkView({system,scene,assets:renderAssets,facadeEnabled:$('facade').checked,onFacadeReveal:facadeReveal});},
    onState:({stats,events,shots:incoming})=>{if(revision!==build)return;browserPerf?.observeWorker(stats);fx?.handle(events);syncShots(incoming);$('bandStats').textContent=`${stats.frozen} frozen / ${stats.rubbleBands} bands / ${stats.rubbleColliders} colliders`;$('status').textContent=`Cannon ${materialLabel} v${stats.masonry?.revision??1} · ${stats.masonry?.chunks??0} chunks / ${stats.masonry?.looseUnits??stats.masonry?.looseBricks??0} loose ${unitLabel} · ${stats.bodies} dynamic bodies · ${stats.awake} awake · ${stats.frozen} frozen. Click anywhere to fire.`;},
    onError:error=>{if(revision===build)$('status').textContent=error;console.error(error);}
   });
  }else{floors=createBreakableFloors({world,rows,members,assets,onEvent:event=>fx?.handle([event])});view=createThreeFracturedChunkView({system:{floors},scene,assets:renderAssets});}
  $('descent').hidden=!masonry;$('playerY').value='0';
  const position=bay?[0,1.7,0]:rows[0].position,radius=bay?4:Math.max(...resources[0].asset.part.sizeM,1);controls.target.fromArray(position);camera.position.set(radius*1.3,position[1]+radius*.5,radius*2);controls.update();accumulator=0;
  $('status').textContent=bay?`Farmhouse wall/timber bay · ${instances.length} parts · ${resources.reduce((n,r)=>n+r.asset.pieces.length,0)} chunks. Foundations support the walls; walls carry the timber.`:`${selectedEntry.id} · ${resources[0].asset.masonry?resources[0].asset.masonry.clusters.length+' clusters / '+selectedEntry.physicalChunks+' units':selectedEntry.physicalChunks+' chunks'} · ${resources[0].asset.massKg.toFixed(1)} kg. Click to impact or drop the mass.`;
 }catch(error){if(revision===build)$('status').textContent=error.message;console.error(error);}
}
function syncShots(incoming){
 const ids=new Set(incoming.map(s=>s.body.id));for(const old of shots)if(!ids.has(old.body.id))scene.remove(old.mesh);shots=shots.filter(s=>ids.has(s.body.id));
 for(const shot of incoming)if(!shots.some(s=>s.body.id===shot.body.id)){const mesh=new T.Mesh(sphere,metal);mesh.scale.setScalar(shot.radius/.13);scene.add(mesh);shots.push({...shot,mesh});}
}
async function rebuildStairs(revision){
 const parts=resolveStairFlight(library.catalogue,Number($('seed').value)),resources=await Promise.all(Object.values(parts).map(entry=>library.load(entry)));if(revision!==build||disposed)return;
 currentResources=resources;for(const resource of resources)debrisBindings?.register(resource);
 const assets=new Map(resources.map(r=>[r.asset.assetId,r])),definition=createStairFlightDefinition(parts,Object.fromEntries([...assets].map(([id,r])=>[id,r.asset])));
 client=createAssemblyClient({options:{scene:'catalogue-house',definition,assets:Object.fromEntries([...assets].map(([id,r])=>[id,r.asset])),backend:'cannon',collisionLOD:'auto',material:'brittle'},
  onReady:system=>{if(revision!==build)return;floors=system.floors;rows=definition.floors;view=createThreeBendableStructureView({system,scene,assets,damageColours:false});controls.target.set(0,1.1,.8);camera.position.set(5,4,6);controls.update();},
  onState:({stats,events,shots:incoming})=>{if(revision!==build)return;browserPerf?.observeWorker(stats);fx?.handle(events);syncShots(incoming);$('status').textContent=definition.name+' · '+stats.floorBreaks+' fractured parts · '+stats.bodies+' dynamic bodies · '+stats.awake+' awake. Hit a stringer or tread; Release supports removes the landing supports.';},
  onError:error=>{if(revision===build)$('status').textContent=error;console.error(error);}
 });
}
async function rebuildHouse(id,revision){
 const house=resolveCatalogueHouse(library.catalogue,id,Number($('seed').value)),tileEntry=library.resolve({type:'roof.tile_patch',materialId:'clay_tile',sizeMm:[1000,18,1000]});
 const resources=await Promise.all(house.instances.map(instance=>library.load(instance.entry))),tileResource=await library.load(tileEntry);if(revision!==build||disposed)return;
 currentResources=[...resources,tileResource];for(const resource of currentResources)debrisBindings?.register(resource);
 $('facadeControl').hidden=!house.masonry;$('facade').checked=house.facade??true;$('descent').hidden=!house.masonry;$('playerY').value='0';
 const assets=new Map(resources.map(r=>[r.asset.assetId,r])),definition=createCatalogueHouseDefinition(house,Object.fromEntries([...assets].map(([id,r])=>[id,r.asset])),tileResource.asset);
 let tileMesh;tileResource.gltf.scene.getObjectByName(tileResource.asset.pieces[0].node).traverse(node=>{if(node.isMesh&&!tileMesh)tileMesh=node;});
 const physics=housePhysicsOptions(house,new URLSearchParams(location.search));
 client=createAssemblyClient({options:{scene:'catalogue-house',definition,assets:Object.fromEntries([...assets].map(([id,r])=>[id,r.asset])),...physics,material:'brittle',chipsBelowKg:0},
  onReady:system=>{if(revision!==build)return;floors=system.floors;rows=definition.floors;view=createThreeFracturedChunkView({system,scene,assets,facadeEnabled:$('facade').checked,onFacadeReveal:facadeReveal});tileView=createRoofTilesView({system,scene,material:tileMesh.material,color:0xffffff,uvRect:structureAtlasRect(STRUCTURE_MATERIALS.clay_tile.atlas.row)});controls.target.set(0,2.3,0);camera.position.set(8,7,house.depth*1.4+4);controls.update();},
  onState:({stats,events,shots:incoming})=>{if(revision!==build)return;browserPerf?.observeWorker(stats);fx?.handle(events);const ids=new Set(incoming.map(s=>s.body.id));for(const old of shots)if(!ids.has(old.body.id))scene.remove(old.mesh);shots=shots.filter(s=>ids.has(s.body.id));for(const shot of incoming)if(!shots.some(s=>s.body.id===shot.body.id)){const mesh=new T.Mesh(sphere,metal);mesh.scale.setScalar(shot.radius/.13);scene.add(mesh);shots.push({...shot,mesh});}$('bandStats').textContent=`${stats.frozen} frozen / ${stats.rubbleBands} bands`;$('status').textContent=house.name+' · '+stats.backend+' · '+stats.collisionLOD+' collision · '+stats.collisionShapes+' shapes · 4 complete walls · '+stats.floorBreaks+' fractured parts · '+stats.solverBodies+' bodies · '+(stats.steps?stats.physicsMs/stats.steps:0).toFixed(2)+' ms/step. Click anywhere to fire.';},
  onError:error=>{if(revision===build)$('status').textContent=error;console.error(error);}
 });
}
function fire(point,drop=false,origin=null){if(client){const direction=new T.Vector3().subVectors(camera.position,point).normalize();client.command({type:'fire',target:point.toArray(),origin:(origin??point.clone().addScaledVector(direction,3)).toArray(),mode:drop?'drop':'projectile',mass:350,speed:12});return;}if(!world)return;const direction=new T.Vector3().subVectors(camera.position,point).normalize(),start=drop?point.clone().add(new T.Vector3(0,3,0)):(origin??point.clone().addScaledVector(direction,3)),body=new C.Body({mass:350,shape:new C.Sphere(.13),position:new C.Vec3(start.x,start.y,start.z)});if(!drop)body.velocity.set(-direction.x*12,-direction.y*12,-direction.z*12);world.addBody(body);const mesh=new T.Mesh(sphere,metal);scene.add(mesh);shots.push({body,mesh});if(shots.length>8){const old=shots.shift();world.removeBody(old.body);scene.remove(old.mesh);}}
const ray=new T.Raycaster(),mouse=new T.Vector2();
bindSceneTap(renderer.domElement,e=>{
 if(!view)return;
 const bounds=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-bounds.left)/bounds.width*2-1,1-(e.clientY-bounds.top)/bounds.height*2);ray.setFromCamera(mouse,camera);
 // Picking supplies depth only. Empty space and non-pickable rubble can be shot.
 const hit=ray.intersectObjects([...view.roots,...scene.children.filter(o=>o.isBatchedMesh),ground])[0],point=hit?.point??ray.ray.at(Math.max(3,camera.position.distanceTo(controls.target)),new T.Vector3());
 fire(point,false,ray.ray.origin.clone().addScaledVector(ray.ray.direction,.5));
});
$('facade').onchange=()=>view?.setFacadeEnabled($('facade').checked);
$('surfaces').onchange=()=>library?.setSurfaceDetail($('surfaces').checked);
$('playerY').onchange=()=>{const y=Number($('playerY').value);if(Number.isFinite(y))client?.command({type:'playerHeight',y});};
$('reset').onclick=rebuild;$('part').onchange=rebuild;$('seed').onchange=rebuild;$('drop').onclick=()=>{if(client){fire(currentResources[0]?.asset.masonry?new T.Vector3().fromArray(rows[0].position).add(new T.Vector3(0,rows[0].halfExtents[1],0)):new T.Vector3(0,4.7,0),true);return;}if(floors)fire($('part').value==='__bay__'?new T.Vector3(0,3.5,0):new T.Vector3().fromArray(rows[0].position).add(new T.Vector3(0,selectedEntry.sizeMm[1]/2000,0)),true);};
$('release').onclick=()=>{if(client){client.command({type:'releaseFoundations'});return;}if(!floors)return;for(const panel of floors.panels)panel.releaseFoundation?.();for(const panel of floors.panels)for(const attachment of panel.attachments){attachment.disabled=true;attachment.bond.alive=false;world.removeConstraint(attachment.bond.joint);attachment.group.body.wakeUp();}for(const body of supportBodies)world.removeBody(body);for(const mesh of supports)scene.remove(mesh);supportBodies=[];supports=[];$('status').textContent='Support joints released. Remaining contacts carry the load.';};
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;if(innerWidth<=700)camera.clearViewOffset();else camera.setViewOffset(innerWidth,innerHeight,-Math.min(120,innerWidth*.15),0,innerWidth,innerHeight);camera.updateProjectionMatrix();}addEventListener('resize',resize);resize();
let previous=performance.now();renderer.setAnimationLoop(now=>{browserPerf?.beginFrame(now);const elapsed=Math.min(.05,(now-previous)/1000);previous=now;if(document.hidden)return;if(client){client.advance(elapsed);client.update(now);view?.update();tileView?.update();tileView?.tick(elapsed);for(const shot of shots){shot.mesh.position.copy(shot.body.position);shot.mesh.quaternion.copy(shot.body.quaternion);}}else if(world&&floors){accumulator+=elapsed;for(let i=0;i<16&&accumulator>=1/240;i++){floors.beforeStep(1/240);world.step(1/240);floors.afterStep();accumulator-=1/240;}view.update();for(const shot of shots){shot.mesh.position.copy(shot.body.position);shot.mesh.quaternion.copy(shot.body.quaternion);}}view?.tick?.(elapsed);controls.update();camera.updateMatrixWorld();fxFrustum.setFromProjectionMatrix(fxMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));fx?.tick(elapsed);browserPerf?.beforeRender();renderer.render(scene,camera);browserPerf?.afterRender(now);});
try{library=await loadPartLibrary(import.meta.env.BASE_URL + 'assets/structures/manifest.json');if(disposed){library.dispose();}else{$('surfaces').checked=new URLSearchParams(location.search).get('surfaces')!=='0';library.setSurfaceDetail($('surfaces').checked);$('part').add(new Option('TEST · Destructible stairs + landing','__stairs__'));for(const house of CATALOGUE_HOUSES)$('part').add(new Option(house.name,'__house__'+house.id));const choices=new Map();for(const entry of library.catalogue.assets){const key=JSON.stringify({type:entry.type,materialId:entry.materialId,sizeMm:entry.sizeMm,...(entry.type.startsWith('test.masonry.')?{variant:entry.variant}:{})});if(!choices.has(key)){const label=entry.type.startsWith('test.masonry.')?`TEST · ${entry.materialId==='stone_rubble'?'Rounded stone':entry.materialId==='stone_dressed'?'Stone block':'Brick'} ${entry.type.endsWith('window')?'window + lintel':'solid'} · ${entry.variant===2?'Revealing facade':entry.materialId==='stone_rubble'?'Authored cells':entry.variant===0?'Geometry Nodes':'Bisect'}`:`${entry.type} · ${entry.materialId} · ${entry.sizeMm.join('×')} mm`;const option=new Option(label,key);$('part').add(option);choices.set(key,true);}}const first=[...$('part').options].find(o=>!o.value.startsWith('__')&&JSON.parse(o.value).type==='wall.straight');const params=new URLSearchParams(location.search),requested=params.get('specimen')?.replace(/^facade-/,''),wantFacade=params.get('specimen')?.startsWith('facade-');const requestedType=(requested?.startsWith('rounded')?'test.masonry.rounded.':requested?.startsWith('stone')?'test.masonry.stone.':'test.masonry.')+(requested?.endsWith('window')?'window':'solid');const specimen=[...$('part').options].find(o=>o.value.includes(JSON.stringify(requestedType))&&(!wantFacade||JSON.parse(o.value).variant===2)&&(!params.has('variant')||JSON.parse(o.value).variant===Number(params.get('variant'))));if(/^(brick|stone|rounded)/.test(requested??'')&&specimen)$('part').value=specimen.value;else if(first)$('part').value=first.value;if(params.get('specimen')==='stairs')$('part').value='__stairs__';if(params.get('house')&&CATALOGUE_HOUSES.some(h=>h.id===params.get('house')))$('part').value='__house__'+params.get('house');if(params.get('catalogueOnly')==='1')for(const option of [...$('part').options])if(option.value.startsWith('__'))option.remove();await rebuild();}}catch(error){if(!disposed)$('status').textContent=error.message;}

