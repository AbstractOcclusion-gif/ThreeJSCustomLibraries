// Splash of something hitting still water (pond, stream, pool): streaking droplets, tumbling water chunks, tall entry
// jets and a crown. Ported from WebAquarium's particles/splash.js. Three instanced draw calls, simulated on the CPU.
// Sprites are "packed": r = mass, g = shine, b = dissolve noise, a = thickness. The crown is a photographic flipbook.
// The droplet and chunk sprites are generated here; pass `textures` to use your own packed sprites instead.
import {makePool} from './pool.js';

const TAU = Math.PI * 2;
const RENDER_ORDER = 9;
const CAPACITY = Object.freeze({droplets: 3000, chunks: 384, crowns: 24});
const CROWN_SHEET = Object.freeze({columns: 8, rows: 4, url: new URL('../../../assets/particles/splash-crown.webp', import.meta.url).href});
const CHUNK_FRAMES = 4;   // chunk sprites in one row; a chunk steps through them once over its life
const GRAVITY = 9.81;

// Scales on a splash; 1 = as authored below. Pass one look to every splash that should match.
export function createSplashLook() {
  return {amount: 1, height: 1, size: 1, life: 1, brightness: 1};
}

// One splash of strength 1 and radius 1 m. Speeds in m/s, sizes in metres, times in seconds; pairs are [min, max].
// Everything scales with the splash radius; counts and speeds also with its strength (0..1).
const DROPLETS = Object.freeze({count: [18, 70], out: [.5, 2.4], up: [1.6, 4.6], size: [.02, .045], life: 2.2, drag: .35, streak: .022});
const CHUNKS = Object.freeze({count: [6, 16], out: .8, up: [.5, 2], size: [.3, .66], hero: 1.5, life: [.5, .9], gravity: 1.9, drag: 1.2, spin: Math.PI / 6});
const JETS = Object.freeze({count: [4, 6], spread: .2, up: [.5, 2], width: [.08, .11], life: [.75, 1.5], gravity: 1.6, drag: 1.5, stretch: .5});
const CROWN = Object.freeze({size: 3, life: [.45, .7], from: .15});   // sheet height in splash radii; no crown below this strength

const lerp = (a, b, t) => a + (b - a) * t;
const between = ([min, max]) => min + Math.random() * (max - min);

// Value noise for the generated sprites.
function noise2(x, y, seed) {
  const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return lerp(lerp(hash(i, j), hash(i + 1, j), a), lerp(hash(i, j + 1), hash(i + 1, j + 1), a), b);
}
function packedTexture(THREE, width, height, texel) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const values = texel((x + .5) / width, (y + .5) / height);
    for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = Math.round(255 * Math.min(1, Math.max(0, values[c])));
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
// A droplet: a round body, a small highlight off-centre, thick in the middle.
function dropletTexture(THREE) {
  return packedTexture(THREE, 64, 64, (u, v) => {
    const r = Math.hypot(u - .5, v - .5) * 2;
    const mass = 1 - THREE.MathUtils.smoothstep(r, .25, .95);
    const shine = Math.max(0, 1 - Math.hypot(u - .38, v - .64) * 7);
    return [mass, shine, noise2(u * 6, v * 6, 1), mass * mass];
  });
}
// Four ragged lumps of water in a row: noisy outlines, bright ridges, their own dissolve noise.
function chunkTexture(THREE) {
  const size = 96;
  return packedTexture(THREE, size * CHUNK_FRAMES, size, (u, v) => {
    const frame = Math.min(CHUNK_FRAMES - 1, Math.floor(u * CHUNK_FRAMES)), fu = u * CHUNK_FRAMES - frame;
    const x = fu - .5, y = v - .5, r = Math.hypot(x, y) * 2;
    const lumps = noise2(fu * 3.2, v * 3.2, 11 + frame) * .6 + noise2(fu * 7.5, v * 7.5, 23 + frame) * .4;
    const mass = THREE.MathUtils.smoothstep(lumps * 1.25 - r * 1.05, .08, .42);
    const ridges = Math.pow(noise2(fu * 9, v * 9, 37 + frame), 3) * mass;
    return [mass, ridges, noise2(fu * 5, v * 5, 51 + frame), mass * lumps];
  });
}

// scene: where the splash is drawn (draw it after the water). depth: createParticleDepthBinding().
// lighting: {uniforms: {uSunCol, uFxAmbient}, direction} as the water spray takes.
// textures: optional {droplet, chunks, crown} packed sprites to use instead of the generated ones and the bundled crown.
export function createImpactSplash({THREE, scene, depth, lighting, look = createSplashLook(), textures = {}, loadTexture = url => new THREE.TextureLoader().loadAsync(url)}) {
  if (!THREE || !scene || !depth || !lighting?.uniforms?.uSunCol || !lighting.direction) {
    throw Error('Impact splash needs Three.js, a target scene, a depth binding and lighting');
  }
  const show = {droplets: true, chunks: true, jets: true, crown: true};
  const owned = [];
  const own = texture => { owned.push(texture); return texture; };
  const shared = {
    ...depth.uniforms,
    uSunCol: lighting.uniforms.uSunCol, uAmb: lighting.uniforms.uFxAmbient, uLight: {value: lighting.direction},
    uTint: {value: new THREE.Color(0xecf7ff)}, uBright: {value: 1},
  };
  // Packed sprite to lit colour and alpha (WebAquarium's packedSplash). env: the particle's fade, 1 fresh to 0 gone.
  const LIT = /* glsl */`
    uniform vec3 uSunCol, uAmb, uLight, uTint;
    uniform float uBright;
    ${depth.glsl}
    vec4 packedSplash(vec4 sprite, float env, float opacity, vec3 world, float glint) {
      // The sprite dissolves through its own noise instead of ghosting out.
      float alpha = sprite.r * clamp((sprite.b - (1.0 - env)) / .35, 0.0, 1.0) * env * opacity * fxDepthFade(world);
      vec3 light = normalize(uLight), view = normalize(world - cameraPosition);
      float wrapped = clamp(light.y * .6 + .4, 0.0, 1.0);
      vec3 lit = uTint * (uAmb * .9 + uSunCol * wrapped * .6);
      // Thin water glows when the sun is behind it.
      lit += uSunCol * pow(clamp(dot(view, light), 0.0, 1.0), 4.0) * exp(-sprite.a * 3.0) * sprite.r * env;
      lit = min(lit, vec3(.82)) * uBright;
      lit += uSunCol * sprite.g * sprite.g * sprite.g * 2.0 * env * glint;
      return vec4(fxFog(lit, world), alpha);
    }`;
  // A camera-facing quad stretched along its velocity as seen on screen, pivoting at its head.
  const STRETCH = /* glsl */`
    vec3 stretchQuad(vec3 world, vec3 velocity, vec2 corner, float width, float reach) {
      vec4 mv = viewMatrix * vec4(world, 1.0);
      vec2 d = (viewMatrix * vec4(velocity, 0.0)).xy;
      float speed = length(d);
      vec2 along = speed > .0001 ? d / speed : vec2(0.0, 1.0), across = vec2(-along.y, along.x);
      mv.xy += across * corner.x * width + along * (corner.y - .5) * reach;
      gl_Position = projectionMatrix * mv;
      return (inverse(viewMatrix) * mv).xyz;
    }`;
  const END = /* glsl */`
      #include <tonemapping_fragment>
      #include <colorspace_fragment>`;
  function instanced(capacity, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
    const arrays = {};
    for (const [name, itemSize] of Object.entries(attributes)) {
      arrays[name] = new Float32Array(capacity * itemSize);
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(arrays[name], itemSize));
    }
    return {geometry, arrays, pool: makePool(capacity, geometry, Object.keys(attributes))};
  }
  function mesh(geometry, uniforms, vertexShader, fragmentShader) {
    const material = new THREE.ShaderMaterial({transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: {...shared, ...uniforms}, vertexShader, fragmentShader});
    const result = new THREE.Mesh(geometry, material);
    result.frustumCulled = false; result.renderOrder = RENDER_ORDER; result.visible = false;
    scene.add(result);
    return result;
  }

  // Droplets.
  const drops = instanced(CAPACITY.droplets, {iPos: 3, iVel: 3, iLife: 2, iSize: 1});   // iLife: remaining, total
  const dropFloor = new Float32Array(CAPACITY.droplets);                                 // water level each falls back to
  const dropMesh = mesh(drops.geometry, {tDrop: {value: textures.droplet ?? own(dropletTexture(THREE))}}, /* glsl */`
    attribute vec3 iPos, iVel; attribute vec2 iLife; attribute float iSize;
    varying float vEnv, vBlur; varying vec2 vUv; varying vec3 vWorld;
    ${STRETCH}
    void main() {
      if (iLife.x <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
      vUv = position.xy + .5;
      vEnv = 1.0 - smoothstep(.6, 1.0, 1.0 - iLife.x / iLife.y);
      float streak = iSize + length(iVel) * ${DROPLETS.streak.toFixed(3)};
      // A streak spreads its water along its length.
      vBlur = clamp(1.4 * iSize / streak, .2, 1.0);
      vWorld = stretchQuad(iPos, iVel, position.xy, iSize, streak);
    }`, /* glsl */`
    uniform sampler2D tDrop;
    varying float vEnv, vBlur; varying vec2 vUv; varying vec3 vWorld;
    ${LIT}
    void main() {
      vec4 sprite = texture2D(tDrop, vUv);
      sprite.r = smoothstep(.06, .45, sprite.r);   // a crisp core, not a soft puff
      vec4 color = packedSplash(sprite, vEnv, .9 * vBlur, vWorld, 1.0);
      if (color.a < .003) discard;
      gl_FragColor = color;
      ${END}
    }`);

  // Chunks (mode 0) and entry jets (mode 1).
  const chunks = instanced(CAPACITY.chunks, {iPos: 3, iVel: 3, iLife: 2, iShape: 3});   // iShape: size, rotation, mode
  const chunkSpin = new Float32Array(CAPACITY.chunks);
  const chunkMesh = mesh(chunks.geometry, {tChunk: {value: textures.chunks ?? own(chunkTexture(THREE))}}, /* glsl */`
    attribute vec3 iPos, iVel; attribute vec2 iLife; attribute vec3 iShape;
    varying float vEnv, vFrame; varying vec2 vUv; varying vec3 vWorld;
    ${STRETCH}
    void main() {
      if (iLife.x <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
      float t = clamp(1.0 - iLife.x / iLife.y, 0.0, 1.0);
      vEnv = 1.0 - t;
      vFrame = min(floor(t * ${CHUNK_FRAMES}.0), ${CHUNK_FRAMES - 1}.0);
      vUv = position.xy + .5;
      if (iShape.z > .5) {
        vWorld = stretchQuad(iPos, iVel, position.xy, iShape.x, iShape.x * (1.0 + 3.0 * ${JETS.stretch.toFixed(2)}) + length(iVel) * .4 * ${JETS.stretch.toFixed(2)});
        return;
      }
      // Pop to half size at once, then keep growing.
      float grown = t < .04 ? t / .04 * .5 : .5 + .5 * (t - .04) / .96;
      float c = cos(iShape.y), s = sin(iShape.y);
      vec4 mv = viewMatrix * vec4(iPos, 1.0);
      mv.xy += mat2(c, s, -s, c) * position.xy * iShape.x * grown;
      gl_Position = projectionMatrix * mv;
      vWorld = (inverse(viewMatrix) * mv).xyz;
    }`, /* glsl */`
    uniform sampler2D tChunk;
    varying float vEnv, vFrame; varying vec2 vUv; varying vec3 vWorld;
    ${LIT}
    void main() {
      vec4 color = packedSplash(texture2D(tChunk, vec2((vFrame + vUv.x) / ${CHUNK_FRAMES}.0, vUv.y)), vEnv, .9, vWorld, 1.0);
      if (color.a < .003) discard;
      gl_FragColor = color;
      ${END}
    }`);

  // Crown: the flipbook on an upright card that turns about the vertical to face the camera, its base on the water.
  const crowns = instanced(CAPACITY.crowns, {iPos: 3, iLife: 2, iShape: 2});   // iShape: size, mirrored
  const crownUniforms = {tCrown: {value: textures.crown ?? null}};
  const crownMesh = mesh(crowns.geometry, crownUniforms, /* glsl */`
    attribute vec3 iPos; attribute vec2 iLife, iShape;
    varying float vT, vFlip; varying vec2 vUv; varying vec3 vWorld, vRight;
    void main() {
      if (iLife.x <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
      vT = clamp(1.0 - iLife.x / iLife.y, 0.0, .999);
      vUv = position.xy + .5; vFlip = iShape.y;
      vec3 toCamera = cameraPosition - iPos; toCamera.y = 0.0;
      vRight = normalize(cross(vec3(0.0, 1.0, 0.0), toCamera + vec3(.00001, 0.0, 0.0)));
      const float baseInCell = .06;   // the water line sits this far above the bottom of a flipbook cell
      vWorld = iPos + vRight * position.x * iShape.x + vec3(0.0, (position.y + .5 - baseInCell) * iShape.x, 0.0);
      gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
    }`, /* glsl */`
    uniform sampler2D tCrown;
    varying float vT, vFlip; varying vec2 vUv; varying vec3 vWorld, vRight;
    ${LIT}
    vec4 cell(float frame, vec2 uv) {
      float column = mod(frame, ${CROWN_SHEET.columns}.0), row = floor(frame / ${CROWN_SHEET.columns}.0);
      uv = mix(vec2(.012), vec2(.988), uv);
      return texture2D(tCrown, vec2((column + uv.x) / ${CROWN_SHEET.columns}.0, 1.0 - (row + 1.0 - uv.y) / ${CROWN_SHEET.rows}.0));
    }
    void main() {
      const float lastFrame = ${CROWN_SHEET.columns * CROWN_SHEET.rows - 1}.0;
      vec2 uv = vec2(vFlip > .5 ? 1.0 - vUv.x : vUv.x, vUv.y);
      float frame = vT * lastFrame, first = floor(frame);
      vec4 t = mix(cell(first, uv), cell(min(first + 1.0, lastFrame), uv), frame - first);
      vec3 rgb = t.rgb / max(t.a, .05) * min(t.a * 4.0, 1.0);
      float lum = dot(rgb, vec3(.299, .587, .114));
      // Bright relief in the photo is thick water; dark is a thin clear sheet.
      float thick = smoothstep(.35, .85, lum);
      float alpha = t.a * mix(.25, 1.0, thick) * .95 * fxDepthFade(vWorld) * smoothstep(1.0, .85, vT);
      if (alpha < .003) discard;
      // A normal from the photo's relief, in the card's own axes.
      vec2 e = vec2(1.5 / 221.0, 0.0);
      float here = dot(t.rgb, vec3(.333));
      float gx = dot(cell(first, uv + e.xy).rgb, vec3(.333)) - here, gy = dot(cell(first, uv + e.yx).rgb, vec3(.333)) - here;
      vec3 V = normalize(cameraPosition - vWorld), forward = normalize(vec3(V.x, 0.0, V.z) + .00001);
      vec3 N = normalize(forward - vRight * gx * 6.0 * (vFlip > .5 ? -1.0 : 1.0) - vec3(0.0, 1.0, 0.0) * gy * 6.0);
      vec3 L = normalize(uLight), H = normalize(L + V);
      float wrapped = clamp(L.y * .6 + .4, 0.0, 1.0);
      float fresnel = .04 + .96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
      float sparkle = pow(max(dot(N, H), 0.0), 90.0);
      vec3 lit = uTint * (uAmb * .7 + uSunCol * wrapped * .35) * (.6 + .6 * lum) * uBright;
      lit += (uAmb * 1.6 + uSunCol * .25) * fresnel + uSunCol * sparkle * 4.0 + uSunCol * smoothstep(.72, 1.0, lum) * .9;
      lit += uSunCol * pow(clamp(dot(-V, L), 0.0, 1.0), 4.0) * (1.0 - thick) * .5;
      // Glints stay solid on the clear parts.
      alpha = max(alpha, min(1.0, fresnel * .6 + sparkle) * t.a * .95);
      gl_FragColor = vec4(fxFog(lit, vWorld), alpha);
      ${END}
    }`);
  let disposed = false;
  // The crown needs its flipbook; until it has loaded (or if it fails) splashes simply have no crown.
  const ready = textures.crown ? Promise.resolve() : loadTexture(CROWN_SHEET.url).then(texture => {
    if (disposed) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    crownUniforms.tCrown.value = own(texture);
  });

  function addDroplet(x, y, z, vx, vy, vz, size, life) {
    const k = drops.pool.alloc(), a = drops.arrays;
    a.iPos.set([x, y, z], k * 3); a.iVel.set([vx, vy, vz], k * 3);
    a.iLife[k * 2] = a.iLife[k * 2 + 1] = life; a.iSize[k] = size; dropFloor[k] = y;
  }
  function addChunk(x, y, z, vx, vy, vz, size, life, jet) {
    const k = chunks.pool.alloc(), a = chunks.arrays;
    a.iPos.set([x, y, z], k * 3); a.iVel.set([vx, vy, vz], k * 3);
    a.iLife[k * 2] = a.iLife[k * 2 + 1] = life;
    a.iShape.set([size, Math.random() * TAU, Number(jet)], k * 3);
    chunkSpin[k] = (Math.random() * 2 - 1) * CHUNKS.spin;
  }

  function step(part, gravity, dragRate, dt, each) {
    const {pool, arrays: a} = part;
    if (!pool.any) return 0;
    pool.begin();
    let alive = 0;
    for (let k = 0; k < pool.max; k++) {
      if (a.iLife[k * 2] <= 0) continue;
      pool.mark(k);
      a.iLife[k * 2] = Math.max(0, a.iLife[k * 2] - dt);
      if (a.iVel) {
        const drag = Math.exp(-dragRate(k) * dt), i = k * 3;
        a.iVel[i + 1] -= gravity(k) * dt;
        a.iVel[i] *= drag; a.iVel[i + 1] *= drag; a.iVel[i + 2] *= drag;
        a.iPos[i] += a.iVel[i] * dt; a.iPos[i + 1] += a.iVel[i + 1] * dt; a.iPos[i + 2] += a.iVel[i + 2] * dt;
      }
      each?.(k);
      if (a.iLife[k * 2] > 0) alive++;
    }
    pool.end();
    return alive;
  }

  const api = {
    look, show, ready,
    meshes: [crownMesh, chunkMesh, dropMesh],
    // position: where it hits the water (y = water level). strength 0..1. radius: size of what hit, in metres.
    // amount scales how many particles this one splash throws (a raindrop throws a few, a boulder all of them).
    emit(position, strength = .6, radius = .2, amount = 1) {
      if (disposed) return;
      if (![position?.x, position?.y, position?.z, strength, radius, amount].every(Number.isFinite) || radius <= 0 || amount < 0) throw Error('Impact splash needs a finite position, strength and a positive radius');
      const s = Math.min(1, Math.max(0, strength)), {x, y, z} = position;
      const scale = radius * look.size, tall = Math.sqrt(radius) * look.height, many = look.amount * amount;
      if (show.crown && crownUniforms.tCrown.value && s >= CROWN.from) {
        const k = crowns.pool.alloc(), a = crowns.arrays;
        a.iPos.set([x, y, z], k * 3);
        a.iLife[k * 2] = a.iLife[k * 2 + 1] = lerp(...CROWN.life, s) * look.life;
        a.iShape.set([radius * CROWN.size * (.5 + .7 * s) * look.size, Number(Math.random() < .5)], k * 2);
      }
      if (show.jets && s > .2) {
        for (let i = Math.round(lerp(...JETS.count, s) * many); i > 0; i--) {
          const angle = Math.random() * TAU, out = Math.sqrt(Math.random()) * JETS.spread * s;
          addChunk(x, y + .01, z, Math.cos(angle) * out, lerp(...JETS.up, s) * tall, Math.sin(angle) * out,
            between(JETS.width) * scale, between(JETS.life) * look.life, true);
        }
      }
      if (show.chunks && s >= .12) {
        for (let i = Math.round(lerp(...CHUNKS.count, s) * many); i > 0; i--) {
          let rx, rz;
          do { rx = Math.random() * 2 - 1; rz = Math.random() * 2 - 1; } while (rx * rx + rz * rz > 1);
          // A rare chunk is much larger than the rest.
          const hero = Math.pow(Math.random(), 10) * CHUNKS.hero;
          addChunk(x + rx * radius * .5, y, z + rz * radius * .5, rx * CHUNKS.out * s, lerp(...CHUNKS.up, s) * (.5 + Math.random() * .7) * tall, rz * CHUNKS.out * s,
            (between(CHUNKS.size) + hero * CHUNKS.size[0]) * (.6 + .8 * s) * scale, between(CHUNKS.life) * look.life, false);
        }
      }
      if (show.droplets) {
        for (let i = Math.round(lerp(...DROPLETS.count, s) * many); i > 0; i--) {
          const angle = Math.random() * TAU, out = between(DROPLETS.out) * s * Math.sqrt(radius), from = Math.sqrt(Math.random()) * radius * .6;
          addDroplet(x + Math.cos(angle) * from, y + .01, z + Math.sin(angle) * from, Math.cos(angle) * out, between(DROPLETS.up) * (.4 + .6 * s) * tall, Math.sin(angle) * out,
            between(DROPLETS.size) * (.6 + .6 * Math.sqrt(radius)) * look.size, DROPLETS.life * look.life);
        }
      }
    },
    update(dt) {
      if (disposed || !Number.isFinite(dt) || dt < 0) return;
      shared.uBright.value = look.brightness;
      const d = drops.arrays, c = chunks.arrays;
      // A droplet is gone when it falls back into the water.
      dropMesh.visible = step(drops, () => GRAVITY, () => DROPLETS.drag, dt, k => {
        if (d.iVel[k * 3 + 1] < 0 && d.iPos[k * 3 + 1] < dropFloor[k]) d.iLife[k * 2] = 0;
      }) > 0;
      chunkMesh.visible = step(chunks, k => c.iShape[k * 3 + 2] > .5 ? JETS.gravity : CHUNKS.gravity, k => c.iShape[k * 3 + 2] > .5 ? JETS.drag : CHUNKS.drag, dt, k => {
        c.iShape[k * 3 + 1] += chunkSpin[k] * dt;
      }) > 0;
      crownMesh.visible = step(crowns, null, null, dt) > 0;
    },
    get active() { return Number(dropMesh.visible) + Number(chunkMesh.visible) + Number(crownMesh.visible); },
    clear() {
      for (const part of [drops, chunks, crowns]) { part.arrays.iLife.fill(0); part.geometry.attributes.iLife.needsUpdate = true; part.pool.any = false; }
      dropMesh.visible = chunkMesh.visible = crownMesh.visible = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of api.meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      for (const texture of owned) texture.dispose();
    },
  };
  return api;
}
