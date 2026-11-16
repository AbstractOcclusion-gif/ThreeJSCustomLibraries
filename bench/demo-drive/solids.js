// What stands in the valley is solid: the World dressing says where its tree trunks and larger rocks are (its hooks),
// and each becomes a fixed box of the players' scenery. No shape is worked out here.
export const SOLIDS = Object.freeze({trunkHeight: 3});   // m of a trunk that can be run into, from the ground up

// dressing: the World demo's dressing ({trunks, subscribe}). scenery: the players' ({addBox, remove}).
export function connectSolids({dressing, scenery}) {
 const half = SOLIDS.trunkHeight / 2, tiles = new Map();
 const trunks = dressing.trunks.map(({x, y, z, radius}) => scenery.addBox({halfExtents: [radius, half, radius], position: [x, y + half, z]}));
 const unsubscribe = dressing.subscribe(event => {
  if (event.type === 'dressing:rocks') tiles.set(event.tile, event.rocks.map(rock => scenery.addBox(rock)));
  else if (event.type === 'dressing:rocks-removed') {
   for (const body of tiles.get(event.tile) ?? []) scenery.remove(body);
   tiles.delete(event.tile);
  }
 });
 return {
  get count() { let count = trunks.length; for (const bodies of tiles.values()) count += bodies.length; return count; },
  dispose() {
   unsubscribe();
   for (const bodies of [trunks, ...tiles.values()]) for (const body of bodies) scenery.remove(body);
   tiles.clear();
  },
 };
}
