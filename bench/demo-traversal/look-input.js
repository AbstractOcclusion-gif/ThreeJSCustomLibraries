// Looking around: a mouse click captures the pointer and the mouse then turns the view (Esc frees it), a finger drags
// it, and the wheel zooms. follow: the camera (look(yaw, pitch), zoom(delta)). sensitivity: rad per pixel.
export function createLookInput({canvas, follow, sensitivity}) {
 function zoom(event) { event.preventDefault(); follow.zoom(event.deltaY); }
 let orbitPointer = null;
 let pointerX = 0, pointerY = 0;
 // A mouse click captures the pointer and the mouse then turns the view (Esc frees it); a finger drags it.
 function startOrbit(event) {
  if (event.pointerType === 'mouse') { canvas.requestPointerLock()?.catch?.(() => {}); return; }
  if (event.button !== 0 || orbitPointer !== null) return;
  orbitPointer = event.pointerId;
  pointerX = event.clientX;
  pointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
 }
 function moveOrbit(event) {
  if (event.pointerId !== orbitPointer) return;
  follow.look((pointerX - event.clientX) * sensitivity, (event.clientY - pointerY) * sensitivity);
  pointerX = event.clientX;
  pointerY = event.clientY;
 }
 function stopOrbit(event) {
  if (event.pointerId === orbitPointer) orbitPointer = null;
 }
 function mouseLook(event) {
  if (document.pointerLockElement === canvas) follow.look(-event.movementX * sensitivity, event.movementY * sensitivity);
 }
 window.addEventListener('mousemove', mouseLook);
 canvas.addEventListener('pointermove', moveOrbit);
 canvas.addEventListener('lostpointercapture', stopOrbit);
 canvas.addEventListener('pointerdown', startOrbit);
 canvas.addEventListener('wheel', zoom, {passive: false});
 return {dispose() {
  window.removeEventListener('mousemove', mouseLook);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  canvas.removeEventListener('pointermove', moveOrbit);
  canvas.removeEventListener('lostpointercapture', stopOrbit);
  canvas.removeEventListener('pointerdown', startOrbit);
  canvas.removeEventListener('wheel', zoom);
 }};
}
