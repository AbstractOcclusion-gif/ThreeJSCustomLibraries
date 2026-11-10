// Bench-only: aim a raycaster from a pointer event on the canvas.
import {Vector2} from 'three';

const pointer = new Vector2();

export function aimRay(raycaster, event, element, camera) {
  const bounds = element.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
  raycaster.setFromCamera(pointer, camera);
  return raycaster;
}
