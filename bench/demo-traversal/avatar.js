import {createGrounder} from '../../src/character/ik/grounder.js';
import {createHeadLook} from '../../src/character/ik/head-look.js';
import {prepareTransition, sample, timeAtSpeed, timeAtTurn} from '../../src/character/clips/transitions.js';
import {prepareMixamo} from '../../src/character/clips/mixamo-clips.js';
import {mirrorClip} from '../../src/character/clips/mirror-takeoff.js';
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';

import {createFootPlacement} from '../../src/character/ik/foot-placement.js';
import {createHandPlacement} from '../../src/character/ik/hand-placement.js';
import {LEDGE_CLIPS} from '../../src/character/clips/traversal-clips.js';
import {shortestTurn} from '../../src/character/angles.js';

const CLIP_BASE = '/character/mixamo/';   // local clips, served from private-assets in development
const IDLE_FILE = 'Standing Idle';   // the standing pose, a clip in /character/mixamo; ?idle=<file name> tries another
// Blends between clips ease in and out over these times (s): into standing or the stride, and into a sharper move
// (a take-off, a landing, a grab).
const IDLE_BLEND_SECONDS = .22, SHARP_BLEND_SECONDS = .12;
const STILL_SPEED = .08;   // m/s under which she stands
const LEFT = 0, RIGHT = 1; // feet, as the gait contact phases index them
const FALL_SPEED = 7;      // m/s of fall from which the fall loop replaces the jump's air pose: faster than a jump lands, even onto lower ground
// Landings heavier than the jump's own, each played from the frame her feet touch the ground (frames at 30 fps):
// firm = a real drop taken standing, hard = from a height with a long recovery, roll = a hard one rolled out.
const LANDINGS = {firm: {first: 8, last: 32}, hard: {first: 18, last: 75}, roll: {first: 14, last: 56}};
const LANDING_FILES = {firm: 'falling to landing', hard: 'hard landing', roll: 'falling to roll'};
const HARD_RECOVERY = .75; // share of the hard landing after which she can move again
const FIRM_BREAK = .3;     // s of a firm landing that always plays before a move cuts it
// Running into a wall: the clip she reacts with, and the share of it after which she can move again.
const BUMP = {file: 'Standing Block React Large', recovery: .5};
// Moving along a ledge she hangs from: the clip (it goes to her left; its mirror goes right). Her hands stay on the
// edge, each where the clip has it along it.
const SHIMMY = {file: 'Braced Hang Shimmy'};
// On a rope: the clip she climbs it with, held still while she just hangs on; each foot is set against the rope, `aside`
// m to its own side of it.
const ROPE = {file: 'Climbing A Rope', aside: .05};
// On a ladder: the clip she climbs it with, held still while she just holds on. One cycle of it takes `rungsPerCycle`
// rungs (a hand each), which sets how far apart a ladder's rungs are for her hands and feet to meet them.
// The file has her facing away from her own forward: `yaw` (rad) turns it round. `sole` (m) is how far under the ball
// of her foot, the joint the clip moves, the rung she stands on is.
const LADDER = {file: 'Climbing Ladder', rungsPerCycle: 2, yaw: Math.PI, sole: .04};
// Hanging, a foot whose ball is within `near` m of the wall is set against it, `pad` m off; `probe` m is how far either
// side of the ball the wall is looked for.
const WALL_FEET = {near: .3, pad: .03, probe: .45};
// Pushing and pulling: the clip she pushes with is a whole push, from its start to its stop, so only one stride of
// its steady middle is kept (frames at 30 fps, chosen where the two ends match best); the pull is a loop as it is.
// Her hands are set against what she holds, `palm` m off it.
const PUSH = {file: 'Push', first: 82, last: 132, pull: 'Pull Heavy Object', palm: .03};
// Crouching: the pose she keeps low in, the walk she moves low with, and the slide a crouch at a run starts with.
const CROUCH = {idle: 'Crouching Idle', walk: 'Crouched Walking', slide: 'Running Slide'};
// Stops and turn-arounds, one set for the walk and one for the run (see transitions.js). first: the frame the clip is
// played from; turn: it turns her round.
const MOVE_CLIPS = {
 stop: {run: {file: 'Run To Stop'}, walk: {file: 'Female Stop Walking (1)', first: 26}},
 pivot: {run: {file: 'Running Turn 180', turn: true}, walk: {file: 'Walking Turn 180', turn: true}},
 turn: {stand: {file: 'left turn', turn: true, sway: true}},   // a quarter turn on the spot; its mirror turns the other way
};
const MOVES = {
 from: .8,           // m/s she has to be going for a stop or a turn-around to be played at all
 afterTravel: .9,    // m she has to have covered in the stride first: a tap forward gets no stop, just the blend back
 turnAfter: .25,     // rad she has to have turned on the spot before the turn's own steps are played
 runFrom: 2.6,       // m/s from which the run's clips replace the walk's
 settle: .25,        // m/s under which a stop plays out on its own time
 walkStopRate: 1.3,  // playback rate of the walk's stop, which is played through rather than matched
 creep: .35,         // share of real time a matched clip always advances by, so it never freezes on a frame
 pivotAngle: -.7,    // cosine between the move asked and the way she travels under which she turns around
 changedMind: .5,    // cosine between the move asked and the turn-around's goal under which it is dropped
 eitherWay: 2.8,     // rad: a turn-around wider than this goes round whichever way suits the foot she is on
 offsetRate: 12,     // 1/s the model's own turn eases out once a turn-around ends or is dropped
 fade: .2,           // s to blend into one of these clips
 maxRate: 2.2,       // fastest a matched clip is played, in times real time: beyond that it lags her rather than rushing
 handOver: .9,       // share of her walk or run speed, and of the turn, at which the stride takes over from a turn-around
 finishRate: 2,      // playback rate of what is left of a turn-around once she is back up to speed
};
const WALK_IN = .7;        // share of the walk speed where the walk has fully replaced the idle pose
const WALK_IN_RATE = 9;    // 1/s that share follows her speed
// On stairs her steps shorten to the treads: one tread a step at a walk, the nearest whole number of treads at a run.
// least: the shortest her stride gets, as a share of the clip's; rate: 1/s it changes at.
const STAIR_STRIDE = {least: .35, rate: 6};
// Her head, neck and upper spine share the turn toward what she looks at.
const LOOK_SHARES = {spine2: .15, neck: .3, head: .55};
// A hand goes to a wall beside her: looked for `drop` m under the shoulder, out to `reach` m, not nearer than `least`;
// held `palm` m off it; only on a wall more upright than `upright` (its normal's Y) and while she goes slower than
// `maxSpeed` (m/s). rateIn and rateOut: 1/s the hand goes out and comes back; after: s the wall has to have been there first.
const TOUCH = {drop: .22, reach: .62, least: .22, palm: .05, upright: .35, maxSpeed: 2.6, rateIn: 4, rateOut: 3.5, after: .3};
// Banking into turns: rad of lean per m/s of speed and rad/s of turn, the most she leans (rad), how fast it follows (1/s).
const LEAN = {perTurn: .012, most: .16, rate: 8};

function mixamoJoint(name) {
 const key = name.replace(/^mixamorig:?/, '').replace(/^(Left|Right)/, side => side[0] + '_').toLowerCase();
 return key;
}

// groundAt(point, normal): ground height under a world point, or NaN. probe(from, to): the first thing between two world
// points, as {point, normal, distance}, or null; without it her hands do not look for walls.
export async function loadTraversalAvatar(height, groundAt, probe, {
 loadRig, useNativeWalk = false, adaptMixamo = source => source,
 loadFbx = path => new FBXLoader().loadAsync(path),
} = {}) {
 const loadMixamo = file => loadFbx(CLIP_BASE + file + '.fbx');
 const kinds = Object.keys(LANDINGS);
 const moveKinds = Object.entries(MOVE_CLIPS).flatMap(([type, set]) => Object.entries(set).map(([gait, spec]) => ({type, gait, ...spec})));
 const idleFile = new URLSearchParams(globalThis.location?.search).get('idle') || IDLE_FILE;
 const [{rig, nativeWalk, disposeAssets}, sources, movesLoaded, traversal] = await Promise.all([
  loadRig(),
  Promise.all([idleFile, 'walking', 'running', 'jump', BUMP.file, SHIMMY.file, ROPE.file, LADDER.file, PUSH.file, PUSH.pull,
   CROUCH.idle, CROUCH.walk, CROUCH.slide, 'falling idle', ...kinds.map(kind => LANDING_FILES[kind])].map(loadMixamo)),
  Promise.all(moveKinds.map(kind => loadMixamo(kind.file))),
  Promise.all(LEDGE_CLIPS.map(({file}) => loadMixamo('ledge/' + file))),
 ]);
 rig.traverse(node => {
  if (!node.isMesh) return;
  node.castShadow = true;
  node.frustumCulled = false;
 });

 const [mixIdle, mixWalk, mixRun, mixJump, mixBump, mixShimmy, mixRope, mixLadder, mixPush, mixPull,
  mixCrouch, mixCrouchWalk, mixSlide, mixFall, mixFirm, mixHard, mixRoll] = sources.map(source => adaptMixamo(source, rig));
 const original = useNativeWalk && Boolean(nativeWalk);
 const mixer = new THREE.AnimationMixer(rig);
 const hips = rig.getObjectByName('mixamorigHips');
 const root = nativeWalk?.tracks.find(track => track.name === hips.name + '.position') ??
  new THREE.VectorKeyframeTrack(hips.name + '.position', [0], hips.position.toArray());
 const idleClip = prepareMixamo(mixIdle, rig, 'idle', root).clip;
 const trialWalk = prepareMixamo(mixWalk, rig, 'walk', root);
 const trialRun = prepareMixamo(mixRun, rig, 'run', root);
 const walkClip = original ? nativeWalk : trialWalk.clip;
 const runClip = trialRun.clip;
 const takeoffClip = prepareMixamo(mixJump, rig, 'takeoff', root, {first: 10, last: 21, airborne: true}).clip;
 const movingJump = takeoffClip.clone();
 const airClip = prepareMixamo(mixJump, rig, 'air', root, {first: 21, last: 32, airborne: true}).clip;
 // The landing keeps the clip's own pelvis motion, so she sinks into it with her feet on the ground.
 const landClip = prepareMixamo(mixJump, rig, 'land', root, {first: 32, last: 50}).clip;
 const fallClip = prepareMixamo(mixFall, rig, 'fall', root, {airborne: true}).clip;
 const bumpClip = prepareMixamo(mixBump, rig, 'bump', root).clip;
 // Low: the crouch on the spot, its walk as fast as she really goes, and the slide, which keeps its own sink and rise.
 const crouchClip = prepareMixamo(mixCrouch, rig, 'crouch', root).clip, crouchData = prepareMixamo(mixCrouchWalk, rig, 'crouch walk', root);
 const slideData = prepareMixamo(mixSlide, rig, 'slide', root);
 // Both are played on the spot, as fast as what she holds really goes.
 const pushData = prepareMixamo(mixPush, rig, 'push', root, {first: PUSH.first, last: PUSH.last}), pullData = prepareMixamo(mixPull, rig, 'pull', root);
 // The shimmy is not set on the ground like the others: she hangs, with her pelvis where the hang has it.
 const shimmy = prepareMixamo(mixShimmy, rig, 'shimmy', root);
 // These keep the pelvis motion of the clip (the crouch, the roll); only its steady travel is left to the controller.
 const landings = Object.fromEntries([mixFirm, mixHard, mixRoll].map((source, i) => [kinds[i], prepareMixamo(source, rig, kinds[i], root, LANDINGS[kinds[i]])]));
 function poseBounds(clip) {
  mixer.clipAction(clip).play();
  mixer.update(0);
  rig.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(rig, true);
  mixer.stopAllAction();
  return bounds;
 }
 const walkBounds = poseBounds(nativeWalk ?? walkClip);
 const worldToPelvis = new THREE.Matrix3().setFromMatrix4(hips.parent.matrixWorld).invert();
 const lift = new THREE.Vector3();
 // Puts a clip's first pose on the ground her own walk stands on.
 function settle(clip) {
  const start = poseBounds(clip);
  const track = clip.tracks.find(track => track.name === root.name);
  lift.set(0, walkBounds.min.y - start.min.y, 0).applyMatrix3(worldToPelvis);
  for (let i = 0; i < track.values.length; i += 3) {
   track.values[i] += lift.x;
   track.values[i + 1] += lift.y;
   track.values[i + 2] += lift.z;
  }
 }
 for (const clip of [idleClip, ...(original ? [] : [walkClip]), runClip, takeoffClip, movingJump, airClip, landClip, fallClip, bumpClip, pushData.clip, pullData.clip, crouchClip, crouchData.clip, slideData.clip, ...kinds.map(kind => landings[kind].clip)]) settle(clip);
 const scale = height / (walkBounds.max.y - walkBounds.min.y);
 const pelvisMetres = hips.parent.getWorldScale(new THREE.Vector3()).y * scale;
 const moveData = movesLoaded.map((source, i) => prepareTransition(adaptMixamo(source, rig), rig, moveKinds[i].type + ' ' + moveKinds[i].gait, root, {...moveKinds[i], scale}));
 for (const data of moveData) settle(data.clip);
 // Her own walk is the Mixamo walk played in place, so the Mixamo file tells how far one cycle really carries her.
 const walkStride = trialWalk.stride * pelvisMetres;
 const runStride = trialRun.stride * pelvisMetres;
 const feet = walkBounds.getCenter(new THREE.Vector3());
 feet.y = walkBounds.min.y;
 const model = new THREE.Group();
 model.scale.setScalar(scale);
 // Keep the visual offset below the scaled group so physics still sees feet at zero.
 const offset = new THREE.Group();
 offset.position.copy(feet).negate();
 offset.add(rig);
 model.add(offset);

 const [idle, walk, run, takeoff, air, land] = [idleClip, walkClip, runClip, takeoffClip, airClip, landClip]
  .map(clip => mixer.clipAction(clip));
 const runningTakeoff = mixer.clipAction(movingJump);
 const oppositeTakeoff = mixer.clipAction(mirrorClip(movingJump, rig));
 // The jump is one-sided: one foot pushes off last and the other touches down first. The mirrored set swaps them, and
 // a jump keeps one set from take-off to landing.
 const oppositeAir = mixer.clipAction(mirrorClip(airClip, rig)), oppositeLand = mixer.clipAction(mirrorClip(landClip, rig));
 const fall = mixer.clipAction(fallClip);
 const heavy = Object.fromEntries(kinds.map(kind => [kind, mixer.clipAction(landings[kind].clip)]));
 // What the controller is committed to while a landing plays: how long (s) and how fast she travels (m/s).
 const recovery = {
  hard: {seconds: landings.hard.clip.duration * HARD_RECOVERY, speed: 0},
  roll: {seconds: landings.roll.clip.duration, speed: landings.roll.stride * pelvisMetres / landings.roll.clip.duration},
  bump: {seconds: bumpClip.duration * BUMP.recovery, speed: 0},
  slide: {seconds: slideData.clip.duration, speed: slideData.stride * pelvisMetres / slideData.clip.duration},
 };
 const bump = mixer.clipAction(bumpClip);
 const crouchIdle = mixer.clipAction(crouchClip), crouchWalk = mixer.clipAction(crouchData.clip), slide = mixer.clipAction(slideData.clip);
 const crouchPace = crouchData.stride * pelvisMetres / crouchData.clip.duration;   // m/s the low walk goes at
 if (!(crouchPace > 0)) throw Error(`The "${CROUCH.walk}" clip has to travel: it cannot be the in-place version`);
 // On a rope she is carried: the clip keeps its bob but none of its own rise, and plays as fast as she climbs.
 const ropeClimb = prepareMixamo(mixRope, rig, 'rope', root, {carried: true});
 const ropeHold = mixer.clipAction(ropeClimb.clip);
 const shimmyLeft = mixer.clipAction(shimmy.clip), shimmyRight = mixer.clipAction(mirrorClip(shimmy.clip, rig));
 const ropePace = ropeClimb.rise * pelvisMetres / ropeClimb.clip.duration;   // m/s the clip climbs at
 // Where a climbing clip has what she holds (a rope, a ladder): the middle of her two hands over the whole climb, from her feet (m): how far up, ahead
 // of her and to her left.
 function gripOf(hold) {
  const grip = {height: 0, ahead: 0, aside: 0};
  const wrists = ['Left', 'Right'].map(side => rig.getObjectByName('mixamorig' + side + 'Hand')), at = new THREE.Vector3(), origin = new THREE.Vector3(), samples = 24;
  hold.play();
  for (let i = 0; i < samples; i++) {
   hold.time = hold.getClip().duration * i / samples;
   mixer.update(0);
   model.updateMatrixWorld(true);
   model.getWorldPosition(origin);
   for (const wrist of wrists) {
    wrist.getWorldPosition(at).sub(origin);   // she is not turned yet: the world's axes are hers
    grip.height += at.y / (samples * 2); grip.ahead += at.z / (samples * 2); grip.aside += at.x / (samples * 2);
   }
  }
  mixer.stopAllAction();
  return grip;
 }
 const ropeGrip = gripOf(ropeHold);
 // On a ladder she is carried the same way; the ladder is where that clip has her hands, and its rungs as far apart
 // as the clip climbs between two of them.
 const ladderClimb = prepareMixamo(mixLadder, rig, 'ladder', root, {carried: true, centred: true, yaw: LADDER.yaw});
 if (!(ladderClimb.rise > 0)) throw Error(`The "${LADDER.file}" clip does not rise: it needs its own climb, not the in-place version`);
 const ladderHold = mixer.clipAction(ladderClimb.clip);
 // What she holds as she pushes: how far ahead of her the clip has her hands, and how fast each clip walks (m/s).
 const pushWalk = mixer.clipAction(pushData.clip), pullWalk = mixer.clipAction(pullData.clip);
 const push = {ahead: gripOf(pushWalk).ahead + PUSH.palm, pushSpeed: pushData.stride * pelvisMetres / pushData.clip.duration, pullSpeed: pullData.stride * pelvisMetres / pullData.clip.duration};
 if (!(push.pushSpeed > 0 && push.pullSpeed > 0)) throw Error('The push and pull clips have to travel: they cannot be the in-place versions');
 const ladderCycle = ladderClimb.rise * pelvisMetres;   // m she climbs over one cycle of the clip
 // Where the ladder has to be for that clip: grip (as ropeGrip), rung (m between two rungs) and first (m from its foot
 // up to the lowest one, set below from where the clip rests her feet).
 const ladder = {grip: gripOf(ladderHold), rung: ladderCycle / LADDER.rungsPerCycle, first: 0};   // first: the top of the lowest rung
 const shimmyPace = shimmy.stride * pelvisMetres / shimmy.clip.duration;   // m/s the clip moves her along the ledge
 for (const action of [takeoff, runningTakeoff, oppositeTakeoff, air, land, oppositeAir, oppositeLand, bump, slide, ...kinds.map(kind => heavy[kind])]) {
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
 }
 const hands = createHandPlacement(rig);
 const bones = new Map();
 rig.traverse(bone => { if (bone.isBone) bones.set(mixamoJoint(bone.name), bone); });
 idle.play();
 mixer.update(0);
 const ankleProbe = new THREE.Vector3(), otherProbe = new THREE.Vector3();
 const ankle = (bones.get('l_foot').getWorldPosition(ankleProbe).y + bones.get('r_foot').getWorldPosition(ankleProbe).y) / 2;
 mixer.stopAllAction();
 // The rungs her feet rest on. Followed up the ladder (the clip's own rise put back), the ball of a foot stops on a
 // rung, then goes on to the next but one; the height at which it is stillest is where a rung has to be.
 {
  const ball = bones.get('l_toebase'), origin = new THREE.Vector3(), samples = 48, heights = [];
  ladderHold.play();
  for (let i = 0; i < samples; i++) {
   ladderHold.time = ladderClimb.clip.duration * i / samples;
   mixer.update(0);
   model.updateMatrixWorld(true);
   model.getWorldPosition(origin);
   heights.push(ball.getWorldPosition(ankleProbe).y - origin.y + ladderCycle * i / samples);
  }
  mixer.stopAllAction();
  // A cycle later the foot is one cycle higher: the samples wrap with that.
  const at = i => heights[(i + samples) % samples] + ladderCycle * Math.floor(i / samples);
  let stillest = 0;
  for (let i = 1; i < samples; i++) if (Math.abs(at(i + 1) - at(i - 1)) < Math.abs(at(stillest + 1) - at(stillest - 1))) stillest = i;
  ladder.first = ((heights[stillest] - LADDER.sole) % ladder.rung + ladder.rung) % ladder.rung;
 }
 function contactPhases(gait) {
  const feet = [bones.get('l_foot'), bones.get('r_foot')];
  const samples = 32;
  const scores = [-Infinity, -Infinity], phases = [0, .5];
  mixer.stopAllAction();
  gait.reset().setEffectiveTimeScale(0).play();
  for (let i = 0; i < samples; i++) {
   gait.time = gait.getClip().duration * i / samples;
   mixer.update(0);
   const a = feet[0].getWorldPosition(ankleProbe).y;
   const b = feet[1].getWorldPosition(ankleProbe).y;
   for (const [side, score] of [[0, b - a - a], [1, a - b - b]]) {
    if (score > scores[side]) { scores[side] = score; phases[side] = i / samples; }
   }
  }
  mixer.stopAllAction();
  return phases;
 }
 const walkContact = contactPhases(walk), runContact = contactPhases(run);
 const runPhaseOffset = runContact[0] - walkContact[0];
 // The lower foot at a moment of a clip: the one still on, or first back on, the ground.
 function lowerFoot(clip, time) {
  const feet = [bones.get('l_foot'), bones.get('r_foot')];
  mixer.stopAllAction();
  const action = mixer.clipAction(clip).reset().setEffectiveTimeScale(0).play();
  action.time = time;
  mixer.update(0);
  const side = feet[LEFT].getWorldPosition(ankleProbe).y <= feet[RIGHT].getWorldPosition(otherProbe).y ? LEFT : RIGHT;
  mixer.stopAllAction();
  action.setEffectiveTimeScale(1);
  return side;
 }
 const pushFoot = lowerFoot(takeoffClip, takeoffClip.duration), landFoot = lowerFoot(airClip, airClip.duration);
 // Each stop and turn-around as authored and mirrored: the foot she stands on as it starts and as it ends, and the way
 // it turns her (+1 or -1 times the clip's own turn).
 const moves = {stop: {}, pivot: {}, turn: {}};
 for (const [i, kind] of moveKinds.entries()) {
  const data = moveData[i], startFoot = lowerFoot(data.clip, 0), endFoot = lowerFoot(data.clip, data.duration);
  moves[kind.type][kind.gait] = [
   {data, action: mixer.clipAction(data.clip), startFoot, endFoot, way: 1},
   {data, action: mixer.clipAction(mirrorClip(data.clip, rig)), startFoot: 1 - startFoot, endFoot: 1 - endFoot, way: -1},
  ];
 }
 const moveActions = Object.values(moves).flatMap(set => Object.values(set).flatMap(pair => pair.map(variant => variant.action)));
 for (const action of moveActions) {
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
 }
 // How high her ankle sits when the foot is flat on the floor: the lowest it gets through the walk. (Standing, her
 // ankles sit higher, and feet held to that height walk with bent knees.)
 // And where in the stride both feet are nearest the floor: setting off from a standstill starts there, so a first
 // step, or a tap, moves her legs as little as it can.
 let stanceAnkle = Infinity, startPhase = 0, lowestPair = Infinity;
 mixer.stopAllAction();
 walk.reset().setEffectiveTimeScale(0).play();
 for (let i = 0; i < 32; i++) {
  walk.time = walkClip.duration * i / 32;
  mixer.update(0);
  const left = bones.get('l_foot').getWorldPosition(ankleProbe).y, right = bones.get('r_foot').getWorldPosition(ankleProbe).y;
  stanceAnkle = Math.min(stanceAnkle, left, right);
  if (Math.max(left, right) < lowestPair) { lowestPair = Math.max(left, right); startPhase = i / 32; }
 }
 mixer.stopAllAction();
 const soleHeight = Math.max(.025, Math.min(ankle, stanceAnkle));
 const footIK = createFootPlacement(bones, soleHeight);
 const grounder = createGrounder({bones, footIK, soleHeight, groundAt});
 const headLook = createHeadLook(Object.entries(LOOK_SHARES).map(([name, share]) => ({bone: bones.get(name), share})));
 const touch = [LEFT, RIGHT].map(side => ({shoulder: bones.get(side === LEFT ? 'l_arm' : 'r_arm'), point: new THREE.Vector3(), away: new THREE.Vector3(), weight: 0, dwell: 0, found: false}));
 const touchFrom = new THREE.Vector3(), touchTo = new THREE.Vector3(), wallProbe = new THREE.Vector3();
 const wallGoals = [LEFT, RIGHT].map(() => ({point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0)})), wallFeet = [null, null];
 // To compare: ?ground=off leaves her feet as the clips put them.
 const grounding = new URLSearchParams(globalThis.location?.search).get('ground') !== 'off';
 const floor = new THREE.Vector3();
 const pelvis = idleClip.tracks.find(track => track.name === hips.name + '.position');
 const [grab, hang, climb, drop] = traversal.map((source, i) => {
  const {name, first, last} = LEDGE_CLIPS[i];
  // Ledge physics positions the capsule. The clip supplies the pose and timing.
  const {clip} = prepareMixamo(adaptMixamo(source, rig), rig, name, pelvis, {first, last, airborne: true, centred: true});
  return mixer.clipAction(clip);
 });
 for (const action of [grab, hang, climb, drop]) {
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
 }
 let vertical = 0, impact = 0, launchPose = 0;
 let reach = 0, ropeReach = 0, ladderReach = 0, pushReach = 0, previousAction = 'free';
 const ropeHand = new THREE.Vector3(), ropeHands = [new THREE.Vector3(), new THREE.Vector3()];
 let lean = 0, lastHeading = null;
 let current, finished, phase = 0, jogShare = 0, airTime = 0, airborne = false;
 const actions = [idle, walk, run, takeoff, runningTakeoff, oppositeTakeoff, air, land, oppositeAir, oppositeLand, fall, bump, shimmyLeft, shimmyRight, ropeHold, ladderHold, pushWalk, pullWalk, crouchIdle, crouchWalk, slide, ...kinds.map(kind => heavy[kind]), ...moveActions, grab, hang, climb, drop];
 let mirrored = false;   // whether this jump or fall plays the mirrored set
 // A change of clip blends from the weights at that moment to the new ones along an eased curve: slow in, slow out.
 const blendFrom = new Map();
 let blendSpan = 0, blendTime = 0;
 let move = null;        // the stop or turn-around playing: its variant, the time shown, and for a turn where it goes
 let asked = false;      // whether a move was asked last frame
 let strideTravel = 0;   // m covered in the stride since she last stood still
 let moving = 0;         // share of the walk in the standing-to-walking blend
 let strideShare = 1;    // share of the clip's stride she takes (under 1 on stairs)
 let rootedFrom = null;  // the heading she had when she began turning on the spot, or null
 let yawOffset = 0;      // rad the model is turned from the capsule's heading while a turn-around plays
 // Picks the stride back up with `side` as the foot that has just come down.
 function resumeStride(side, running) {
  phase = ((running ? runContact[side] - runPhaseOffset : walkContact[side]) + 1) % 1;
 }
 // The foot carrying her at this point of the stride: the one whose contact the gait phase is nearest.
 function stanceFoot() {
  const away = side => {
   const contact = jogShare > .5 ? runContact[side] - runPhaseOffset : walkContact[side];
   const apart = ((phase - contact) % 1 + 1) % 1;
   return Math.min(apart, 1 - apart);
  };
  return away(LEFT) <= away(RIGHT) ? LEFT : RIGHT;
 }
 const weights = new Map();
 mixer.addEventListener('finished', ({action}) => {
  if (action === current) finished = true;
 });
 function reset() {
  hands.restore();
  grounder.reset();
  headLook.reset();
  for (const hand of touch) hand.weight = hand.dwell = 0;
  blendSpan = 0;
  reach = ropeReach = ladderReach = pushReach = 0;
  previousAction = 'free';
  lean = model.rotation.z = 0;
  yawOffset = model.rotation.y = 0;
  move = null;
  asked = false;
  strideTravel = 0;
  moving = 0;
  strideShare = 1;
  rootedFrom = null;
  lastHeading = null;
  mixer.stopAllAction();
  for (const action of actions) weights.set(action, action === idle ? 1 : 0);
  walk.reset().setEffectiveWeight(0).setEffectiveTimeScale(0).play();
  run.reset().setEffectiveWeight(0).setEffectiveTimeScale(0).play();
  current = idle.reset().setEffectiveWeight(1).play();
  phase = jogShare = 0;
  finished = false;
  airTime = 0;
  vertical = impact = launchPose = 0;
  airborne = false;
  mirrored = false;
  mixer.update(0);
 }
 reset();
 return {
  model,
  ropeGrip,
  ladder,
  push,
  recovery,
  // The clip she is in, by name, for a host that shows it.
  // What the grounder is doing to her feet and pelvis, for a host that tunes it.
  get grounding() { return grounder.state; },
  sampleFeet(points) {
   const contacts = grounder.state.feet;
   const joints = ['l_foot', 'r_foot'];
   for (const [side, point] of points.entries()) {
    bones.get(joints[side]).getWorldPosition(point);
    point.y -= soleHeight;
    point.planted = contacts[side].planted;
   }
  },
  // How far her head is turned (rad), and how far each hand has gone out to a wall (0..1), for a host that shows it.
  get looking() { return {yaw: headLook.yaw, pitch: headLook.pitch, touch: touch.map(hand => hand.weight)}; },
  get playing() { return current === walk ? 'stride' : current.getClip().name; },
  // What the host tells her each frame. landing: 'firm', 'hard' or 'roll' on the frame she comes down that hard. wish:
  // the move asked, in the world ({x, z}). tread: how deep the stairs under her are (m), or 0. look: a world point to
  // look toward. bumped: true on the frame she runs into a wall.
  update(dt, {speed, grounded, velocity, heading, rooted}, jumped, {walkSpeed, runSpeed, jumpSpeed}, action, {landing = null, wish = null, tread = 0, look = null, bumped = false, crouched = false, sliding = false} = {}) {
   hands.restore();
   grounder.restore();
   headLook.restore();
   const gait = speed < STILL_SPEED ? idle : walk;
   const wasAirborne = airborne;
   const vy = velocity.y;
   if (jumped) { vertical = vy; launchPose = 0; }
   else vertical = THREE.MathUtils.damp(vertical, vy, 24, dt);
   if (wasAirborne && grounded) impact = Math.max(0, -vertical);
   airTime = grounded ? 0 : airTime + dt;
   // Carried by a ledge or a rope she is not falling: off a climb she stands straight away, with no landing to play.
   // Off a rope she is in the air at once.
   if (action.state !== 'free') { airborne = false; airTime = 0; }
   else airborne = jumped || previousAction === 'rope' || previousAction === 'ladder' || (!grounded && (airborne || airTime > .11));
   const rising = current === takeoff || current === runningTakeoff || current === oppositeTakeoff;
   let next = gait;
   if (action.state === 'rope') next = ropeHold;
   else if (action.state === 'ladder') next = ladderHold;
   else if (action.state === 'push') next = action.way < 0 ? pullWalk : pushWalk;
   else if (action.state === 'hang') next = previousAction !== 'hang' || (current === grab && !finished) ? grab : action.shimmying > 0 ? shimmyLeft : action.shimmying < 0 ? shimmyRight : hang;
   else if (action.state === 'climb') next = climb;
   else if (previousAction === 'hang' || (current === drop && !finished && !grounded)) next = drop;
   else if (jumped) {
    // A moving jump pushes off the foot that carries her; a standing one plays as authored.
    const moving = speed >= .35;
    mirrored = moving && stanceFoot() !== pushFoot;
    next = !moving ? takeoff : mirrored ? oppositeTakeoff : runningTakeoff;
   }
   else if (airborne) {
    // Walking off an edge: the foot that carried her counts as the one that pushed.
    if (!wasAirborne) mirrored = speed >= STILL_SPEED && stanceFoot() !== pushFoot;
    next = rising && vertical > jumpSpeed * .10 ? current : -vertical > FALL_SPEED ? fall : mirrored ? oppositeAir : air;
   }
   // A firm landing is only played standing; moving, the stride takes it as it takes a jump.
   else if (bumped && grounded && reach === 0) next = bump;
   else if (landing && grounded && reach === 0 && (landing !== 'firm' || gait === idle)) next = heavy[landing];
   else if (wasAirborne && grounded && reach === 0) {
    if (gait === idle) next = mirrored ? oppositeLand : land;
    else {
     // She comes down on the foot the air pose leads with, and the stride resumes from that foot's contact.
     const side = mirrored ? 1 - landFoot : landFoot;
     resumeStride(side, speed > (walkSpeed + runSpeed) / 2);
    }
   }
   else if ((current === land || current === oppositeLand) && !finished && current.time < (gait === idle ? .38 : .22)) next = current;
   else if (current === heavy.roll && !finished) next = current;
   else if (current === heavy.hard && !finished && (gait === idle || current.time < recovery.hard.seconds)) next = current;
   else if (current === bump && !finished && (gait === idle || current.time < recovery.bump.seconds)) next = current;
   else if (current === heavy.firm && !finished && (gait === idle || current.time < FIRM_BREAK)) next = current;
   // Low: a slide plays through; crouched, she keeps low where she would stand or walk.
   if (sliding && grounded && action.state === 'free') next = slide;
   else if (crouched && next === gait) next = speed < STILL_SPEED ? crouchIdle : crouchWalk;
   // Stops and turn-arounds, only while nothing above claimed the frame and she is on her feet.
   const asking = !!wish && (wish.x !== 0 || wish.z !== 0);
   if (next !== gait || !grounded || airborne || action.state !== 'free') move = null;
   else {
    const going = Math.hypot(velocity.x, velocity.z);
    if (move?.type === 'stop') {
     const {data} = move.variant;
     if (asking) move = null;
     else {
      const matched = move.gait === 'run' && speed > MOVES.settle ? timeAtSpeed(data, speed, 0, data.times.length - 1) : 0;
      move.time = Math.min(move.time + dt * MOVES.maxRate, Math.max(move.time + dt * (move.gait === 'run' ? (speed > MOVES.settle ? MOVES.creep : 1) : MOVES.walkStopRate), matched));
      if (move.time >= data.duration) move = null;
     }
    } else if (move?.type === 'pivot') {
     const {data} = move.variant, last = data.times.length - 1;
     const inward = velocity.x * move.dirX + velocity.z * move.dirZ;
     if (!asking || wish.x * Math.sin(move.to) + wish.z * Math.cos(move.to) < MOVES.changedMind * Math.hypot(wish.x, wish.z)) move = null;
     else {
      // Coming in, the frame that brakes as fast as she does; past the turning point, the one that leaves as fast.
      move.out ||= inward <= 0;
      const matched = move.out ? Math.max(data.times[data.pivot], timeAtSpeed(data, -going, data.pivot, last)) : timeAtSpeed(data, inward, 0, data.pivot);
      // Up to the speed she is asked for now: she may come out of a run's turn-around at a walk.
      const leaving = wish.run ?? move.gait === 'run';
      const upToSpeed = move.out && going >= (leaving ? runSpeed : walkSpeed) * Math.min(1, Math.hypot(wish.x, wish.z)) * MOVES.handOver;
      move.time = Math.min(move.time + dt * MOVES.maxRate, Math.max(move.time + dt * (upToSpeed ? MOVES.finishRate : MOVES.creep), matched));
      if (move.time >= data.duration || (upToSpeed && sample(data.times, data.yaw, move.time) / data.yaw.at(-1) >= MOVES.handOver)) {
       resumeStride(move.variant.endFoot, leaving);
       move = null;
      }
     }
    }
    else if (move?.type === 'turn') {
     // Her steps keep pace with the turn itself: the frame shown is the one that has turned as far as she has.
     const {data} = move.variant;
     if (!rooted) move = null;
     else move.time = timeAtTurn(data, Math.min(1, Math.abs(shortestTurn(heading - move.from)) / move.angle) * Math.abs(data.yaw.at(-1)));
    }
    rootedFrom = rooted ? rootedFrom ?? heading : null;
    if (!move && rooted && current === idle && asking && Math.abs(shortestTurn(heading - rootedFrom)) >= MOVES.turnAfter) {
     const turn = shortestTurn(Math.atan2(wish.x, wish.z) - rootedFrom);
     const variant = moves.turn.stand.find(candidate => Math.sign(candidate.data.yaw.at(-1)) * candidate.way === Math.sign(turn));
     move = {type: 'turn', gait: 'stand', variant, from: rootedFrom, angle: Math.abs(turn), time: 0};
    }
    strideTravel = current === walk ? strideTravel + speed * dt : current === idle ? 0 : strideTravel;
    if (!move && current === walk && speed > MOVES.from && going > 0 && strideTravel > MOVES.afterTravel) {
     const gaitNow = speed > MOVES.runFrom ? 'run' : 'walk', foot = stanceFoot();
     if (asked && !asking) {
      const variant = moves.stop[gaitNow].find(candidate => candidate.startFoot === foot);
      move = {type: 'stop', gait: gaitNow, variant, time: gaitNow === 'run' ? timeAtSpeed(variant.data, speed, 0, variant.data.times.length - 1) : 0};
     } else if (asking && (wish.x * velocity.x + wish.z * velocity.z) / (Math.hypot(wish.x, wish.z) * going) < MOVES.pivotAngle) {
      const from = heading + yawOffset, to = Math.atan2(wish.x, wish.z), turn = shortestTurn(to - from);
      const pair = moves.pivot[gaitNow], way = candidate => Math.sign(candidate.data.yaw.at(-1)) * candidate.way;
      // A near half-turn goes round the way that suits the foot she is on; a narrower one, the short way.
      const variant = Math.abs(turn) > MOVES.eitherWay ? pair.find(candidate => candidate.startFoot === foot) : pair.find(candidate => way(candidate) === Math.sign(turn));
      move = {type: 'pivot', gait: gaitNow, variant, time: 0, out: false, from, to, dirX: velocity.x / going, dirZ: velocity.z / going,
       turn: way(variant) === Math.sign(turn) ? turn : way(variant) * (Math.PI * 2 - Math.abs(turn))};
     }
    }
    if (move) next = move.variant.action;
   }
   asked = asking;
   if (move?.type === 'pivot') {
    const {data} = move.variant, share = sample(data.times, data.yaw, move.time) / data.yaw.at(-1);
    yawOffset = shortestTurn(move.from + move.turn * share - heading);
   } else yawOffset *= Math.exp(-dt * MOVES.offsetRate);
   model.rotation.y = yawOffset;
   let changed = false;
   if (next !== current) {
    // The idle keeps playing under the walk: it is only restarted when nothing of it shows.
    if (next !== walk && (next !== idle || weights.get(idle) === 0)) next.reset().setEffectiveWeight(weights.get(next)).play();
    // Back from moving along the ledge she is already hanging: the hang is taken up settled, not caught again.
    if (next === hang && (current === shimmyLeft || current === shimmyRight)) hang.time = hang.getClip().duration;
    changed = true;
    if (next === walk && (current === idle || moves.turn.stand.some(variant => variant.action === current))) phase = startPhase;
    current = next;
    finished = false;
   }
   const blend = 1 - Math.exp(-dt * 16);
   jogShare += (THREE.MathUtils.smoothstep(speed, walkSpeed * 1.1, runSpeed * .95) - jogShare) * blend;
   const stride = THREE.MathUtils.lerp(walkStride, runStride, jogShare);
   // tread: how deep the stairs under her are (m), or 0. A step is half a stride.
   const step = stride / 2, treads = jogShare < .5 ? 1 : Math.max(1, Math.round(step / tread));
   const wantedShare = tread > 0 && grounded ? THREE.MathUtils.clamp(treads * tread / step, STAIR_STRIDE.least, 1) : 1;
   strideShare = THREE.MathUtils.damp(strideShare, wantedShare, STAIR_STRIDE.rate, dt);
   phase = (phase + dt * speed / (stride * strideShare)) % 1;
   walk.time = phase * walkClip.duration;
   run.time = ((phase + runPhaseOffset + 1) % 1) * runClip.duration;
   const touchdown = wasAirborne && grounded && next === walk;
   const fade = move ? MOVES.fade : touchdown || next === takeoff || next === runningTakeoff || next === oppositeTakeoff || next === grab || next === ropeHold || next === ladderHold || next === slide || next === bump || kinds.some(kind => next === heavy[kind]) ? SHARP_BLEND_SECONDS : IDLE_BLEND_SECONDS;
   if (changed) {
    for (const action of actions) blendFrom.set(action, weights.get(action));
    blendSpan = fade;
    blendTime = 0;
   }
   blendTime += dt;
   const mix = blendSpan > 0 ? THREE.MathUtils.smoothstep(blendTime / blendSpan, 0, 1) : 1;
   // Leaving a standstill the walk comes in with her speed, so slow starts and pivots do not snap between two poses.
   // ... and eased in time, because she gains and loses that speed within a few frames.
   moving = THREE.MathUtils.damp(moving, THREE.MathUtils.smoothstep(speed, STILL_SPEED, walkSpeed * WALK_IN), WALK_IN_RATE, dt);
   let total = 0;
   for (const action of actions) {
    const target = next !== walk ? Number(action === next)
     : action === idle ? 1 - moving : action === walk ? moving * (1 - jogShare) : action === run ? moving * jogShare : 0;
    const weight = mix < 1 ? THREE.MathUtils.lerp(blendFrom.get(action), target, mix) : target;
    weights.set(action, weight < .001 ? 0 : weight);
    total += weights.get(action);
   }
   for (const action of actions) action.setEffectiveWeight(weights.get(action) / total);

   if (next === takeoff || next === runningTakeoff || next === oppositeTakeoff) {
    launchPose = Math.max(launchPose, 1 - THREE.MathUtils.clamp(vertical / jumpSpeed, 0, 1));
    next.time = launchPose * next.getClip().duration;
    next.setEffectiveTimeScale(0);
   }
   if (next === air || next === oppositeAir) {
    next.time = THREE.MathUtils.smoothstep(-vertical, 0, jumpSpeed * 1.15) * next.getClip().duration;
    next.setEffectiveTimeScale(0);
   }
   if (next === land || next === oppositeLand) next.setEffectiveTimeScale(THREE.MathUtils.lerp(1.45, 1, THREE.MathUtils.smoothstep(impact, 1.5, 5)));
   if (next === ropeHold) ropeHold.setEffectiveTimeScale(action.climbing * action.climbSpeed / ropePace);
   if (next === crouchWalk) crouchWalk.setEffectiveTimeScale(speed / crouchPace);
   // Pushing, her steps go as fast as what she holds really does: against something that will not move she stands.
   if (next === pushWalk) pushWalk.setEffectiveTimeScale(Math.abs(action.moving) / push.pushSpeed);
   if (next === pullWalk) pullWalk.setEffectiveTimeScale(Math.abs(action.moving) / push.pullSpeed);
   // On a ladder the frame is the one for her height on it, so her hands and feet meet the same rungs going up and down.
   if (next === ladderHold) { ladderHold.time = action.rise / ladderCycle % 1 * ladderClimb.clip.duration; ladderHold.setEffectiveTimeScale(0); }
   if (next === climb) { climb.time = action.pull * climb.getClip().duration; climb.setEffectiveTimeScale(0); }
   if (move) { next.time = Math.min(move.time, move.variant.data.duration); next.setEffectiveTimeScale(0); }
   previousAction = action.state;
   const turning = lastHeading === null || dt <= 0 ? 0 : shortestTurn(heading - lastHeading) / dt;
   lastHeading = heading;
   const bank = grounded && action.state === 'free' && move?.type !== 'pivot' ? THREE.MathUtils.clamp(speed * turning * LEAN.perTurn, -LEAN.most, LEAN.most) : 0;
   lean = THREE.MathUtils.damp(lean, bank, LEAN.rate, dt);
   // Heading grows toward her left; a positive roll about her forward axis tips her right.
   model.rotation.z = -lean;
   mixer.update(dt);
   if (next === shimmyLeft || next === shimmyRight) next.setEffectiveTimeScale(action.shimmySpeed / shimmyPace);
   const wantedReach = action.state === 'hang' ? 1 : action.state === 'climb' ? THREE.MathUtils.clamp((.65 - action.pull) * 5, 0, 1) : 0;
   reach += THREE.MathUtils.clamp(wantedReach - reach, -dt * 7, dt * 9);
   hands.apply(action.anchor, reach, action.facing, current === shimmyLeft || current === shimmyRight);
   // On a rope each hand is brought onto it, where the rope says she holds.
   ropeReach += THREE.MathUtils.clamp((action.state === 'rope' ? 1 : 0) - ropeReach, -dt * 7, dt * 9);
   if (ropeReach > 0) {
    // Each keeps its own height along the rope, as the clip has it, and is set on the rope's line. Letting go, they
    // ease off from where they held, as her body has it.
    model.getWorldPosition(floor);
    for (const side of [LEFT, RIGHT]) {
     if (action.state === 'rope') {
      const {point, way} = action.line;
      hands.wrist(side, ropeHand).sub(floor).sub(point);
      ropeHands[side].copy(point).addScaledVector(way, ropeHand.dot(way));
     }
     hands.touch(side, ropeHand.copy(floor).add(ropeHands[side]), ropeReach);
    }
   }
   if (action.state === 'rope') {
    // Her feet too: each keeps its height along the rope and comes against it, on its own side.
    const {point, way} = action.line, leftX = Math.cos(heading), leftZ = -Math.sin(heading);
    for (const [side, name] of ['l_foot', 'r_foot'].entries()) {
     const goal = wallGoals[side].point, out = (side === LEFT ? 1 : -1) * ROPE.aside;
     bones.get(name).getWorldPosition(touchFrom);
     ropeHand.copy(touchFrom).sub(floor).sub(point);
     goal.copy(floor).add(point).addScaledVector(way, ropeHand.dot(way));
     goal.x += leftX * out; goal.z += leftZ * out;
     goal.lerp(touchFrom, 1 - ropeReach);
     wallFeet[side] = wallGoals[side];
    }
    footIK.solve(wallFeet);
   }
   // Pushing, each hand is set against the side she holds, where the clip has it across and up that side.
   pushReach += THREE.MathUtils.clamp((action.state === 'push' ? 1 : 0) - pushReach, -dt * 7, dt * 9);
   if (action.state === 'push') {
    const {x, z, intoX, intoZ} = action.face;
    for (const side of [LEFT, RIGHT]) {
     hands.wrist(side, touchFrom);
     const gap = (x - touchFrom.x) * intoX + (z - touchFrom.z) * intoZ - PUSH.palm;
     hands.touch(side, touchTo.set(touchFrom.x + intoX * gap, touchFrom.y, touchFrom.z + intoZ * gap), pushReach);
    }
   }
   // On a ladder the ball of each foot is brought onto the plane of the rungs, at the height the clip has it (the
   // rungs are where the clip rests her feet).
   ladderReach += THREE.MathUtils.clamp((action.state === 'ladder' ? 1 : 0) - ladderReach, -dt * 7, dt * 9);
   if (action.state === 'ladder') {
    const {x, z, intoX, intoZ} = action.plane;
    for (const [side, names] of [['l_foot', 'l_toebase'], ['r_foot', 'r_toebase']].entries()) {
     bones.get(names[1]).getWorldPosition(touchFrom);
     const gap = ((x - touchFrom.x) * intoX + (z - touchFrom.z) * intoZ) * ladderReach;
     bones.get(names[0]).getWorldPosition(wallGoals[side].point);
     wallGoals[side].point.x += intoX * gap; wallGoals[side].point.z += intoZ * gap;
     wallFeet[side] = wallGoals[side];
    }
    footIK.solve(wallFeet);
   }
   if (probe && action.state === 'hang') {
    // Her feet brace against the wall she hangs on: each one near it is brought to it, keeping the clip's own angle.
    const intoX = Math.sin(action.facing), intoZ = Math.cos(action.facing);
    for (const [side, names] of [['l_foot', 'l_toebase'], ['r_foot', 'r_toebase']].entries()) {
     wallFeet[side] = null;
     bones.get(names[1]).getWorldPosition(touchFrom);
     const hit = probe(touchTo.set(touchFrom.x - intoX * WALL_FEET.probe, touchFrom.y, touchFrom.z - intoZ * WALL_FEET.probe), wallProbe.set(touchFrom.x + intoX * WALL_FEET.probe, touchFrom.y, touchFrom.z + intoZ * WALL_FEET.probe));
     const gap = hit ? hit.distance - WALL_FEET.probe - WALL_FEET.pad : Infinity;
     if (Math.abs(gap) > WALL_FEET.near) continue;
     bones.get(names[0]).getWorldPosition(wallGoals[side].point);
     wallGoals[side].point.x += intoX * gap; wallGoals[side].point.z += intoZ * gap;
     wallFeet[side] = wallGoals[side];
    }
    footIK.solve(wallFeet);
   }
   // Free on her feet and not in a landing or a turn-around, she looks where she is asked to and touches a wall beside her.
   const facing = heading + yawOffset;
   const easy = grounded && !airborne && action.state === 'free' && reach === 0 && (current === idle || current === walk);
   headLook.update(dt, look, facing, easy);
   for (const [side, hand] of touch.entries()) {
    hand.found = false;
    hand.shoulder.getWorldPosition(touchFrom).y -= TOUCH.drop;
    if (probe && easy && speed < TOUCH.maxSpeed) {
     // Her left is (cos, -sin) of the way she faces on X/Z.
     const out = (side === LEFT ? 1 : -1) * TOUCH.reach;
     const hit = probe(touchFrom, touchTo.set(touchFrom.x + Math.cos(facing) * out, touchFrom.y, touchFrom.z - Math.sin(facing) * out));
     if (hit && Math.abs(hit.normal.y) < TOUCH.upright && hit.distance > TOUCH.least) {
      hand.found = true;
      touchTo.set(hit.point.x + hit.normal.x * TOUCH.palm, hit.point.y, hit.point.z + hit.normal.z * TOUCH.palm);
      if (hand.weight > 0) hand.point.lerp(touchTo, 1 - Math.exp(-dt * TOUCH.rateIn * 3)); else hand.point.copy(touchTo);
      hand.away.subVectors(hand.point, touchFrom);
     }
    }
    // Coming back, the hand lets go from where it was beside her, not from a spot on the wall she has left behind.
    if (!hand.found) hand.point.addVectors(touchFrom, hand.away);
    hand.dwell = hand.found ? hand.dwell + dt : 0;
    hand.weight = THREE.MathUtils.clamp(hand.weight + (hand.dwell > TOUCH.after ? TOUCH.rateIn : -TOUCH.rateOut) * dt, 0, 1);
    hands.touch(side, hand.point, THREE.MathUtils.smoothstep(hand.weight, 0, 1));
   }
   // Her feet follow the ground whenever she stands on it; the roll and the ledge moves keep their own poses.
   model.getWorldPosition(floor);
   // Planted feet are pinned only while she moves: standing, they rest where the pose puts them.
   grounder.update(dt, floor.y, grounding && grounded && !airborne && action.state === 'free' && current !== heavy.roll && current !== slide, speed >= STILL_SPEED, current === walk ? strideShare : 1);
  },
  reset,
  dispose() {
   mixer.stopAllAction();
   mixer.uncacheRoot(rig);
   disposeAssets?.();
  },
 };
}
