import {createInteraction} from '../../src/interaction/index.js';
import {addJoltBlocks} from '../kit/jolt-blocks.js';
import {FINISH, box} from './courtyard.js';

const SLED = {x: [-11.45, -10.55], z: [-.45, .45], height: .76, mass: 24};
const SCREEN = {x: [-18.15, -17.85], z: [-.9, .9], rows: 3, columns: 4, course: .38, joint: .015,
 stoneMass: 8, kick: 9};
const REACH = {sled: 1.75, screen: 1.65, footHeight: .55};

// grab(block): takes hold of the crate ({body, mesh, halfExtents}), to push and pull it (push.js).
export function createCourtyardProps({host, scene, style, controller, prompt, grab}) {
 const interaction = createInteraction();
 const impulse = new host.J.Vec3(0, 0, 0);
 const add = blocks => addJoltBlocks({host, scene, blocks, style});
 const sledPlan = {...box(SLED.x, [0, SLED.height], SLED.z, FINISH.timber), mass: SLED.mass};
 const screenPlan = box(SCREEN.x, [0, SCREEN.rows * SCREEN.course], SCREEN.z, FINISH.stone);
 const {z, rows, columns, course, joint, stoneMass, kick} = SCREEN;
 const width = (z[1] - z[0]) / columns;
 const stones = Array.from({length: rows * columns}, (_, i) => {
  const row = Math.floor(i / columns), start = z[0] + (i % columns) * width;
  return box(SCREEN.x, [row * course, (row + 1) * course - joint], [start, start + width - joint], FINISH.stone);
 });
 let sled, intact, rubble;
 function reset() {
  interaction.cancel();
  interaction.focus(null);
  sled?.dispose();
  intact?.dispose();
  rubble?.dispose();
  sled = add([sledPlan]);
  intact = add(stones);
  rubble = null;
  prompt.textContent = '';
 }
 function throwBody(body, x, y, z) {
  impulse.Set(x, y, z);
  host.bodies.AddImpulse(body.GetID(), impulse);
 }
 interaction.register('sled', {prompt: 'Grab the timber crate', activate() { grab({...sled.entries[0], halfExtents: sledPlan.halfExtents}); }});
 interaction.register('screen', {prompt: 'Knock down the loose masonry', activate() {
  intact.dispose();
  intact = null;
  rubble = add(stones.map(stone => ({...stone, mass: stoneMass})));
  const away = Math.sign(screenPlan.position[0] - controller.position.x);
  for (const [i, {body}] of rubble.entries.entries()) {
   const heightShare = (Math.floor(i / columns) + 1) / rows;
   throwBody(body, away * kick * heightShare, 0, 0);
  }
 }});
 return {
  reset,
  press: interaction.press,
  release: interaction.release,
  update(dt, enabled) {
   const at = controller.position, crate = sled.entries[0].mesh.position, [x, , z] = screenPlan.position;
   const crateDistance = Math.hypot(at.x - crate.x, at.z - crate.z);
   const screenDistance = rubble ? Infinity : Math.hypot(at.x - x, at.z - z);
   const onFoot = enabled && controller.grounded && Math.abs(at.y) <= REACH.footHeight;
   const crateInReach = crateDistance <= REACH.sled;
   const screenInReach = screenDistance <= REACH.screen;
   const target = !onFoot ? null :
    crateInReach && (!screenInReach || crateDistance < screenDistance) ? 'sled' : screenInReach ? 'screen' : null;
   interaction.focus(target);
   interaction.update(dt);
   const status = interaction.status;
   const message = status ? 'E · ' + status.prompt : '';
   if (prompt.textContent !== message) prompt.textContent = message;
  },
  draw() { sled.update(); rubble?.update(); },
  dispose() {
   interaction.dispose();
   sled.dispose();
   intact?.dispose();
   rubble?.dispose();
   host.J.destroy(impulse);
  },
 };
}
