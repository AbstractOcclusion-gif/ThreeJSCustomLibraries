// A small 2D fluid for one fire, run on the GPU: a vertical slice of air, heated along its bottom edge.
// Hot air rises (buoyancy), curls (vorticity confinement) and stays incompressible (pressure projection), which is
// what makes flames lick, neck and shed their tips. The bottom is a wall; the sides and the top are open.
// Each step: move velocity and add forces, measure divergence, solve pressure, remove its gradient, move heat.
import * as THREE from 'three';
import {createRenderScope} from '../core/render-state.js';
import {createFixedStep} from '../core/fixed-step.js';
import {NOISE_GLSL} from '../core/lighting.js';

export const FLAME_FLUID_DEFAULTS = Object.freeze({
  resolution: [80, 120],   // cells across and up
  pressureIterations: 12,  // more keeps the flow tighter and costs one small pass each
});
// Units: the slice is 1 wide; speeds are slice widths per second.
const SIM = Object.freeze({
  step: 1 / 60, maxSteps: 2,
  buoyancy: 10,            // upward acceleration of fully hot air
  cooling: 2.2,            // share of the heat lost per second: with buoyancy, this sets the flame height
  taper: 2.2,              // extra cooling at the top of the slice, as a multiple of `cooling`: flames thin to a tip
  sideDrag: 1.6,           // sideways speed lost per second on top of `drag`: the fire wanders less left and right
  burnout: .22,            // heat lost per second whatever is left: thin wisps go out instead of lingering
  edge: [.16, 6],          // within this share of the slice from its sides and top, heat is lost this much faster per second
  drag: .6,                // velocity lost per second
  curl: .6,                // vorticity confinement: how strongly small swirls are kept alive
  sourceRows: .045,        // height of the heated band, as a share of the slice height
  sourceFlicker: 3.2,      // how fast the heat along the band wanders, per second
  sourceGrain: 14,         // hot spots along the band
});

const QUAD_VERTEX = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// Shared by every pass. Bottom: wall. Sides and top: open, where pressure is zero.
const COMMON = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uTexel;
  bool outside(vec2 uv) { return uv.x < 0.0 || uv.x > 1.0 || uv.y > 1.0; }
`;

// temperature() gives the heat field (0..~1) as a texture: sample .r.
// seed: any number; fires with different seeds burn with different hot spots, so no two move alike.
export function createFlameFluid(renderer, {resolution = FLAME_FLUID_DEFAULTS.resolution, pressureIterations = FLAME_FLUID_DEFAULTS.pressureIterations, seed = 0} = {}) {
  if (!renderer?.isWebGLRenderer) throw Error('Flame fluid needs a WebGL renderer');
  const [columns, rows] = resolution;
  if (!Number.isFinite(seed)) throw Error('Flame fluid seed must be finite');
  if (![columns, rows].every(n => Number.isInteger(n) && n >= 8 && n <= 512) || !Number.isInteger(pressureIterations) || pressureIterations < 1 || pressureIterations > 80) {
    throw Error('Flame fluid needs a resolution of 8..512 cells and 1..80 pressure iterations');
  }
  const target = () => {
    const t = new THREE.WebGLRenderTarget(columns, rows, {type: THREE.HalfFloatType, depthBuffer: false});
    t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
    t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const pair = () => ({read: target(), write: target(), swap() { [this.read, this.write] = [this.write, this.read]; }});
  const velocity = pair(), heat = pair(), pressure = pair(), divergence = target();
  const texel = new THREE.Vector2(1 / columns, 1 / rows);
  const aspect = rows / columns;   // the slice is `aspect` tall in its own units
  const shared = {uTexel: {value: texel}, uAspect: {value: aspect}, uDt: {value: SIM.step}};
  const pass = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader: QUAD_VERTEX, fragmentShader: COMMON + fragmentShader, uniforms: {...shared, ...uniforms}, depthTest: false, depthWrite: false,
  });

  const passes = {
    // Move the velocity along itself, then add buoyancy, drag and vorticity confinement.
    advectVelocity: pass(/* glsl */`
      uniform sampler2D tVelocity, tHeat;
      uniform float uAspect, uDt;
      float curlAt(vec2 uv) {
        return (texture2D(tVelocity, uv + vec2(uTexel.x, 0.0)).y - texture2D(tVelocity, uv - vec2(uTexel.x, 0.0)).y)
          - (texture2D(tVelocity, uv + vec2(0.0, uTexel.y)).x - texture2D(tVelocity, uv - vec2(0.0, uTexel.y)).x);
      }
      void main() {
        vec2 scale = vec2(1.0, 1.0 / uAspect);   // slice units to uv
        vec2 v = texture2D(tVelocity, vUv - texture2D(tVelocity, vUv).xy * scale * uDt).xy;
        float heat = texture2D(tHeat, vUv).r;
        v.y += ${SIM.buoyancy.toFixed(2)} * heat * uDt;
        // Push along the gradient of |curl|, turned a quarter: it feeds the swirls the solver would smooth away.
        vec2 grad = vec2(abs(curlAt(vUv + vec2(uTexel.x, 0.0))) - abs(curlAt(vUv - vec2(uTexel.x, 0.0))),
          abs(curlAt(vUv + vec2(0.0, uTexel.y))) - abs(curlAt(vUv - vec2(0.0, uTexel.y))));
        float len = length(grad);
        if (len > .0001) v += ${SIM.curl.toFixed(2)} * uDt * curlAt(vUv) * vec2(grad.y, -grad.x) / len;
        v *= 1.0 - ${SIM.drag.toFixed(2)} * uDt;
        v.x *= 1.0 - ${SIM.sideDrag.toFixed(2)} * uDt;
        if (vUv.y < uTexel.y) v.y = max(v.y, 0.0);   // nothing flows down through the fuel
        gl_FragColor = vec4(v, 0.0, 1.0);
      }`, {tVelocity: {value: null}, tHeat: {value: null}}),
    divergence: pass(/* glsl */`
      uniform sampler2D tVelocity;
      void main() {
        float right = texture2D(tVelocity, vUv + vec2(uTexel.x, 0.0)).x, left = texture2D(tVelocity, vUv - vec2(uTexel.x, 0.0)).x;
        float up = texture2D(tVelocity, vUv + vec2(0.0, uTexel.y)).y;
        float down = vUv.y < uTexel.y ? 0.0 : texture2D(tVelocity, vUv - vec2(0.0, uTexel.y)).y;
        gl_FragColor = vec4(.5 * (right - left + up - down), 0.0, 0.0, 1.0);
      }`, {tVelocity: {value: null}}),
    pressure: pass(/* glsl */`
      uniform sampler2D tPressure, tDivergence;
      float p(vec2 uv, float centre) {
        if (outside(uv)) return 0.0;        // open air
        if (uv.y < 0.0) return centre;      // wall
        return texture2D(tPressure, uv).r;
      }
      void main() {
        float centre = texture2D(tPressure, vUv).r;
        float sum = p(vUv + vec2(uTexel.x, 0.0), centre) + p(vUv - vec2(uTexel.x, 0.0), centre)
          + p(vUv + vec2(0.0, uTexel.y), centre) + p(vUv - vec2(0.0, uTexel.y), centre);
        gl_FragColor = vec4((sum - texture2D(tDivergence, vUv).r) * .25, 0.0, 0.0, 1.0);
      }`, {tPressure: {value: null}, tDivergence: {value: null}}),
    project: pass(/* glsl */`
      uniform sampler2D tPressure, tVelocity;
      float p(vec2 uv, float centre) {
        if (outside(uv)) return 0.0;
        if (uv.y < 0.0) return centre;
        return texture2D(tPressure, uv).r;
      }
      void main() {
        float centre = texture2D(tPressure, vUv).r;
        vec2 gradient = .5 * vec2(p(vUv + vec2(uTexel.x, 0.0), centre) - p(vUv - vec2(uTexel.x, 0.0), centre),
          p(vUv + vec2(0.0, uTexel.y), centre) - p(vUv - vec2(0.0, uTexel.y), centre));
        gl_FragColor = vec4(texture2D(tVelocity, vUv).xy - gradient, 0.0, 1.0);
      }`, {tPressure: {value: null}, tVelocity: {value: null}}),
    // Move the heat along the flow, cool it, and feed the heated band.
    advectHeat: pass(/* glsl */`
      uniform sampler2D tVelocity, tHeat;
      uniform float uAspect, uDt, uTime, uIntensity, uSeed;
      uniform vec2 uSource;   // centre and half width of the heated band, in slice widths
      ${NOISE_GLSL}
      void main() {
        vec2 scale = vec2(1.0, 1.0 / uAspect);
        float heat = texture2D(tHeat, vUv - texture2D(tVelocity, vUv).xy * scale * uDt).r;
        // A flame that nears the open border burns out before it gets there, so it is never cut off.
        float border = min(min(vUv.x, 1.0 - vUv.x), 1.0 - vUv.y);
        float quench = ${SIM.edge[1].toFixed(1)} * (1.0 - smoothstep(0.0, ${SIM.edge[0].toFixed(2)}, border));
        heat = max(0.0, heat * (1.0 - (${SIM.cooling.toFixed(2)} * (1.0 + ${SIM.taper.toFixed(2)} * vUv.y) + quench) * uDt) - ${SIM.burnout.toFixed(2)} * uDt);
        float along = (vUv.x - uSource.x) / uSource.y;
        float band = (1.0 - smoothstep(.75, 1.0, abs(along))) * (1.0 - smoothstep(0.0, ${SIM.sourceRows.toFixed(3)}, vUv.y));
        // Fuel does not burn evenly: hot spots wander along the band.
        float spots = valueNoise(vec3(vUv.x * ${SIM.sourceGrain.toFixed(1)}, uTime * ${SIM.sourceFlicker.toFixed(1)}, uSeed));
        float feed = band * uIntensity * smoothstep(.3, .62, spots + uIntensity * .12);
        gl_FragColor = vec4(max(heat, feed), 0.0, 0.0, 1.0);
      }`, {tVelocity: {value: null}, tHeat: {value: null}, uTime: {value: 0}, uIntensity: {value: 0}, uSeed: {value: seed}, uSource: {value: new THREE.Vector2(.5, .3)}}),
  };

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const stage = new THREE.Scene(), eye = new THREE.Camera();
  stage.add(quad);
  const scope = createRenderScope(renderer);
  const clock = createFixedStep({step: SIM.step, maxSteps: SIM.maxSteps});
  const draw = (material, into) => { quad.material = material; renderer.setRenderTarget(into); renderer.render(stage, eye); };
  let time = 0, disposed = false;

  function stepOnce(intensity) {
    time += SIM.step;
    let u = passes.advectVelocity.uniforms;
    u.tVelocity.value = velocity.read.texture; u.tHeat.value = heat.read.texture;
    draw(passes.advectVelocity, velocity.write); velocity.swap();
    passes.divergence.uniforms.tVelocity.value = velocity.read.texture;
    draw(passes.divergence, divergence);
    u = passes.pressure.uniforms; u.tDivergence.value = divergence.texture;
    for (let i = 0; i < pressureIterations; i++) {
      u.tPressure.value = pressure.read.texture;
      draw(passes.pressure, pressure.write); pressure.swap();
    }
    u = passes.project.uniforms; u.tPressure.value = pressure.read.texture; u.tVelocity.value = velocity.read.texture;
    draw(passes.project, velocity.write); velocity.swap();
    u = passes.advectHeat.uniforms;
    u.tVelocity.value = velocity.read.texture; u.tHeat.value = heat.read.texture; u.uTime.value = time; u.uIntensity.value = intensity;
    draw(passes.advectHeat, heat.write); heat.swap();
  }

  return {
    aspect,
    get temperature() { return heat.read.texture; },
    // sourceWidth: half width of the heated band as a share of the slice width (0..0.5).
    setSource(sourceWidth) {
      if (!(sourceWidth > 0 && sourceWidth <= .5)) throw Error('Flame fluid source half width must be in (0, 0.5]');
      passes.advectHeat.uniforms.uSource.value.set(.5, sourceWidth);
    },
    // intensity 0..1 feeds the fire.
    update(dt, {intensity}) {
      if (disposed) return;
      scope(() => clock.advance(dt, () => stepOnce(intensity)));
    },
    clear() {
      scope(() => {
        renderer.setClearColor(0x000000, 0);
        for (const t of [velocity.read, velocity.write, heat.read, heat.write, pressure.read, pressure.write]) { renderer.setRenderTarget(t); renderer.clear(); }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const t of [velocity.read, velocity.write, heat.read, heat.write, pressure.read, pressure.write, divergence]) t.dispose();
      for (const material of Object.values(passes)) material.dispose();
      quad.geometry.dispose();
    },
  };
}
