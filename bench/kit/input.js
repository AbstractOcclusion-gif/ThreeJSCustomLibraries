// Bench-only: aim a raycaster from a pointer event on the canvas.
import {Vector2} from 'three';
import {onLeave} from './page-lifecycle.js';

const pointer = new Vector2();
const DEFAULT_TAP_DISTANCE = 8;

export function aimRay(raycaster, event, element, camera) {
  const bounds = element.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
  raycaster.setFromCamera(pointer, camera);
  return raycaster;
}

// A drag that returns to its origin and a two-finger pinch are never taps.
export function bindSceneTap(element, onTap, {distance = DEFAULT_TAP_DISTANCE} = {}) {
  const pointers = new Set();
  let start = null;
  const moved = event => Math.hypot(event.clientX - start.x, event.clientY - start.y) > distance;
  function down(event) {
    pointers.add(event.pointerId);
    start = pointers.size === 1 && event.button === 0 && event.isPrimary !== false
      ? {id: event.pointerId, x: event.clientX, y: event.clientY}
      : null;
  }
  function move(event) {
    if (start?.id === event.pointerId && moved(event)) start = null;
  }
  function up(event) {
    const tap = start?.id === event.pointerId && pointers.size === 1 && !moved(event);
    cancel(event);
    if (tap) onTap(event);
  }
  function cancel(event) {
    start = null;
    pointers.delete(event.pointerId);
  }
  function blur() {
    start = null;
    pointers.clear();
  }
  const listeners = {pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel};
  for (const [type, listener] of Object.entries(listeners)) element.addEventListener(type, listener);
  addEventListener('blur', blur);
  function dispose() {
    for (const [type, listener] of Object.entries(listeners)) element.removeEventListener(type, listener);
    removeEventListener('blur', blur);
    blur();
  }
  onLeave(dispose);
  return dispose;
}
