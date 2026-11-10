// ocean/sim-window.js -- the interactive ripple simulation as a WINDOW that follows a focus (the boat) over the open ocean:
// WebGpuWater's WaterSimWindow (texel-snapped centre, Scroll on move, edge fade) around the pond solver copied from WebAquarium
// src/rendering/passes.js (updateMat = WaterSim.compute Update: explicit wave equation + viscosity; normalMat; foamMat) plus a port
// of the SphereInteract kernel (Crest-style velocity dipole: a moving sphere pushes ahead / pulls behind -> V-wake, + wake foam).
// Field layout (aquarium convention): sim .r height (m), .g velocity, .ba normal xz; foam .r foam coverage.
// Sim height units are METRES (Unity normalises by the body's vertical extent); strength knobs are tuned here accordingly.
import * as THREE from 'three';
import { QV, createPass, createTargetScope, pingPong } from './passes.js';
import { createObstacleUniforms } from './obstacle.js';

const REF_FPS = 60;                                      // solver steps per second (frame-rate independent, as the aquarium)
const MAX_STEPS_PER_FRAME = 8;
export const MAX_SPHERES = 8;                            // queued interactor stamps per step
export const MAX_DROPS = 16;                             // queued height drops per step
const REST_STATE = [0, 0, 0, 0];                         // height, velocity and the two horizontal components of an up normal
// Sanitize (WaterSim.compute): clamp the field to its stable range so one runaway texel can't propagate. Unity's limits are 1 and
// 0.5 in pool units (x the 100 m ocean extent = inert); in metres they are set to what a boat wake can physically reach.
const SIM_MAX_ABS_HEIGHT = 4.0, SIM_MAX_ABS_VELOCITY = 0.5;
// SphereInteract constants (WaterSim.compute).
const SPHERE_FALLOFF_VERT = 1.6, SPHERE_FALLOFF_HORIZ = 1.4, SPHERE_INNER_OFFSET = 0.109, SPHERE_INNER_MULT = 1.55, SPHERE_CULL_RADII = 4.0;
// Wake foam dose (WaterSimulation.CalculateWakeFoamDose).
const WAKE_FOAM_FULL_SPEED = 5, WAKE_FOAM_INJECTION_RATE = 3, MIN_INTERACTION_DT = 1e-5;
const MIN_STAMP_TEXEL_RADIUS = 4;                        // WaterSimulation.MinDropTexelRadius: a stamp is never narrower than 4 texels

// Foam kernel (WaterSim.compute Foam) constants and the UNIT bridge: Unity's foam thresholds are authored in pool units (height /
// the body's vertical extent, 100 m on the ocean bodies) while this field is in metres, so speeds and heights are divided by this
// before the thresholds, and the demo scene's values carry over unchanged.
const FOAM_HEIGHT_UNIT_METERS = 100;
const FOAM_MAX_ADVECT_TEXELS = 4.0, FOAM_SHEAR_FRACTION = 1.0, FOAM_STICKY_SENSE = 4.0, FOAM_STICKY_KNEE_RELAX = 0.5, FOAM_FRESH_THRESHOLD = 0.5;
// Unity defaults: DefaultSimWindowMeters 32 (half size), DefaultSimResolution 256, ripple waveSpeed 0.6, damping 0.99; the foam
// block is the "15. Boat demo" scene's. Caps are in metres per step here (Unity's 0.5 pool units = 50 m, inert): 0.02 keeps a slam
// or a heave spike from throwing one oversized wave.
export const SIM_WINDOW_DEFAULTS = Object.freeze({ halfSizeMeters: 32, resolution: 256, waveSpeed: 0.6, damping: 0.99, viscosity: 0.15, edgeFadeTexels: 12,
  wakeStartForceCap: 0.02, wakeFoamStrength: 1, wakeFoamRadiusScale: 1.5,
  foamGenRate: 0.6, foamDecayFresh: 0.96, foamDecayResidual: 0.993, foamDecayRate: 1.25, foamSpread: 0.2, foamGenThreshold: 0.716, foamMinWaveHeight: 0.166,
  foamAdvect: 3, foamFromSpeed: 6, foamFromCurvature: 30, foamDeposit: 0.45, foamCrestBias: 0.028, foamHeadroom: 1 });

// Read by the surface, the sampler and the foam particles later: the window frame + its textures.
const createSimUniforms = () => ({ tSim: { value: null }, tSimFoam: { value: null }, uSimOn: { value: 0 }, uSimCenter: { value: new THREE.Vector2() },
  uSimHalf: { value: 32 }, uSimTexel: { value: 1 / 256 }, uSimEdgeFadeTexels: { value: 12 } });
// Ripple sample at a world xz: (height, velocity, normal xz) faded to rest over the edge band; fade = 0 outside the window.
export const SIM_SAMPLE_GLSL = /* glsl */`
uniform sampler2D tSim, tSimFoam; uniform float uSimOn, uSimHalf, uSimTexel, uSimEdgeFadeTexels; uniform vec2 uSimCenter;
vec2 simWindowUv(vec2 worldXZ){ return (worldXZ - uSimCenter) / (2.0 * uSimHalf) + 0.5; }
float simWindowFade(vec2 uv){ if (uSimOn < 0.5 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  vec2 d = min(uv, 1.0 - uv); return clamp(min(d.x, d.y) / max(uSimEdgeFadeTexels * uSimTexel, 1e-5), 0.0, 1.0); }
vec4 sampleRipple(vec2 worldXZ, out float fade){ vec2 uv = simWindowUv(worldXZ); fade = simWindowFade(uv);
  if (fade <= 0.0) return vec4(0.0); vec4 info = textureLod(tSim, uv, 0.0); info.r *= fade; info.ba *= fade; return info; }
float sampleWakeFoam(vec2 worldXZ){ vec2 uv = simWindowUv(worldXZ); float fade = simWindowFade(uv); return fade > 0.0 ? textureLod(tSimFoam, uv, 0.0).r * fade : 0.0; }`;

const glf = x => Number(x).toPrecision(9);
const rtOpts = floatFilter => ({ type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false,
  minFilter: floatFilter, magFilter: floatFilter });
const foamOpts = () => ({ type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

export class SimWindow {
  constructor(renderer, settings = {}, obstacleUniforms = createObstacleUniforms()) {
    const s = { ...SIM_WINDOW_DEFAULTS, ...settings }; this.s = s;
    if (!(s.resolution >= 16) || (s.resolution & (s.resolution - 1))) throw new RangeError(`SimWindow: resolution ${s.resolution} must be a power of two >= 16`);
    this.renderer = renderer;
    this.pass = createPass(renderer);
    this.scope = createTargetScope(renderer);
    const SIM_U = this.uniforms = createSimUniforms();
    const OBSTACLE_U = this.obstacles = obstacleUniforms;
    const floatFilter = renderer.extensions.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter;
    const N = s.resolution; this.resolution = N; this.halfSize = Math.max(1, s.halfSizeMeters); this.texelMeters = 2 * this.halfSize / N;
    this.sim = pingPong(() => new THREE.WebGLRenderTarget(N, N, rtOpts(floatFilter))); this.foam = pingPong(() => new THREE.WebGLRenderTarget(N, N, foamOpts()));
    this.cellX = 0; this.cellZ = 0; this.centerInit = false; this.center = new THREE.Vector2(); this.simAcc = 0; this.time = 0;
    this.spheres = []; this.sphereCount = 0;
    const TEXEL = new THREE.Vector2(1 / N, 1 / N);
    // ---- solver (copied from the aquarium's updateMat / normalMat / foamMat, minus the pool-only solid/shore/cylinder terms)
    // Solid cells (WaterSim.compute ObstacleSolidAt / ReflectiveNeighbour): a column the hull occupies holds its rest dip with no
    // wave motion of its own, and a neighbour there reads as the cell itself, so waves reflect off the hull. The obstacle map's V is
    // flipped relative to the sim (Unity obstacleFlipY).
    this.updateMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tWater: { value: null }, uSpeed: { value: s.waveSpeed }, uDamp: { value: s.damping }, uTexel: { value: TEXEL }, uVisc: { value: s.viscosity },
        tSolid: OBSTACLE_U.tObstacleSolid, uSolidOn: OBSTACLE_U.uSolidOn, uSolidThreshold: { value: 0.02 }, uRestDip: { value: 0 } },
      fragmentShader: `uniform sampler2D tWater, tSolid; uniform float uSpeed, uDamp, uVisc, uSolidOn, uSolidThreshold, uRestDip; uniform vec2 uTexel; varying vec2 vUv;
      bool solid(vec2 uv){ return uSolidOn > 0.5 && texture2D(tSolid, vec2(uv.x, 1.0 - uv.y)).r > uSolidThreshold; }
      vec2 nN(vec2 uv, vec2 self){ return solid(uv) ? self : texture2D(tWater, uv).rg; }
      void main(){ vec4 info = texture2D(tWater, vUv); vec2 ex = vec2(uTexel.x, 0.0), ey = vec2(0.0, uTexel.y);
        if (solid(vUv)) { gl_FragColor = vec4(-uRestDip, 0.0, info.ba); return; }
        vec2 a = (nN(vUv - ex, info.rg) + nN(vUv + ex, info.rg) + nN(vUv - ey, info.rg) + nN(vUv + ey, info.rg)) * 0.25;
        info.g += (a.x - info.r) * uSpeed; info.g *= uDamp;
        info.g = mix(info.g, a.y, uVisc);          // viscosity: pull the velocity toward its neighbourhood mean (kills the texel checkerboard)
        info.r += info.g; info.r *= 0.9998;
        info.r = clamp(info.r, -${glf(SIM_MAX_ABS_HEIGHT)}, ${glf(SIM_MAX_ABS_HEIGHT)}); info.g = clamp(info.g, -${glf(SIM_MAX_ABS_VELOCITY)}, ${glf(SIM_MAX_ABS_VELOCITY)});
        gl_FragColor = info; }` });
    this.normalMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tWater: { value: null }, uTexel: { value: TEXEL }, uD: { value: this.texelMeters } },
      fragmentShader: `uniform sampler2D tWater; uniform vec2 uTexel; uniform float uD; varying vec2 vUv;
      void main(){ vec4 info = texture2D(tWater, vUv);
        vec3 dx = vec3(uD, texture2D(tWater, vUv + vec2(uTexel.x, 0.0)).r - info.r, 0.0);
        vec3 dy = vec3(0.0, texture2D(tWater, vUv + vec2(0.0, uTexel.y)).r - info.r, uD);
        info.ba = normalize(cross(dy, dx)).xz; gl_FragColor = info; }` });
    // ---- Foam (WaterSim.compute Foam): foam back-traced along the surface normal's xz (slides off crests, rides ripple fronts),
    // diffused toward its neighbours, generated from a speed + shear activity and negative curvature behind a threshold / minimum
    // wave height gate (relaxed where foam already sits), deposited, and decayed with a fresh / residual survival pair.
    this.foamMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tFoam: { value: null }, tWater: { value: null }, uTexel: { value: TEXEL },
        uAdvect: { value: 3 }, uSpread: { value: 0.2 }, uFromSpeed: { value: 6 }, uFromCurv: { value: 30 }, uCrestBias: { value: 0 }, uGenThreshold: { value: 0.716 },
        uMinWaveHeight: { value: 0.166 }, uGenRate: { value: 0.6 }, uDeposit: { value: 0.45 }, uHeadroom: { value: 1 }, uDecayFresh: { value: 0.96 }, uDecayResidual: { value: 0.993 },
        uDecayRate: { value: 1.25 }, uDtSteps: { value: 1 } },
      fragmentShader: `uniform sampler2D tFoam, tWater; uniform vec2 uTexel;
      uniform float uAdvect, uSpread, uFromSpeed, uFromCurv, uCrestBias, uGenThreshold, uMinWaveHeight, uGenRate, uDeposit, uHeadroom, uDecayFresh, uDecayResidual, uDecayRate, uDtSteps;
      varying vec2 vUv;
      #define FOAM_UNIT ${glf(1 / FOAM_HEIGHT_UNIT_METERS)}
      vec4 W(vec2 o){ return texture2D(tWater, clamp(vUv + o * uTexel, 0.0, 1.0)); }
      float F(vec2 o){ return texture2D(tFoam, clamp(vUv + o * uTexel, 0.0, 1.0)).r; }
      void main(){ vec4 info = W(vec2(0.0));
        vec2 flow = clamp(info.ba * uAdvect, -${glf(FOAM_MAX_ADVECT_TEXELS)}, ${glf(FOAM_MAX_ADVECT_TEXELS)});
        float advected = texture2D(tFoam, clamp(vUv - flow * uTexel, 0.0, 1.0)).r;          // bilinear back-trace
        float foam = mix(advected, (F(vec2(-1.,0.)) + F(vec2(1.,0.)) + F(vec2(0.,-1.)) + F(vec2(0.,1.))) * 0.25, uSpread);
        vec4 nL = W(vec2(-1.,0.)), nR = W(vec2(1.,0.)), nD = W(vec2(0.,-1.)), nU = W(vec2(0.,1.));
        vec4 nL2 = W(vec2(-2.,0.)), nR2 = W(vec2(2.,0.)), nD2 = W(vec2(0.,-2.)), nU2 = W(vec2(0.,2.));
        float speed = abs((info.g + nL.g + nR.g + nD.g + nU.g + nL2.g + nR2.g + nD2.g + nU2.g) / 9.0) * FOAM_UNIT;
        float lap = ((nL2.r + nR2.r + nD2.r + nU2.r) * 0.25 - info.r) * FOAM_UNIT;
        float shear = length(vec2(nR2.g - nL2.g, nU2.g - nD2.g)) * 0.25 * FOAM_UNIT;
        float activity = (speed + shear * ${glf(FOAM_SHEAR_FRACTION)}) * uFromSpeed + max(0.0, -lap) * uFromCurv;
        float crestHeight = max(0.0, -lap);
        float heightSignal = mix(abs(info.r) * FOAM_UNIT, crestHeight, uCrestBias);
        float sticky = clamp(foam * ${glf(FOAM_STICKY_SENSE)}, 0.0, 1.0) * ${glf(FOAM_STICKY_KNEE_RELAX)};
        float genThreshold = uGenThreshold * (1.0 - sticky), minWaveHeight = uMinWaveHeight * (1.0 - sticky);
        float heightGate = smoothstep(minWaveHeight * 0.5, max(minWaveHeight, 1e-6), heightSignal);
        float gen = clamp(activity - genThreshold, 0.0, 1.0) * heightGate;
        float headroom = mix(1.0, clamp(1.0 - foam, 0.0, 1.0), uHeadroom);
        foam += gen * headroom * (uGenRate * uDtSteps);
        foam = max(foam, clamp(gen * uDeposit, 0.0, 1.0));
        float survival = clamp(mix(uDecayResidual, uDecayFresh, clamp(foam / ${glf(FOAM_FRESH_THRESHOLD)}, 0.0, 1.0)), 0.0, 1.0);
        foam *= pow(survival, uDtSteps * uDecayRate);
        gl_FragColor = vec4(foam, 0.0, 0.0, 1.0); }` });
    // ---- Scroll (WaterSim.compute Scroll / ScrollFoam): Dst[p] = Src[p - offset], rest state where the source falls outside
    this.scrollMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tSrc: { value: null }, uOffset: { value: new THREE.Vector2() }, uTexel: { value: TEXEL }, uRest: { value: new THREE.Vector4(...REST_STATE) } },
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uOffset, uTexel; uniform vec4 uRest; varying vec2 vUv;
      void main(){ vec2 uv = vUv - uOffset * uTexel; bool inGrid = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)));
        gl_FragColor = inGrid ? textureLod(tSrc, uv, 0.0) : uRest; }` });
    // ---- Obstacle (WaterSim.compute Obstacle): inject the frame-to-frame footprint delta, 5x5 binomial-blurred, dead-banded, scaled
    this.obstacleMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tWater: { value: null }, tPrev: OBSTACLE_U.tObstaclePrev, tCurr: OBSTACLE_U.tObstacleCurr,
        uTexel: { value: TEXEL }, uStrength: { value: 0.05 }, uDeadband: { value: 0.0006 } },
      fragmentShader: `uniform sampler2D tWater, tPrev, tCurr; uniform vec2 uTexel; uniform float uStrength, uDeadband; varying vec2 vUv;
      const float W[5] = float[5](1.0, 4.0, 6.0, 4.0, 1.0);
      void main(){ vec4 info = texture2D(tWater, vUv); vec2 oc = vec2(vUv.x, 1.0 - vUv.y); float delta = 0.0;
        for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 q = clamp(oc + vec2(float(i), float(j)) * uTexel, 0.0, 1.0);
          delta += (texture2D(tPrev, q).r - texture2D(tCurr, q).r) * W[i + 2] * W[j + 2]; }
        float blurred = delta / 256.0;
        blurred = sign(blurred) * max(0.0, abs(blurred) - uDeadband);
        info.r += blurred * uStrength;
        gl_FragColor = info; }` });
    // ---- Drop (WaterSim.compute Drop): analytic cosine height stamps, uv-space radius like Unity (the aquarium's dropMat twin)
    this.dropMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tWater: { value: null }, uCount: { value: 0 },
        uDrops: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()) } },   // center.xy (uv), radius (uv), strength (m)
      fragmentShader: `uniform sampler2D tWater; uniform int uCount; uniform vec4 uDrops[${MAX_DROPS}]; varying vec2 vUv;
      void main(){ vec4 info = texture2D(tWater, vUv);
        for (int i = 0; i < ${MAX_DROPS}; i++) { if (i >= uCount) break; vec4 q = uDrops[i];
          float drop = max(0.0, 1.0 - length(q.xy - vUv) / q.z); drop = 0.5 - cos(drop * 3.14159265) * 0.5;
          info.r += drop * q.w; }
        info.r = clamp(info.r, -${glf(SIM_MAX_ABS_HEIGHT)}, ${glf(SIM_MAX_ABS_HEIGHT)});
        gl_FragColor = info; }` });
    this.dropCount = 0;
    // ---- SphereInteract: velocity dipole per queued sphere, wake foam stamp (port of the compute kernel; uv-space like Unity)
    this.sphereMat = new THREE.ShaderMaterial({ vertexShader: QV, uniforms: { tWater: { value: null }, tFoam: { value: null }, uCount: { value: 0 },
        uSphereA: { value: Array.from({ length: MAX_SPHERES }, () => new THREE.Vector4()) },   // center.xy (uv), radius (half-extent units), velY
        uSphereB: { value: Array.from({ length: MAX_SPHERES }, () => new THREE.Vector4()) },   // velXZ (height units), weight * strength, wakeFoamDose
        uSphereC: { value: Array.from({ length: MAX_SPHERES }, () => new THREE.Vector4()) },   // verticalForceCap
        uWakeStartForceCap: { value: s.wakeStartForceCap }, uWakeFoamStrength: { value: s.wakeFoamStrength }, uWakeFoamRadiusScale: { value: s.wakeFoamRadiusScale } },
      fragmentShader: `uniform sampler2D tWater, tFoam; uniform int uCount; uniform vec4 uSphereA[${MAX_SPHERES}], uSphereB[${MAX_SPHERES}], uSphereC[${MAX_SPHERES}];
      uniform float uWakeStartForceCap, uWakeFoamStrength, uWakeFoamRadiusScale; varying vec2 vUv;
      float interactionFalloff(float a, float x){ float ax = a * x; float ax2 = ax * ax; float ax4 = ax2 * ax2; return ax / (1.0 + ax2 * ax4); }
      void main(){ vec4 info = texture2D(tWater, vUv); vec4 foam = texture2D(tFoam, vUv);
        for (int i = 0; i < ${MAX_SPHERES}; i++) { if (i >= uCount) break;
          vec4 A = uSphereA[i], B = uSphereB[i]; float radius = A.z, velY = A.w; vec2 velXZ = B.xy; float gain = B.z, dose = B.w;
          vec2 d = vUv - A.xy; float dist = length(d);
          if (dist > radius * ${glf(SPHERE_CULL_RADII)}) continue;
          float sdf = dist - radius; vec2 nrm = dist > 1e-5 ? d / dist : vec2(0.0); float a = 1.0 / max(radius, 1e-4);
          float verticalForce = -velY * interactionFalloff(${glf(SPHERE_FALLOFF_VERT)} * a, sdf);
          float horizontalForce = 0.0;
          if (sdf > 0.0 || sdf < -radius * ${glf(SPHERE_INNER_OFFSET)}) {
            horizontalForce = sign(sdf) * dot(nrm, velXZ) * interactionFalloff(${glf(SPHERE_FALLOFF_HORIZ)} * a, abs(sdf));
            if (sdf < 0.0) horizontalForce *= ${glf(SPHERE_INNER_MULT)}; }
          float verticalPush = verticalForce * gain; float cap = uSphereC[i].x;
          if (cap > 0.0) verticalPush = clamp(verticalPush, -cap, cap);
          float wakePush = verticalPush + horizontalForce * gain;
          if (uWakeStartForceCap > 0.0) wakePush = clamp(wakePush, -uWakeStartForceCap, uWakeStartForceCap);
          info.g = clamp(info.g + wakePush, -${glf(SIM_MAX_ABS_VELOCITY)}, ${glf(SIM_MAX_ABS_VELOCITY)});
          float wakeDisc = clamp(1.0 - dist / max(radius * uWakeFoamRadiusScale, 1e-4), 0.0, 1.0);
          float wakeStamp = 1.0 - exp(-(uWakeFoamStrength * dose * wakeDisc));
          foam.r = 1.0 - (1.0 - foam.r) * (1.0 - wakeStamp); }
        gl_FragColor = info; }` });
    // the sphere pass must also carry the foam stamp: run it twice (field, then foam) -- see stepSpheres
    this.sphereFoamMat = this.sphereMat.clone(); this.sphereFoamMat.uniforms = this.sphereMat.uniforms;
    this.sphereFoamMat.fragmentShader = this.sphereMat.fragmentShader.replace('gl_FragColor = info; }', 'gl_FragColor = foam; }');
    this.clear();
    SIM_U.uSimHalf.value = this.halfSize; SIM_U.uSimTexel.value = 1 / N; SIM_U.uSimEdgeFadeTexels.value = s.edgeFadeTexels; SIM_U.uSimOn.value = 1;
    this.applySettings(s);
  }
  applySettings(settings) {
    const s = { ...this.s, ...settings }; this.s = s;
    this.updateMat.uniforms.uSpeed.value = s.waveSpeed; this.updateMat.uniforms.uDamp.value = s.damping; this.updateMat.uniforms.uVisc.value = s.viscosity;
    const u = this.sphereMat.uniforms; u.uWakeStartForceCap.value = s.wakeStartForceCap; u.uWakeFoamStrength.value = s.wakeFoamStrength; u.uWakeFoamRadiusScale.value = s.wakeFoamRadiusScale;
    const f = this.foamMat.uniforms; f.uAdvect.value = s.foamAdvect; f.uSpread.value = s.foamSpread; f.uFromSpeed.value = s.foamFromSpeed; f.uFromCurv.value = s.foamFromCurvature;
    f.uCrestBias.value = s.foamCrestBias; f.uGenThreshold.value = s.foamGenThreshold; f.uMinWaveHeight.value = s.foamMinWaveHeight; f.uGenRate.value = s.foamGenRate;
    f.uDeposit.value = s.foamDeposit; f.uHeadroom.value = s.foamHeadroom; f.uDecayFresh.value = s.foamDecayFresh; f.uDecayResidual.value = s.foamDecayResidual; f.uDecayRate.value = s.foamDecayRate;
    this.uniforms.uSimEdgeFadeTexels.value = s.edgeFadeTexels;
    if (s.obstacleStrength !== undefined) { this.obstacleMat.uniforms.uStrength.value = s.obstacleStrength; this.obstacleMat.uniforms.uDeadband.value = s.obstacleDeadband; }
    if (s.solidThreshold !== undefined) { this.updateMat.uniforms.uSolidThreshold.value = s.solidThreshold; this.updateMat.uniforms.uRestDip.value = s.restDip; }
  }
  // Footprint delta (after the obstacle maps were rendered this frame): one full-grid pass, Unity's ApplyObstacle.
  stepObstacle() {
    const pass = this.pass.render;
    if (this.obstacles.uObstacleOn.value < 0.5) return;
    this.obstacleMat.uniforms.tWater.value = this.sim.read.texture; pass(this.obstacleMat, this.sim.write); this.sim.swap();
  }
  clear() {
    const renderer = this.renderer;
    this.scope(() => {
      renderer.setClearColor(0, 0);
      for (const t of [this.sim.read, this.sim.write, this.foam.read, this.foam.write]) {
        renderer.setRenderTarget(t);
        renderer.clear();
      }
    });
    this.publish();
  }
  worldToUv(x, z, out) { return out.set((x - this.center.x) / (2 * this.halfSize) + 0.5, (z - this.center.y) / (2 * this.halfSize) + 0.5); }
  // WaterSimWindow.Track: snap the centre to the texel lattice around the follow point, scroll the field by the cell delta.
  track(followX, followZ) {
    const cellX = Math.round(followX / this.texelMeters), cellZ = Math.round(followZ / this.texelMeters);
    if (!this.centerInit) { this.cellX = cellX; this.cellZ = cellZ; this.centerInit = true; }
    else { const dx = cellX - this.cellX, dz = cellZ - this.cellZ; if (dx || dz) { this.scope(() => this.scroll(dx, dz)); this.cellX = cellX; this.cellZ = cellZ; } }
    this.center.set(this.cellX * this.texelMeters, this.cellZ * this.texelMeters);
    this.uniforms.uSimCenter.value.copy(this.center);
    this.publish();
  }
  scroll(dx, dz) {   // the centre moved +d cells: content shifts -d texels: Dst[p] = Src[p + d]
    const pass = this.pass.render;
    const u = this.scrollMat.uniforms; u.uOffset.value.set(-dx, -dz);
    u.uRest.value.set(...REST_STATE); u.tSrc.value = this.sim.read.texture; pass(this.scrollMat, this.sim.write); this.sim.swap();
    u.uRest.value.set(0, 0, 0, 1); u.tSrc.value = this.foam.read.texture; pass(this.scrollMat, this.foam.write); this.foam.swap();
  }
  // Queue a moving sphere (WaterVolume.AddSphereInteraction): world centre, world step this frame, radius (m), weight = submersion,
  // strength = master gain, dt for the wake foam dose. Mapped to Unity's sim-normalised space: centre uv, radius / half size,
  // velXZ and velY in sim height units (metres here).
  addSphere(centerX, centerY, centerZ, stepX, stepY, stepZ, radius, weight, strength, verticalForceCap, dt) {
    if (this.sphereCount >= MAX_SPHERES || weight <= 0 || strength <= 0) return;
    const i = this.sphereCount++, A = this.sphereMat.uniforms.uSphereA.value[i], B = this.sphereMat.uniforms.uSphereB.value[i];
    this.worldToUv(centerX, centerZ, A); if (A.x < 0 || A.x > 1 || A.y < 0 || A.y > 1) { this.sphereCount--; return; }
    A.z = Math.max(radius / this.halfSize, MIN_STAMP_TEXEL_RADIUS / this.resolution); A.w = stepY;   // same uv-space units as Unity's kernel
    const horizontal = Math.hypot(stepX, stepZ), dose = dt > MIN_INTERACTION_DT ? Math.min(horizontal / dt / WAKE_FOAM_FULL_SPEED, 1) * WAKE_FOAM_INJECTION_RATE * dt : 0;
    B.set(stepX, stepZ, weight * strength, dose); this.sphereMat.uniforms.uSphereC.value[i].x = verticalForceCap;
  }
  // Queue a height drop (WaterVolume.AddRipple): world centre, radius (m, floored to 4 texels), strength (m).
  addDrop(x, z, radius, strength) {
    if (this.dropCount >= MAX_DROPS || strength === 0) return;
    const q = this.dropMat.uniforms.uDrops.value[this.dropCount]; this.worldToUv(x, z, q);
    if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) return;
    q.z = Math.max(radius / this.halfSize, MIN_STAMP_TEXEL_RADIUS / this.resolution); q.w = strength; this.dropCount++;
  }
  stepDrops() {
    const pass = this.pass.render;
    if (!this.dropCount) return;
    const u = this.dropMat.uniforms; u.uCount.value = this.dropCount; u.tWater.value = this.sim.read.texture;
    pass(this.dropMat, this.sim.write); this.sim.swap(); this.dropCount = 0;
  }
  stepSpheres() {
    const pass = this.pass.render;
    if (!this.sphereCount) return;
    const u = this.sphereMat.uniforms; u.uCount.value = this.sphereCount; u.tWater.value = this.sim.read.texture; u.tFoam.value = this.foam.read.texture;
    pass(this.sphereMat, this.sim.write); pass(this.sphereFoamMat, this.foam.write); this.sim.swap(); this.foam.swap(); this.sphereCount = 0;
  }
  // Per frame: fixed-rate solver steps (same accumulator as the aquarium), normals, foam layer.
  update(dt) {
    this.scope(() => this.step(dt));
  }
  step(dt) {
    const pass = this.pass.render;
    this.stepObstacle(); this.stepDrops(); this.stepSpheres();
    this.simAcc += dt; const nSteps = Math.min(Math.max(0, Math.floor(this.simAcc * REF_FPS + 0.25)), MAX_STEPS_PER_FRAME);
    this.simAcc = THREE.MathUtils.clamp(this.simAcc - nSteps / REF_FPS, -0.25 / REF_FPS, 1 / REF_FPS);
    for (let i = 0; i < nSteps; i++) { this.updateMat.uniforms.tWater.value = this.sim.read.texture; pass(this.updateMat, this.sim.write); this.sim.swap(); }
    if (nSteps > 0) { this.normalMat.uniforms.tWater.value = this.sim.read.texture; pass(this.normalMat, this.sim.write); this.sim.swap(); }
    const f = this.foamMat.uniforms;
    f.tFoam.value = this.foam.read.texture; f.tWater.value = this.sim.read.texture; f.uDtSteps.value = dt * REF_FPS;   // frame-rate independent gen / decay
    pass(this.foamMat, this.foam.write); this.foam.swap();
    this.publish();
  }
  publish() {
    this.uniforms.tSim.value = this.sim.read.texture;
    this.uniforms.tSimFoam.value = this.foam.read.texture;
  }
  dispose() { const u = this.uniforms; u.uSimOn.value = 0; u.tSim.value = u.tSimFoam.value = null; this.sim.dispose(); this.foam.dispose();
    this.pass.dispose();
    for (const m of [this.updateMat, this.normalMat, this.foamMat, this.scrollMat, this.dropMat, this.sphereMat, this.sphereFoamMat, this.obstacleMat]) m.dispose(); }
}
