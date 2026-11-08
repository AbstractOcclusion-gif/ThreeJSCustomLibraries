// Three-phase utility pole: dimensions of the Glider cable lab's 'triple' rig, inlined (pole 6 m, arm 3 m, phases at 6.3 m).
import * as T from 'three';
export const POLE = Object.freeze({height: 6, radius: .1, color: 0x9374cc, arm: {width: .16, height: .2, length: 3, color: 0x98774b}});
export const phases = Object.freeze([[6.3, -1.2], [6.3, 0], [6.3, 1.2]]);   // [height, lateral offset]
// mesh(geometry, color) -> Mesh lets the host own materials; default creates MeshStandardMaterial.
export function createUtilityPole(mesh = (g, c) => new T.Mesh(g, new T.MeshStandardMaterial({color: c, roughness: 1}))) {
  const pole = new T.Group(); pole.name = 'utility-pole';
  const shaft = mesh(new T.CylinderGeometry(POLE.radius, POLE.radius, POLE.height, 10), POLE.color); shaft.position.y = POLE.height / 2;
  const arm = mesh(new T.BoxGeometry(POLE.arm.width, POLE.arm.height, POLE.arm.length), POLE.arm.color); arm.position.y = POLE.height;
  pole.add(shaft, arm);
  for (const [height, offset] of phases) { const insulator = mesh(new T.CylinderGeometry(.09, .12, height - POLE.height, 8), 0xc2d4c4); insulator.position.set(0, (height + POLE.height) / 2, offset); pole.add(insulator); }
  return pole;
}
