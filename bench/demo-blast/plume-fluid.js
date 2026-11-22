// The blast plume as a GPU fluid, on the scheme of the fire tool's flame fluid (src/fire/fluid.js): ping-pong passes
// with pressure projection and vorticity confinement. This one is axisymmetric (radius across, height up, the axis on
// the left edge), in metres, seconds and kelvin above ambient, and sits in a stratified atmosphere: a deep mixed layer
// under a stable cap, where the cloud stops rising and spreads.
// gas texture: r = heat / HEAT_UNIT, g = smoke density, b = unburned fuel.
import {Camera, ClampToEdgeWrapping, FloatType, HalfFloatType, LinearFilter, Mesh, NearestFilter, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget} from 'three';
import {createRenderScope} from '../../src/core/render-state.js';
import {createFixedStep} from '../../src/core/fixed-step.js';

export const HEAT_UNIT = 1700;   // K above ambient stored as 1
const AIR = Object.freeze({gravity: 9.81, ambient: 293});
const SIM = Object.freeze({
  step: 1 / 20, maxSteps: 8,
  dragRate: .025,          // velocity lost per second, per unit of the look's drag
  // The fireball at its largest, in fireball radii: a sphere resting on the ground, evenly hot up to a soft edge
  // (from this share of its radius). An even sphere rolls up into a ring; a hot centre would spear up through it.
  ignition: {centre: .8, heat: 3200, smoke: 2.7, fuel: .55, edge: .8},
  // Dust already lofted under it by the thermal pulse: a short column that seeds the stem.
  stem: {radius: 1.25, height: 2.9, heat: 25, smoke: 2.6},
  burn: {above: 450, rate: 1.1, heat: 550, smoke: .55},   // fuel burns above this heat, at this share per second
  // Dust-laden air is heavy: share of gravity one unit of smoke takes off the lift. The stem's dust nearly cancels its
  // own warmth, so it is drawn up by the head instead of racing past it.
  dustLoad: .04,
  radiation: .4,           // share of the heat radiated per second at ignition heat; falls with the cube of the heat
  coldest: -60,            // K: floor of the overshoot cooling
  smokeDecay: .0015,       // share of the smoke lost per second
  // Wind along the ground lifts dust into the two lowest rows: this is what the afterwinds feed the stem with.
  dust: {rows: 2, wind: 2, gain: .18, most: 2.6, riseShares: .25},
  // Potential temperature gradient, K per metre: nearly neutral below the cap, strongly stable in it.
  lapse: {mixed: .0005, cap: .012, capStart: .8, capDepth: .1},
});
// Pressure is solved by multigrid: a few smoothing passes on the grid and on ever coarser copies of it, so that the
// large shapes of the flow (the whole head pushing the air above it aside) converge as fast as the small ones.
const MULTIGRID = Object.freeze({
  smallest: 8,             // cells: the coarsest grid keeps at least this many across and up
  before: 2, after: 2,     // smoothing passes on the way down and on the way up
  coarsest: 24,            // smoothing passes on the coarsest grid
  damping: .8,             // share of each Jacobi update kept: damped passes smooth the error instead of ringing
});
const PROFILE = Object.freeze({
  rows: 64, seconds: .25,  // the cloud is measured in this many height bands, this often
  smoke: .09, heat: .05,   // a cell with more than this counts as cloud
  mass: .02,               // a band with more smoke than this counts as cloud
  follow: 1.1,             // s: the measured head is followed this smoothly
  margin: 1.15,            // the drawn bounds lead the measured ones by this much
});

const f = (value, digits = 4) => Number(value).toFixed(digits);
const QUAD_VERTEX = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// Left: the axis. Bottom: the ground. Right and top: open air, where pressure is zero.
const COMMON = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uTexel, uDomain;   // 1 / cells; metres across and up
  uniform float uCell, uDt;       // metres; seconds
  uniform sampler2D tVelocity;
  // Mirrored across the axis and the ground, so nothing flows through either.
  vec2 velocityAt(vec2 uv) {
    vec2 v = texture2D(tVelocity, uv).xy;
    if (uv.x < 0.0) v.x = -v.x;
    if (uv.y < 0.0) v.y = -v.y;
    return v;
  }
  float pressureAt(sampler2D pressure, vec2 uv, float centre) {
    if (uv.x > 1.0 || uv.y > 1.0) return 0.0;
    if (uv.x < 0.0 || uv.y < 0.0) return centre;
    return texture2D(pressure, uv).r;
  }
`;

// fireballRadius, domainRadius, cloudTop, riseSeconds: metres and seconds, from the blast scale.
// look: {fuel, drag, curl, riseSpeed}, read every step.
export function createPlumeFluid(renderer, {fireballRadius, domainRadius, cloudTop, riseSeconds, look, columns, rows, pressureCycles}) {
  if (!renderer?.isWebGLRenderer) throw Error('Plume fluid needs a WebGL renderer');
  if (![columns, rows, pressureCycles].every(Number.isInteger) || columns < 16 || rows < 16 || pressureCycles < 1) {
    throw Error('Plume fluid needs at least 16 x 16 cells and 1 pressure cycle');
  }
  const cell = domainRadius / columns, domainHeight = cell * rows;
  if (domainHeight < cloudTop) throw Error('Plume fluid domain is lower than the cloud top');
  const target = (width = columns, height = rows) => {
    const t = new WebGLRenderTarget(width, height, {type: HalfFloatType, depthBuffer: false});
    t.texture.minFilter = t.texture.magFilter = LinearFilter;
    t.texture.wrapS = t.texture.wrapT = ClampToEdgeWrapping;
    return t;
  };
  const pair = () => ({read: target(), write: target(), swap() { [this.read, this.write] = [this.write, this.read]; }});
  const velocity = pair(), gas = pair(), divergence = target();
  // Level 0 is the grid itself; each next level halves it. solution: the pressure (level 0) or its correction;
  // source: what its Laplacian must equal; residual: what is still missing after smoothing.
  const levels = [];
  for (let width = columns, height = rows, size = cell; ; width /= 2, height /= 2, size *= 2) {
    levels.push({
      solution: {read: target(width, height), write: target(width, height), swap() { [this.read, this.write] = [this.write, this.read]; }},
      source: levels.length ? target(width, height) : divergence, residual: target(width, height),
      grid: new Vector3(1 / width, 1 / height, size),
    });
    if (width % 2 || height % 2 || width / 2 < MULTIGRID.smallest || height / 2 < MULTIGRID.smallest) break;
  }
  const pressure = levels[0].solution;
  const profile = new WebGLRenderTarget(1, PROFILE.rows, {type: FloatType, depthBuffer: false});
  profile.texture.minFilter = profile.texture.magFilter = NearestFilter;
  const profileData = new Float32Array(PROFILE.rows * 4);
  const shared = {
    uTexel: {value: new Vector2(1 / columns, 1 / rows)}, uDomain: {value: new Vector2(domainRadius, domainHeight)},
    uCell: {value: cell}, uDt: {value: SIM.step}, tVelocity: {value: null},
  };
  const pass = (fragmentShader, uniforms = {}) => new ShaderMaterial({
    vertexShader: QUAD_VERTEX, fragmentShader: COMMON + fragmentShader, uniforms: {...shared, ...uniforms}, depthTest: false, depthWrite: false,
  });
  const capStart = cloudTop * SIM.lapse.capStart, capEnd = capStart + cloudTop * SIM.lapse.capDepth;
  const centre = fireballRadius * SIM.ignition.centre;

  const passes = {
    // Move the velocity along itself, then add buoyancy, vorticity confinement and drag.
    advectVelocity: pass(/* glsl */`
      uniform sampler2D tGas;
      uniform float uRise, uCurl, uDrag;
      float curlAt(vec2 uv) {
        vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
        return ((velocityAt(uv + dx).y - velocityAt(uv - dx).y) - (velocityAt(uv + dy).x - velocityAt(uv - dy).x)) / (2.0 * uCell);
      }
      void main() {
        vec2 v = velocityAt(vUv - texture2D(tVelocity, vUv).xy * uDt / uDomain);
        vec2 gas = texture2D(tGas, vUv).rg;
        float heat = gas.r * ${f(HEAT_UNIT, 1)};
        float lift = uRise * uRise * heat / (${f(AIR.ambient, 1)} + max(heat, 0.0)) - ${f(SIM.dustLoad)} * gas.g;
        v.y += ${f(AIR.gravity)} * lift * uDt;
        // Push along the gradient of |curl|, turned a quarter: it keeps the rolls the solver would smooth away.
        vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
        vec2 grad = vec2(abs(curlAt(vUv + dx)) - abs(curlAt(vUv - dx)), abs(curlAt(vUv + dy)) - abs(curlAt(vUv - dy)));
        float len = length(grad);
        if (len > 1e-6) v += uCurl * uCell * uDt * curlAt(vUv) * vec2(grad.y, -grad.x) / len;
        gl_FragColor = vec4(v * exp(-uDrag * uDt), 0.0, 1.0);
      }`, {tGas: {value: null}, uRise: {value: 1}, uCurl: {value: 0}, uDrag: {value: 0}}),
    // Flux through the cell faces; a face's area grows with its radius.
    divergence: pass(/* glsl */`
      void main() {
        vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
        float column = floor(vUv.x / uTexel.x);
        vec2 here = velocityAt(vUv);
        float outward = (column + 1.0) * .5 * (here.x + velocityAt(vUv + dx).x) - column * .5 * (here.x + velocityAt(vUv - dx).x);
        float upward = .5 * (velocityAt(vUv + dy).y - velocityAt(vUv - dy).y);
        gl_FragColor = vec4((outward / (column + .5) + upward) / uCell, 0.0, 0.0, 1.0);
      }`),
    // One damped Jacobi pass of the axisymmetric Poisson equation, on any level (uGrid: 1 / cells, cell size in m).
    smooth: pass(/* glsl */`
      uniform sampler2D tSolution, tSource;
      uniform vec3 uGrid;
      void main() {
        vec2 dx = vec2(uGrid.x, 0.0), dy = vec2(0.0, uGrid.y);
        float column = floor(vUv.x / uGrid.x);
        float outer = (column + 1.0) / (column + .5), inner = column / (column + .5);
        float centre = texture2D(tSolution, vUv).r;
        float sum = outer * pressureAt(tSolution, vUv + dx, centre) + inner * pressureAt(tSolution, vUv - dx, centre)
          + pressureAt(tSolution, vUv + dy, centre) + pressureAt(tSolution, vUv - dy, centre);
        float solved = (sum - texture2D(tSource, vUv).r * uGrid.z * uGrid.z) / (outer + inner + 2.0);
        gl_FragColor = vec4(mix(centre, solved, ${f(MULTIGRID.damping)}), 0.0, 0.0, 1.0);
      }`, {tSolution: {value: null}, tSource: {value: null}, uGrid: {value: null}}),
    // What the level's solution still misses: source minus its Laplacian.
    residual: pass(/* glsl */`
      uniform sampler2D tSolution, tSource;
      uniform vec3 uGrid;
      void main() {
        vec2 dx = vec2(uGrid.x, 0.0), dy = vec2(0.0, uGrid.y);
        float column = floor(vUv.x / uGrid.x);
        float outer = (column + 1.0) / (column + .5), inner = column / (column + .5);
        float centre = texture2D(tSolution, vUv).r;
        float laplacian = (outer * pressureAt(tSolution, vUv + dx, centre) + inner * pressureAt(tSolution, vUv - dx, centre)
          + pressureAt(tSolution, vUv + dy, centre) + pressureAt(tSolution, vUv - dy, centre) - (outer + inner + 2.0) * centre) / (uGrid.z * uGrid.z);
        gl_FragColor = vec4(texture2D(tSource, vUv).r - laplacian, 0.0, 0.0, 1.0);
      }`, {tSolution: {value: null}, tSource: {value: null}, uGrid: {value: null}}),
    // Onto the next coarser level: the linear filter averages the four finer cells under each coarse one.
    restrict: pass(/* glsl */`
      uniform sampler2D tFine;
      void main() { gl_FragColor = vec4(texture2D(tFine, vUv).r, 0.0, 0.0, 1.0); }`, {tFine: {value: null}}),
    // Back onto the finer level: add the coarse correction, interpolated.
    correct: pass(/* glsl */`
      uniform sampler2D tSolution, tCoarse;
      void main() { gl_FragColor = vec4(texture2D(tSolution, vUv).r + texture2D(tCoarse, vUv).r, 0.0, 0.0, 1.0); }`, {tSolution: {value: null}, tCoarse: {value: null}}),
    project: pass(/* glsl */`
      uniform sampler2D tPressure;
      void main() {
        vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
        float centre = texture2D(tPressure, vUv).r;
        vec2 gradient = vec2(pressureAt(tPressure, vUv + dx, centre) - pressureAt(tPressure, vUv - dx, centre),
          pressureAt(tPressure, vUv + dy, centre) - pressureAt(tPressure, vUv - dy, centre)) / (2.0 * uCell);
        gl_FragColor = vec4(texture2D(tVelocity, vUv).xy - gradient, 0.0, 1.0);
      }`, {tPressure: {value: null}}),
    // Move heat, smoke and fuel along the flow; burn, radiate, and cool or warm against the atmosphere.
    advectGas: pass(/* glsl */`
      uniform sampler2D tGas;
      uniform float uFeed;   // 0..1 ground dust still available
      void main() {
        vec2 v = texture2D(tVelocity, vUv).xy;
        vec3 gas = texture2D(tGas, vUv - v * uDt / uDomain).rgb;
        float heat = gas.r * ${f(HEAT_UNIT, 1)}, smoke = gas.g, fuel = gas.b;
        float burned = heat > ${f(SIM.burn.above, 1)} ? fuel * (1.0 - exp(-${f(SIM.burn.rate)} * uDt)) : 0.0;
        float hot = max(heat, 0.0) / ${f(SIM.ignition.heat, 1)};
        heat -= max(heat, 0.0) * (1.0 - exp(-${f(SIM.radiation)} * hot * hot * hot * uDt));
        // Potential temperature: rising air cools against a stable layer, sinking air warms.
        float height = vUv.y * uDomain.y;
        float lapse = mix(${f(SIM.lapse.mixed, 5)}, ${f(SIM.lapse.cap, 5)}, smoothstep(${f(capStart, 1)}, ${f(capEnd, 1)}, height));
        heat = max(${f(SIM.coldest, 1)}, heat + burned * ${f(SIM.burn.heat, 1)} - v.y * lapse * uDt);
        smoke = smoke * exp(-${f(SIM.smokeDecay, 5)} * uDt) + burned * ${f(SIM.burn.smoke)};
        if (vUv.y < ${f(SIM.dust.rows, 1)} * uTexel.y) {
          float lifted = max(0.0, length(v) - ${f(SIM.dust.wind)}) * ${f(SIM.dust.gain)} * uDt * uFeed;
          smoke = max(smoke, min(${f(SIM.dust.most)}, smoke + lifted));
        }
        gl_FragColor = vec4(heat / ${f(HEAT_UNIT, 1)}, smoke, fuel - burned, 1.0);
      }`, {tGas: {value: null}, uFeed: {value: 1}}),
    ignite: pass(/* glsl */`
      uniform float uFuel;
      void main() {
        vec2 p = vUv * uDomain;
        float bubble = 1.0 - smoothstep(${f(SIM.ignition.edge)}, 1.0, length(vec2(p.x, p.y - ${f(centre, 2)})) / ${f(fireballRadius, 2)});
        float stemRadius = ${f(fireballRadius * SIM.stem.radius, 2)};
        float stem = exp(-p.x * p.x / (stemRadius * stemRadius)) * max(0.0, 1.0 - p.y / ${f(fireballRadius * SIM.stem.height, 2)});
        float heat = ${f(SIM.ignition.heat, 1)} * bubble + ${f(SIM.stem.heat, 1)} * stem * (1.0 - bubble);
        gl_FragColor = vec4(heat / ${f(HEAT_UNIT, 1)}, ${f(SIM.ignition.smoke)} * bubble + ${f(SIM.stem.smoke)} * stem * (1.0 - bubble),
          ${f(SIM.ignition.fuel)} * bubble * uFuel, 1.0);
      }`, {uFuel: {value: 1}}),
    // One texel per height band: smoke mass, outermost cloud cell (share of the radius), hottest cell.
    profile: pass(/* glsl */`
      uniform sampler2D tGas;
      void main() {
        float mass = 0.0, reach = 0.0, hottest = 0.0;
        for (int i = 0; i < ${columns}; i++) {
          float x = (float(i) + .5) * uTexel.x;
          vec3 gas = texture2D(tGas, vec2(x, vUv.y)).rgb;
          mass += gas.g * x;
          if (gas.g > ${f(PROFILE.smoke)} || gas.r > ${f(PROFILE.heat)}) reach = x;
          hottest = max(hottest, gas.r);
        }
        gl_FragColor = vec4(mass, reach, hottest, 1.0);
      }`, {tGas: {value: null}}),
  };

  const quad = new Mesh(new PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const stage = new Scene(), eye = new Camera();
  stage.add(quad);
  const scope = createRenderScope(renderer);
  const clock = createFixedStep({step: SIM.step, maxSteps: SIM.maxSteps});
  const draw = (material, into) => { quad.material = material; renderer.setRenderTarget(into); renderer.render(stage, eye); };
  const start = {height: centre, radius: fireballRadius, top: centre + fireballRadius};
  const head = {height: start.height, radius: start.radius}, measured = {...head};
  const bounds = {radius: fireballRadius * SIM.stem.radius * 2, top: fireballRadius * SIM.stem.height};
  let time = 0, feed = 1, active = false, disposed = false, hottest = 0;
  let generation = 0, reading = false, sinceProfile = 0, readFailed = false;

  function stepOnce() {
    time += SIM.step;
    let u = passes.advectVelocity.uniforms;
    shared.tVelocity.value = velocity.read.texture;
    u.tGas.value = gas.read.texture; u.uRise.value = look.riseSpeed; u.uCurl.value = look.curl; u.uDrag.value = look.drag * SIM.dragRate;
    draw(passes.advectVelocity, velocity.write); velocity.swap();
    shared.tVelocity.value = velocity.read.texture;
    draw(passes.divergence, divergence);
    for (let i = 0; i < pressureCycles; i++) solvePressure();
    passes.project.uniforms.tPressure.value = pressure.read.texture;
    draw(passes.project, velocity.write); velocity.swap();
    shared.tVelocity.value = velocity.read.texture;
    u = passes.advectGas.uniforms;
    u.tGas.value = gas.read.texture; u.uFeed.value = feed * Math.exp(-time / (riseSeconds * SIM.dust.riseShares));
    draw(passes.advectGas, gas.write); gas.swap();
  }
  function smooth(level, count) {
    const u = passes.smooth.uniforms;
    u.tSource.value = level.source.texture; u.uGrid.value = level.grid;
    for (let i = 0; i < count; i++) {
      u.tSolution.value = level.solution.read.texture;
      draw(passes.smooth, level.solution.write); level.solution.swap();
    }
  }
  // One V-cycle. The pressure of the previous step is the starting guess on the grid itself.
  function solvePressure() {
    const last = levels.length - 1;
    for (let l = 0; l < last; l++) {
      const level = levels[l], coarser = levels[l + 1];
      smooth(level, MULTIGRID.before);
      const u = passes.residual.uniforms;
      u.tSolution.value = level.solution.read.texture; u.tSource.value = level.source.texture; u.uGrid.value = level.grid;
      draw(passes.residual, level.residual);
      passes.restrict.uniforms.tFine.value = level.residual.texture;
      draw(passes.restrict, coarser.source);
      renderer.setRenderTarget(coarser.solution.read); renderer.clear();
    }
    smooth(levels[last], MULTIGRID.coarsest);
    for (let l = last - 1; l >= 0; l--) {
      const level = levels[l], u = passes.correct.uniforms;
      u.tSolution.value = level.solution.read.texture; u.tCoarse.value = levels[l + 1].solution.read.texture;
      draw(passes.correct, level.solution.write); level.solution.swap();
      smooth(level, MULTIGRID.after);
    }
  }
  function clearTargets() {
    renderer.setClearColor(0x000000, 0);
    for (const t of [velocity.read, velocity.write, gas.read, gas.write, pressure.read, pressure.write, divergence]) { renderer.setRenderTarget(t); renderer.clear(); }
  }
  // Where the cloud is, read back a few times a second from a 1 x rows texture: its top, its reach, its head.
  function analyse() {
    let top = 0, reach = 0, peak = 0, peakRow = -1, hot = 0;
    const firstHeadRow = Math.floor(fireballRadius / domainHeight * PROFILE.rows);
    for (let j = 0; j < PROFILE.rows; j++) {
      const mass = profileData[j * 4], rowReach = profileData[j * 4 + 1];
      hot = Math.max(hot, profileData[j * 4 + 2]);
      if (rowReach > 0) { top = j + 1; reach = Math.max(reach, rowReach); }
      if (j >= firstHeadRow && mass > peak) { peak = mass; peakRow = j; }
    }
    hottest = hot;
    if (top > 0) {
      bounds.top = Math.min(domainHeight, top / PROFILE.rows * domainHeight * PROFILE.margin);
      bounds.radius = Math.min(domainRadius, (reach * domainRadius + cell) * PROFILE.margin);
    }
    if (peak > PROFILE.mass) {
      measured.height = (peakRow + .5) / PROFILE.rows * domainHeight;
      measured.radius = Math.max(fireballRadius, profileData[peakRow * 4 + 1] * domainRadius);
    }
  }
  function measure() {
    if (reading || readFailed) return;
    reading = true;
    const asked = generation;
    passes.profile.uniforms.tGas.value = gas.read.texture;
    scope(() => draw(passes.profile, profile));
    renderer.readRenderTargetPixelsAsync(profile, 0, 0, 1, PROFILE.rows, profileData).then(() => {
      reading = false;
      if (!disposed && asked === generation) analyse();
    }, error => {
      reading = false; readFailed = true;
      // Without the readback the cloud is still simulated; it is drawn across the whole domain instead.
      bounds.radius = domainRadius; bounds.top = domainHeight;
      console.error('Plume fluid: cloud measurement failed, drawing the whole domain', error);
    });
  }
  function reset() {
    generation++;
    clock.reset(); time = 0; feed = 1; active = false; hottest = 0; sinceProfile = 0;
    head.height = measured.height = start.height;
    head.radius = measured.radius = start.radius;
    bounds.radius = fireballRadius * SIM.stem.radius * 2; bounds.top = fireballRadius * SIM.stem.height;
    scope(clearTargets);
  }
  reset();

  return {
    extent: new Vector3(domainRadius, domainHeight, domainRadius), cell,
    head, bounds,
    get texture() { return gas.read.texture; },
    get hottest() { return hottest; },   // heat / HEAT_UNIT of the hottest cell
    ignite() {
      reset();
      active = true; hottest = SIM.ignition.heat / HEAT_UNIT;
      passes.ignite.uniforms.uFuel.value = look.fuel;
      scope(() => { draw(passes.ignite, gas.write); gas.swap(); });
    },
    reset,
    update(dt) {
      if (!active || disposed) return;
      scope(() => { renderer.setClearColor(0x000000, 0); clock.advance(dt, stepOnce); });
      sinceProfile += dt;
      if (sinceProfile >= PROFILE.seconds) { sinceProfile = 0; measure(); }
      const follow = 1 - Math.exp(-dt / PROFILE.follow);
      head.height += (measured.height - head.height) * follow;
      head.radius += (measured.radius - head.radius) * follow;
    },
    setGroundFeed(amount) { feed = Math.max(0, Math.min(1, amount)); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of [velocity.read, velocity.write, gas.read, gas.write, profile]) t.dispose();
      for (const level of levels) for (const t of [level.solution.read, level.solution.write, level.source, level.residual]) t.dispose();
      for (const material of Object.values(passes)) material.dispose();
      quad.geometry.dispose();
    },
    get diagnostics() { return {time, head: {...head}, bounds: {...bounds}, hottest, cell}; },
  };
}
