import * as C from 'cannon-es';
import {resolvePart} from './catalogue.js';
import {linkMasonryCorners} from './masonry-corners.js';

export const CATALOGUE_HOUSES=Object.freeze([
 {id:'cottage',name:'Stone cottage · 4 × 4 m',depth:4},
 {id:'farmhouse',name:'Farmhouse · 4 × 6 m',depth:6},
 {id:'longhouse',name:'Long house · 4 × 8 m',depth:8},
 {id:'exposed-fieldstone',name:'Exposed fieldstone cottage · 4 × 4 m',depth:4,masonry:true,material:'stone_rubble',facade:false},
 {id:'plastered-brick',name:'Plastered brick cottage · 4 × 4 m',depth:4,masonry:true,bondedCorners:true,material:'brick',facade:true},
 {id:'plastered-farmhouse',name:'Plastered dressed-stone farmhouse · 4 × 6 m',depth:6,masonry:true,bondedCorners:true,material:'stone_dressed',facade:true},
 {id:'rough-cottage',name:'TEST · rough stone + second hits',depth:4,experimental:true},
 {id:'log-cabin',name:'Log cabin · 4 × 4 m',depth:4,timber:'log',material:'oak'},
 {id:'wooden-house',name:'Wooden house · 4 × 4 m',depth:4,timber:'plank',material:'oak'},
 {id:'unit-brick',name:'TEST · brick house + revealing facade',depth:4,masonry:true,material:'brick'},
 {id:'unit-stone',name:'TEST · stone house + revealing facade',depth:4,masonry:true,material:'stone_dressed'},
 {id:'brick-cottage',name:'Brick cottage · 4 × 4 m',depth:4,masonry:true,bondedCorners:true,material:'brick',facade:false},
 {id:'stone-farmhouse',name:'Dressed-stone farmhouse · 4 × 6 m',depth:6,masonry:true,bondedCorners:true,material:'stone_dressed',facade:false},
 {id:'fieldstone-cottage',name:'Plastered fieldstone cottage · 4 × 4 m',depth:4,masonry:true,material:'stone_rubble',facade:true},
 // Blueprint variations. sideWallType replaces the default side wall asset; each partition is an
 // interior wall with a door across the house at z, on its own footing.
 {id:'fieldstone-two-room',name:'Fieldstone two-room house · 4 × 8 m',depth:8,masonry:true,material:'stone_rubble',facade:false,sideWallType:'house.wall.side_windows',partitions:[{z:0}]},
 // wallHeight covers both storeys in one wall asset per facade; endWallTypes replaces the default
 // end walls; upperFloor adds joists, boards and the oak stair at that height.
 {id:'fieldstone-two-storey',name:'Fieldstone two-storey house · 4 × 4 m',depth:4,masonry:true,material:'stone_rubble',facade:false,wallHeight:5,endWallTypes:{window:'house.wall.tall_windows',door:'house.wall.tall_door_window'},sideWallType:'house.wall.tall_windows',upperFloor:{height:2.5}},
 // porch: deck, posts, beam and tiled lean-to roof in front of the door. balcony: platform on braces
 // with railings above the door of a two-storey house (its front wall needs an upper door).
 {id:'fieldstone-porch-cottage',name:'Fieldstone cottage with porch · 4 × 4 m',depth:4,masonry:true,material:'stone_rubble',facade:false,porch:true},
 {id:'fieldstone-balcony-house',name:'Fieldstone two-storey house with balcony · 4 × 4 m',depth:4,masonry:true,material:'stone_rubble',facade:false,wallHeight:5,endWallTypes:{window:'house.wall.tall_windows',door:'house.wall.tall_doors'},sideWallType:'house.wall.tall_windows',upperFloor:{height:2.5},balcony:true},
]);
// Window centres per masonry wall type as [x along the wall, y]. Other '...window' walls have one at [0, 1.5].
const MASONRY_WINDOWS=Object.freeze({'house.wall.side_windows':[[-2,1.5],[2,1.5]],'house.wall.tall_windows':[[0,1.5],[0,4]],'house.wall.tall_door_window':[[0,4]]});
const MASONRY_WINDOW_FRAME=[900,1200,100],MASONRY_WINDOW_GLASS=[740,1040,6];
// Porch in front of the door (metres; z measured out from the front wall face).
const PORCH=Object.freeze({boardX:[-1,0,1],deckLift:.005,postX:[-1.4,1.4],postZ:1.9,postSizeMm:[200,2200,200],beamSizeMm:[3000,250,200],
 rafterX:[-1.4,0,1.4],rafterSizeMm:[2200,150,80],rafterZ:1.1,slope:.22,roofZ:1,footingHalfWidth:1.6});
// Balcony at the upper floor (metres; z out from the front wall face).
const BALCONY=Object.freeze({depth:1,braceX:[-.8,.8],braceSizeMm:[1500,150,150],braceDrop:.08,railSizeMm:[[2000,900,60],[1000,900,60]],railInset:.03});
// Upper floor of a 4 m deep house (metres, house frame): joists span between the end walls,
// boards cover the room beside a 1 m stairwell along the left wall, one straight oak flight.
const UPPER_FLOOR=Object.freeze({joistX:[-.65,-.05,.55,1.15,1.68],joistSizeMm:[4000,200,80],boardSizeMm:[830,35,2000],boardX:[-.315,.515,1.345],boardZ:[-1,1],
 stairX:-1.24,stringerOffset:.46,stringerSizeMm:[4000,250,60],stringerY:1.3,treads:13,treadStart:[.3,-1.48],treadStep:[.18,.24]});

// Four complete wall assets. There are no metre-wide wall-to-wall module seams.
export function resolveCatalogueHouse(catalogue,id='cottage',seed=1){
 const spec=CATALOGUE_HOUSES.find(h=>h.id===id);if(!spec)throw Error('Unknown catalogue house');
 const depth=spec.depth,instances=[];
 function add(type,sizeMm,position,{materialId='stone_rubble',quaternion=[0,0,0,1],neighbours=[],foundation=null,covering=false}={}){
  const index=instances.length;instances.push({entry:resolvePart(catalogue,{type,materialId,sizeMm,seed,placementId:`${id}-${index}`}),position,quaternion,neighbours,foundation,covering});return index;
 }
 const yaw=[0,Math.SQRT1_2,0,Math.SQRT1_2];
 const thickness=spec.timber?(spec.timber==='log'?.28:.08):spec.masonry ? .24 : .4,side=2-thickness/2,end=depth/2+thickness/2;
 const wallOptions={materialId:spec.material??'stone_rubble'};
 // Walls taller than the 3 m default lift the gables and roof by the same amount.
 const wallHeight=spec.wallHeight??3,lift=wallHeight-3,wallMm=wallHeight*1000,wallY=wallHeight/2;
 const endType=spec.bondedCorners?'test.house.bonded.end.':'test.house.masonry.',sideType=spec.sideWallType??(spec.bondedCorners?'test.house.bonded.side.window':'test.house.masonry.window'),sideWidth=(depth+(spec.bondedCorners?2*thickness:0))*1000;
 const windowType=spec.timber?`wall.${spec.timber}_windows`:'wall.whole_windows',facadeType=spec.timber?`wall.${spec.timber}_facade`:spec.experimental?'wall.facade_detail':'wall.facade';
 const backType=spec.endWallTypes?.window??(spec.masonry?endType+'window':windowType),frontType=spec.endWallTypes?.door??(spec.masonry?endType+'door':facadeType),sidesType=spec.masonry?sideType:windowType;
 const back=add(backType,[4000,wallMm,thickness*1000],[0,wallY,-end],{...wallOptions,foundation:0,quaternion:spec.masonry?[0,1,0,0]:undefined});
 const right=add(sidesType,[sideWidth,wallMm,thickness*1000],[side,wallY,0],{...wallOptions,quaternion:yaw,foundation:1,neighbours:[back]});
 const front=add(frontType,[4000,wallMm,thickness*1000],[0,wallY,end],{...wallOptions,foundation:2,neighbours:[right]});
 const left=add(sidesType,[sideWidth,wallMm,thickness*1000],[-side,wallY,0],{...wallOptions,quaternion:spec.masonry?[0,-Math.SQRT1_2,0,Math.SQRT1_2]:yaw,foundation:3,neighbours:[back,front]});
 // Partitions span between the side walls' inner faces; foundation 4+i is their own footing member.
 for(const [i,partition]of (spec.partitions??[]).entries()){
  const wall=add('house.partition.door',[Math.round((4-2*thickness)*1000),3000,thickness*1000],[0,1.5,partition.z],{...wallOptions,foundation:4+i,neighbours:[right,left]});
  add('opening.door',[900,2050,45],[0,1.025,partition.z],{materialId:'oak',neighbours:[wall]});
 }
 const gableType=spec.timber?'wall.timber_gable':'wall.gable',gableThickness=spec.timber?.08:.4,gableOptions=spec.timber?{materialId:'oak'}:{},gableEnd=spec.timber?end:depth/2+.2;
 const backGable=add(gableType,[4000,1500,gableThickness*1000],[0,3.75+lift,-gableEnd],{...gableOptions,neighbours:[back]});
 const frontGable=add(gableType,[4000,1500,gableThickness*1000],[0,3.75+lift,gableEnd],{...gableOptions,neighbours:[front]});
 function window(position,wall,quaternion=[0,0,0,1],frameSizeMm=[1160,1360,100],glassSizeMm=[1000,1200,6]){
  const frame=add('opening.frame',frameSizeMm,position,{materialId:'oak',quaternion,neighbours:[wall]});
  add('opening.glass',glassSizeMm,position,{materialId:'glass',quaternion,neighbours:[frame]});
 }
 if(!spec.masonry){for(const x of [-1,1])window([x,1.5,-depth/2-.2],back);window([1,1.5,depth/2+.2],front);}
 add('opening.door',[900,2050,45],[spec.masonry?0:-1,1.025,end],{materialId:'oak',neighbours:[front]});
 if(!spec.masonry)for(const [x,wall]of [[side,right],[-side,left]])for(let j=0;j<depth/2;j++)window([x,1.5,(j+.5)*2-depth/2],wall,yaw);
 const angle=Math.atan(.75),previousBoards=[[],[]];let lastRidge;
 for(let row=0;row<(depth+2)/2;row++){
  const z=-depth/2+row*2,end=row===0?backGable:row===depth/2?frontGable:null;
  const rowRafters=[];
  const ridge=add('roof.ridge',[2000,300,200],[0,4.5+lift,z],{materialId:'oak',quaternion:yaw,neighbours:[...(lastRidge==null?[]:[lastRidge]),...(spec.masonry&&end!=null?[end]:[])]});lastRidge=ridge;
  for(const [side,sign]of [-1,1].entries()){
   const a=-sign*angle,q=[0,0,Math.sin(a/2),Math.cos(a/2)],normal=[-Math.sin(a),Math.cos(a),0];
   const rafter=add('roof.rafter',[3000,150,80],[sign*1.2,3.6+lift,z],{materialId:'oak',quaternion:q,neighbours:[ridge,sign<0?left:right,...(end==null?[]:[end]),...(spec.masonry?[...rowRafters,...(end==null?[]:[row===0?back:front])]:[])]});rowRafters.push(rafter);
   let lastBoard;
   for(let strip=0;strip<3;strip++){
    const t=strip-1,position=[sign*1.2+Math.cos(a)*t+normal[0]*.0925,3.6+lift+Math.sin(a)*t+normal[1]*.0925,z];
    const board=add('floor.boards',[1000,35,2000],position,{materialId:'oak',quaternion:q,covering:true,neighbours:[rafter,...(lastBoard==null?[]:[lastBoard]),...(previousBoards[side][strip]==null?[]:[previousBoards[side][strip]]),...(end==null?[]:[end]),...(spec.masonry&&Math.abs(position[0])<.5?[ridge]:[])]});
    lastBoard=board;previousBoards[side][strip]=board;
   }
  }
 }
 if(spec.upperFloor){
  if(depth!==4)throw Error('The upper floor layout is authored for 4 m deep houses');
  const f=UPPER_FLOOR,top=spec.upperFloor.height,oak={materialId:'oak'};
  const joists=f.joistX.map(x=>add('floor.joist',f.joistSizeMm,[x,top-f.boardSizeMm[1]/1000-f.joistSizeMm[1]/2000,0],{...oak,quaternion:yaw,neighbours:[back,front]}));
  for(const x of f.boardX)for(const z of f.boardZ)add('floor.boards',f.boardSizeMm,[x,top-f.boardSizeMm[1]/2000,z],{...oak,neighbours:joists.filter((_,j)=>Math.abs(f.joistX[j]-x)<f.boardSizeMm[0]/2000)});
  // Same pitch and orientation as the stair flight in stairs.js; the stringers hang off the left wall and the first joist.
  const pitch=new C.Quaternion();pitch.setFromEuler(-Math.atan(.75),-Math.PI/2,0,'XYZ');
  const stringers=[-1,1].map(sign=>add('stairs.stringer',f.stringerSizeMm,[f.stairX+sign*f.stringerOffset,f.stringerY,0],{...oak,quaternion:pitch.toArray(),neighbours:[left,joists[0]]}));
  for(let i=0;i<f.treads;i++)add('stairs.tread',[1000,40,280],[f.stairX,f.treadStart[0]+i*f.treadStep[0],f.treadStart[1]+i*f.treadStep[1]],{...oak,neighbours:stringers});
 }
 const face=end+thickness/2,oak={materialId:'oak'},axisX=new C.Vec3(1,0,0),alongZ=new C.Quaternion().setFromAxisAngle(new C.Vec3(0,1,0),-Math.PI/2);
 const porchPostZ=face+PORCH.postZ;
 if(spec.porch){
  const p=PORCH,angle=Math.atan(p.slope),footing=4+(spec.partitions?.length??0);
  for(const x of p.boardX)add('floor.boards',[1000,35,2000],[x,.0175+p.deckLift,face+1],{...oak,neighbours:[front]});
  const posts=p.postX.map(x=>add('frame.post',p.postSizeMm,[x,p.postSizeMm[1]/2000,porchPostZ],{...oak,foundation:footing}));
  const beamTop=(p.postSizeMm[1]+p.beamSizeMm[1])/1000,beam=add('frame.beam',p.beamSizeMm,[0,beamTop-p.beamSizeMm[1]/2000,porchPostZ],{...oak,neighbours:posts});
  // Lean-to rafters rest on the beam and run up to the wall; roof boards follow the same slope.
  const down=new C.Quaternion().setFromAxisAngle(axisX,angle),rafterY=beamTop+p.rafterSizeMm[1]/2000+(p.postZ-p.rafterZ)*p.slope;
  const rafters=p.rafterX.map(x=>add('roof.rafter',p.rafterSizeMm,[x,rafterY,face+p.rafterZ],{...oak,quaternion:down.mult(alongZ).toArray(),neighbours:[front,beam]}));
  for(const [i,x]of p.boardX.entries())add('floor.boards',[1000,35,2000],[x,rafterY+(p.rafterZ-p.roofZ)*p.slope+(p.rafterSizeMm[1]+35)/2000,face+p.roofZ],{...oak,quaternion:down.toArray(),covering:true,neighbours:[rafters[i]]});
 }
 if(spec.balcony){
  if(!spec.upperFloor)throw Error('A balcony needs an upper floor');
  const b=BALCONY,top=spec.upperFloor.height,up=new C.Quaternion().setFromAxisAngle(axisX,-Math.PI/4),reach=b.braceSizeMm[0]/2000*Math.SQRT1_2;
  const platform=add('floor.boards',[1000,35,2000],[0,top-.0175,face+b.depth/2],{...oak,quaternion:yaw,neighbours:[front]});
  for(const x of b.braceX)add('frame.brace',b.braceSizeMm,[x,top-.035-b.braceDrop-reach,face+reach],{...oak,quaternion:up.mult(alongZ).toArray(),neighbours:[front,platform]});
  const railY=top+b.railSizeMm[0][1]/2000,frontRail=add('balcony.rail',b.railSizeMm[0],[0,railY,face+b.depth-b.railInset],{...oak,neighbours:[platform]});
  for(const sign of [-1,1])add('balcony.rail',b.railSizeMm[1],[sign*(1-b.railInset),railY,face+b.depth/2],{...oak,quaternion:yaw,neighbours:[platform,frontRail]});
  add('opening.door',[900,2050,45],[0,top+1.025,end],{...oak,neighbours:[front]});
 }
 // Frames and glass for the masonry window openings, added last so earlier instance indices stay stable.
 if(spec.masonry){
  const windowsOf=type=>MASONRY_WINDOWS[type]??(type.endsWith('window')?[[0,1.5]]:[]);
  for(const [wall,type,place,quaternion]of [[back,backType,(x,y)=>[-x,y,-end],[0,1,0,0]],[front,frontType,(x,y)=>[x,y,end],[0,0,0,1]],[right,sidesType,(x,y)=>[side,y,-x],yaw],[left,sidesType,(x,y)=>[-side,y,x],[0,-Math.SQRT1_2,0,Math.SQRT1_2]]])
   for(const [x,y]of windowsOf(type))window(place(x,y),wall,quaternion,MASONRY_WINDOW_FRAME,MASONRY_WINDOW_GLASS);
 }
 for(const [i,row]of instances.entries())for(const n of [...row.neighbours])if(n<i){instances[n].neighbours.push(i);row.neighbours=row.neighbours.filter(x=>x!==n);}
 return{...spec,instances,roofTop:4.7+lift,centre:[0,2.3+lift/2,0],porchPostZ};
}

export function createCatalogueHouseDefinition(house,assets,tileAsset){
 const get=id=>assets instanceof Map?assets.get(id):assets[id],depth=house.depth;
 const nodes=[[-1.8,-.15,-depth/2-.2],[1.8,-.15,-depth/2-.2],[1.8,-.15,depth/2+.2],[-1.8,-.15,depth/2+.2]].map(position=>({position,anchor:true}));
 const members=nodes.map((_,i)=>({a:i,b:(i+1)%4,type:'foundation',profile:'steel',storey:1,bendable:{section:'rectangle',segments:1,response:'brittle',width:.4,height:.3,massPerMetre:288,density:2400,stiffness:1e7,yieldMoment:1e8,breakForce:1e8,collisionInset:.02,color:0x777777}}));
 for(const partition of house.partitions??[]){const a=nodes.length;nodes.push({position:[-1.8,-.15,partition.z],anchor:true},{position:[1.8,-.15,partition.z],anchor:true});members.push({...members[0],a,b:a+1});}
 if(house.porch){const a=nodes.length;nodes.push({position:[-PORCH.footingHalfWidth,-.15,house.porchPostZ],anchor:true},{position:[PORCH.footingHalfWidth,-.15,house.porchPostZ],anchor:true});members.push({...members[0],a,b:a+1});}
 const floors=house.instances.map(instance=>{
  const asset=get(instance.entry.id),bearings=[];
  if(instance.foundation!=null){
   const bottom=Math.min(...asset.pieces.flatMap(p=>p.collider.vertices.map(v=>v[1]+p.position[1]))),q=new C.Quaternion(...instance.quaternion),origin=new C.Vec3(...instance.position);
   // A continuous footing bears every chunk that actually reaches the base.
   // Three interior points on each convex bottom face restrain its real footprint.
   for(const piece of asset.pieces){
    const points=piece.collider.vertices.map(v=>new C.Vec3(...v).vadd(new C.Vec3(...piece.position))).filter(p=>Math.abs(p.y-bottom)<1e-5);
    if(points.length<3)continue;
    const centre=points.reduce((sum,p)=>sum.vadd(p),new C.Vec3()).scale(1/points.length);
    const first=points[0],second=points.reduce((best,p)=>p.distanceSquared(first)>best.distanceSquared(first)?p:best,first),axis=second.vsub(first),third=points.reduce((best,p)=>p.vsub(first).cross(axis).lengthSquared()>best.vsub(first).cross(axis).lengthSquared()?p:best,first);
    for(const vertex of [first,second,third]){const local=centre.vadd(vertex).scale(.5),point=q.vmult(local).vadd(origin);bearings.push({member:instance.foundation,point:point.toArray()});}
   }
  }
  const coveringMass=instance.covering?2*tileAsset.massKg:0;
  const row={storey:1,assetId:asset.assetId,kind:asset.material,position:instance.position,quaternion:instance.quaternion,halfExtents:asset.part.sizeM.map(n=>n/2),mass:asset.massKg+coveringMass,breakEnergy:asset.breakEnergyJ,breakForce:Math.max(10000,asset.massKg*100),bearingTolerance:.001,bearings,neighbours:instance.neighbours};
  if(instance.covering){row.roofTiles=[];for(let z=0;z<8;z++)for(let x=0;x<4;x++){
   const position=[(x+.5)*.25-.5,.035/2+.018/2,(z+.5)*.25-1],physical=asset.pieces.filter(p=>p.mode!=='cosmetic');
   const owner=physical.reduce((a,b)=>Math.hypot(a.position[0]-position[0],a.position[2]-position[2])<Math.hypot(b.position[0]-position[0],b.position[2]-position[2])?a:b);
   row.roofTiles.push({position,pieceId:owner.id});
  }}
  return row;
 });
 if(house.bondedCorners)linkMasonryCorners(floors,assets,[0,1,2,3]);
 return{version:1,name:house.name,nodes,members,floors,metadata:{heavy:true,height:house.roofTop??4.7,span:4,width:depth+2,stories:house.upperFloor?2:1,house:true,hubMass:0,wholeWalls:true,...(house.masonry?{masonryHouse:true}:{})}};
}
