// TSL side of the WebGPU puffs: the compute step that moves every puff, and the sprite material that draws one sheet in
// one blend mode. Same maths as puffs.js (CPU step) and puff-material.js (GLSL shading); every number comes from
// puff-config.js and billow-glsl.js.
import {Fn, If, instanceIndex, uniform, float, vec2, vec3, vec4, texture, uv, mix, smoothstep, clamp, min, max, floor, fract, mod, select, dot, sqrt, length} from 'three/tsl';
import {SpriteNodeMaterial, AdditiveBlending, NormalBlending, Color, Vector2} from 'three/webgpu';
import {WIND_RAMP, PUFF_SHADING} from '../puff-config.js';
import {BILLOW} from '../billow-glsl.js';
import {DEAD} from './slots.js';

const {heat: HEAT, billow: BILLOW_LOOK} = PUFF_SHADING;
// hash13 of core/lighting.js NOISE_GLSL, written again as nodes (core stays GLSL): same scale and offset.
const NOISE_HASH = Object.freeze({scale: 0.1031, offset: 31.32});
const MIN_LIFE = 1e-4; // guards age / life on dead slots

// One frame of motion, as puffs.js update(): age, integrate with gravity, wind drift ramping in over WIND_RAMP.
// Each invocation writes only its own puff, so the WebGL 2 fallback (transform feedback) can run it too.
export function createPuffStep(rows, capacity) {
  const dt = uniform(0), drift = uniform(0), wind = uniform(new Vector2());
  const node = Fn(() => {
    const motion = rows.motion.element(instanceIndex),
      velocity = rows.velocity.element(instanceIndex);
    const shape = rows.shape.element(instanceIndex),
      look = rows.look.element(instanceIndex);
    If(velocity.w.greaterThan(DEAD), () => {
      const age = motion.w.add(dt).toVar();
      If(age.greaterThanEqual(velocity.w), () => {
        velocity.w.assign(DEAD);
      }).Else(() => {
        motion.xyz.addAssign(velocity.xyz.mul(dt));
        velocity.y.subAssign(dt.mul(shape.z));
        const carried = drift.mul(look.z).mul(min(1, age.div(WIND_RAMP))).mul(dt);
        motion.x.addAssign(wind.x.mul(carried));
        motion.z.addAssign(wind.y.mul(carried));
        motion.w.assign(age);
      });
    });
  })().compute(capacity);
  return {node, dt, drift, wind};
}

const hash13 = Fn(([source]) => {
  const p = fract(source.mul(NOISE_HASH.scale)).toVar();
  p.addAssign(dot(p, p.zyx.add(NOISE_HASH.offset)));
  return fract(p.x.add(p.y).mul(p.z));
});
const valueNoise = Fn(([p]) => {
  const i = floor(p).toVar(),
    g = fract(p),
    f = g.mul(g).mul(g.mul(-2).add(3)).toVar();
  const h = (x, y, z) => hash13(i.add(vec3(x, y, z)));
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), f.x), mix(h(0, 1, 0), h(1, 1, 0), f.x), f.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), f.x), mix(h(0, 1, 1), h(1, 1, 1), f.x), f.y),
    f.z,
  );
});
// particleBillow of billow-glsl.js: returns (warped uv, density) instead of an inout uv.
const particleBillow = Fn(([source, phase]) => {
  const centered = source.mul(2).sub(1);
  const depth = sqrt(max(0, float(1).sub(dot(centered, centered))));
  const p = vec3(source.mul(BILLOW.scale), depth.mul(BILLOW.depth).add(phase)).toVar();
  const coarse = valueNoise(p).toVar(),
    detail = valueNoise(p.mul(BILLOW.detail[0]).add(BILLOW.detail[1])).toVar();
  const warped = clamp(source.add(vec2(coarse, detail).sub(0.5).mul(BILLOW.warp)), 0, 1);
  const density = mix(float(BILLOW.density[0]), float(BILLOW.density[1]), smoothstep(BILLOW.ramp[0], BILLOW.ramp[1], mix(coarse, detail, BILLOW.detailMix)));
  return vec3(warped, density);
});
const vec3Of = ([x, y, z]) => vec3(x, y, z);

// Shading of a flipbook sheet, as puff-material.js: crossfaded frames, then heat or billow.
function animatedColor({map, cols, rows, heat, billow, width, height}, t, tint) {
  const last = cols * rows - 1,
    tiles = vec2(cols, rows);
  const inset = [(0.5 * cols) / width, (0.5 * rows) / height];
  const frame = t.mul(last).toVar(),
    first = floor(frame);
  const frameUv = (index, at) =>
    vec2(mod(index, cols), float(rows - 1).sub(floor(index.div(cols))))
      .add(mix(vec2(...inset), vec2(1 - inset[0], 1 - inset[1]), at))
      .div(tiles);
  let at = uv(),
    density = float(1);
  if (billow) {
    const result = particleBillow(uv(), frame.mul(BILLOW_LOOK.phasePerFrame)).toVar();
    at = result.xy;
    density = result.z;
  }
  const a = texture(map, frameUv(first, at)),
    b = texture(map, frameUv(min(first.add(1), last), at));
  const blended = mix(vec4(a.rgb.mul(a.a), a.a), vec4(b.rgb.mul(b.a), b.a), fract(frame)).toVar();
  let color = blended.rgb.div(max(blended.a, PUFF_SHADING.minAlpha)),
    alpha = blended.a,
    base = tint;
  if (heat) {
    const temperature = color.r.mul(mix(float(1), float(HEAT.cool), frame.div(last)));
    color = mix(vec3Of(HEAT.ember), vec3Of(HEAT.flame), smoothstep(HEAT.flameRamp[0], HEAT.flameRamp[1], temperature));
    color = mix(color, vec3Of(HEAT.core), smoothstep(HEAT.coreRamp[0], HEAT.coreRamp[1], temperature));
    alpha = smoothstep(HEAT.alphaRamp[0], HEAT.alphaRamp[1], alpha);
    base = vec3(1);
  }
  if (billow) {
    const body = float(1).sub(smoothstep(BILLOW_LOOK.body[0], BILLOW_LOOK.body[1], length(at.mul(2).sub(1))));
    alpha = min(1, alpha.add(body.mul(BILLOW_LOOK.bodyAlpha)).mul(density));
    color = mix(vec3(BILLOW_LOOK.grey), color, BILLOW_LOOK.keep);
  }
  return vec4(base.mul(color), alpha);
}
// A still sheet: frame `index` of its grid, as the cloned, offset textures of puffs.js.
function staticColor({map, cols, rows}, index, tint) {
  const f = mod(index, cols * rows);
  const offset = vec2(mod(f, cols).div(cols), float(rows - 1).sub(floor(f.div(cols))).div(rows));
  const sample = texture(map, uv().div(vec2(cols, rows)).add(offset));
  return vec4(tint.mul(sample.rgb), sample.a);
}

// Material for the puffs of one sheet in one blend mode; other puffs collapse to nothing in its vertex stage.
// sheet: {id, map, cols, rows, animated, heat, billow, width, height}. light: uniform colour (environment.light or white).
export function createPuffMaterial(rows, sheet, additive, light) {
  const motion = rows.motion.toAttribute(),
    velocity = rows.velocity.toAttribute(),
    shape = rows.shape.toAttribute();
  const look = rows.look.toAttribute(),
    tint = rows.tint.toAttribute(),
    draw = rows.draw.toAttribute();
  const life = velocity.w,
    age = motion.w;
  const mine = life.greaterThan(DEAD).and(draw.x.equal(sheet.id)).and(draw.z.equal(additive ? 1 : 0));
  const t = clamp(age.div(max(life, MIN_LIFE)), 0, 1).toVar();
  const size = shape.x.mul(t.mul(shape.y).add(1));
  const material = new SpriteNodeMaterial({transparent: true, depthWrite: false, blending: additive ? AdditiveBlending : NormalBlending});
  material.positionNode = motion.xyz;
  material.scaleNode = vec2(size.mul(look.x), size).mul(select(mine, 1, 0));
  material.rotationNode = look.w;
  const fade = select(look.y.greaterThan(0), min(1, age.div(max(look.y, MIN_LIFE))), 1);
  material.opacityNode = float(1).sub(t).mul(shape.w).mul(fade);
  const lit = select(tint.w.greaterThan(0.5), tint.xyz.mul(light), tint.xyz);
  material.colorNode = sheet.animated ? animatedColor(sheet, t, lit) : staticColor(sheet, draw.y, lit);
  return material;
}

export const createLightUniform = () => uniform(new Color(1, 1, 1));
