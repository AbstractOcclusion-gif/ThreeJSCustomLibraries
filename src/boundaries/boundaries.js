// Boundary runs -> scene objects. Each kind resolves to an asset:
//   {model: Object3D, length}      a module cloned along the legs and stretched to fit (fence, wall, hedge from a mesh)
//   {leavedBush: {...}}            hedge made of leaved-tree bushes (default for 'hedge'); options: heightM, widthM, spacingM, color, tintJitter
//   {electric: true}               poles + three sagging conductors (default for 'electric')
// Procedural fallbacks exist for 'fence' (posts + rails) and 'wall' (stone block), so no model files are needed.
import * as T from 'three';
import {hash2} from '../core/hash.js';
import {LeavedTrees} from '../trees/leaved-trees.js';
import {repeatModules, walkRun, electricMounts, conductorPoints} from './runs.js';
import {createUtilityPole, phases} from './utility-pole.js';

const HEDGE_DEFAULTS = Object.freeze({heightM: 1.6, widthM: 1.2, spacingM: .9, color: '#2f5a1e', tintJitter: .12});
// Hedge bush jitter: height x [min, span]; crowns overlap their neighbours by `overlap`; yaw turns up to `yaw` rad.
const HEDGE_JITTER = Object.freeze({height: [.9, .2], overlap: 1.15, yaw: .6});
// Procedural fence module, m: square posts `post` wide set `inset` in from each end; rails at shares of the height.
const FENCE = Object.freeze({post: .12, inset: .06, rails: [.45, .85], rail: [.07, .05]});   // rail: [height, depth]
// Conductor tube: segments along, radius (m), sides; spans shorter than minSpan m are skipped.
const WIRE = Object.freeze({segments: 12, radius: .022, sides: 5, minSpan: .01});

export function proceduralFence({length = 2.4, height = 1.1, color = 0x996540} = {}) {
  const g = new T.Group(), m = new T.MeshStandardMaterial({color, roughness: 1});
  for (const x of [-length / 2 + FENCE.inset, length / 2 - FENCE.inset]) { const post = new T.Mesh(new T.BoxGeometry(FENCE.post, height, FENCE.post), m); post.position.set(x, height / 2, 0); g.add(post); }
  for (const y of FENCE.rails.map(share => height * share)) { const rail = new T.Mesh(new T.BoxGeometry(length, ...FENCE.rail), m); rail.position.y = y; g.add(rail); }
  return {model: g, length};
}
export function proceduralWall({length = 2, height = .9, thickness = .45, color = 0x928879} = {}) {
  const g = new T.Group(); g.add(new T.Mesh(new T.BoxGeometry(length, height, thickness), new T.MeshStandardMaterial({color, roughness: 1})).translateY(height / 2));
  return {model: g, length};
}

export function createBoundaries({scene, assets = {}, lighting, sampleGround = () => 0, mesh} = {}) {
  if (!scene) throw Error('createBoundaries needs a scene');
  const view = new T.Group(); view.name = 'boundaries'; scene.add(view);
  const resolved = {fence: proceduralFence(), wall: proceduralWall(), hedge: {leavedBush: {}}, electric: {electric: true}, ...assets};
  const owned = new Set(), wires = new Set();
  const wireMaterial = new T.MeshStandardMaterial({color: 0x272c32});
  const pole = createUtilityPole(mesh);
  let hedges = null;
  const hedgeOptions = {...HEDGE_DEFAULTS, ...(resolved.hedge?.leavedBush ?? {})};
  if (resolved.hedge?.leavedBush) hedges = new LeavedTrees({scene: view, profile: 'bush', lighting, sampleGround, ...resolved.hedge.leavedBush.trees});

  function drawElectric(route) {
    const {angles, mounts} = electricMounts(route, phases);
    route.forEach(([x, z], i) => { const p = pole.clone(true); p.position.set(x, sampleGround(x, z), z); p.rotation.y = angles[i]; view.add(p); });
    for (let i = 1; i < route.length; i++) for (const [phase, start] of mounts[i - 1].entries()) {
      const end = mounts[i][phase]; if (Math.hypot(end[0] - start[0], end[2] - start[2]) < WIRE.minSpan) continue;
      const pts = conductorPoints(start, end).map(([x, y, z]) => new T.Vector3(x, y + sampleGround(x, z), z));
      const geometry = new T.TubeGeometry(new T.CatmullRomCurve3(pts), WIRE.segments, WIRE.radius, WIRE.sides, false); wires.add(geometry); view.add(new T.Mesh(geometry, wireMaterial));
    }
  }
  function drawModules(asset, route) {
    repeatModules(route, asset.length, ({x, z, yaw, scaleX}) => { const m = asset.model.clone(true); m.position.set(x, sampleGround(x, z), z); m.rotation.y = yaw; m.scale.x = scaleX; view.add(m); });
  }
  function hedgePlacements(route, out) {
    const base = new T.Color(hedgeOptions.color).convertSRGBToLinear(), o = hedgeOptions;
    walkRun(route, o.spacingM, ({x, z, yaw}) => {
      const jitter = 1 + o.tintJitter * (hash2(x, z, 21) * 2 - 1), h = o.heightM * (HEDGE_JITTER.height[0] + HEDGE_JITTER.height[1] * hash2(x, z, 22));
      out.push({x, z, h, r: o.widthM / 2 * HEDGE_JITTER.overlap, yaw: yaw + hash2(x, z, 23) * HEDGE_JITTER.yaw, tint: [base.r * jitter, base.g * jitter, base.b * jitter]});
    });
  }

  return {
    group: view, hedges, hedgeOptions,
    setRuns(runs) {
      this.clear();
      const hedgeItems = [];
      for (const run of runs) {
        const asset = resolved[run.kind]; if (!asset) continue;
        if (asset.electric) drawElectric(run.points);
        else if (asset.leavedBush) hedgePlacements(run.points, hedgeItems);
        else drawModules(asset, run.points);
      }
      if (hedges && hedgeItems.length) hedges.place(hedgeItems, 1);
      return this;
    },
    setHedge(options) { Object.assign(hedgeOptions, options); },
    setEnvironment(environment) { hedges?.setEnvironment(environment); },   // optional: hedges sway and light with it
    update(dt) { hedges?.update(dt); },
    clear() { for (const child of [...view.children]) if (child !== hedges?.group) view.remove(child); for (const g of wires) g.dispose(); wires.clear(); hedges?.clear(); },
    dispose() { this.clear(); hedges?.dispose(); wireMaterial.dispose(); pole.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); for (const a of Object.values(resolved)) a.model?.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); for (const o of owned) o.dispose(); scene.remove(view); },
  };
}
