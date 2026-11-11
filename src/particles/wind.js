// Wind made visible: streaks that ride the air and debris (leaves, dust) that it carries. Same pattern as
// water/precipitation.js: camera-centred instances in a wrapped box, moved in the shader, driven by the shared
// environment (core/environment.js). Both stay hidden in calm air and fill in as the wind rises.
const RENDER_ORDER = 9;      // after the scene's transparent surfaces, before precipitation
const MAX_COUNT = 4000;
const LIGHT = Object.freeze({night: .12, day: .88});   // colour x (night + day x daylight)

// Streaks. Each is a thin ribbon that fades in, shoots ahead of the wind while it waves, and fades out; then it
// starts again somewhere else. Lengths in metres, speeds in m/s, times in seconds.
const STREAK = Object.freeze({
  count: 70, segments: 14,
  extent: [60, 9, 60],          // box around the camera the streaks live in
  below: .35,                   // share of the box height below the camera
  wind: [2.5, 14],              // none below the first wind speed, all of them from the second
  life: 3.2,                    // one fade-in, run and fade-out
  length: [2.5, .45],           // ribbon length: base + this many metres per m/s of wind
  width: .09,
  lead: 1.6,                    // how far ahead of the drifting air the head runs over its life, in ribbon lengths
  wave: [.22, 7],               // sideways and vertical wave: amplitude (m) at the tail, radians along the ribbon
  gustWave: 2.5,                // extra wave amplitude at full gust
  opacity: .5,
});

// Debris. Leaves tumble and flutter; dust is small and faint. Both fall slowly while the wind carries them.
const DEBRIS = Object.freeze({
  count: 260,
  extent: [44, 8, 44],
  below: .4,
  wind: [4, 16],
  carried: .85,                 // share of the wind speed debris travels at
  fall: .6,                     // m/s
  flutter: [.5, 2.2],           // sideways sway: amplitude (m), radians per second
  leafShare: .4,                // the rest is dust
  leafSize: [.06, .12], dustSize: [.012, .03],
  spin: [2, 9],                 // radians per second
  leafColors: [[.42, .33, .12], [.5, .23, .08], [.3, .36, .14]],
  dustColor: [.72, .66, .56],
  opacity: {leaf: .95, dust: .4},
});

function validCount(count, label) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw Error(`${label} count must be 1..${MAX_COUNT}`);
  return count;
}
function amountFor(speed, [from, full], scale) {
  const t = Math.min(1, Math.max(0, (speed - from) / (full - from)));
  return Math.min(1, t * t * (3 - 2 * t) * scale);
}
function seedAttribute(THREE, count, size) {
  const seeds = new Float32Array(count * size);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  return new THREE.InstancedBufferAttribute(seeds, size);
}

// update(dt, environment, position, amount = 1): amount scales how many streaks show for a given wind.
export function createWindStreaks({THREE, group, count = STREAK.count} = {}) {
  validCount(count, 'Wind streak');
  const strip = [], index = [];
  for (let segment = 0; segment <= STREAK.segments; segment++) {
    const along = segment / STREAK.segments;
    strip.push(along, -.5, 0, along, .5, 0);
    if (segment < STREAK.segments) {
      const a = segment * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
  geometry.setAttribute('iSeed', seedAttribute(THREE, count, 4));
  const uniforms = {
    uCenter: {value: new THREE.Vector3()}, uOffset: {value: new THREE.Vector3()}, uWind: {value: new THREE.Vector3(1, 0, 0)},
    uExtent: {value: new THREE.Vector3(...STREAK.extent)}, uTime: {value: 0}, uLength: {value: STREAK.length[0]},
    uWave: {value: STREAK.wave[0]}, uColor: {value: new THREE.Color()},
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 iSeed;
      uniform vec3 uCenter, uOffset, uWind, uExtent;
      uniform float uTime, uLength, uWave;
      varying vec3 vShape;   // along the ribbon, across it, age within its life
      vec3 pathPoint(vec3 start, float along, float age, float phase) {
        float wave = along * ${STREAK.wave[1].toFixed(1)} - age * 9.0 + phase;
        vec3 side = normalize(cross(uWind, vec3(0.0, 1.0, 0.0)));
        return start - uWind * (along * uLength) + (side * sin(wave) + vec3(0.0, .6, 0.0) * cos(wave * .8)) * (uWave * along);
      }
      void main() {
        float cycle = uTime / ${STREAK.life.toFixed(1)} + iSeed.w;
        float age = fract(cycle);
        // A new place every life, so no streak repeats its path.
        vec3 seed = fract(iSeed.xyz + floor(cycle) * vec3(.371, .613, .829));
        vec3 start = uCenter + mod(seed * uExtent + uOffset, uExtent) - uExtent * vec3(.5, ${STREAK.below.toFixed(2)}, .5);
        start += uWind * (age * uLength * ${STREAK.lead.toFixed(1)});
        float phase = seed.x * 40.0;
        vec3 p = pathPoint(start, position.x, age, phase);
        vec3 tangent = normalize(pathPoint(start, position.x + .04, age, phase) - p);
        vec3 across = normalize(cross(tangent, p - cameraPosition));
        float taper = sin(position.x * 3.14159265);
        p += across * (position.y * ${STREAK.width.toFixed(3)} * (.35 + .65 * taper));
        vShape = vec3(position.x, position.y + .5, age);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform vec3 uColor;
      varying vec3 vShape;
      void main() {
        float ends = sin(vShape.x * 3.14159265);
        float edge = 1.0 - abs(vShape.y - .5) * 2.0;
        float life = sin(vShape.z * 3.14159265);
        gl_FragColor = vec4(uColor, ends * edge * life * ${STREAK.opacity.toFixed(2)});
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = RENDER_ORDER;
  group.add(mesh);
  let disposed = false;
  return {
    update(dt, environment, position, amount = 1) {
      if (disposed) return;
      const {x, z, speed, gust} = environment.wind;
      const share = amountFor(speed, STREAK.wind, amount);
      geometry.instanceCount = Math.round(count * share);
      mesh.visible = geometry.instanceCount > 0;
      if (!mesh.visible) return;
      uniforms.uCenter.value.copy(position);
      uniforms.uWind.value.set(x / speed, 0, z / speed);
      const offset = uniforms.uOffset.value;
      offset.x = (offset.x + x * dt) % STREAK.extent[0]; offset.z = (offset.z + z * dt) % STREAK.extent[2];
      uniforms.uTime.value += dt;
      uniforms.uLength.value = STREAK.length[0] + STREAK.length[1] * speed;
      uniforms.uWave.value = STREAK.wave[0] * (1 + STREAK.gustWave * gust);
      uniforms.uColor.value.copy(environment.light).multiplyScalar(LIGHT.night + LIGHT.day * environment.daylight);
    },
    get instanceCount() { return disposed || !mesh.visible ? 0 : geometry.instanceCount; },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.remove(mesh); geometry.dispose(); material.dispose();
    },
  };
}

// update(dt, environment, position, amount = 1): amount scales how much debris flies for a given wind.
export function createWindDebris({THREE, group, count = DEBRIS.count} = {}) {
  validCount(count, 'Wind debris');
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  geometry.setAttribute('iSeed', seedAttribute(THREE, count, 4));
  const uniforms = {
    uCenter: {value: new THREE.Vector3()}, uOffset: {value: new THREE.Vector3()},
    uExtent: {value: new THREE.Vector3(...DEBRIS.extent)}, uTime: {value: 0}, uLight: {value: new THREE.Color()},
    uLeafColors: {value: DEBRIS.leafColors.map(color => new THREE.Color(...color))},
    uDustColor: {value: new THREE.Color(...DEBRIS.dustColor)},
  };
  const number = value => value.toFixed(3);
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 iSeed;
      uniform vec3 uCenter, uOffset, uExtent, uLeafColors[${DEBRIS.leafColors.length}], uDustColor;
      uniform float uTime;
      varying vec2 vUv;
      varying vec4 vTint;   // rgb colour, a = 1 for a leaf and 0 for dust
      void main() {
        bool leaf = iSeed.w < ${number(DEBRIS.leafShare)};
        vec3 p = uCenter + mod(iSeed.xyz * uExtent + uOffset, uExtent) - uExtent * vec3(.5, ${number(DEBRIS.below)}, .5);
        float sway = uTime * ${number(DEBRIS.flutter[1])} + iSeed.x * 50.0;
        p += vec3(sin(sway), .5 * cos(sway * 1.3), cos(sway * .7)) * (${number(DEBRIS.flutter[0])} * (leaf ? 1.0 : .4));
        float size = leaf ? mix(${number(DEBRIS.leafSize[0])}, ${number(DEBRIS.leafSize[1])}, iSeed.y) : mix(${number(DEBRIS.dustSize[0])}, ${number(DEBRIS.dustSize[1])}, iSeed.y);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec2 corner = position.xy;
        if (leaf) {
          // Tumble: spin in the screen plane and flip edge-on now and then.
          float spin = uTime * mix(${number(DEBRIS.spin[0])}, ${number(DEBRIS.spin[1])}, iSeed.z) + iSeed.x * 20.0;
          corner = vec2(corner.x * cos(spin) - corner.y * sin(spin), corner.x * sin(spin) + corner.y * cos(spin));
          corner.x *= .25 + .75 * abs(sin(spin * .37 + iSeed.y * 9.0));
        }
        p += (right * corner.x + up * corner.y) * size;
        vUv = position.xy + .5;
        vTint = vec4(leaf ? uLeafColors[int(iSeed.z * ${DEBRIS.leafColors.length}.0)] : uDustColor, leaf ? 1.0 : 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform vec3 uLight;
      varying vec2 vUv;
      varying vec4 vTint;
      void main() {
        vec2 c = vUv - .5;
        // A leaf is a pointed oval; dust is a soft dot.
        float leaf = 1.0 - smoothstep(.8, 1.0, length(c * vec2(2.0, 3.4)) + abs(c.x) * .9);
        float dust = 1.0 - smoothstep(.2, 1.0, length(c) * 2.0);
        float alpha = mix(dust * ${number(DEBRIS.opacity.dust)}, leaf * ${number(DEBRIS.opacity.leaf)}, vTint.a);
        if (alpha <= .01) discard;
        gl_FragColor = vec4(vTint.rgb * uLight, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = RENDER_ORDER;
  group.add(mesh);
  let disposed = false;
  return {
    update(dt, environment, position, amount = 1) {
      if (disposed) return;
      const {x, z, speed} = environment.wind;
      geometry.instanceCount = Math.round(count * amountFor(speed, DEBRIS.wind, amount));
      mesh.visible = geometry.instanceCount > 0;
      if (!mesh.visible) return;
      uniforms.uCenter.value.copy(position);
      const offset = uniforms.uOffset.value;
      offset.x = (offset.x + x * DEBRIS.carried * dt) % DEBRIS.extent[0];
      offset.y = (offset.y - DEBRIS.fall * dt) % DEBRIS.extent[1];
      offset.z = (offset.z + z * DEBRIS.carried * dt) % DEBRIS.extent[2];
      uniforms.uTime.value += dt;
      uniforms.uLight.value.copy(environment.light).multiplyScalar(LIGHT.night + LIGHT.day * environment.daylight);
    },
    get instanceCount() { return disposed || !mesh.visible ? 0 : geometry.instanceCount; },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.remove(mesh); geometry.dispose(); material.dispose();
    },
  };
}
