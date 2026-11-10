// A bounded load-bearing wall/timber bay, assembled from exact catalogue parts.
// Connections are explicit blueprint decisions, not inferred from material names.
import {resolvePart} from './catalogue.js';

export function resolveFarmhouseBay(catalogue,seed=1){
 const requests=[],add=(type,materialId,sizeMm,position,neighbours=[],angle=0,foundation=false)=>{const id=requests.length;requests.push({entry:resolvePart(catalogue,{type,materialId,sizeMm,seed,placementId:`farmhouse-bay-${id}`}),position,quaternion:[0,Math.sin(angle/2),0,Math.cos(angle/2)],neighbours,foundation});return id;};
 const back=add('wall.window','stone_rubble',[2000,3000,400],[0,1.5,-1.2],[],0,true);
 const front=add('wall.door','stone_rubble',[2000,3000,400],[0,1.5,1.2],[],0,true);
 const sides=[];
 for(const x of [-.8,.8]){const first=add('wall.straight','stone_rubble',[1000,3000,400],[x,1.5,-.5],[back],Math.PI/2,true);sides.push(first,add('wall.straight','stone_rubble',[1000,3000,400],[x,1.5,.5],[front,first],Math.PI/2,true));}
 const beam=add('frame.beam','oak',[3000,250,200],[0,3.125,0],sides);
 const joists=[-.5,.5].map(x=>add('floor.joist','oak',[3000,200,80],[x,3.35,0],[beam],Math.PI/2));
 const boards=[];for(const [i,x]of [-.5,.5].entries())boards.push(add('floor.boards','oak',[1000,35,2000],[x,3.4675,0],[joists[i],...boards]));
 add('opening.frame','oak',[1160,1360,100],[0,1.5,-1.2],[back]);
 add('opening.glass','glass',[1000,1200,6],[0,1.5,-1.2],[requests.length-1]);
 add('opening.door','oak',[900,2050,45],[0,1.025,1.2],[front]);
 // Floor neighbour rows are undirected. Store each link on its lower-index row,
 // matching the existing createBreakableFloors convention.
 for(const [id,row]of requests.entries())for(const n of [...row.neighbours])if(n<id){requests[n].neighbours.push(id);row.neighbours=row.neighbours.filter(x=>x!==n);}
 return requests;
}
