import * as THREE from 'three';
import {CHANNEL_OBSTACLE_COUNT, createChannelSurface, createFlowBake, createRipples, proceduralSky} from '../../src/water/index.js';
import {createBenchPondSettings} from '../water/controls.js';
import {BASIN} from './courtyard.js';

const WATER = {
 grid: 48, captureScale: .4, causticSegments: 64,
 rippleCell: .04, rippleSubsteps: 3, velocityRetention: .988, rippleVisibility: .68,
 landing: {strengthScale: 1.7, radiusScale: 1.25},
};

// Water above her feet, in metres. Blend through the bands as she steps onto a different shelf.
const ANKLE = {depth: .11, strength: .24, radius: .15};
const SHIN = {depth: .28, strength: .32, radius: .18};
const KNEE = {depth: .45, strength: .43, radius: .22};

export function wadeRipple(depth) {
 const [from, to] = depth <= SHIN.depth ? [ANKLE, SHIN] : [SHIN, KNEE];
 const blend = THREE.MathUtils.smoothstep(depth, from.depth, to.depth);
 const wet = THREE.MathUtils.smoothstep(depth, 0, ANKLE.depth);
 return {
  strength: wet * THREE.MathUtils.lerp(from.strength, to.strength, blend),
  radius: THREE.MathUtils.lerp(from.radius, to.radius, blend),
 };
}

export function cisternLevelAt(x, z) {
 return x > BASIN.x[0] && x < BASIN.x[1] && z > BASIN.z[0] && z < BASIN.z[1] ? BASIN.level : -Infinity;
}

export function createCistern({renderer, scene, camera, sunDirection}) {
 const width = BASIN.x[1] - BASIN.x[0], length = BASIN.z[1] - BASIN.z[0];
 const ripples = createRipples({origin: [BASIN.x[0], BASIN.z[0]], size: [
  Math.ceil(width / WATER.rippleCell), Math.ceil(length / WATER.rippleCell),
 ], cell: WATER.rippleCell, substeps: WATER.rippleSubsteps, velocityRetention: WATER.velocityRetention});
 ripples.mask((x, z) => Number.isFinite(cisternLevelAt(x, z)));
 const flow = createFlowBake();
 const obstacles = Array.from({length: CHANNEL_OBSTACLE_COUNT}, () => new THREE.Vector4());
 const pond = createChannelSurface({renderer, scene, camera, sky: proceduralSky(sunDirection), ripples, flow, obstacles,
  captureScale: WATER.captureScale, causticSegments: WATER.causticSegments, pondOptics: true});
 const surface = new THREE.PlaneGeometry(width, length, WATER.grid, WATER.grid);
 surface.rotateX(-Math.PI / 2);
 surface.translate((BASIN.x[0] + BASIN.x[1]) / 2, 0, (BASIN.z[0] + BASIN.z[1]) / 2);
 surface.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(surface.attributes.position.count * 3), 3));
 pond.surface.geometry.dispose();
 pond.surface.geometry = surface;
 pond.surface.position.y = BASIN.level;
 const settings = createBenchPondSettings();
 settings.rippleStrength = WATER.rippleVisibility;
 settings.planarReflection.on = false;
 settings.foam = settings.bankFoam = settings.godRays = 0;
 const viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum();
 let time = 0;
 return {
  contact(event) {
   if (!(event.water > 0)) return;
   const {strength, radius} = wadeRipple(event.water);
   if (event.type === 'character:track') ripples.splash(event.to.x, event.to.z, strength, radius);
   if (event.type === 'character:land') {
    ripples.splash(event.x, event.z, strength * WATER.landing.strengthScale, radius * WATER.landing.radiusScale);
   }
  },
  draw(dt) {
   time += dt;
   ripples.update(dt);
   pond.surface.updateMatrixWorld();
   frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
   if (frustum.intersectsObject(pond.surface)) pond.render(time, settings);
  },
  dispose() { pond.dispose(); ripples.dispose(); flow.dispose(); },
 };
}
