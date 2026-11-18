// Site plan in metres. The stepped banks stay within the controller's stair height.
export const FINISH = {
 stone: 0x8b7457, moss: 0x58634b, grass: 0x68724a, mud: 0x655345, sand: 0xad9770, timber: 0x4f3d2a,
};
export const YARD = {x: [-26, -3.3], z: [-5.5, 17], floor: -1};
export const BASIN = {
 x: [-22, -9], z: [5, 12], level: -.06,
 banks: [{width: 1.25, top: -.17}, {width: 1.25, top: -.34}],
 bed: -.51,
};
export const COURTYARD_STATION = [-6, 0, 0, -Math.PI / 2];
export const YARD_DOOR = {z: 0, halfWidth: 1.25, height: 2.8};
export const HALL_DOOR = {z: -2, halfWidth: 1.25, height: 2.8};

export function box([left, right], [bottom, top], [near, far], color) {
 return {
  halfExtents: [(right - left) / 2, (top - bottom) / 2, (far - near) / 2],
  position: [(right + left) / 2, (top + bottom) / 2, (far + near) / 2],
  color,
 };
}

export function doorWall(x, y, [near, far], door, color) {
 const start = door.z - door.halfWidth, end = door.z + door.halfWidth;
 return [
  box(x, y, [near, start], color),
  box(x, [door.height, y[1]], [start, end], color),
  box(x, y, [end, far], color),
 ];
}

export function courtyardBlocks() {
 const [left, right] = YARD.x, [near, far] = YARD.z;
 const [west, east] = BASIN.x, [south, north] = BASIN.z;
 const ground = (x, z, color, top = 0) => box(x, [YARD.floor, top], z, color);
 const blocks = [
  ground(YARD.x, [near, south], FINISH.grass),
  ground(YARD.x, [north, far], FINISH.mud),
  ground([left, west], BASIN.z, FINISH.mud),
  ground([east, right], BASIN.z, FINISH.sand),
 ];
 let start = west, end = east;
 for (const {width, top} of BASIN.banks) {
  blocks.push(ground([start, start + width], BASIN.z, FINISH.sand, top));
  blocks.push(ground([end - width, end], BASIN.z, FINISH.sand, top));
  start += width;
  end -= width;
 }
 blocks.push(ground([start, end], BASIN.z, FINISH.mud, BASIN.bed));
 return blocks;
}
