// Vessel: a liquid in a round container (a glass, a bottle, a tube tank), after WebAquarium's water body in its tube
// mode (src/water/body.js): a surface that ripples with a ripple field (ripples.js) and a volume whose colour comes from
// what it absorbs along the path through it, so a thin edge is pale and a deep core dark. WebAquarium's absorption,
// exp(-(1 - colour) x 1.6 / clarity x 0.35 x path in m), is given exactly to Three's transmission (attenuation colour
// and distance), which also bends what is behind it, read from the scene drawn without it in the same render.
// The path is the real one, pixel by pixel, as in WebAquarium: from where the eye's ray enters the liquid to where it
// leaves it (the wall, the bottom, the surface) or meets something standing in it (contain: an ice cube, a toy, as
// the box it fills). So an opaque thing in the liquid is seen through it as it is: pale just under the surface, deep
// in colour further down, and cut by the surface where it floats. It can also take a thin dark-and-bright line where
// the rippling surface crosses it (submerge).
// The surface rises and falls with the field (its mesh follows the heights, as WebAquarium's) and takes its normals
// from the same heights (WebAquarium's normal pass), as a normal map, finer than the field. Both calm down at the rim. As WebAquarium: a meniscus where the liquid meets the glass (a dark band and a bright line
// at the waterline), and the colour capped (`maxBrightness`, its "HDR safety for bloom"), so a glint does not bloom
// into squares.
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export const VESSEL_DEFAULTS = Object.freeze({
  color: 0xc8782a,      // the liquid's colour (WebAquarium uColor): what it lets through most
  clarity: 1,           // WebAquarium clarity: higher is clearer
  scatter: .55,         // share of the light the liquid takes that it sends back in its own colour, where it absorbs
                        // (WebAquarium's in-scattering, .55): a deep liquid glows with its colour instead of going black
  ior: 1.33,            // refractive index (water 1.33, spirits about 1.36)
  heightScale: 1,       // m of surface per unit of the ripple field
  normalScale: 1,       // scale on the surface's slopes
  roughness: .03,
  segments: 64,         // around the vessel
  rings: 16,            // of the surface's mesh, from the axis to the rim (it follows the field's heights)
  detail: 3,            // normal map texels per cell of the field (its heights read smoothly between cells)
  rimCells: 3,          // cells at the rim over which the surface calms: WebAquarium's smooth round waterline (3)
  meniscusWidth: .002,  // m: the band where the liquid climbs the glass, on the side and round the surface's edge
  meniscusDark: .45,    // share of light the band loses (WebAquarium)
  meniscusBright: .35,  // brightness of the line at the waterline (WebAquarium)
  maxBrightness: 6,     // the brightest the liquid draws (WebAquarium's HDR safety for bloom)
});
export const VESSEL_LIMITS = Object.freeze({clarity: [.001, 100], scatter: [0, 2], ior: [1, 3], heightScale: [1e-5, 10], normalScale: [0, 8], roughness: [0, 1], segments: [8, 256],
  rings: [1, 128], detail: [1, 8], rimCells: [0, 16], meniscusWidth: [0, 1], meniscusDark: [0, 1], meniscusBright: [0, 4], maxBrightness: [.1, 1000]});
const FIXED = ['segments', 'rings', 'detail'];
export const VESSEL_MAX_CONTENTS = 4;   // things standing in the liquid that its path stops at (contain)
const NO_EXIT = '1e6';                  // m: a path that does not leave by this face, a ray that misses a thing
const ROUND_STEPS = 12;                 // steps from a thing's box to its rounded shape
const ROUND_REACHED = '1e-5';           // m from the rounded shape that counts as on it
const SEEN_STEPS = 10;                  // halvings of the path when looking for the last place the eye still sees
const HIDES_GROWN = '1.08';             // a thing hides as a box this much larger: the scene is read clear of its edge
// The live level (m above the still surface) at a point of the vessel's own x and z: the field's heights read between
// its cells (four texels: the field's texture is not filtered), calmed at the rim as the surface's mesh is.
const LEVEL_GLSL = /* glsl */`
uniform sampler2D uVesselRipples;
uniform vec4 uVesselField;
uniform vec2 uVesselCells;
uniform float uVesselHeightScale, uVesselRim, uVesselRadius;
float vesselHeight(vec2 cell) { return texture2D(uVesselRipples, (clamp(cell, vec2(0.0), uVesselCells - 1.0) + .5) / uVesselCells).r; }
float vesselLevel(vec2 xz) {
  vec2 at = (xz - uVesselField.xy) / uVesselField.zw * uVesselCells - .5, cell = floor(at), share = at - cell;
  float height = mix(mix(vesselHeight(cell), vesselHeight(cell + vec2(1.0, 0.0)), share.x),
    mix(vesselHeight(cell + vec2(0.0, 1.0)), vesselHeight(cell + vec2(1.0, 1.0)), share.x), share.y);
  float away = uVesselRadius - length(xz);
  return height * uVesselHeightScale * (uVesselRim > 0.0 ? clamp(away / uVesselRim, 0.0, 1.0) : step(0.0, away));
}`;
// An object in the liquid, after Three's light loop: d = m below the live surface at this point (negative above it).
const SUBMERGED_GLSL = /* glsl */`
{
  vec3 local = (uVesselInverse * vec4(vVesselWorld, 1.0)).xyz;
  float level = vesselLevel(local.xz);
  float d = level - local.y;
  if (uVesselBehind > 0.5 && d < 0.0) discard;   // the scene behind the liquid: nothing of this thing above the surface
  if (d > 0.0) gl_FragColor.rgb *= mix(vec3(1.0), exp(-uVesselAbsorb * d), uVesselTint);
  float line = smoothstep(uMeniscusWidth, 0.0, abs(d));
  gl_FragColor.rgb *= 1.0 - uMeniscusDark * line;
  gl_FragColor.rgb += uMeniscusBright * gl_FragColor.rgb * smoothstep(uMeniscusWidth * .25, 0.0, abs(d));
}`;
// The meniscus and the cap, after Three's light loop. dist: m from the waterline (down the side, in from the edge).
const MENISCUS_GLSL = /* glsl */`
{
  float dist = VESSEL_MENISCUS_DISTANCE;
  gl_FragColor.rgb *= 1.0 - uMeniscusDark * smoothstep(uMeniscusWidth, 0.0, dist);
  gl_FragColor.rgb += uMeniscusBright * gl_FragColor.rgb * smoothstep(uMeniscusWidth * .25, 0.0, dist);
  gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(uMaxBrightness));
}`;
// The path of the eye's ray through the liquid, m: from a point of its surface or side, along the ray bent into it, to
// the wall (a cylinder about y), the bottom or the surface, or to the nearest thing standing in it. A thing is its box
// with rounded edges (uVesselContentBox: half size, rounding): the ray is stepped from where it enters the box to the
// rounded shape (it is convex: a few steps of its distance reach it).
const PATH_GLSL = /* glsl */`
uniform mat4 uVesselInverse;
uniform float uVesselDepth;
uniform vec3 uVesselScatter;
uniform int uVesselContentCount;
uniform mat4 uVesselContentInverse[${VESSEL_MAX_CONTENTS}];
uniform vec4 uVesselContentBox[${VESSEL_MAX_CONTENTS}];
// The stretch of a ray inside the box of thing i, made grown times larger: x where it enters, y where it leaves (no
// stretch: y <= x).
vec2 vesselBoxSpan(int i, vec3 start, vec3 along, float grown) {
  vec3 safe = mix(along, vec3(1e-8), lessThan(abs(along), vec3(1e-8)));   // a ray along a face: no division by zero
  vec3 reach = uVesselContentBox[i].xyz * grown, one = (-reach - start) / safe, other = (reach - start) / safe;
  vec3 first = min(one, other), last = max(one, other);
  return vec2(max(max(first.x, first.y), first.z), min(min(last.x, last.y), last.z));
}
// Where a ray meets thing i, m along it (${NO_EXIT} when it misses it).
float vesselMeets(int i, vec3 worldPosition, vec3 worldRay) {
  // Affine maps keep the ray's parameter: every distance is in m along worldRay.
  vec3 start = (uVesselContentInverse[i] * vec4(worldPosition, 1.0)).xyz, along = mat3(uVesselContentInverse[i]) * worldRay;
  vec2 span = vesselBoxSpan(i, start, along, 1.0);
  if (span.y <= max(span.x, 0.0)) return ${NO_EXIT};
  float at = max(span.x, 0.0), rounding = uVesselContentBox[i].w, pace = length(along);
  if (rounding <= 0.0) return at;
  for (int pass = 0; pass < ${ROUND_STEPS}; pass++) {
    vec3 beyond = abs(start + along * at) - uVesselContentBox[i].xyz + rounding;
    float gap = length(max(beyond, 0.0)) + min(max(beyond.x, max(beyond.y, beyond.z)), 0.0) - rounding;
    if (gap < ${ROUND_REACHED}) return at;
    at += gap / pace;
    if (at > span.y) break;
  }
  return ${NO_EXIT};
}
// stopped: the thing the path ends at (-1: the vessel's own wall, bottom or surface).
float vesselPath(vec3 worldPosition, vec3 worldRay, out int stopped) {
  vec3 from = (uVesselInverse * vec4(worldPosition, 1.0)).xyz, ray = mat3(uVesselInverse) * worldRay;
  float a = dot(ray.xz, ray.xz), b = dot(from.xz, ray.xz), c = dot(from.xz, from.xz) - uVesselRadius * uVesselRadius;
  float wall = a > 1e-8 ? (-b + sqrt(max(b * b - a * c, 0.0))) / a : ${NO_EXIT};
  float bottom = ray.y < -1e-6 ? (-uVesselDepth - from.y) / ray.y : ${NO_EXIT};
  float top = ray.y > 1e-6 ? -from.y / ray.y : ${NO_EXIT};
  float path = max(min(wall, min(bottom, top)), 0.0);
  stopped = -1;
  for (int i = 0; i < ${VESSEL_MAX_CONTENTS}; i++) {
    if (i >= uVesselContentCount) break;
    float meets = vesselMeets(i, worldPosition, worldRay);
    if (meets < path) { path = meets; stopped = i; }
  }
  return path;
}
// Is a place of the liquid hidden from the eye, in the scene behind the liquid, by the part under the surface of a
// thing standing in it (another than the one the path stopped at)? The eye's straight line to the place is not the
// bent path: it can cross a thing the path went round.
bool vesselHidden(vec3 place, int stopped) {
  vec3 toPlace = place - cameraPosition;
  // The share of that line from which it runs under the surface (the vessel's own y below 0).
  float eyeHeight = (uVesselInverse * vec4(cameraPosition, 1.0)).y, placeHeight = (uVesselInverse * vec4(place, 1.0)).y;
  float under = eyeHeight > 0.0 ? eyeHeight / max(eyeHeight - placeHeight, 1e-6) : 0.0;
  for (int i = 0; i < ${VESSEL_MAX_CONTENTS}; i++) {
    if (i >= uVesselContentCount) break;
    if (i == stopped) continue;
    vec2 span = vesselBoxSpan(i, (uVesselContentInverse[i] * vec4(cameraPosition, 1.0)).xyz, mat3(uVesselContentInverse[i]) * toPlace, ${HIDES_GROWN});
    if (min(span.y, 1.0) > max(span.x, under)) return true;
  }
  return false;
}
// How far along the path the eye still sees the liquid's places (the path itself when nothing stands in front of its end).
float vesselSeenTo(vec3 worldPosition, vec3 worldRay, float path, int stopped) {
  if (!vesselHidden(worldPosition + worldRay * path, stopped)) return path;
  float seen = 0.0, hidden = path;
  for (int pass = 0; pass < ${SEEN_STEPS}; pass++) {
    float middle = (seen + hidden) * .5;
    if (vesselHidden(worldPosition + worldRay * middle, stopped)) hidden = middle; else seen = middle;
  }
  return seen;
}`;
// Three's transmission (its getIBLVolumeRefraction) with the path of this pixel instead of one thickness: the scene
// drawn without the liquid is read where the path ends, and loses what that path absorbs. That scene holds only what
// is in or behind the liquid: a thing given to contain is left out of it above the surface (see contain), so the part
// of it that stands out of the liquid, in front of the surface, is never read as if it were behind. Its part under the
// surface can still hide the path's end from the eye (screen space keeps only the nearest thing): the scene is then
// read at the last place of the path the eye still sees (after WebAquarium's rule for a refracted sample in front of
// the surface), so no copy of the thing shows beside it. What the liquid absorbs it gives back in part as its own
// colour, by the light it takes (WebAquarium's in-scattering).
const TRANSMISSION_GLSL = /* glsl */`
#ifdef USE_TRANSMISSION
{
  material.transmission = transmission;
  material.attenuationDistance = attenuationDistance;
  material.attenuationColor = attenuationColor;
  vec3 vesselEye = normalize(vWorldPosition - cameraPosition), vesselNormal = inverseTransformDirection(normal, viewMatrix);
  vec3 vesselBent = refract(vesselEye, vesselNormal, 1.0 / material.ior);
  if (dot(vesselBent, vesselBent) == 0.0) vesselBent = vesselEye;
  int vesselStopped;
  material.thickness = vesselPath(vWorldPosition, vesselBent, vesselStopped);
  vec3 vesselSeen = vWorldPosition + vesselBent * vesselSeenTo(vWorldPosition, vesselBent, material.thickness, vesselStopped);
  vec4 vesselClip = projectionMatrix * viewMatrix * vec4(vesselSeen, 1.0);
  vec4 vesselBehind = getTransmissionSample(vesselClip.xy / vesselClip.w * .5 + .5, material.roughness, material.ior);
  vec3 vesselKept = material.diffuseColor * volumeAttenuation(material.thickness, material.attenuationColor, material.attenuationDistance);
  vec3 vesselMirror = EnvironmentBRDF(vesselNormal, -vesselEye, material.specularColor, material.specularF90, material.roughness);
  material.transmissionAlpha = mix(1.0, 1.0 - (1.0 - vesselBehind.a) * (vesselKept.r + vesselKept.g + vesselKept.b) / 3.0, material.transmission);
  // totalDiffuse: the light this place takes (the liquid's own diffuse colour is white). Its brightness only: the glow
  // keeps the liquid's colour under a coloured light (a whisky stays amber in a blue room).
  vec3 vesselGlow = uVesselScatter * (1.0 - vesselKept) * luminance(totalDiffuse);
  totalDiffuse = mix(totalDiffuse, (1.0 - vesselMirror) * (vesselKept * vesselBehind.rgb + vesselGlow), material.transmission);
}
#endif`;
const ABSORB = Object.freeze({scale: 1.6, factor: .35});   // WebAquarium's absorption constants
const ATTENUATION_DISTANCE = .1;                           // m: the distance Three's attenuation colour is given at

// Per metre of path, what each channel loses (WebAquarium water/body.js).
export function vesselAbsorption(color, clarity) {
  const c = new THREE.Color(color), k = ABSORB.scale / Math.max(clarity, VESSEL_LIMITS.clarity[0]) * ABSORB.factor;
  return new THREE.Vector3((1 - c.r) * k, (1 - c.g) * k, (1 - c.b) * k);
}
// The same as Three's attenuation: the colour left after `distance` m.
function attenuation(absorb, target) {
  return target.setRGB(Math.exp(-absorb.x * ATTENUATION_DISTANCE), Math.exp(-absorb.y * ATTENUATION_DISTANCE), Math.exp(-absorb.z * ATTENUATION_DISTANCE), THREE.LinearSRGBColorSpace);
}

// ripples: a createRipples() field whose x and z are the vessel's own, centred on its axis. radius, depth: m of the
// liquid (the surface at y 0 of the group, the bottom at -depth). Settings: VESSEL_DEFAULTS. Returns {group, surface,
// body, material (the surface's), sideMaterial, materials, settings, shadowGlass, set(key, value), update(), dispose()};
// update after the ripples step. contain(object, halfSize, rounding) -> release(): an opaque thing standing in the
// liquid, as the box it fills (object: its Object3D, the box centred on it; halfSize: Vector3, half the box in the
// object's own frame; rounding: radius of its rounded edges, 0 = sharp); the liquid's path stops at it, so it shows
// through the liquid by its real depth (at most VESSEL_MAX_CONTENTS). Give its material to submerge as well: the part
// of it above the surface is then left out of the scene the liquid looks through (it stands in front of the liquid,
// not behind it).
// submerge(material, {tint}): an object's material takes the line where the live surface crosses it (tint: share of
// the liquid's colour it also takes under the surface, 0..1: 0 for a thing given to contain, which the liquid already
// tints; above 0 for one drawn over the liquid); call before other features hook the material.
// shadowGlass: what the liquid lets through, for a light shadow (lighting/shadow-casters.js): put it on the meshes'
// userData.shadowGlass to cast it.
export function createVessel({ripples, radius, depth, ...overrides} = {}) {
  if (!ripples?.texture || !ripples.bounds?.isVector4) throw new TypeError('A vessel needs a ripple field (createRipples)');
  if (!(radius > 0) || !(depth > 0)) throw new RangeError('A vessel needs a radius and a depth above 0');
  const settings = {...VESSEL_DEFAULTS};
  const check = (key, value) => {
    if (!(key in VESSEL_DEFAULTS)) throw Error('Unknown vessel setting: ' + key);
    const range = VESSEL_LIMITS[key];
    if (range && (!Number.isFinite(value) || value < range[0] || value > range[1] || (FIXED.includes(key) && !Number.isInteger(value)))) throw new RangeError('Invalid vessel ' + key);
  };
  for (const [key, value] of Object.entries(overrides)) { check(key, value); settings[key] = value; }

  const field = ripples.texture.image, [columns, rows] = [field.width, field.height];
  const size = Math.max(columns, rows) * settings.detail;   // texels across the normal map
  const normals = new THREE.DataTexture(new Uint8Array(size * size * 4), size, size);
  normals.magFilter = normals.minFilter = THREE.LinearFilter;
  normals.colorSpace = THREE.NoColorSpace;
  const material = new THREE.MeshPhysicalMaterial({transmission: 1, thickness: depth, normalMap: normals, metalness: 0});
  const meniscus = {uMeniscusWidth: {value: 0}, uMeniscusDark: {value: 0}, uMeniscusBright: {value: 0}, uMaxBrightness: {value: 0}, uVesselRadius: {value: radius}};
  const inverse = new THREE.Matrix4();   // world -> vessel
  // The liquid's volume and what stands in it, for the path of each pixel.
  const volume = {uVesselInverse: {value: inverse}, uVesselDepth: {value: depth}, uVesselScatter: {value: new THREE.Color()}, uVesselContentCount: {value: 0},
    uVesselContentInverse: {value: Array.from({length: VESSEL_MAX_CONTENTS}, () => new THREE.Matrix4())},
    uVesselContentBox: {value: Array.from({length: VESSEL_MAX_CONTENTS}, () => new THREE.Vector4())}};
  // The surface and the side share the look; each measures its distance to the waterline its own way.
  const withMeniscus = (target, distance) => {
    target.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, meniscus, volume);
      shader.vertexShader = 'varying vec3 vVesselLocal;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvVesselLocal = position;');
      shader.fragmentShader = 'varying vec3 vVesselLocal;\nuniform float uMeniscusWidth, uMeniscusDark, uMeniscusBright, uMaxBrightness, uVesselRadius;\n'
        + shader.fragmentShader.replace('#include <common>', '#include <common>\n' + PATH_GLSL)
          .replace('#include <transmission_fragment>', TRANSMISSION_GLSL)
          .replace('#include <tonemapping_fragment>', MENISCUS_GLSL.replace('VESSEL_MENISCUS_DISTANCE', distance) + '\n#include <tonemapping_fragment>');
    };
    target.customProgramCacheKey = () => 'vessel:' + distance;
    return target;
  };
  const sideMaterial = withMeniscus(material.clone(), '-vVesselLocal.y');
  withMeniscus(material, 'uVesselRadius - length(vVesselLocal.xz)');
  sideMaterial.normalMap = null;
  const shadowGlass = {color: new THREE.Color(), opacity: 1, side: THREE.FrontSide};
  const absorb = new THREE.Vector3();
  function look() {
    absorb.copy(vesselAbsorption(settings.color, settings.clarity));
    attenuation(absorb, material.attenuationColor);
    material.attenuationDistance = ATTENUATION_DISTANCE;
    for (const target of [material, sideMaterial]) {
      if (!target) continue;
      target.attenuationColor.copy(material.attenuationColor); target.attenuationDistance = ATTENUATION_DISTANCE;
      target.ior = settings.ior; target.roughness = settings.roughness;
    }
    material.normalScale.setScalar(1);
    volume.uVesselScatter.value.set(settings.color).multiplyScalar(settings.scatter);
    meniscus.uMeniscusWidth.value = settings.meniscusWidth; meniscus.uMeniscusDark.value = settings.meniscusDark;
    meniscus.uMeniscusBright.value = settings.meniscusBright; meniscus.uMaxBrightness.value = settings.maxBrightness;
    // A light crossing the whole depth: what is left of it tints the shadow.
    shadowGlass.color.setRGB(Math.exp(-absorb.x * depth), Math.exp(-absorb.y * depth), Math.exp(-absorb.z * depth), THREE.LinearSRGBColorSpace);
  }
  look();

  // A disc in rings, so its inside can follow the field (a ring from radius 0: the same uv as a circle's).
  const surfaceGeometry = new THREE.RingGeometry(0, radius, settings.segments, settings.rings).rotateX(-Math.PI / 2);
  const surfacePosition = surfaceGeometry.attributes.position;
  // The side and the bottom only: the top is the surface (a single-material mesh draws all of a geometry, so the side
  // is an open tube and the bottom its own disc, facing down).
  const side = new THREE.CylinderGeometry(radius, radius, depth, settings.segments, 1, true).translate(0, -depth / 2, 0);
  const bottom = new THREE.CircleGeometry(radius, settings.segments).rotateX(Math.PI / 2).translate(0, -depth, 0);
  const bodyGeometry = mergeGeometries([side, bottom]);
  side.dispose(); bottom.dispose();
  const surface = new THREE.Mesh(surfaceGeometry, material), body = new THREE.Mesh(bodyGeometry, sideMaterial);
  surface.name = 'vesselSurface'; body.name = 'vesselBody';
  const group = new THREE.Group();
  group.add(surface, body);

  // WebAquarium's normal pass on the CPU: the slope of the field at each texel, in the surface's uv frame (u along +x,
  // v along -z once the disc lies flat), as a tangent-space normal map; heights read smoothly between cells; flat at
  // the rim, where the field ends.
  const {x: xMin, y: zMin, z: width, w: height} = ripples.bounds;
  const cellX = width / columns, cellZ = height / rows;
  const heightAt = (x, z) => {   // bilinear, in m of the vessel's frame
    const h = field.data;
    const fx = THREE.MathUtils.clamp((x - xMin) / cellX - .5, 0, columns - 1.001), fz = THREE.MathUtils.clamp((z - zMin) / cellZ - .5, 0, rows - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, at = j * columns + i;
    return (h[at] * (1 - tx) + h[at + 1] * tx) * (1 - tz) + (h[at + columns] * (1 - tx) + h[at + columns + 1] * tx) * tz;
  };
  // 1 in the open, falling to 0 at the rim over `rimCells` cells: where the surface calms down.
  const rimWidth = () => settings.rimCells * Math.max(cellX, cellZ);
  const calm = (x, z, rim) => (rim > 0 ? THREE.MathUtils.clamp((radius - Math.hypot(x, z)) / rim, 0, 1) : 1);
  // The surface's mesh follows the field: each vertex at the live level of its place.
  function writeSurface() {
    const rim = rimWidth();
    for (let i = 0; i < surfacePosition.count; i++) {
      const x = surfacePosition.getX(i), z = surfacePosition.getZ(i);
      surfacePosition.setY(i, heightAt(x, z) * settings.heightScale * calm(x, z, rim));
    }
    surfacePosition.needsUpdate = true;
  }
  function writeNormals() {
    const out = normals.image.data, k = settings.heightScale * settings.normalScale, rim = rimWidth();
    for (let j = 0; j < size; j++) {
      const z = -((j + .5) / size * 2 - 1) * radius;   // v = (j + .5) / size runs toward -z
      for (let i = 0; i < size; i++) {
        const x = ((i + .5) / size * 2 - 1) * radius, o = (j * size + i) * 4;
        const fade = calm(x, z, rim);
        const slopeX = (heightAt(x + cellX, z) - heightAt(x - cellX, z)) / (2 * cellX) * k * fade;
        const slopeZ = (heightAt(x, z + cellZ) - heightAt(x, z - cellZ)) / (2 * cellZ) * k * fade;
        // tangent space: x = -dh/dx along u; y = -dh/dv = +dh/dz (v runs toward -z); z out of the surface.
        const nx = -slopeX, ny = slopeZ, length = Math.hypot(nx, ny, 1);
        out[o] = (nx / length * .5 + .5) * 255; out[o + 1] = (ny / length * .5 + .5) * 255; out[o + 2] = (1 / length * .5 + .5) * 255; out[o + 3] = 255;
      }
    }
    normals.needsUpdate = true;
  }
  const follow = () => { writeSurface(); writeNormals(); };
  follow();
  let wasActive = false;
  const submerged = new Set();   // the submerged materials' uniforms
  const contents = [];           // {object, box (half size, rounding)}: what stands in the liquid
  // 1 while Three draws the scene behind transmissive things (its transmission pass), 0 in every other draw. Set as
  // each contained thing is about to be drawn, from the target it is drawn into: Three's transmission target is the
  // one that is mipmapped and keeps its depth unresolved.
  const behind = {value: 0};
  const drawsBehind = renderer => {
    const target = renderer.getRenderTarget();
    return Boolean(target?.texture?.generateMipmaps && target.resolveDepthBuffer === false);
  };

  return {
    group, surface, body, material, sideMaterial, materials: [material, sideMaterial], settings, shadowGlass, normals,
    set(key, value) {
      check(key, value);
      if (FIXED.includes(key)) throw Error(`Vessel ${key} is fixed at creation`);
      settings[key] = value; look(); follow();
      return this;
    },
    contain(object, halfSize, rounding = 0) {
      if (!object?.isObject3D) throw new TypeError('A vessel contains an Object3D');
      if (!halfSize?.isVector3 || !(halfSize.x > 0 && halfSize.y > 0 && halfSize.z > 0)) throw new RangeError('A contained thing needs the half size of its box (Vector3, above 0)');
      if (!(rounding >= 0 && rounding <= Math.min(halfSize.x, halfSize.y, halfSize.z))) throw new RangeError('The rounding of a contained thing goes from 0 to its smallest half size');
      if (contents.length >= VESSEL_MAX_CONTENTS) throw new RangeError(`A vessel contains at most ${VESSEL_MAX_CONTENTS} things`);
      const entry = {object, box: new THREE.Vector4(halfSize.x, halfSize.y, halfSize.z, rounding)};
      contents.push(entry);
      // Its meshes say which draw this is, so a submerged material leaves the scene behind the liquid above the surface.
      const hooked = [];
      object.traverse(child => {
        if (!child.isMesh) return;
        const previous = child.onBeforeRender;
        child.onBeforeRender = function (renderer, ...rest) { behind.value = drawsBehind(renderer) ? 1 : 0; previous.call(this, renderer, ...rest); };
        hooked.push([child, previous]);
      });
      return () => {
        const at = contents.indexOf(entry);
        if (at >= 0) contents.splice(at, 1);
        for (const [child, previous] of hooked) child.onBeforeRender = previous;
      };
    },
    submerge(target, {tint = 1} = {}) {
      if (!target?.isMaterial) throw new TypeError('Submerge takes a material');
      if (!(tint >= 0 && tint <= 1)) throw new RangeError('Submerged tint is a share, 0 to 1');
      const uniforms = {...meniscus, uVesselInverse: {value: inverse}, uVesselField: {value: ripples.bounds}, uVesselRipples: {value: ripples.texture},
        uVesselCells: {value: new THREE.Vector2(columns, rows)}, uVesselRim: {value: rimWidth()}, uVesselBehind: behind,
        uVesselHeightScale: {value: settings.heightScale}, uVesselAbsorb: {value: absorb}, uVesselTint: {value: tint}};
      submerged.add(uniforms);
      const previous = target.onBeforeCompile;
      target.onBeforeCompile = function (shader, renderer) {
        previous.call(this, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = 'varying vec3 vVesselWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvVesselWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = 'varying vec3 vVesselWorld;\nuniform mat4 uVesselInverse;\n' + LEVEL_GLSL
          + '\nuniform float uVesselTint, uVesselBehind, uMeniscusWidth, uMeniscusDark, uMeniscusBright;\nuniform vec3 uVesselAbsorb;\n'
          + shader.fragmentShader.replace('#include <tonemapping_fragment>', SUBMERGED_GLSL + '\n#include <tonemapping_fragment>');
      };
      const key = target.customProgramCacheKey;
      target.customProgramCacheKey = function () { return key.call(this) + '|vessel-submerged'; };
      target.needsUpdate = true;
      return target;
    },
    // After the ripples step: the surface follows the field while it moves (and once more when it settles).
    update() {
      group.updateWorldMatrix(true, false);
      inverse.copy(group.matrixWorld).invert();
      for (const uniforms of submerged) { uniforms.uVesselHeightScale.value = settings.heightScale; uniforms.uVesselRim.value = rimWidth(); }
      volume.uVesselContentCount.value = contents.length;
      contents.forEach(({object, box}, index) => {
        object.updateWorldMatrix(true, false);
        volume.uVesselContentInverse.value[index].copy(object.matrixWorld).invert();
        volume.uVesselContentBox.value[index].copy(box);
      });
      const active = ripples.active;
      if (active || wasActive) follow();
      wasActive = active;
    },
    dispose() { surfaceGeometry.dispose(); bodyGeometry.dispose(); material.dispose(); sideMaterial.dispose(); normals.dispose(); group.removeFromParent(); },
  };
}
