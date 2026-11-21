import * as THREE from 'three';
import {createChannelSurface, createFlowBake, createRipples, CHANNEL_OBSTACLE_COUNT, skyFromWeather} from '../../src/water/index.js';
import {createBenchPondSettings} from '../water/controls.js';
import {SITE} from './layout.js';

const LOOK = {cell: .10, padding: 1.4, shoreMargin: .2, captureScale: .45, causticSegments: 92, waveVisibility: .8};
const CONTACT = {stepStrength: .32, stepRadius: .23, landingStrength: .7, landingRadius: .38, fullDepth: .45};

export function createMeadowPond({renderer, scene, camera, field, weather}) {
 const {x, z, radii: [rx, rz], level} = SITE.pond;
 const origin = [x - rx - LOOK.padding, z - rz - LOOK.padding];
 const size = [rx, rz].map(radius => Math.ceil(2 * (radius + LOOK.padding) / LOOK.cell));
 const levelAt = (wx, wz) => field.heightAt(wx, wz) < level ? level : -Infinity;
 const ripples = createRipples({origin, size, cell: LOOK.cell});
 ripples.mask((wx, wz) => levelAt(wx, wz) === level);
 const flow = createFlowBake();
 const obstacles = Array.from({length: CHANNEL_OBSTACLE_COUNT}, () => new THREE.Vector4());
 const pond = createChannelSurface({renderer, scene, camera, sky: skyFromWeather(weather, {water: true, celestial: false}),
  ripples, flow, obstacles, clipToBed: true, pondOptics: true, captureScale: LOOK.captureScale, causticSegments: LOOK.causticSegments});
 // A flat water mesh carries the exact bed heights and only covers triangles touching the shoreline.
 const geometry = field.geometry.clone(), position = geometry.attributes.position;
 const bed = field.heightMap.image.data, source = geometry.index.array, faces = [];
 const waterBounds = new THREE.Box3(), corner = new THREE.Vector3();
 for (let i = 0; i < source.length; i += 3) {
  const a = source[i], b = source[i + 1], c = source[i + 2];
  if (Math.min(bed[a], bed[b], bed[c]) >= level + LOOK.shoreMargin) continue;
  faces.push(a, b, c);
  for (const index of [a, b, c]) waterBounds.expandByPoint(corner.set(position.getX(index), level, position.getZ(index)));
 }
 for (let i = 0; i < position.count; i++) position.setY(i, 0);
 const bedHeight = new THREE.BufferAttribute(bed, 1);
 geometry.setAttribute('bedHeight', bedHeight);
 geometry.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(position.count * 3), 3));
 geometry.setIndex(faces);
 geometry.computeVertexNormals();
 pond.surface.geometry.dispose();
 pond.surface.geometry = geometry;
 pond.surface.position.y = level;
 const settings = createBenchPondSettings();
 settings.foam = settings.bankFoam = settings.godRays = 0;
 settings.planarReflection.on = false;
 settings.rippleStrength = LOOK.waveVisibility;
 const {width: columns, height: rows} = field.heightMap.image;
 const {x: west, y: north, z: spanX, w: spanZ} = field.bounds;
 const sampleIndex = (coordinate, start, span, count) => Math.round(THREE.MathUtils.clamp((coordinate - start) / span, 0, 1) * (count - 1));
 const left = sampleIndex(origin[0], west, spanX, columns), right = sampleIndex(x + rx + LOOK.padding, west, spanX, columns);
 const top = sampleIndex(origin[1], north, spanZ, rows), bottom = sampleIndex(z + rz + LOOK.padding, north, spanZ, rows);
 const lastBed = bed.slice();
 const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
 let time = 0, bedDirty = false;
 return {
  levelAt, settings,
  noteHeightSample(column, row) {
   bedDirty ||= column >= left && column <= right && row >= top && row <= bottom;
  },
  refreshBed() {
   if (!bedDirty) return;
   bedDirty = false;
   // Snow recovery can write and then restore a sample before the frame is drawn.
   let changed = false;
   for (let row = top; row <= bottom; row++) for (let column = left; column <= right; column++) {
    const index = row * columns + column;
    if (lastBed[index] === bed[index]) continue;
    lastBed[index] = bed[index];
    changed = true;
   }
   if (!changed) return;
   bedHeight.needsUpdate = true;
   ripples.mask((wx, wz) => levelAt(wx, wz) === level);
  },
  contact(event) {
   if (!(event.water > 0)) return;
   const landing = event.type === 'character:land', point = landing ? event : event.to;
   const share = Math.min(1, event.water / CONTACT.fullDepth);
   ripples.splash(point.x, point.z, share * (landing ? CONTACT.landingStrength : CONTACT.stepStrength),
    landing ? CONTACT.landingRadius : CONTACT.stepRadius);
  },
  clear: ripples.clear,
  draw(dt) {
   time += dt;
   ripples.update(dt);
   frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
   pond.surface.visible = frustum.intersectsBox(waterBounds);
   if (!pond.surface.visible) return;
   pond.render(time, settings);
  },
  dispose() { pond.dispose(); ripples.dispose(); flow.dispose(); },
 };
}
