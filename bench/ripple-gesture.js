// Adapted from WebAquarium's water gesture: one stamp on press and distance-spaced
// stamps while dragging. A stationary hold adds a pulse on the frame clock.
export function bindRippleGesture(canvas, controls, pick, stamp, {spacing = .45, interval = .25} = {}) {
 let pointer = null, last, next = 0, elapsed = 0, enabled;
 function release(event) {
  if (pointer === null || (event?.pointerId !== undefined && event.pointerId !== pointer)) return;
  const id = pointer;
  pointer = null;
  controls.enabled = enabled;
  if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
 }
 function down(event) {
  if (event.button !== 0 || !event.isPrimary || event.ctrlKey || event.shiftKey || event.altKey || pointer !== null) return;
  const hit = pick(event);
  if (!hit) return;
  pointer = event.pointerId;
  enabled = controls.enabled;
  controls.enabled = false;
  canvas.setPointerCapture(pointer);
  event.stopImmediatePropagation();
  last = {x: hit.x, z: hit.z};
  next = elapsed + interval;
  stamp(last, 1);
 }
 function move(event) {
  if (event.pointerId !== pointer) return;
  const hit = pick(event);
  if (!hit) { release(event); return; }
  const distance = Math.hypot(hit.x - last.x, hit.z - last.z);
  if (distance < spacing) return;
  last = {x: hit.x, z: hit.z};
  next = elapsed + interval;
  stamp(last, Math.min(1, distance / (2 * spacing)));
 }
 canvas.addEventListener('pointerdown', down, true);
 canvas.addEventListener('pointermove', move);
 for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, release);
 window.addEventListener('blur', release);
 return {
  cancel: release,
  update(dt) {
   elapsed += dt;
   if (pointer !== null && elapsed >= next) { stamp(last, .35); next = elapsed + interval; }
  },
  dispose() {
   release();
   canvas.removeEventListener('pointerdown', down, true);
   canvas.removeEventListener('pointermove', move);
   for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.removeEventListener(name, release);
   window.removeEventListener('blur', release);
  },
 };
}
