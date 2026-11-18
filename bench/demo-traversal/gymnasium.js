import {doorWall, HALL_DOOR} from './courtyard.js';

// One indoor hall beside the entrance lane, made of the kit's blocks (bench/kit/jolt-blocks.js),
// with one area for each of her moves. Lengths in m; x runs east, z north, the floor's top is y = 0. Spans are [from, to].
const COLORS = {floor: 0x7d735f, wall: 0x6f6654, roof: 0x5c5446, ledge: 0x8f8468, stair: 0x8b7457, tower: 0x74624c, beam: 0x4f3d2a};
// The room inside its walls; `wall`, `floor` and `roof` are how thick those are.
const HALL = {x: [5, 29], z: [-14, 14], height: 10, wall: .5, floor: 1, roof: .5};
// Windows in the two long walls (west and east), for the sun: `count` to a wall, `width` wide, from `sill` up to `head`.
const WINDOWS = {count: 4, width: 4, sill: 5, head: 8.5};
// 1. Stair set: the steps that feel best, up to a landing `landing` deep. Centred on x, starting at z.
const STAIRS = {steps: 10, rise: .2, run: .4, halfWidth: 1, x: 17.5, z: 3, landing: 2, color: COLORS.stair};
// 2. Ledge wall, against the south wall from x eastward: one bay for each height, a straight `face` then a pier `pier`
// wide that stands `pier` further out, so each height has an inner corner and two outer ones. `depth` is how far the face stands off the wall.
const LEDGES = {x: 10.5, heights: [2, 2.4, 2.8], face: 3, depth: 1.5, pier: 1.5};
// 3. Rope pit: a hole in the floor (a fall brings her back to the last station) with two ropes in a row over it,
// hung from a rafter that spans the hall. The ropes hang `drop` down from the rafter's underside (y), at these z.
const PIT = {x: [6, 12], z: [-4, 4]};
const RAFTER = {x: 9, y: 7, width: .3, depth: .4};
const ROPES = {z: [-1.5, 1.5], drop: 6.6};   // 3 m apart: a swing reaches about 2 m, the jump off it covers the rest
// 4. Drop tower, against the east wall: `levels` flights of the same steps, each ending on a platform `landing` deep,
// 2 m higher than the last. Open on its west side, to drop from. Centred on x, starting at z.
const DROP_TOWER = {levels: 3, steps: 10, rise: .2, run: .4, halfWidth: 1.2, x: 27.8, z: -10, landing: 2, color: COLORS.tower};
// 5. Ladder wall: a pier against the north wall with a gallery on top (`top` up), and a ladder up its south face,
// `width` wide between two rails and standing `standoff` off the pier (room for her toes behind the rungs). `rail` and
// `rung` are how thick those are.
const LADDER = {x: 15.5, top: 4, width: .5, standoff: .35, rail: .05, rung: .035, pier: {halfWidth: 1.5, depth: 2}, color: COLORS.beam};
// 6. Winch: a capstan beside the rope pit winds a rope over a pulley and lifts a platform out of the pit, to cross
// it in two jumps. The capstan's post stands at (x, z); its arm points along (sin, cos) of `angle` (rad) at first,
// and she holds it `grip` from the post; `drum` is how high the rope leaves it.
const CAPSTAN = {x: 14.6, z: -1, angle: Math.PI / 2, grip: 1.6, drum: 1.12};
// The platform hangs in the middle of the pit's length, its top `low` when down (under where a fall brings her
// back) and level with the floor when up. The pulley hangs over it from a mast at the pit's edge. One turn of the
// capstan winds `perTurn` of rope.
// The rope holds the platform at its edge nearest the mast (`hook`, from its middle), clear of where she stands.
const WINCH = {perTurn: 4, platform: {halfExtents: [.8, .15, 1], x: 11, z: 0, low: -3, high: 0, hook: [.7, 0]},
 pulley: 5.4, mast: {x: 12.3, half: .1, top: 5.8, arm: .2}};
// 7. Low passage: a tunnel she can only go through crouched (or slide into at a run), `clear` high inside, along z
// from `z`, `length` long and `width` wide between walls `wall` thick, under a slab `slab` thick.
const TUNNEL = {x: 20, z: -6, length: 3, width: 1.2, clear: 1.15, wall: .2, slab: .3};
// How far in front of an area its station puts her.
const STATION = {pit: 3.5, ledges: 2.5, tower: 1.5, stairs: 2, ladder: 2.5, capstan: .9, tunnel: 2.5};

// Lamps under the roof, for the lighting tool's rig: intensity in candela, distance (cutoff) in m, at these (x, z).
export const GYM_LAMPS = {color: 0xffd9a0, intensity: 120, distance: 22, decay: 2, height: 8.5, at: [[11, -8], [23, -8], [11, 8], [23, 8]]};
// Ropes for the rope tool: where each is fixed and how far down its end hangs.
export const GYM_ROPES = ROPES.z.map(z => ({top: [RAFTER.x, RAFTER.y, z], drop: ROPES.drop}));
// The ladder's own plane: where its rails and rungs stand, in front of the pier's face.
const LADDER_FACE = HALL.z[1] - LADDER.pier.depth, LADDER_PLANE = LADDER_FACE - LADDER.standoff;
// Ladders for the ladder tool: the foot of each, the way she faces on it (rad), how high it goes and how far it stands off its wall.
export const GYM_LADDERS = [{base: [LADDER.x, 0, LADDER_PLANE], heading: 0, height: LADDER.top, standoff: LADDER.standoff}];
// The capstan, for the capstan tool: the foot of its post and the way its arm points.
// It winds as its angle goes down (she pushes it from its station), and stops when the platform is up or down.
const WINDING = -1, TURN = Math.PI * 2;
export const GYM_CAPSTAN = {at: [CAPSTAN.x, 0, CAPSTAN.z], angle: CAPSTAN.angle, grip: CAPSTAN.grip,
 range: [-(WINCH.platform.high - WINCH.platform.low) / WINCH.perTurn * TURN, 0]};
// The winch, for the winch tool: where the rope leaves the drum, the pulley, the platform.
export const GYM_WINCH = {way: WINDING, perTurn: WINCH.perTurn, drum: [CAPSTAN.x, CAPSTAN.drum, CAPSTAN.z],
 pulley: [WINCH.platform.x + WINCH.platform.hook[0], WINCH.pulley, WINCH.platform.z + WINCH.platform.hook[1]], platform: {...WINCH.platform, color: COLORS.beam}};
// Where the number keys put her: x, y, z and the way she faces (rad).
export const GYM_STATIONS = {
 Digit2: [RAFTER.x, 0, PIT.z[0] - STATION.pit, 0],                                                    // facing the rope pit
 Digit3: [LEDGES.x + (LEDGES.face + LEDGES.pier) * LEDGES.heights.length / 2, 0, HALL.z[0] + LEDGES.depth + LEDGES.pier + STATION.ledges, Math.PI],   // facing the ledge wall
 Digit4: [DROP_TOWER.x, 0, DROP_TOWER.z - STATION.tower, 0],                                          // foot of the drop tower
 Digit5: [STAIRS.x, 0, STAIRS.z - STATION.stairs, 0],                                                 // foot of the stair set
 Digit6: [LADDER.x, 0, LADDER_PLANE - STATION.ladder, 0],                                             // facing the ladder
 Digit9: [TUNNEL.x, 0, TUNNEL.z - STATION.tunnel, 0],                                                 // facing the low passage
 Digit8: [CAPSTAN.x + CAPSTAN.grip, 0, CAPSTAN.z - STATION.capstan, 0],                               // behind the end of the capstan's arm (7 is the courtyard)
};

// A block from its spans along x, y and z.
const box = ([x0, x1], [y0, y1], [z0, z1], color) => ({halfExtents: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2], position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], color});

// A flight's blocks: steps of `rise` by `run`, centred on x, starting at z and at the height `base`; `landing` is a
// platform at its top, that deep. Every step stands on the ground.
export function stairBlocks({steps, rise, run, halfWidth, x, z, landing = 0, base = 0, color}) {
 const across = [x - halfWidth, x + halfWidth];
 const blocks = Array.from({length: steps}, (_, i) => box(across, [0, base + (i + 1) * rise], [z + run * i, z + run * (i + 1)], color));
 if (landing) blocks.push(box(across, [0, base + steps * rise], [z + run * steps, z + run * steps + landing], color));
 return blocks;
}

// A long wall at x (its inner face), `side` -1 for the west one and 1 for the east: solid up to the sills and above the
// heads, piers between the windows.
function windowWall(x, side) {
 const across = side < 0 ? [x - HALL.wall, x] : [x, x + HALL.wall], [from, to] = HALL.z;
 const pier = (to - from - WINDOWS.count * WINDOWS.width) / (WINDOWS.count + 1);
 return [
  ...(side < 0
   ? doorWall(across, [0, WINDOWS.sill], [from, to], HALL_DOOR, COLORS.wall)
   : [box(across, [0, WINDOWS.sill], [from, to], COLORS.wall)]),
  box(across, [WINDOWS.head, HALL.height], [from, to], COLORS.wall),
  ...Array.from({length: WINDOWS.count + 1}, (_, i) => {
   const start = from + i * (pier + WINDOWS.width);
   return box(across, [WINDOWS.sill, WINDOWS.head], [start, start + pier], COLORS.wall);
  }),
 ];
}

// The ladder's rungs, `spacing` apart from the lowest one, whose top is `first` above its foot: both come from her climbing clip
// (the avatar), so the rungs are made once she is loaded.
export function ladderRungBlocks(spacing, first) {
 const across = [LADDER.x - LADDER.width / 2, LADDER.x + LADDER.width / 2], count = Math.floor((LADDER.top - first) / spacing) + 1;
 return Array.from({length: count}, (_, i) => {
  const y = first + i * spacing;
  return box(across, [y - LADDER.rung, y], [LADDER_PLANE - LADDER.rung / 2, LADDER_PLANE + LADDER.rung / 2], LADDER.color);
 });
}

// Every block of the hall.
export function gymnasiumBlocks() {
 const {x, z, height, wall, floor, roof} = HALL, under = [-floor, 0], outerX = [x[0] - wall, x[1] + wall];
 const bay = LEDGES.face + LEDGES.pier, south = z[0];
 const flight = DROP_TOWER.steps * DROP_TOWER.run + DROP_TOWER.landing, storey = DROP_TOWER.steps * DROP_TOWER.rise;
 return [
  // The floor, around the pit.
  box(x, under, [z[0], PIT.z[0]], COLORS.floor),
  box(x, under, [PIT.z[1], z[1]], COLORS.floor),
  box([x[0], PIT.x[0]], under, PIT.z, COLORS.floor),
  box([PIT.x[1], x[1]], under, PIT.z, COLORS.floor),
  // The walls and the roof.
  ...windowWall(x[0], -1),
  ...windowWall(x[1], 1),
  box(outerX, [0, height], [z[0] - wall, z[0]], COLORS.wall),
  box(outerX, [0, height], [z[1], z[1] + wall], COLORS.wall),
  box(outerX, [height, height + roof], [z[0] - wall, z[1] + wall], COLORS.roof),
  ...stairBlocks(STAIRS),
  ...LEDGES.heights.flatMap((top, i) => {
   const start = LEDGES.x + i * bay;
   return [
    box([start, start + LEDGES.face], [0, top], [south, south + LEDGES.depth], COLORS.ledge),
    box([start + LEDGES.face, start + bay], [0, top], [south, south + LEDGES.depth + LEDGES.pier], COLORS.ledge),
   ];
  }),
  box([RAFTER.x - RAFTER.width / 2, RAFTER.x + RAFTER.width / 2], [RAFTER.y, RAFTER.y + RAFTER.depth], z, COLORS.beam),
  // The winch's mast, at the pit's edge, and the arm its pulley hangs from.
  box([WINCH.mast.x - WINCH.mast.half, WINCH.mast.x + WINCH.mast.half], [0, WINCH.mast.top], [WINCH.platform.z - WINCH.mast.half, WINCH.platform.z + WINCH.mast.half], COLORS.beam),
  box([WINCH.platform.x + WINCH.platform.hook[0] - WINCH.mast.half, WINCH.mast.x + WINCH.mast.half], [WINCH.mast.top - WINCH.mast.arm, WINCH.mast.top], [WINCH.platform.z - WINCH.mast.half, WINCH.platform.z + WINCH.mast.half], COLORS.beam),
  // The low passage: two walls and the slab over them.
  ...[-1, 1].map(side => {
   const inner = TUNNEL.x + side * TUNNEL.width / 2, outer = inner + side * TUNNEL.wall;
   return box([Math.min(inner, outer), Math.max(inner, outer)], [0, TUNNEL.clear], [TUNNEL.z, TUNNEL.z + TUNNEL.length], COLORS.wall);
  }),
  box([TUNNEL.x - TUNNEL.width / 2 - TUNNEL.wall, TUNNEL.x + TUNNEL.width / 2 + TUNNEL.wall], [TUNNEL.clear, TUNNEL.clear + TUNNEL.slab], [TUNNEL.z, TUNNEL.z + TUNNEL.length], COLORS.wall),
  // The ladder's pier and its two rails.
  box([LADDER.x - LADDER.pier.halfWidth, LADDER.x + LADDER.pier.halfWidth], [0, LADDER.top], [LADDER_FACE, z[1]], COLORS.tower),
  ...[-1, 1].map(side => {
   const inner = LADDER.x + side * LADDER.width / 2, outer = inner + side * LADDER.rail;
   return box([Math.min(inner, outer), Math.max(inner, outer)], [0, LADDER.top], [LADDER_PLANE - LADDER.rail, LADDER_PLANE], LADDER.color);
  }),
  ...Array.from({length: DROP_TOWER.levels}, (_, level) => stairBlocks({...DROP_TOWER, z: DROP_TOWER.z + level * flight, base: level * storey})).flat(),
 ];
}
