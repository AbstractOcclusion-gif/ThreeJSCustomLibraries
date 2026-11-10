import * as THREE from 'three';

const FIN_WEIGHT = 0.45 * 255;     // a vertex belongs to a fin above 45 % of its byte rig weight
const FIN_SPLIT_PASSES = 8;        // 2-means passes splitting each side's paired fins into pectoral and ventral
const FIN_ROOT_SHIFT = 2;          // a paired fin's root = the nearest quarter (length >> this) of its cluster to the midline
const TEXTURE_ANISOTROPY = 4;
// The packed model format (assets/fish/README.md): int16 positions x scale, int8 normals, uint16 uvs.
const PACKED = Object.freeze({position: 32767, normal: 127, uv: 65535});
// WebAquarium's skin values, toned for MeshStandardMaterial: rougher, and a fifth of the metalness.
const SKIN = Object.freeze({extraRoughness: .15, metalnessShare: .2});

// WebAquarium fin pivots and the instanced body / fin deformation.
function finPivots(g) {
  const p = g.attributes.position.array, w = g.attributes.aW.array, n = p.length / 3, out = new Float32Array(n * 4), T = FIN_WEIGHT;
  const idx = c => { const a = []; for (let i = 0; i < n; i++) if (w[i * 4 + c] > T) a.push(i); return a; };
  const mean = (a, f) => a.reduce((s, i) => s + f(i), 0) / Math.max(1, a.length);
  let cy = 0; for (let i = 0; i < n; i++) cy += p[i * 3 + 1]; cy /= n;
  // median: dorsal (above the body centre) / anal (below); pivot y = the base of each fin
  const med = idx(1);
  for (const up of [true, false]) { const a = med.filter(i => (p[i * 3 + 1] > cy) === up); if (!a.length) continue;
    const ys = a.map(i => p[i * 3 + 1]); const base = up ? Math.min(...ys) : Math.max(...ys);
    for (const i of a) { out[i * 4] = 0; out[i * 4 + 1] = base; out[i * 4 + 2] = p[i * 3 + 2]; out[i * 4 + 3] = 1; } }
  // paired: per side, 2-means on z (pectoral near the head +Z, ventral mid-belly); root = 25 % of the cluster nearest the midline
  const pr = idx(2);
  for (const sd of [1, -1]) { const a = pr.filter(i => Math.sign(p[i * 3] || 1e-6) === sd); if (!a.length) continue;
    const zs = a.map(i => p[i * 3 + 2]); let c0 = Math.max(...zs), c1 = Math.min(...zs), lab = [];
    for (let it = 0; it < FIN_SPLIT_PASSES; it++) { lab = a.map(i => Math.abs(p[i * 3 + 2] - c0) <= Math.abs(p[i * 3 + 2] - c1) ? 0 : 1);
      const m0 = a.filter((_, k) => !lab[k]), m1 = a.filter((_, k) => lab[k]); if (m0.length) c0 = mean(m0, i => p[i * 3 + 2]); if (m1.length) c1 = mean(m1, i => p[i * 3 + 2]); }
    for (const L of [0, 1]) { const cl = a.filter((_, k) => lab[k] === L); if (!cl.length) continue;
      const root = [...cl].sort((x, y) => Math.abs(p[x * 3]) - Math.abs(p[y * 3])).slice(0, Math.max(1, cl.length >> FIN_ROOT_SHIFT));
      const px = mean(root, i => p[i * 3]), py = mean(root, i => p[i * 3 + 1]), pz = mean(root, i => p[i * 3 + 2]);
      for (const i of cl) { out[i * 4] = px; out[i * 4 + 1] = py; out[i * 4 + 2] = pz; out[i * 4 + 3] = 2; } } }
  // jaw: hinge at the back (min z) and top (max y) of the jaw verts
  const jw = idx(3);
  if (jw.length) { const hz = Math.min(...jw.map(i => p[i * 3 + 2])), hy = Math.max(...jw.map(i => p[i * 3 + 1]));
    for (const i of jw) { out[i * 4] = 0; out[i * 4 + 1] = hy; out[i * 4 + 2] = hz; out[i * 4 + 3] = 3; } }
  return new THREE.BufferAttribute(out, 4);
}
const FISH_DEFORM = `
      // body wave, head (+Z) -> tail, driven by the rig-derived weights. aSwim = (phase, amplitude, turn bend, hover);
      // uWave (per species) = (tail envelope, base envelope, wave length in radians, fin amount)
      float tb = aW.x; vLook = aLook;
      // v78 FINS ROTATE about their own pivots (no translation: nothing is pulled, the body never moves with them)
      if (aFP.w > 0.5) { float hv = aSwim.w; vec3 d = transformed - aFP.xyz;
        if (aFP.w < 1.5) { float a = sin(uTime * 6.0 - tb * 7.0 + aSwim.x) * 0.22 * smoothstep(0.45, 0.9, aW.y) * uWave.w * (0.4 + hv);   // median fin sway
          d.xy = rotCS(d.xy, cos(a), sin(a)); }
        else if (aFP.w < 2.5) { float sd = aFP.x >= 0.0 ? 1.0 : -1.0, ph = uTime * 5.0 + aSwim.x * 0.5 + (aFP.z > 0.045 ? 0.0 : 1.7), k = smoothstep(0.45, 0.9, aW.z) * uWave.w * (0.35 + hv);
          float a = (0.5 + 0.5 * sin(ph)) * 0.5 * k * sd, b = sin(ph + 1.2) * 0.28 * k * sd;   // abduction (open / close) + sweep
          d.xy = rotCS(d.xy, cos(a), sin(a)); d.xz = rotCS(d.xz, cos(b), -sin(b)); }
        else { float a = (0.5 + 0.5 * sin(uTime * 2.6 + aSwim.x * 0.3)) * 0.1 * smoothstep(0.45, 0.9, aW.w);             // jaw hinge (opens downward)
          d.yz = rotCS(d.yz, cos(a), -sin(a)); }
        transformed = aFP.xyz + d; }
      transformed.x += sin(aSwim.x - tb * uWave.z) * aSwim.y * (uWave.x * tb * tb + uWave.y);
      // turn (FishSystem-style turn input, -1..1 in aSwim.z): the body follows the arc -- a C-curve with head and tail toward the
      // inside of the turn around the mid-body; deeper when turning in place (hover), where the tail sweeps drive the pivot
      float tc = tb - 0.42;
      transformed.x += aSwim.z * uTurn.x * (1.0 + uTurn.y * aSwim.w) * (tc * tc - 0.05);`;

const bytes = encoded => Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
const FISH_HEADER = `attribute vec4 aSwim, aW, aFP;
 attribute float aLook; varying float vLook;
 uniform float uTime; uniform vec4 uWave, uTurn;
 vec2 rotCS(vec2 v, float c, float s){ return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }`;

export async function createFishMesh(data, species, count, clock) {
 const texture = await new THREE.TextureLoader().loadAsync(data.tex);
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.anisotropy = TEXTURE_ANISOTROPY;
 const geometry = new THREE.BufferGeometry();
 geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(new Int16Array(bytes(data.pos).buffer), v => v / PACKED.position * data.scale), 3));
 geometry.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(new Int8Array(bytes(data.nrm).buffer), v => v / PACKED.normal), 3));
 geometry.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(new Uint16Array(bytes(data.uv).buffer), v => v / PACKED.uv), 2));
 geometry.setAttribute('aW', new THREE.BufferAttribute(bytes(data.w), 4, true));
 geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(bytes(data.idx).buffer), 1));
 geometry.setAttribute('aFP', data.fp ? new THREE.BufferAttribute(new Float32Array(bytes(data.fp).buffer), 4) : finPivots(geometry));
 const swim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
 geometry.setAttribute('aSwim', swim);
 geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
 const material = new THREE.MeshStandardMaterial({
  map: texture, roughness: Math.min(1, species.rough + SKIN.extraRoughness), metalness: species.metal * SKIN.metalnessShare,
 });
 const wave = {value: new THREE.Vector4(...species.wave)}, turn = {value: new THREE.Vector4(species.curl, species.pivot, 0, 0)};
 material.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, {uTime: clock, uWave: wave, uTurn: turn});
  shader.vertexShader = FISH_HEADER + '\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FISH_DEFORM);
 };
 material.customProgramCacheKey = () => 'webaquarium-fish-swim';
 const mesh = new THREE.InstancedMesh(geometry, material, count);
 mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 mesh.frustumCulled = false;
 return {mesh, swim, dispose() {
  mesh.removeFromParent();
  mesh.dispose();
  geometry.dispose();
  material.dispose();
  texture.dispose();
 }};
}
