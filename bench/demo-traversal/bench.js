import * as THREE from 'three';
import initJolt from 'jolt-physics';
import {createFixedStep, createJoltHost} from '../../src/core/index.js';
import {createFollowCamera} from './camera.js';
import {shortestTurn} from '../../src/character/angles.js';
import {createLedgeAction} from '../../src/character/actions/ledge.js';
import {createRopeAction} from '../../src/character/actions/rope.js';
import {createLadderAction} from '../../src/character/actions/ladder.js';
import {createPushAction} from '../../src/character/actions/push.js';
import {createActionSet} from '../../src/character/actions/action-set.js';
import {createCrouch} from '../../src/character/crouch.js';
import {createCapstan} from './capstan.js';
import {createWinch} from './winch.js';
import {createCharacterController} from '../../src/character/index.js';
import {addJoltBlocks} from '../kit/jolt-blocks.js';
import {WORLD_COST} from '../kit/world-settings.js';
import {createTouchControls} from '../kit/touch-controls.js';
import {pickQuality} from './quality.js';
import {createCourseLight} from './light.js';
import {createLookInput} from './look-input.js';
import {benchRenderer, bindResize, onLeave, startFrameLoop} from '../kit/page.js';
import {createStairSense} from '../../src/character/stairs.js';
import {GYM_CAPSTAN, GYM_LADDERS, GYM_WINCH, GYM_ROPES, GYM_STATIONS, gymnasiumBlocks, ladderRungBlocks, stairBlocks} from './gymnasium.js';
import {box, courtyardBlocks, COURTYARD_STATION, doorWall, FINISH, HALL_DOOR, YARD, YARD_DOOR} from './courtyard.js';
import {cisternLevelAt, createCistern} from './cistern.js';
import {createCourtyardProps} from './courtyard-props.js';

// A stair up to a drop, on the far side of the gap, to try landings from every height: steps of `rise` by `run` (m),
// centred on x, starting at z.
const TOWER = {steps: 13, rise: .24, run: .4, halfWidth: 1.2, x: 1.8, z: 12.4};
// Where the number keys put her: x, y, z and the way she faces (rad). R, or a fall, brings her back to the last one.
// 1 is the entrance; the others are the areas of the gymnasium beside it (gymnasium.js).
const STATIONS = {Digit1: [0, 0, 0, 0], ...GYM_STATIONS, Digit7: COURTYARD_STATION};
// Landings by the speed she comes down at (m/s): firm from a real drop, hard from a height. A hard landing is rolled out
// when the move asked points within `forward` (a cosine) of the way she faces; otherwise she takes it standing.
const LANDING = {firm: 6.2, hard: 8, forward: .5};
// On stairs with treads shallower than `under` (m) she walks at `pace` times her walk speed: short steps taken at full
// speed would be hurried.
const STAIR_PACE = {under: .7, pace: .75};
// Running into a wall: she was going at least `from` (m/s), kept less than `kept` of it over one physics step, and a wall
// stands within `reach` (m) ahead of her chest (`chest` m up), facing her (cosine under `facing`).
const BUMP = {from: 3, kept: .4, reach: .75, chest: 1, facing: -.7};
// While she hangs: these keys move her along the ledge, to her left (1) or her right (-1).
const SHIMMY = {KeyA: 1, ArrowLeft: 1, KeyD: -1, ArrowRight: -1};
const COURSE = {size: 64, thickness: 1, color: 0x8b7457, blocks: [
 {halfExtents: [3, .5, 7.35], position: [0, -.5, 1.85]},
 {halfExtents: [6, .5, 3], position: [-3, -.5, 14.6]},   // far side of the gap, wide enough to land and roll beside the stair
 {halfExtents: [3, 1.8, .3], position: [0, 1.8, -5.5]},
 ...doorWall([-3.3, -2.7], [0, 3.6], [-5.5, 9.5], YARD_DOOR, FINISH.stone),
 ...doorWall([2.7, 3.3], [0, 3.6], [-5.5, 9.5], HALL_DOOR, FINISH.stone),
 box([YARD.x[1], -3], [YARD.floor, 0], [YARD_DOOR.z - YARD_DOOR.halfWidth, YARD_DOOR.z + YARD_DOOR.halfWidth], FINISH.stone),
 box([3, 5], [YARD.floor, 0], [HALL_DOOR.z - HALL_DOOR.halfWidth, HALL_DOOR.z + HALL_DOOR.halfWidth], FINISH.stone),
 ...courtyardBlocks(),
 {halfExtents: [2.7, .1, .45], position: [0, .1, 4]},
 {halfExtents: [2.7, .2, .45], position: [0, .2, 4.9]},
 {halfExtents: [2.7, .3, 1.9], position: [0, .3, 7.25]},
 {halfExtents: [.45, 1.4, .5], position: [-1.9, 2, 7.8]},
 {halfExtents: [.45, 1.4, .5], position: [1.9, 2, 7.8]},
 {halfExtents: [2.35, .38, .5], position: [0, 3.64, 7.8]},
 ...stairBlocks(TOWER),
 ...gymnasiumBlocks(),
]};
const SHORT_JUMP_MARK = 7.45;
// Capsule (m), speeds (m/s) and feel. Jumps are committed: no steering in the air, a standing jump launches at jumpLaunch.
// She stops harder than she starts (braking), slows into sharp turns and pivots (turnCoupling), and a hard landing costs speed.
// From a standstill she turns on the spot first when the move asked is more than turnFirst (rad) off the way she faces.
const PLAYER = {radius: .3, height: 1.75, walkSpeed: 1.3, runSpeed: 4.4, airControl: 0, jumpSpeed: 5.5, jumpCut: .55, jumpLaunch: 2.4,
 braking: 16, turnSpeed: 12, turnCoupling: .7, turnFirst: .6, standTurnSpeed: 5.5, landingLoss: .7, landingSoft: 4, landingHard: 9};
// Ground under a foot: looked for from `above` to `below` the point asked (m); flatter than `slope` (the normal's Y) or it does not count.
const FOOT = {above: .45, below: .5, slope: .65};
const VIEW = {yaw: 0, pitch: .38, distance: 4.2, height: 1.05, fov: 60, sensitivity: .0025};
const MOVE = {KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [1, 0], ArrowLeft: [1, 0], KeyD: [-1, 0], ArrowRight: [-1, 0]};
const RUN_KEYS = ['ShiftLeft', 'ShiftRight'];
const OTHER_KEYS = ['KeyR', 'KeyE', 'KeyC', 'Space', ...RUN_KEYS, ...Object.keys(STATIONS)];
// On a touch screen (bench/kit/touch-controls.js): buttons that press the page's own keys. The stick moves her, and
// pushed far it makes her run; the numbered ones are the stations. `?touch` in the address shows them on any screen.
const TOUCH_BUTTONS = [
 {id: 'jump', label: 'Jump', code: 'Space'},
 {id: 'drop', label: 'Drop', code: 'KeyS'},      // shown while she hangs from a ledge
 {id: 'swing', label: 'Swing', code: RUN_KEYS[0]},   // shown while she holds a rope
 {id: 'interact', label: 'Use', code: 'KeyE'},
 {id: 'crouch', label: 'Crouch', code: 'KeyC'},
 {id: 'reset', label: 'R', code: 'KeyR', row: 'top'},
 ...Object.keys(STATIONS).map((code, index) => ({id: code, label: String(index + 1), code, row: 'top'})),
];
const PROXY_COLOR = 0xf2a755;   // the capsule drawn while the model loads, or when it cannot
const MS = 1000;
const GRAVITY = 12.8;   // m/s2, the same for the Jolt world, the ropes and the winch

export async function startTraversalBench({loadAvatar, label, createDressing}) {
 const renderer = benchRenderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(VIEW.fov, 1, .1, 200);
 const unbindResize = bindResize(renderer, camera);
 const half = COURSE.size / 2;
 const quality = pickQuality();
 if (quality.pixelRatio) renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
 const light = createCourseLight({renderer, scene, quality, size: COURSE.size}), {stage} = light;

 const jumpMark = new THREE.Mesh(new THREE.PlaneGeometry(5.3, .11), new THREE.MeshBasicMaterial({color: 0xbfa66b}));
 jumpMark.rotation.x = -Math.PI / 2;
 jumpMark.position.set(0, .602, SHORT_JUMP_MARK);
 scene.add(jumpMark);

 const J = await initJolt();
 const host = createJoltHost(J, {gravity: GRAVITY});
 const site = createDressing?.({renderer, scene, environment: stage.environment});
 const blocks = addJoltBlocks({host, scene, blocks: COURSE.blocks, color: COURSE.color, style: site?.style});
 const controller = createCharacterController({J, jolt: host.jolt, layer: host.layers.moving, waterLevelAt: cisternLevelAt, ...PLAYER});
 const cistern = createCistern({renderer, scene, camera, sunDirection: stage.environment.sun.direction});
 // The line that says what E does: the courtyard props write what they offer into propHint, and each frame shows
 // that, or what she holds or could turn (see the frame loop).
 const propPrompt = document.querySelector('#interaction'), propHint = {textContent: ''};
 const props = createCourtyardProps({host, scene, controller, style: site?.style, prompt: propHint, grab: block => push.grabBlock(block)});
 controller.subscribe(cistern.contact);
 const footFrom = new THREE.Vector3(), footTo = new THREE.Vector3();
 function groundAt(point, normal) {
  footFrom.copy(point).y += FOOT.above;
  footTo.copy(point).y -= FOOT.below;
  const hit = host.raycast(footFrom, footTo);
  if (!hit || hit.normal.y < FOOT.slope) return NaN;
  normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
  return hit.point.y;
 }
 const stairsUnder = createStairSense(groundAt);
 // She looks toward a point this far (m) along the way the view looks.
 const LOOK_AHEAD = 15;
 const look = new THREE.Vector3(), viewWay = new THREE.Vector3();
 let tread = 0;   // how deep the stairs under her are (m), or 0
 const status = document.querySelector('#status');
 const walker = new THREE.Group();
 const proxy = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.height - PLAYER.radius * 2), new THREE.MeshStandardMaterial({color: PROXY_COLOR}));
 proxy.position.y = PLAYER.height / 2;
 proxy.castShadow = true;
 walker.add(proxy);
 scene.add(walker);
 let character, rungs, disposed = false;   // rungs: the ladder's, made once her climbing clip says how far apart
 loadAvatar(PLAYER.height, groundAt, (from, to) => host.raycast(from, to)).then(loaded => {
  if (disposed) return;
  character = loaded;
  rope.fit(loaded.ropeGrip);
  ladder.fit(loaded.ladder.grip);
  push.fit(loaded.push);
  rungs = addJoltBlocks({host, scene, blocks: ladderRungBlocks(loaded.ladder.rung, loaded.ladder.first)});
  walker.add(loaded.model);
  proxy.visible = false;
  status.textContent = label + ' ready';
 }, error => { status.textContent = label + ' could not load'; console.error(error); });

 const follow = createFollowCamera(camera, host, VIEW);
 controller.subscribe(event => { if (event.type === 'character:land') follow.land(event.speed); });
 // Where she stood one physics step ago: frames are drawn between that and where she stands now.
 const previous = {position: new THREE.Vector3(), heading: 0};
 function remember() { previous.position.copy(controller.position); previous.heading = controller.heading; }
 const ledge = createLedgeAction({controller, host, radius: PLAYER.radius, height: PLAYER.height});
 const rope = createRopeAction({controller, scene, gravity: GRAVITY, ropes: GYM_ROPES});
 const ladder = createLadderAction({controller, radius: PLAYER.radius, ladders: GYM_LADDERS});
 const push = createPushAction({controller, host, radius: PLAYER.radius});
 const capstan = createCapstan({host, scene, style: site?.style, ...GYM_CAPSTAN});
 // Turning it winds the winch: a rope over a pulley, and a platform that rises out of the pit.
 const winch = createWinch({host, scene, style: site?.style, capstan, gravity: GRAVITY, ...GYM_WINCH});
 // What carries her when she does not move herself, in the order they take her: the rope she holds, the ladder she is
 // on, what she pushes or pulls, else the ledge, which also steps her when she is free. Free, she catches a rope she
 // jumps into, else takes a ladder she walks into or jumps onto.
 const actions = createActionSet()
  .add('rope', rope, {input: i => ({jump: i.jump, climb: i.running ? 0 : i.forward, swing: i.running, push: i.forward, turn: i.side}), take: () => rope.tryCatch()})
  .add('ladder', ladder, {input: i => ({jump: i.jump, climb: i.forward}), take: i => ladder.tryMount(i.moveX, i.moveZ)})
  .add('push', push, {input: i => ({moveX: i.moveX, moveZ: i.moveZ})})
  .add('ledge', ledge, {input: i => ({jump: i.jump && !i.low, climb: i.climb, drop: i.drop, shimmy: i.shimmy})});
 const carrier = () => actions.carrier;
 const crouch = createCrouch({controller, standing: PLAYER.height});
 // Free and on her feet beside the capstan's arm, she can take it.
 const canTurn = () => carrier().state === 'free' && controller.grounded && capstan.near(controller.position);
 // E: lets go of what she holds, else does what the props offer, else takes the capstan's arm, else lowers her from
 // the edge she stands at.
 function use() {
  if (push.state === 'push') push.release();
  else if (propHint.textContent) props.press();
  else if (canTurn()) push.grabTurning(capstan);
  else if (carrier().state === 'free') ledge.lower();
 }
 const UP = new THREE.Vector3(0, 1, 0), turn = new THREE.Quaternion(), tilt = new THREE.Quaternion(), tiltTo = new THREE.Quaternion();
 const TILT_RATE = 12;   // 1/s her body comes upright again once she lets go of a rope
 const keys = new Set(), move = new THREE.Vector2(), clock = createFixedStep();
 let climb = false, drop = false;
 // What the player asks this physics step, read by every action through its own input (see `actions`).
 const intent = {jump: false, forward: 0, side: 0, running: false, low: false, moveX: 0, moveZ: 0, climb: false, drop: false, shimmy: 0};

 let jumped = false, landing = null, bumped = false;
 const wish = {x: 0, z: 0, run: false};   // the move asked last physics step, in the world, and whether at a run: her stops and turn-arounds read it
 let station = STATIONS.Digit1;
 function reset() {
  keys.delete('Space');
  jumped = bumped = false;
  landing = null;
  controller.teleport(...station);
  remember();
  character?.reset();
  clock.reset();
  actions.reset();
  crouch.reset();
  capstan.reset();
  props.reset();
  tilt.identity();
  follow.reset();
  follow.look(shortestTurn(station[3] - follow.yaw), 0);
  climb = drop = false;
 }
 function simulate(dt) {
  remember();
  // Low while she crouches or slides, on her feet only. She stands up again once she is asked to and has the room:
  // under something she stays down.
  crouch.update(dt, actions.free);
  const low = crouch.low;
  move.set(0, 0);
  for (const key of keys) { const axis = MOVE[key]; if (axis) { move.x += axis[0]; move.y += axis[1]; } }
  move.x += touch.move.x; move.y += touch.move.y;
  if (move.lengthSq() > 1) move.normalize();
  // Keys are relative to the camera: forward is the way it looks, left is its left.
  const sin = Math.sin(follow.yaw), cos = Math.cos(follow.yaw);
  // The stick pushed far is a run on the ground; on a rope only the swing button works the swing.
  const running = !low && (RUN_KEYS.some(key => keys.has(key)) || (touch.running && rope.state !== 'rope')), pace = !running && tread > 0 && tread < STAIR_PACE.under ? STAIR_PACE.pace : 1;
  const moveX = wish.x = (sin * move.y + cos * move.x) * pace, moveZ = wish.z = (cos * move.y - sin * move.x) * pace;
  wish.run = running;
  const before = controller.speed;
  let shimmy = 0;
  for (const key of keys) shimmy += SHIMMY[key] ?? 0;
  shimmy += Math.sign(touch.move.x);
  intent.jump = keys.has('Space'); intent.forward = move.y; intent.side = move.x; intent.running = running; intent.low = low;
  intent.moveX = moveX; intent.moveZ = moveZ; intent.climb = climb; intent.drop = drop; intent.shimmy = shimmy;
  actions.update(dt, intent, jump => controller.update(dt, {moveX, moveZ, run: running, jump}));
  if (carrier().state === 'free' && controller.grounded && !controller.committed && before > BUMP.from && controller.speed < before * BUMP.kept) {
   const sinH = Math.sin(controller.heading), cosH = Math.cos(controller.heading), {position: at} = controller;
   const hit = host.raycast(footFrom.set(at.x, at.y + BUMP.chest, at.z), footTo.set(at.x + sinH * BUMP.reach, at.y + BUMP.chest, at.z + cosH * BUMP.reach));
   if (hit && hit.normal.x * sinH + hit.normal.z * cosH < BUMP.facing) {
    bumped = true;
    const recovery = character?.recovery.bump;
    if (recovery) controller.commit(recovery.seconds, recovery.speed);
   }
  }
  // The controller is not stepped while she hangs or climbs, so what it last told is only read when she is free.
  const impact = carrier().state === 'free' ? controller.landed : 0;
  if (impact >= LANDING.firm) {
   const forward = moveX * Math.sin(controller.heading) + moveZ * Math.cos(controller.heading) > LANDING.forward;
   landing = impact < LANDING.hard ? 'firm' : forward ? 'roll' : 'hard';
   const recovery = character?.recovery[landing];
   if (recovery) controller.commit(recovery.seconds, recovery.speed);
  }
  if (climb) keys.delete('Space');
  climb = drop = false;
  jumped ||= controller.jumped;
  props.update(dt, carrier().state === 'free');
  winch.step(dt);
  host.step(dt);
  props.draw();
 }
 // A control goes down or comes up: a key of the keyboard, or a button of the touch controls with the same code.
 function press(code, repeat = false) {
  if (code === 'KeyE') { if (!repeat) use(); return; }
  if (code === 'KeyC') { if (!repeat && actions.free) crouch.toggle(character?.recovery.slide); return; }
  if (code === 'Space' && repeat) return;
  keys.add(code);
  if (!repeat && ledge.state === 'hang') {
   climb ||= code === 'Space';
   drop ||= code === 'KeyS' || code === 'ArrowDown';
  }
  if (!repeat && STATIONS[code]) { station = STATIONS[code]; keys.delete(code); reset(); }
  if (!repeat && code === 'KeyR') reset();
 }
 function release(code) { if (code === 'KeyE') props.release(); keys.delete(code); }
 function keydown(event) {
  if (!MOVE[event.code] && !OTHER_KEYS.includes(event.code)) return;
  event.preventDefault();
  press(event.code, event.repeat);
 }
 function keyup(event) { release(event.code); }
 const touch = createTouchControls({buttons: TOUCH_BUTTONS, onPress: press, onRelease: release, force: new URLSearchParams(location.search).has('touch')});
 function blur() { keys.clear(); props.release(); }
 const lookInput = createLookInput({canvas: renderer.domElement, follow, sensitivity: VIEW.sensitivity});
 window.addEventListener('keydown', keydown);
 window.addEventListener('keyup', keyup);
 window.addEventListener('blur', blur);
 reset();

 let lastFrame = 0, frameMs = 0;   // ms: when the last frame started, and the smoothed time between two
 startFrameLoop(renderer, (dt, now) => {
  if (lastFrame) frameMs += (now - lastFrame - frameMs) * (frameMs ? WORLD_COST.fpsSmoothing : 1);
  lastFrame = now;
  clock.advance(dt, simulate);
  const {position} = controller;
  if (position.y < -2.6 || Math.max(Math.abs(position.x), Math.abs(position.z)) >= half) reset();
  walker.position.copy(previous.position).lerp(position, clock.alpha);
  // On a rope her body lines up with it; let go, she comes upright again.
  tiltTo.setFromUnitVectors(UP, rope.state === 'rope' ? rope.up : UP);
  if (rope.state === 'rope') tilt.copy(tiltTo); else tilt.slerp(tiltTo, 1 - Math.exp(-dt * TILT_RATE));
  walker.quaternion.copy(tilt).multiply(turn.setFromAxisAngle(UP, previous.heading + shortestTurn(controller.heading - previous.heading) * clock.alpha));
  tread = controller.grounded && carrier().state === 'free' ? stairsUnder(position, controller.heading) : 0;
  look.copy(camera.position).addScaledVector(camera.getWorldDirection(viewWay), LOOK_AHEAD);
  character?.update(dt, controller, jumped, PLAYER, carrier(), {landing, wish, tread, look, bumped, crouched: crouch.low, sliding: crouch.sliding});
  jumped = bumped = false;
  landing = null;
  touch.show('drop', ledge.state === 'hang');
  touch.show('swing', rope.state === 'rope');
  const hint = push.state === 'push' ? 'E · Let go' : propHint.textContent || (canTurn() ? 'E · Turn the capstan' : carrier().state === 'free' && ledge.canLower() ? 'E · Climb down' : '');
  if (propPrompt.textContent !== hint) propPrompt.textContent = hint;
  touch.show('interact', Boolean(hint));
  blocks.update();
  rope.draw(camera);
  winch.draw(camera);
  follow.update(dt, {position: walker.position, heading: controller.heading, speed: controller.speed, runSpeed: PLAYER.runSpeed,
   // Pushing she is on her feet: the view stays as it is when she walks.
   action: rope.state === 'rope' || ladder.state === 'ladder' ? 'hang' : push.state === 'push' ? 'free' : carrier().state, grounded: controller.grounded});
  if (character) status.textContent = (rope.state === 'rope' ? 'W S climb · A D turn · Shift swings (with W or S: push that way) · Space jumps off' : ladder.state === 'ladder' ? 'W S climb · Space jumps off' : push.state === 'push' ? 'W pushes · S pulls · E lets go' : ledge.state === 'hang' ? 'Space to climb · S to drop' : carrier().state === 'climb' ? 'Climbing' : label + ' · ' + character.playing)
   + (frameMs ? ` · ${Math.round(MS / frameMs)} fps · ${quality.name} quality` : '');

  light.prepare(camera, now);
  camera.updateMatrixWorld();
  site?.update(dt, camera);
  light.shadows(camera);
  cistern.draw(dt);
  light.present(camera, dt);
 });
 const demo = {controller, host, ledge, rope, ladder, push, capstan, winch, props, reset, follow, get character() { return character; }, touch, stations: STATIONS, quality, light, actions, crouch};
 onLeave(() => {
  disposed = true;
  renderer.setAnimationLoop(null);
  window.removeEventListener('keydown', keydown);
  window.removeEventListener('keyup', keyup);
  window.removeEventListener('blur', blur);
  lookInput.dispose();
  unbindResize();
  character?.dispose();
  controller.dispose();
  blocks.dispose();
  props.dispose();
  winch.dispose();
  capstan.dispose();
  cistern.dispose();
  site?.dispose();
  rope.dispose();
  rungs?.dispose();
  touch.dispose();

  host.dispose();
  const resources = new Set();
  walker.traverse(node => {
   if (!node.isMesh) return;
   resources.add(node.geometry);
   for (const material of [].concat(node.material)) { resources.add(material); if (material.map) resources.add(material.map); }
  });
  for (const resource of resources) resource.dispose();
  jumpMark.geometry.dispose();
  jumpMark.material.dispose();
  light.dispose();
  renderer.dispose();
 });
 return demo;
}
