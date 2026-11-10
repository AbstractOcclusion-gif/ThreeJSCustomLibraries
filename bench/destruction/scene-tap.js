// A drag that returns to its origin and a two-finger pinch are never taps.
export function bindSceneTap(element,onTap){
 const pointers=new Set();let start=null;
 const down=e=>{pointers.add(e.pointerId);if(pointers.size===1&&e.button===0&&e.isPrimary!==false)start={id:e.pointerId,x:e.clientX,y:e.clientY};else start=null;};
 const move=e=>{if(start&&e.pointerId===start.id&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)start=null;};
 const up=e=>{const tap=start&&e.pointerId===start.id&&pointers.size===1&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<=8;start=null;pointers.delete(e.pointerId);if(tap)onTap(e);};
 const cancel=e=>{start=null;pointers.delete(e.pointerId);};
 const blur=()=>{start=null;pointers.clear();};
 for(const [type,fn]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['lostpointercapture',cancel]])element.addEventListener(type,fn);
 addEventListener('blur',blur);
 const dispose=()=>{for(const[type,fn]of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',cancel],['lostpointercapture',cancel]])element.removeEventListener(type,fn);removeEventListener('blur',blur);};
 addEventListener('pagehide',dispose,{once:true});return dispose;
}
