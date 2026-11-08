import * as THREE from 'three';
import {createWaveBank, waveCount} from './waves.js';
import {proceduralSky} from './sky-binding.js';
import {createFoamTexture} from './foam-texture.js';

// Inland water surface (river / pond): refraction against a half-resolution bed capture, Beer-Lambert absorption, wind-wave
// bank, interactive ripples, rock wakes, baked flow foam, underwater light shafts. Draws the sky through the `sky` hook:
// {glsl, uniforms, defines} where glsl defines vec3 sky(vec3 dir, float sunMul) and the uniforms carry uSkySun, uSunCol,
// uDaylight (see sky-binding.js: skyFromWeather(view) or proceduralSky()). foamTexture (rgba tile: r/g brightness,
// b density threshold, a coverage) is optional; without it a generated tile is used.
// The host calls render(seconds, settings) once per frame (it captures the bed), then draws the scene itself.
export function createChannelSurface({renderer, scene, camera, sky = proceduralSky(), ripples, obstacles, flow, foamTexture, captureScale = .5}) {
 if (!renderer || !scene || !camera || !ripples || !obstacles || !flow) throw Error('Channel surface needs renderer, scene, camera, ripples, obstacles and flow');
 const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
 const capture = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthTexture: depth});
 const waves = createWaveBank();
 const ownsFoam = !foamTexture;
 const foamTile = foamTexture ?? createFoamTexture();
 foamTile.wrapS = foamTile.wrapT = THREE.RepeatWrapping;
 const uniforms = {
  ...sky.uniforms,
  bedColor: {value: capture.texture},
  bedDepth: {value: depth},
  clipRange: {value: new THREE.Vector2(camera.near, camera.far)},
  currentTime: {value: 0},
  foamAmount: {value: .55},
  foamFeather: {value: .65},
  refraction: {value: 1},
  rippleMap: {value: ripples.texture},
  rippleBounds: {value: ripples.bounds},
  rippleCell: {value: ripples.cell},
  rippleActive: {value: false},
  rocks: {value: obstacles},
  flowSpeed: {value: 1},
  flowMap: {value: flow.texture},
  flowBounds: {value: flow.bounds},
  bakedFlow: {value: false},
  foamTile: {value: foamTile},
  waveA: {value: waves.carriers},
  waveB: {value: waves.amplitudes},
  waveTime: {value: 0},
  godRays: {value: .55},
  impactFoam: {value: new THREE.Vector4()},
  waterTint: {value: new THREE.Color()},
  clarity: {value: 1},
  reflectionStrength: {value: 1},
 };
 const material = new THREE.ShaderMaterial({
  uniforms,
  side: THREE.DoubleSide,
  defines: {...sky.defines},
  vertexShader: `
   attribute vec3 flow;
   varying vec3 vFlow, vWorld, vNormal;
   varying vec4 vClip;
   void main() {
    vFlow = flow;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal = mat3(modelMatrix) * normal;
    vClip = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
    gl_Position = vClip;
   }`,
  fragmentShader: `
   ${sky.glsl}
   uniform sampler2D bedColor;
   uniform highp sampler2D bedDepth;
   uniform vec2 clipRange;
   uniform float currentTime;
   uniform float foamAmount, foamFeather, refraction, rippleCell, flowSpeed;
   uniform highp sampler2D rippleMap;
   uniform bool rippleActive;
   uniform vec4 rippleBounds, rocks[4];
   uniform sampler2D flowMap, foamTile;
   uniform vec4 flowBounds;
   uniform bool bakedFlow;
   uniform vec4 waveA[${waveCount}], waveB[${waveCount}];
   uniform float waveTime, godRays;
   uniform vec4 impactFoam;
   uniform vec3 waterTint;
   uniform float clarity, reflectionStrength;
   varying vec3 vFlow, vWorld, vNormal;
   varying vec4 vClip;

   // WebAquarium's foreground-safe refraction and Beer-Lambert absorption.
   float viewDepth(float z) {
    return clipRange.x * clipRange.y / (clipRange.y - z * (clipRange.y - clipRange.x));
   }
   float wavePhase(int i, vec2 xz) {
    vec4 a = waveA[i];
    return dot(a.xy, xz) * a.z - a.w * waveTime + waveB[i].y;
   }
   vec2 foamFilm(vec2 p, float coverage) {
    vec4 tile = texture2D(foamTile, p);
    float density = clamp(coverage * 1.15, 0.0, 1.2);
    float band = mix(.09, .22, foamFeather);
    float opacity = tile.a * smoothstep(tile.b - band, tile.b + band, density) *
     smoothstep(0.0, mix(.22, .40, foamFeather), coverage);
    return vec2(clamp(tile.r + tile.g * .9, 0.0, 1.0), opacity);
   }
   // WebAquarium's jittered view march with wave curvature as the focusing source.
   vec3 underwaterLight(vec3 origin, vec3 ray, float path) {
    if (godRays <= 0.0 || uSkySun.y <= .025) return vec3(0.0);
    float stepLength = min(path, 4.0) / 8.0;
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))));
    float energy = 0.0;
    for (int i = 0; i < 8; i++) {
     float t = (float(i) + jitter) * stepLength;
     vec3 p = origin + ray * t;
     float depth = max(vWorld.y - p.y, 0.0);
     vec2 lightFoot = p.xz + uSkySun.xz * depth / max(uSkySun.y, .15);
     float focus = 0.0;
     for (int j = 1; j < 7; j += 2) {
      float k = waveA[j].z;
      focus += waveB[j].x * k * k * sin(wavePhase(j, lightFoot));
     }
     energy += max(focus - .12, 0.0) * exp(-t * .9 - depth * .4);
    }
    return uSunCol * (energy * stepLength * godRays * .18);
   }
   float ripple(vec2 uv) {
    vec2 size = vec2(textureSize(rippleMap, 0));
    vec2 p = uv * size - .5;
    vec2 i = floor(p), f = fract(p);
    vec2 q = (i + .5) / size, d = 1.0 / size;
    return mix(mix(texture2D(rippleMap, q).r, texture2D(rippleMap, q + vec2(d.x,0)).r, f.x),
     mix(texture2D(rippleMap, q + vec2(0,d.y)).r, texture2D(rippleMap, q+d).r, f.x), f.y);
   }
   void main() {
    float across = vFlow.y;
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 baseNormal = normalize(vNormal);
    vec2 rippleUV = (vWorld.xz - rippleBounds.xy) / rippleBounds.zw;
    vec2 d = rippleCell / rippleBounds.zw;
    vec2 gradient = vec2(0.0);
    if (rippleActive) {
     gradient = vec2(ripple(rippleUV + vec2(d.x,0)) - ripple(rippleUV - vec2(d.x,0)),
      ripple(rippleUV + vec2(0,d.y)) - ripple(rippleUV - vec2(0,d.y))) / (2.0 * rippleCell);
    }
    float wake = 0.0;
    vec2 wakeNormal = vec2(0.0);
    for (int i = 0; i < 4; i++) {
     if (bakedFlow) break;
     vec4 rock = rocks[i];
     if (rock.z <= 0.0) continue;
     vec2 delta = vWorld.xz - rock.xy;
     vec2 direction = normalize(vec2(1, rock.w));
     float downstream = dot(delta, direction);
     float lateral = dot(delta, vec2(-direction.y, direction.x));
     float wing = abs(abs(lateral) - (.45 * rock.z + .32 * downstream));
     float wakeShape = smoothstep(0.0, .6, downstream) * (1.0 - smoothstep(1.0, 6.0, downstream)) *
      (1.0 - smoothstep(.06, .42, wing));
     float moving = smoothstep(0.0, .4, flowSpeed);
     wake += wakeShape * moving;
     wakeNormal += vec2(-direction.y, direction.x) * wakeShape * cos(downstream * 8.0 - currentTime * 5.0) * moving;
    }
    gradient -= wakeNormal * .1;
    for (int i = 0; i < ${waveCount}; i++) {
     gradient += waveA[i].xy * (waveB[i].x * waveA[i].z * cos(wavePhase(i, vWorld.xz)));
    }
    vec3 n = normalize(baseNormal - vec3(gradient.x, 0, gradient.y));
    if (!gl_FrontFacing) {
     vec3 through = refract(-V, -n, 1.333);
     float window = smoothstep(.01, .32, length(through));
     vec3 color = mix(vec3(.035,.16,.14) * waterTint * (.18 + .82 * uDaylight), sky(normalize(through + vec3(0,.001,0)), .02), window);
     color += underwaterLight(vWorld, V, distance(cameraPosition, vWorld));
     gl_FragColor = vec4(color, 1.0);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
     return;
    }
    vec2 uv = vClip.xy / vClip.w * .5 + .5;
    float front = viewDepth(gl_FragCoord.z);
    float behind = viewDepth(texture2D(bedDepth, uv).r);
    float edge = 1.0 - smoothstep(.8, 1.0, abs(across));
    vec2 bent = clamp(uv + (mat3(viewMatrix) * (n - baseNormal)).xy * .16 * edge * refraction, .001, .999);
    float bentDepth = viewDepth(texture2D(bedDepth, bent).r);
    if (bentDepth > front && abs(bentDepth - behind) < max(.8, .12 * behind)) {
     uv = bent;
     behind = bentDepth;
    }
    float path = max(0.0, behind - front) / max(.3, (mat3(viewMatrix) * V).z);
    vec3 transmission = exp(-vec3(.65, .24, .17) * path / clarity);
    vec3 tint = vec3(.025, .12, .095) * waterTint * (.25 + .75 * uDaylight);
    vec3 refracted = texture2D(bedColor, uv).rgb * transmission + tint * (1.0 - transmission);
    refracted += underwaterLight(vWorld, refract(-V, n, 1.0 / 1.333), path);
    float fresnel = .02 + .98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 color = mix(refracted, sky(reflect(-V, n), .07), clamp(fresnel * reflectionStrength, 0.0, 1.0));
    float bank = smoothstep(mix(.76, .62, foamFeather), .89, abs(across)) *
     (1.0 - smoothstep(mix(.94, .90, foamFeather), 1.0, abs(across))) * .48;
    vec4 field = bakedFlow ? texture2D(flowMap, (vWorld.xz - flowBounds.xy) / flowBounds.zw) : vec4(.6,.5,0,1);
    vec2 impactDelta = (vWorld.xz - impactFoam.xy) * vec2(.65, 1.0);
    float impact = impactFoam.w * (1.0 - smoothstep(.2, max(.21, impactFoam.z), length(impactDelta)));
    float coverage = clamp(bank + sqrt(field.b) * field.a * .9 + wake * .58 + impact, 0.0, 1.0);
    float foamOpacity = foamAmount * smoothstep(0.0, .35, flowSpeed);
    if (coverage > 0.0 && foamOpacity > 0.0) {
     vec2 velocity = (field.rg - .5) * 10.0;
     float cycle = fract(currentTime * .36), phase = fract(cycle + .5);
     const float tileScale = .85;
     vec2 foamUV = vWorld.xz * tileScale;
     vec2 flowUV = velocity * (tileScale / .36);
     vec2 film = mix(foamFilm(foamUV - flowUV * phase + .5, coverage),
      foamFilm(foamUV - flowUV * cycle, coverage), 1.0 - abs(cycle * 2.0 - 1.0));
     vec3 foamColor = vec3(.72, .80, .77) * (.18 + .82 * uDaylight) * mix(.5, 1.25, film.x);
     color = mix(color, foamColor, film.y * foamOpacity);
    }
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
 });
 const surface = new THREE.Mesh(new THREE.BufferGeometry(), material);
 scene.add(surface);
 const size = new THREE.Vector2();
 const viewport = new THREE.Vector4(), scissor = new THREE.Vector4();

 return {
  surface,
  material,
  uniforms,
  get depthTexture() { return capture.depthTexture; },
  get viewport() { return size; },
  render(seconds, settings) {
   renderer.getDrawingBufferSize(size);
   capture.setSize(Math.max(1, Math.floor(size.x * captureScale)), Math.max(1, Math.floor(size.y * captureScale)));
   uniforms.currentTime.value = seconds;
   uniforms.foamAmount.value = settings.foam;
   uniforms.foamFeather.value = settings.foamFeather;
   uniforms.refraction.value = settings.refraction;
   uniforms.flowSpeed.value = settings.speed;
   uniforms.rippleActive.value = ripples.active;
   uniforms.bakedFlow.value = flow.ready;
   uniforms.waveTime.value = settings.waveTime;
   uniforms.godRays.value = settings.godRays;
   if (settings.tint) uniforms.waterTint.value.set(settings.tint);
   uniforms.clarity.value = settings.clarity ?? 1;
   uniforms.reflectionStrength.value = settings.reflection ?? 1;
   if (settings.impactFoam) uniforms.impactFoam.value.copy(settings.impactFoam);
   waves.update(settings.waveHeight, settings.wavelength, settings.waveDirection, settings.waveSpread);
   const previous = renderer.getRenderTarget();
   const face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
   const scissorTest = renderer.getScissorTest();
   renderer.getViewport(viewport);
   renderer.getScissor(scissor);
   surface.visible = false;
   try {
    renderer.setRenderTarget(capture);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
   } finally {
    surface.visible = true;
    renderer.setRenderTarget(previous, face, level);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
   }
  },
  dispose() {
   scene.remove(surface);
   surface.geometry.dispose();
   capture.dispose();
   if (ownsFoam) foamTile.dispose();
   material.dispose();
  },
 };
}
