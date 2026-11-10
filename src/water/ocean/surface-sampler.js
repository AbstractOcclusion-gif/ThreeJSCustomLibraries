// ocean/surface-sampler.js -- the ocean's answer to WaterVolume.SampleHeights for floaters: one pass evaluates the drawn surface
// (FFT cascade sum with the same distance fade as the surface, or the analytic bands) at up to MAX_PROBES world points into a
// MAX_PROBES x 1 float row, read back asynchronously (RowReadback). Mirrors OceanFft.compute's BakeHeightField contract:
// (dispX, height, dispZ, valid) at the queried xz, horizontal displacement NOT inverted (same as the Unity bake).
// Surface velocity for the drift term is finite-differenced per probe on the CPU between two reads.
import * as THREE from 'three';
import { QV, createPass, createTargetScope } from './passes.js';
import { FFT_SAMPLE_GLSL } from './fft.js';
import { RowReadback } from './readback.js';
import { SIM_SAMPLE_GLSL } from './sim-window.js';

export const MAX_PROBES = 64;

const createSampleMaterial = (fft, count, wake) => new THREE.ShaderMaterial({ vertexShader: QV, depthTest: false, depthWrite: false,
  uniforms: { ...fft.uniforms, ...wake?.uniforms, uProbe: { value: Array.from({ length: count }, () => new THREE.Vector2()) },
    uFadeOriginXZ: { value: new THREE.Vector2() } },
  fragmentShader: /* glsl */`
  ${FFT_SAMPLE_GLSL}
  ${wake ? SIM_SAMPLE_GLSL : ''}
  uniform vec2 uProbe[${count}]; uniform vec2 uFadeOriginXZ;
  void main(){
    int i = int(gl_FragCoord.x);
    vec3 d = oceanDisplacementFrom(uProbe[i], uFadeOriginXZ, 1.0);
    ${wake ? 'float fade; d.y += sampleRipple(uProbe[i], fade).r;' : ''}
    gl_FragColor = vec4(d, 1.0);
  }` });

// A probe set: `points` (world Vector3s, written by the owner each frame) -> `samples` (height, velocity) 1-2 frames later.
export class SurfaceProbes {
  constructor(fft, count, {wake} = {}) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_PROBES) throw new RangeError(`SurfaceProbes: count must be 1..${MAX_PROBES}`);
    this.fft = fft;
    this.renderer = fft.renderer;
    this.pass = createPass(this.renderer);
    this.scope = createTargetScope(this.renderer);
    this.target = new THREE.WebGLRenderTarget(count, 1, {type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter});
    this.material = createSampleMaterial(fft, count, wake);
    this.count = count;
    this.points = Array.from({ length: count }, () => new THREE.Vector3());
    this.samples = Array.from({ length: count }, () => ({ valid: false, height: 0, dispX: 0, dispZ: 0, velocity: new THREE.Vector3(), time: 0 }));
    this.readback = new RowReadback(this.renderer, count);
  }
  // Frame start: collect a finished read, finite-difference the surface velocity per probe.
  collect() {
    const tag = this.readback.collect(); if (tag === null) return false;
    const {time, positions} = tag;
    const b = this.readback.buffer;
    for (let i = 0; i < this.count; i++) {
      const s = this.samples[i], valid = b[i * 4 + 3] > 0.5;
      if (valid && s.valid && time > s.time) { const inv = 1 / (time - s.time);
        s.velocity.set((b[i * 4] - s.dispX) * inv, (b[i * 4 + 1] - s.height) * inv, (b[i * 4 + 2] - s.dispZ) * inv); }
      else s.velocity.set(0, 0, 0);
      s.valid = valid; s.dispX = b[i * 4]; s.height = b[i * 4 + 1]; s.dispZ = b[i * 4 + 2]; s.time = time;
      s.x = positions[i * 2]; s.z = positions[i * 2 + 1];
    }
    return true;
  }
  // After the FFT update: sample the surface at this frame's probe points and queue the read, tagged with the wave time.
  issue(waveTime, fadeOrigin) {
    if (this.fft.uniforms.uOceanFftActive.value === 0) return false;
    const u = this.material.uniforms;
    for (let i = 0; i < this.count; i++) u.uProbe.value[i].set(this.points[i].x, this.points[i].z);
    u.uFadeOriginXZ.value.set(fadeOrigin.x, fadeOrigin.z);
    return this.scope(() => {
      this.pass.render(this.material, this.target);
      return this.readback.issue(this.target, {time: waveTime, positions: this.points.flatMap(p => [p.x, p.z])});
    });
  }
  dispose() {
    this.readback.dispose();
    this.pass.dispose();
    this.target.dispose();
    this.material.dispose();
  }
}
