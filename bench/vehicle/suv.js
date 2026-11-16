// The demo's car: Kenney's SUV (assets/vehicle/README.md), scaled from toy size to a real length and split into what
// the vehicle module drives: a body that follows the chassis and four wheels posed by the physics. The wheel layout
// (track, axles, radius, width) is measured on the model, so the physics wheels sit where the drawn ones are.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const MODEL = new URL('../../assets/vehicle/kenney-suv.glb', import.meta.url).href;
const LENGTH = 3.9;   // m, bumper to bumper
// In the vehicle module's wheel order.
const WHEEL_NODES = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];

export async function loadSuv() {
 const {scene: body} = await new GLTFLoader().loadAsync(MODEL);
 const shell = body.getObjectByName('body');
 if (!shell) throw Error('SUV model lacks its body');
 body.updateMatrixWorld(true);
 body.scale.setScalar(LENGTH / new THREE.Box3().setFromObject(shell).getSize(new THREE.Vector3()).z);
 body.updateMatrixWorld(true);
 const bounds = new THREE.Box3().setFromObject(shell), size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
 const centres = [], sizes = [];
 const wheels = WHEEL_NODES.map(name => {
  const node = body.getObjectByName(name);
  if (!node) throw Error('SUV model lacks ' + name);
  const box = new THREE.Box3().setFromObject(node), middle = box.getCenter(new THREE.Vector3());
  centres.push(middle);
  sizes.push(box.getSize(new THREE.Vector3()));
  // The model pivots a wheel at its inner face; the vehicle module poses it by its centre.
  const holder = new THREE.Group();
  node.getWorldPosition(node.position).sub(middle);
  node.scale.copy(body.scale);
  holder.add(node);
  return holder;
 });
 for (const part of [body, ...wheels]) part.traverse(node => { if (node.isMesh) node.castShadow = true; });
 return {
  body, wheels,
  size,                 // m, of the body shell
  centreZ: centre.z,    // m, the shell's middle ahead of the model origin: where the chassis centre goes
  // Options for createVehicle, relative to the chassis centre.
  layout: {
   halfTrack: (Math.abs(centres[0].x) + Math.abs(centres[1].x)) / 2,
   frontAxle: centres[0].z - centre.z,
   rearAxle: centres[2].z - centre.z,
   wheelRadius: sizes[0].y / 2,
   wheelWidth: sizes[0].x,
  },
  dispose() {
   const resources = new Set();
   for (const part of [body, ...wheels]) part.traverse(node => {
    if (!node.isMesh) return;
    resources.add(node.geometry);
    for (const material of [].concat(node.material)) { resources.add(material); if (material.map) resources.add(material.map); }
   });
   for (const resource of resources) resource.dispose();
  },
 };
}
